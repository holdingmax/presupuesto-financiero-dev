import type { Prisma, Rol } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CLASIFICACIONES_SUGERIDAS } from "@/lib/clasificaciones";
import { clasificacionesOcultasParaUsuario, normalizarClasificacion } from "@/lib/clasificacionesOcultas";
import { obtenerValoresOcultos } from "@/lib/ocultasGerenteDb";
import { slugDeEmpresa } from "@/lib/slug";
import { CLASIFICACION_SIN_CLASIFICAR } from "@/lib/filtroClasificacionEmpresa";
import {
  ERROR_CAMBIO_CONCURRENTE,
  ERROR_MOVIMIENTO_NO_ENCONTRADO,
  ERROR_SEMANA_CERRADA,
  ERROR_SIN_PERMISO_DE_CLASIFICAR,
  clasificacionesPropiasDeEmpresa,
  puedeClasificarEnEmpresa,
  validarEdicionEmpresa,
  type TipoSugerencia,
} from "@/lib/clasificarPorEmpresa";

// Parte con base de datos de "clasificar los movimientos de mi empresa" (reglas puras en lib/clasificarPorEmpresa.ts). NO es
// "use server": no se expone como endpoint. La Server Action (app/[empresa]/[periodo]/ejecucion/actionsClasificar.ts) solo
// autentica y llama acá. Cada función RECIBE el usuario y vuelve a decidir todo por su cuenta (permiso por empresa, empresa
// activa con unidades, semana ABIERTA, movimiento de la semana y de una unidad de la empresa): el guard es de servidor.
// Toca únicamente clasificacion / unidadNegocio / ignorado / las marcas de sugerencia de movimientos de las unidades de la
// empresa. Nunca cierra la semana, ni borra, ni prorratea.

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

export type UsuarioParaClasificar = { id: string; rol: Rol; operaEjecucion: boolean };

export type ResultadoEdicionEmpresa = { ok: true } | { ok: false; error: string };
export type ResultadoConfirmarEmpresa = { ok: true; cantidad: number } | { ok: false; error: string };

type Contexto = {
  empresa: { id: string; nombre: string; unidadesNegocio: string[] };
  ejecucion: { id: string; estado: string };
};

async function resolverContexto(
  usuario: UsuarioParaClasificar,
  empresaId: string,
  periodo: string,
  numeroSemana: number
): Promise<{ ok: true; ctx: Contexto } | { ok: false; error: string }> {
  // 1) Permiso por empresa: la casilla de ESTA empresa (la de otra no vale).
  const acceso = await prisma.usuarioEmpresa.findUnique({
    where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId } },
    select: { puedeOperarEjecucion: true },
  });
  if (!puedeClasificarEnEmpresa(usuario, acceso)) return { ok: false, error: ERROR_SIN_PERMISO_DE_CLASIFICAR };

  // 2) Empresa activa y con unidades: son las únicas que se pueden tocar.
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, nombre: true, activo: true, unidadesNegocio: true },
  });
  if (!empresa || !empresa.activo) return { ok: false, error: "No encontré esa empresa o está inactiva." };
  if (empresa.unidadesNegocio.length === 0) return { ok: false, error: "Esta empresa no tiene unidades de negocio asignadas." };

  // 3) Semana existente y ABIERTA.
  if (!FORMATO_PERIODO.test(periodo)) return { ok: false, error: `"${periodo}" no es un período válido (AAAA-MM).` };
  if (!Number.isInteger(numeroSemana) || numeroSemana < 1) return { ok: false, error: "La semana no es válida." };
  const ejecucion = await prisma.ejecucionSemanal.findUnique({
    where: { periodo_numeroSemana: { periodo, numeroSemana } },
    select: { id: true, estado: true },
  });
  if (!ejecucion) return { ok: false, error: `No encontré la semana ${numeroSemana}.` };
  if (ejecucion.estado === "CERRADA") return { ok: false, error: ERROR_SEMANA_CERRADA };

  return { ok: true, ctx: { empresa, ejecucion } };
}

// Las clasificaciones que ESTA empresa puede elegir (y las únicas que se aceptan al guardar): las canónicas del sistema más las
// que ya usan los movimientos de SUS unidades, sin las que este usuario no ve. «SIN CLASIFICAR» siempre está: es lo que entra
// por defecto y tiene que poder volver a elegirse para deshacer. A propósito NO es la lista global de la base
// (calcularClasificacionesDisponibles): esa trae valores de otras empresas y las pantallas de empresa no la usan.
//
// Si la empresa tiene lista PROPIA (lib/config.ts: CLASIFICACIONES_POR_EMPRESA, hoy solo Bradenton), esa lista —y nada más— es
// lo que se ofrece y se acepta: «SIN CLASIFICAR» primero y después las suyas en el orden configurado, sin consultar la base. Un
// valor que una fila ya tenga fuera de la lista se sigue mostrando (la tabla lo agrega como opción actual) pero no se puede
// volver a elegir.
export async function clasificacionesParaEditar(
  unidades: string[],
  ocultasNormalizadas: readonly string[],
  slugEmpresa?: string
): Promise<string[]> {
  const propias = slugEmpresa === undefined ? null : clasificacionesPropiasDeEmpresa(slugEmpresa);
  if (propias !== null) {
    const ocultas = new Set(ocultasNormalizadas);
    return Array.from(new Set([CLASIFICACION_SIN_CLASIFICAR, ...propias])).filter((c) => !ocultas.has(normalizarClasificacion(c)));
  }
  const usadas =
    unidades.length === 0
      ? []
      : (await prisma.movimientoBancario.groupBy({ by: ["clasificacion"], where: { unidadNegocio: { in: unidades } } })).map((f) => f.clasificacion);
  const fuera = new Set(ocultasNormalizadas);
  return Array.from(new Set([...CLASIFICACIONES_SUGERIDAS, CLASIFICACION_SIN_CLASIFICAR, ...usadas]))
    .filter((c) => !fuera.has(normalizarClasificacion(c)))
    .sort((a, b) => a.localeCompare(b, "es"));
}

// Clasificar / cambiar de unidad (dentro de las de la empresa) / ignorar UN movimiento.
export async function editarMovimientoDeEmpresa(
  usuario: UsuarioParaClasificar,
  empresaId: string,
  periodo: string,
  numeroSemana: number,
  movimientoId: string,
  datos: unknown
): Promise<ResultadoEdicionEmpresa> {
  const r = await resolverContexto(usuario, empresaId, periodo, numeroSemana);
  if (!r.ok) return r;
  const { empresa, ejecucion } = r.ctx;

  // El movimiento tiene que ser de ESTA semana (no de otra).
  const movimiento = await prisma.movimientoBancario.findFirst({
    where: { id: movimientoId, ejecucionId: ejecucion.id },
    select: { unidadNegocio: true, clasificacion: true, _count: { select: { desglose: true } } },
  });
  if (!movimiento) return { ok: false, error: ERROR_MOVIMIENTO_NO_ENCONTRADO };

  const ocultasNormalizadas = clasificacionesOcultasParaUsuario(slugDeEmpresa(empresa.nombre), usuario);
  const v = validarEdicionEmpresa({
    datos,
    movimiento: { unidadNegocio: movimiento.unidadNegocio, clasificacion: movimiento.clasificacion, cantidadDesglose: movimiento._count.desglose },
    unidadesEmpresa: empresa.unidadesNegocio,
    estadoSemana: ejecucion.estado,
    clasificacionesValidas: await clasificacionesParaEditar(empresa.unidadesNegocio, ocultasNormalizadas, slugDeEmpresa(empresa.nombre)),
    ocultasNormalizadas,
  });
  if (!v.ok) return v;

  // Escritura atómica con las mismas condiciones: si en el medio el movimiento cambió de unidad, se prorrateó o la semana
  // se cerró, no actualiza nada.
  const res = await prisma.movimientoBancario.updateMany({
    where: {
      id: movimientoId,
      ejecucionId: ejecucion.id,
      unidadNegocio: { in: empresa.unidadesNegocio },
      desglose: { none: {} },
      ejecucion: { estado: "ABIERTA" },
    },
    data: v.data,
  });
  if (res.count !== 1) return { ok: false, error: ERROR_CAMBIO_CONCURRENTE };
  return { ok: true };
}

// Condición común de los lotes: solo movimientos de las unidades de la empresa, sin prorrateo, de una semana ABIERTA, y
// sin las clasificaciones que este usuario no ve.
function dondeDeLaEmpresa(ejecucionId: string, unidades: string[], ocultosGuardados: string[]): Prisma.MovimientoBancarioWhereInput {
  return {
    ejecucionId,
    unidadNegocio: { in: unidades },
    desglose: { none: {} },
    ejecucion: { estado: "ABIERTA" },
    ...(ocultosGuardados.length > 0 ? { clasificacion: { notIn: ocultosGuardados } } : {}),
  };
}

// Confirma de una vez las sugerencias sin confirmar de las unidades de la empresa: las de clasificación (nunca un cheque
// de IVA ambiguo: esos se revisan de a uno, como en Ejecución global) o las de unidad. Solo apaga la marca "sugerida":
// no cambia la clasificación ni la unidad.
export async function confirmarSugerenciasDeEmpresa(
  usuario: UsuarioParaClasificar,
  empresaId: string,
  periodo: string,
  numeroSemana: number,
  tipo: TipoSugerencia
): Promise<ResultadoConfirmarEmpresa> {
  const r = await resolverContexto(usuario, empresaId, periodo, numeroSemana);
  if (!r.ok) return r;
  const { empresa, ejecucion } = r.ctx;
  if (tipo !== "clasificacion" && tipo !== "unidad") return { ok: false, error: "Tipo de sugerencia no válido." };

  const ocultos = await obtenerValoresOcultos(ejecucion.id, slugDeEmpresa(empresa.nombre), usuario);
  const donde = dondeDeLaEmpresa(ejecucion.id, empresa.unidadesNegocio, ocultos);
  const res =
    tipo === "clasificacion"
      ? await prisma.movimientoBancario.updateMany({
          where: { ...donde, sugeridaPorSistema: true, chequeIvaAmbiguo: false },
          data: { sugeridaPorSistema: false },
        })
      : await prisma.movimientoBancario.updateMany({
          where: { ...donde, unidadSugeridaPorSistema: true },
          data: { unidadSugeridaPorSistema: false },
        });
  if (res.count === 0) return { ok: false, error: "No hay ninguna sugerencia para confirmar." };
  return { ok: true, cantidad: res.count };
}

// Para la pantalla: cuántas sugerencias sin confirmar tiene la empresa en la semana (mismas condiciones que el lote).
export async function contarSugerenciasDeEmpresa(
  ejecucionId: string,
  unidades: string[],
  ocultosGuardados: string[]
): Promise<{ clasificacion: number; unidad: number }> {
  if (unidades.length === 0) return { clasificacion: 0, unidad: 0 };
  const donde = dondeDeLaEmpresa(ejecucionId, unidades, ocultosGuardados);
  const [clasificacion, unidad] = await Promise.all([
    prisma.movimientoBancario.count({ where: { ...donde, sugeridaPorSistema: true, chequeIvaAmbiguo: false } }),
    prisma.movimientoBancario.count({ where: { ...donde, unidadSugeridaPorSistema: true } }),
  ]);
  return { clasificacion, unidad };
}
