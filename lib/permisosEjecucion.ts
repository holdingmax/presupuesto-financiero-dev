import type { Rol } from "@prisma/client";
import { esViewer } from "@/lib/permisosViewer";

// Permisos de Ejecución global (docs/ejecucion_global_plan.md §3.3, D-3 y D-4).
// Puros (sin Prisma ni next/headers) para poder probarlos; lib/auth.ts los usa en
// requireOperadorEjecucionGlobal y requireCierreEjecucion.

type ConRol = { rol: Rol };
type ConPermisoDeOperar = ConRol & { operaEjecucion: boolean };

// Operar (subir extractos, clasificar, asignar unidades, ignorar): ADMIN siempre, o
// quien tiene Usuario.operaEjecucion. Ninguna migración le da el permiso a nadie.
// VIEWER nunca (rol de solo lectura, lib/permisosViewer.ts), aunque la base le tenga operaEjecucion en true.
export function puedeOperarEjecucionGlobal(usuario: ConPermisoDeOperar): boolean {
  if (esViewer(usuario)) return false;
  return usuario.rol === "ADMIN" || usuario.operaEjecucion;
}

// Cierre definitivo de una semana: solo FINANZAS y ADMIN (D-4). Quien opera sin ser
// FINANZAS ni ADMIN (Flavia) no cierra.
export function puedeCerrarEjecucion(usuario: ConRol): boolean {
  return usuario.rol === "ADMIN" || usuario.rol === "FINANZAS";
}

// Quien ve TODO Ejecución (todas las unidades, saldos y cuentas): ADMIN, FINANZAS y
// quien opera. El resto (gerentes) ve solo los movimientos de su empresa (§6).
export function veTodoEjecucion(usuario: ConPermisoDeOperar): boolean {
  return puedeCerrarEjecucion(usuario) || puedeOperarEjecucionGlobal(usuario);
}

// Quien ve los bloques Disponibilidades y Cierre del Reporte (saldo, capital de
// trabajo, disponible): solo ADMIN y FINANZAS (§3.4 y §6). Operar Ejecución no alcanza.
export function veBloquesReservadosDelReporte(usuario: ConRol): boolean {
  return puedeCerrarEjecucion(usuario);
}

// Cargar un archivo madre por la web (trae clasificación y unidad ya hechas, así que se salta el
// circuito de confirmación): solo ADMIN y FINANZAS. No depende de operaEjecucion; el servidor lo
// exige aparte, y la pantalla solo muestra la opción a quien puede operar y además cumple esto.
export function puedeCargarMadreEjecucion(usuario: ConRol): boolean {
  return usuario.rol === "ADMIN" || usuario.rol === "FINANZAS";
}

// Quién ve el panel de subida de una semana abierta: quien opera (todo el panel) o quien puede
// cargar la madre (FINANZAS sin operaEjecucion entra, pero solo para eso). Solo decide si se
// MUESTRA el panel: lo que se puede hacer adentro lo sigue decidiendo cada permiso por separado
// (subir extractos de banco, editar, ignorar… siguen exigiendo operaEjecucion en el servidor).
export function veSubidaDeEjecucion(usuario: ConPermisoDeOperar): boolean {
  return puedeOperarEjecucionGlobal(usuario) || puedeCargarMadreEjecucion(usuario);
}
