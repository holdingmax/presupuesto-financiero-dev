import { CLASIFICACIONES_OCULTAS_PARA_GERENTE } from "@/lib/config";
import { quitarDiacriticos } from "@/lib/texto";

// Clasificaciones que el GERENTE no ve en el detalle de la pestaña "Ejecución financiera" de su empresa
// (pedido de Kike, Conexión Logística: AVION y MS). Parte pura, sin base: la config vive en
// lib/config.ts (CLASIFICACIONES_OCULTAS_PARA_GERENTE, por slug) y la regla de quién las ve, acá.
//
// Solo oculta la VISUALIZACIÓN del detalle (lista, cantidad, Total de la pantalla, desplegable, Excel):
// el Reporte (montos por fila), el saldo, los chequeos y el cierre de la semana siguen usando todos los
// movimientos, porque no pasan por este filtro.

type UsuarioParaOcultar = { rol: string; operaEjecucion: boolean };

// Mismo criterio para comparar en todos lados: sin mayúsculas, tildes ni espacios de más.
export function normalizarClasificacion(valor: string): string {
  return quitarDiacriticos(valor).trim().replace(/\s+/g, " ").toUpperCase();
}

// ÚNICA función con la regla de quién ve todo: ADMIN, FINANZAS y quien opera Ejecución
// (operaEjecucion, ej. Flavia) ven todo; el resto (gerentes) no ve las clasificaciones configuradas
// para su empresa. Devuelve la lista configurada (normalizada) o [] si no hay nada que ocultar.
export function clasificacionesOcultasParaUsuario(
  slugEmpresa: string,
  usuario: UsuarioParaOcultar,
  mapa: Readonly<Record<string, readonly string[]>> = CLASIFICACIONES_OCULTAS_PARA_GERENTE
): string[] {
  if (usuario.rol === "ADMIN" || usuario.rol === "FINANZAS" || usuario.operaEjecucion) return [];
  const configuradas = Object.prototype.hasOwnProperty.call(mapa, slugEmpresa) ? mapa[slugEmpresa] : [];
  return Array.from(new Set(configuradas.map(normalizarClasificacion).filter((c) => c !== "")));
}

// De los valores GUARDADOS en la base, los que coinciden (sin mayúsculas ni espacios) con alguna
// clasificación oculta. Son los valores exactos que se excluyen en la consulta de Prisma y en el SQL
// del Total: así ambos caminos usan la misma lista.
export function valoresGuardadosOcultos(guardadas: string[], ocultas: string[]): string[] {
  if (ocultas.length === 0) return [];
  const fuera = new Set(ocultas.map(normalizarClasificacion));
  return Array.from(new Set(guardadas.filter((g) => fuera.has(normalizarClasificacion(g)))));
}
