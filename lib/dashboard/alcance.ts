import type { Rol } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUsuarioAlDia } from "@/lib/auth";
import { slugDeEmpresa } from "@/lib/slug";
import { detectarUnidadesRepetidas, unidadesNormalizadas } from "@/lib/dashboard/unidades";

// ALCANCE del Dashboard consolidado (Entrega 1: base de seguridad). Es lo único que dice QUÉ empresas y QUÉ unidades de
// negocio puede mirar un usuario; toda consulta del dashboard lo recibe y filtra con él, en el servidor.
//
//  - ADMIN: todas las empresas activas. El resto (FINANZAS, GERENTE, VIEWER): las empresas activas que tiene asignadas en
//    UsuarioEmpresa, con el mismo criterio que la pantalla «Mis empresas» (app/page.tsx) y que puedeAccederEmpresa
//    (lib/auth.ts): ADMIN siempre, el resto solo con una fila asignada.
//  - Se calcula SIEMPRE a partir del usuario de la sesión (resolverAlcanceDeSesion). Nunca recibe empresas, unidades ni
//    ningún dato que pueda mandar el navegador.
//  - Solo este archivo puede CREAR un Alcance: el tipo lleva una marca que no se exporta y cada función de consulta llama a
//    exigirAlcance, que rechaza cualquier objeto que no haya salido de acá (por ejemplo un literal con `as Alcance` o una
//    copia con `{ ...alcance }`).
//  - Sin empresas asignadas el alcance es vacío y las consultas ni tocan la base.
//  - Las unidades de negocio tienen que ser de UNA sola empresa: si dos empresas activas comparten una, el alcance NO se
//    arma (falla cerrado). Esa regla hoy solo la controla /admin/unidades-negocio; la base no la impide.

declare const marcaAlcance: unique symbol;

export type EmpresaDelAlcance = Readonly<{
  id: string;
  nombre: string;
  slug: string;
  // Unidades normalizadas (mayúsculas, sin espacios de más), sin repetir.
  unidades: readonly string[];
}>;

export type Alcance = Readonly<{
  empresas: readonly EmpresaDelAlcance[];
  // Unión de las unidades de esas empresas, normalizadas, sin repetir, en orden: lo que se pasa al SQL.
  unidades: readonly string[];
  // No tiene ninguna empresa: no hay nada que consultar.
  vacio: boolean;
  // true solo para ADMIN: el alcance ES el holding completo. Para el resto nunca es el holding, y ningún rótulo puede
  // llamarlo así (lib/dashboard/sinDeduccion.ts: rotuloDeTotal).
  esHolding: boolean;
}> & { readonly [marcaAlcance]: true };

// Alcances que salieron de construirAlcance. No se exporta: nadie más puede agregar objetos.
const CREADOS = new WeakSet<object>();

export function exigirAlcance(alcance: Alcance): Alcance {
  if (typeof alcance !== "object" || alcance === null || !CREADOS.has(alcance)) {
    throw new Error("Alcance inválido: solo lo crea resolverAlcance.");
  }
  return alcance;
}

// ---- Lectura de empresas -----------------------------------------------------------------------------------------

export type EmpresaLeida = { id: string; nombre: string; activo: boolean; unidadesNegocio: string[] };

// Lo único que el resolvedor lee de la base. Se puede inyectar para probarlo sin base; el código de producción no lo pasa.
export type LectorDeEmpresas = {
  // Las empresas ACTIVAS que ese usuario tiene asignadas (misma consulta que app/page.tsx).
  asignadasActivas(usuarioId: string): Promise<EmpresaLeida[]>;
  // Todas las empresas activas: solo para comprobar que ninguna unidad esté repetida; nunca se devuelven al usuario.
  todasLasActivas(): Promise<EmpresaLeida[]>;
};

const SELECCION = { id: true, nombre: true, activo: true, unidadesNegocio: true } as const;

const LECTOR_PRISMA: LectorDeEmpresas = {
  asignadasActivas: (usuarioId) =>
    prisma.empresa.findMany({
      where: { activo: true, usuarios: { some: { usuarioId } } },
      orderBy: { nombre: "asc" },
      select: SELECCION,
    }),
  todasLasActivas: () =>
    prisma.empresa.findMany({ where: { activo: true }, orderBy: { nombre: "asc" }, select: SELECCION }),
};

// ---- Resolvedor --------------------------------------------------------------------------------------------------

export type UsuarioParaAlcance = { id: string; rol: Rol | string };

const ERROR_UNIDAD_REPETIDA =
  "No se puede calcular el alcance: hay una unidad de negocio asignada a más de una empresa. Revisá /admin/unidades-negocio.";

function construirAlcance(empresas: readonly EmpresaLeida[], esHolding: boolean): Alcance {
  const lista = empresas
    .filter((e) => e.activo)
    .map((e): EmpresaDelAlcance => Object.freeze({
      id: e.id,
      nombre: e.nombre,
      slug: slugDeEmpresa(e.nombre),
      unidades: Object.freeze(unidadesNormalizadas(e.unidadesNegocio)),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const alcance = Object.freeze({
    empresas: Object.freeze(lista),
    unidades: Object.freeze(unidadesNormalizadas(lista.flatMap((e) => [...e.unidades]))),
    vacio: lista.length === 0,
    esHolding,
  }) as unknown as Alcance;
  CREADOS.add(alcance);
  return alcance;
}

// Alcance de un usuario. `usuario` es SIEMPRE el de la sesión (o, en un envío programado, el destinatario cargado de la
// base): nunca algo armado con datos del navegador. El segundo parámetro es solo para pruebas.
export async function resolverAlcance(
  usuario: UsuarioParaAlcance,
  lector: LectorDeEmpresas = LECTOR_PRISMA
): Promise<Alcance> {
  const esAdmin = usuario.rol === "ADMIN";

  if (esAdmin) {
    const todas = await lector.todasLasActivas();
    if (detectarUnidadesRepetidas(todas.filter((e) => e.activo)).length > 0) throw new Error(ERROR_UNIDAD_REPETIDA);
    return construirAlcance(todas, true);
  }

  const asignadas = (await lector.asignadasActivas(usuario.id)).filter((e) => e.activo);
  // Sin empresas asignadas: alcance vacío y no se consulta nada más.
  if (asignadas.length === 0) return construirAlcance([], false);

  // Que cada unidad sea de una sola empresa se comprueba contra TODAS las activas: si una unidad de este usuario fuera
  // también de una empresa que no tiene asignada, sus números incluirían movimientos ajenos. Una repetición entre dos
  // empresas que no tocan sus unidades no lo afecta (no se corta el dashboard de todos por un error ajeno).
  const alcance = construirAlcance(asignadas, false);
  const todas = await lector.todasLasActivas();
  const propias = new Set(alcance.unidades);
  if (detectarUnidadesRepetidas(todas.filter((e) => e.activo)).some((r) => propias.has(r.unidad))) {
    throw new Error(ERROR_UNIDAD_REPETIDA);
  }
  return alcance;
}

// Alcance del usuario que tiene la sesión abierta: lo que usan las pantallas y las rutas del dashboard.
export async function resolverAlcanceDeSesion(): Promise<Alcance> {
  const usuario = await requireUsuarioAlDia();
  return resolverAlcance(usuario);
}
