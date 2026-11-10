import type { Rol } from "@prisma/client";

// Quién puede CARGAR EL REAL de una empresa (tipeo directo del Reporte y pantalla /reporte/carga).
// Puro (sin Prisma ni next/*) para poder probarlo; la parte con base de datos vive en
// lib/cargaRealEmpresa.ts.
//
// - ADMIN y FINANZAS: siempre (como hasta ahora; el acceso a la empresa se sigue exigiendo aparte).
// - GERENTE: solo en las empresas donde su fila de UsuarioEmpresa tiene puedeOperarEjecucion = true
//   («Puede cargar Real de esta empresa» en /admin/usuarios). Por empresa: el tilde de una no vale en otra.
// - Cualquier otro caso: no.

export type AccesoParaCargarReal = { puedeOperarEjecucion: boolean } | null | undefined;

export function puedeCargarRealConAcceso(usuario: { rol: Rol }, acceso: AccesoParaCargarReal): boolean {
  if (usuario.rol === "ADMIN" || usuario.rol === "FINANZAS") return true;
  return usuario.rol === "GERENTE" && acceso != null && acceso.puedeOperarEjecucion === true;
}

export const ERROR_SIN_PERMISO_DE_CARGAR_REAL =
  "Solo ADMIN y FINANZAS, o un gerente con permiso de cargar el Real de esta empresa, pueden cargar valores desde el Reporte.";
