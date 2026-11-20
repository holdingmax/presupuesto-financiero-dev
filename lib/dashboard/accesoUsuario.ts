import type { Rol } from "@prisma/client";
import type { Alcance } from "@/lib/dashboard/alcance";
import { bloquesReservadosDelUsuario, type UsuarioConCasillaReservados } from "@/lib/permisosViewer";
import { puedeCerrarEjecucion, veBloquesReservadosDelReporte, veTodoEjecucion } from "@/lib/permisosEjecucion";

// Qué deja ver el rol del usuario DENTRO de su alcance (Entrega 2). Módulo PURO. El Alcance dice QUÉ empresas; esto dice CUÁNTO
// de cada una (bloques reservados, saldos). Siempre con las mismas reglas que el Reporte y Ejecución: acá no se repite ninguna.

// El usuario de la sesión (lo mismo que se le pasa a resolverAlcance, más lo que decide los permisos): rol, la casilla de
// bloques reservados del VIEWER (la decide bloquesReservadosDelUsuario) y operaEjecucion.
export type UsuarioParaDashboard = UsuarioConCasillaReservados & { operaEjecucion: boolean };

export type AccesoDelDashboard = Readonly<{
  esAdminOFinanzas: boolean;
  // Mismos flags que le pasan la pantalla y el Excel del Reporte a armarReporteDePlantilla (el mismo objeto de
  // bloquesReservadosDelUsuario).
  verBloquesReservados: boolean;
  sinBloquesReservados: boolean;
  // Saldos (y por lo tanto «saldo faltante»): quien ve todo Ejecución.
  verSaldos: boolean;
}>;

export function accesoDelDashboard(usuario: UsuarioParaDashboard): AccesoDelDashboard {
  const u = usuario as { rol: Rol; operaEjecucion: boolean };
  const bloques = bloquesReservadosDelUsuario(usuario, veBloquesReservadosDelReporte(u));
  return Object.freeze({
    esAdminOFinanzas: puedeCerrarEjecucion(u),
    verBloquesReservados: bloques.verBloquesReservados,
    sinBloquesReservados: bloques.sinBloquesReservados,
    verSaldos: veTodoEjecucion(u),
  });
}

// El alcance y el usuario tienen que ser de la MISMA sesión: el holding es solo de ADMIN. Si no coinciden (un alcance de ADMIN
// con los permisos de otro rol, o al revés), se corta: nunca se mezclan los permisos de uno con las empresas de otro.
export function exigirAlcanceDelUsuario(alcance: Alcance, usuario: UsuarioParaDashboard): void {
  if (alcance.esHolding !== (usuario.rol === "ADMIN")) {
    throw new Error("El alcance no corresponde al usuario.");
  }
}
