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

// Excel del Reporte: el VIEWER nunca recibe los bloques reservados (Disponibilidades y Cierre), aunque otra regla
// los dejara pasar. Se aplica sobre el flag que ya calcula veBloquesReservadosDelReporte.
export function verBloquesReservadosSiNoEsViewer(usuario: ConRol, veBloques: boolean): boolean {
  return veBloques && !esViewer(usuario);
}
