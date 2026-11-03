import { prisma } from "@/lib/prisma";
import { periodoActual } from "@/lib/reporte/bloqueo";
import { elegirUltimoPeriodoCargado } from "@/lib/navegacionEmpresa";

// Período al que entran ADMIN y FINANZAS desde "Mis empresas": el último, menor o igual al mes actual, con al
// menos una semana CERRADA de Ejecución (las semanas son del holding: igual para todas las empresas). Una sola
// consulta de solo lectura; no crea nada. Sin ningún cierre devuelve PERIODO_POR_DEFECTO.
export async function ultimoPeriodoCargado(actual: string = periodoActual()): Promise<string> {
  const filas = await prisma.ejecucionSemanal.groupBy({
    by: ["periodo"],
    where: { estado: "CERRADA", periodo: { lte: actual } },
  });
  return elegirUltimoPeriodoCargado(
    filas.map((f) => f.periodo),
    actual
  );
}
