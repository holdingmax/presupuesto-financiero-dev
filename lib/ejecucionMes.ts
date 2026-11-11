import type { Prisma } from "@prisma/client";
import { whereMovimientosDeEmpresa } from "@/lib/filtroClasificacionEmpresa";

// Vista "Todo el mes" de la pestaña Ejecución de una empresa (solo lectura): los movimientos de TODAS
// las semanas del período juntos. Parte pura (sin base): el armado del where, la suma del total y el
// aviso de semanas abiertas. La consulta y el permiso viven en app/[empresa]/[periodo]/ejecucion/datos.ts.

export type SemanaDelMes = { id: string; numeroSemana: number; estado: string };

// Mismo where que una semana (unidades de la empresa + clasificación + ocultas) sobre todas las semanas
// del período, y sin los movimientos ignorados.
export function whereMovimientosDelMes(
  ejecucionIds: string[],
  unidades: string[],
  clasificacion: string | undefined,
  ocultas: string[] = []
): Prisma.MovimientoBancarioWhereInput {
  const { ejecucionId: _unaSemana, ...resto } = whereMovimientosDeEmpresa("", unidades, clasificacion, ocultas);
  void _unaSemana;
  return { ...resto, ejecucionId: { in: ejecucionIds }, ignorado: false };
}

// Total del mes = suma de los totales de cada semana, hecha en centavos enteros (sin deriva de coma flotante).
export function sumarTotalesSemanales(totales: number[]): number {
  return totales.reduce((acc, t) => acc + Math.round(t * 100), 0) / 100;
}

// Lo mismo POR MONEDA: el total del mes en cada moneda es la suma de los totales semanales de esa moneda.
export { unirTotales as sumarTotalesSemanalesPorMoneda } from "@/lib/moneda";

export function semanasAbiertas(semanas: { estado: string }[]): number {
  return semanas.filter((s) => s.estado !== "CERRADA").length;
}

// null si todas las semanas están cerradas.
export function avisoSemanasAbiertas(semanas: { estado: string }[]): string | null {
  const n = semanasAbiertas(semanas);
  return n > 0 ? `Incluye semanas abiertas (${n}): los valores pueden cambiar hasta que se cierren.` : null;
}
