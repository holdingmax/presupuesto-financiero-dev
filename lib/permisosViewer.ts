import type { Rol } from "@prisma/client";

// Rol VIEWER (solo lectura). Archivo PURO (sin Prisma, next/* ni lib/auth) a propósito: así lo pueden importar
// lib/permisosEjecucion.ts, lib/presupuestoAcceso.ts, las acciones y los tests sin ciclos, y la lógica nueva queda
// fuera de lib/auth.ts.
//
// Regla única: un VIEWER NUNCA escribe, tenga las casillas que tenga en la base (operaEjecucion,
// puedeOperarEjecucion, puedeRevisarPresupuesto). Cada permiso de escritura del sistema tiene que fallar para él;
// requireEscritura es el candado explícito que va al principio de TODA acción que modifica algo, y
// test/estatico (lib/__tests__/accionesServidorGuards.test.ts) falla si una acción nueva no lo tiene.

export type ConRol = { rol: Rol | string };

export function esViewer(usuario: ConRol): boolean {
  return usuario.rol === "VIEWER";
}

export const MENSAJE_SIN_ACCESO_A_PANTALLA = "No tenés acceso a esta pantalla.";
export const MENSAJE_VIEWER_NO_ESCRIBE = "Tu usuario es de solo lectura: no puede modificar nada.";
export const AVISO_REPORTE_SOLO_LECTURA = "Tu usuario es de solo lectura: podés ver el Reporte, pero no cargar valores.";

// Error propio (no AccesoDenegadoError/PermisoDenegadoError, que viven en lib/auth.ts) para no depender de ese archivo.
export class SoloLecturaError extends Error {
  constructor(mensaje: string = MENSAJE_VIEWER_NO_ESCRIBE) {
    super(mensaje);
    this.name = "SoloLecturaError";
  }
}

// Guard de escritura: tira SoloLecturaError si el usuario es VIEWER. Síncrono y sin base: se llama con el usuario
// que ya devolvió requireUsuario/requireUsuarioAlDia/requireAccesoEmpresa. Devuelve el mismo usuario para poder
// encadenarlo: `const usuario = requireEscritura(await requireUsuarioAlDia())`.
export function requireEscritura<T extends ConRol>(usuario: T): T {
  if (esViewer(usuario)) throw new SoloLecturaError();
  return usuario;
}

// Los permisos de escritura que un VIEWER no puede tener. Los usa /admin/usuarios para forzarlos en false en el
// servidor al crear o cambiar a un VIEWER, sin confiar en lo que mande el formulario.
export const PERMISOS_FORZADOS_VIEWER = {
  operaEjecucion: false,
  puedeOperarEjecucion: false,
  puedeRevisarPresupuesto: false,
} as const;

// ---- Bloques reservados del Reporte (Disponibilidades y Cierre) -------------------------------------------------
//
// ÚNICO punto donde se decide qué bloques reservados le llegan a quien mira el Reporte. La pantalla (reporte/page.tsx)
// y el Excel (reporte/excel/route.ts) arman su `armarReporteDePlantilla` con el MISMO objeto que devuelve esta función,
// así no pueden divergir.
//
//  - `verBloquesReservados`: ve todo lo reservado (como ADMIN y FINANZAS) y lo que cuelga de eso en el Reporte.
//  - `sinBloquesReservados`: se arma SIN Disponibilidades ni Cierre y gana sobre los interruptores de lib/config.ts
//    (que son para el gerente). Solo el VIEWER sin casilla.
//
// `veTodoPorRol` = lo que ya decide el rol (veBloquesReservadosDelReporte, lib/permisosEjecucion.ts: ADMIN y FINANZAS).
// Se recibe como parámetro, y no se repite acá, para no duplicar esa regla ni crear un ciclo de imports con
// lib/permisosEjecucion.ts (que ya importa esViewer de este archivo).
//
// La casilla `veBloquesReservados` de la base SOLO cuenta si el rol es VIEWER: con cualquier otro rol se ignora, tenga
// el valor que tenga. Para un VIEWER la regla por rol no cuenta (nunca fue ADMIN ni FINANZAS): decide solo la casilla.
export type UsuarioConCasillaReservados = ConRol & { veBloquesReservados?: boolean };

export type BloquesReservadosDelUsuario = {
  verBloquesReservados: boolean;
  sinBloquesReservados: boolean;
};

export function bloquesReservadosDelUsuario(
  usuario: UsuarioConCasillaReservados,
  veTodoPorRol: boolean
): BloquesReservadosDelUsuario {
  if (!esViewer(usuario)) return { verBloquesReservados: veTodoPorRol, sinBloquesReservados: false };
  const conCasilla = usuario.veBloquesReservados === true;
  return { verBloquesReservados: conCasilla, sinBloquesReservados: !conCasilla };
}

// Valor que se guarda de la casilla al crear o editar un usuario (lo usa lib/usuarioDatos.ts). Fuera del VIEWER siempre
// false; para un VIEWER, lo que mandó el formulario.
export function casillaReservadosSegunRol(rol: string, marcada: boolean): boolean {
  return esViewer({ rol }) && marcada;
}
