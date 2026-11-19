import { prisma } from "@/lib/prisma";
import { exigirAlcance, type Alcance } from "@/lib/dashboard/alcance";
import { esFechaIso, type FilaDeLote } from "@/lib/dashboard/semana";

// Consulta BASE del Dashboard consolidado (Entrega 1). Solo lee. TODA función exportada de esta carpeta que toca la base
// recibe un Alcance como primer parámetro y lo valida con exigirAlcance antes de consultar (lo controla un test estático:
// lib/dashboard/__tests__/estatico.test.ts). Solo SQL con parámetros: nada de $queryRawUnsafe.

// Movimientos del ALCANCE por semana calendario (lunes a domingo, la semana de Postgres), mes y estado del lote, entre
// `desde` (inclusive) y `hasta` (exclusive), "AAAA-MM-DD". Sin ignorados. Misma regla de unidad y de prorrateo que el Real del
// Reporte (lib/reporte.ts): un movimiento sin prorrateo cuenta por su unidad; uno prorrateado, por las porciones de las
// unidades del alcance (cuenta una vez aunque tenga varias porciones propias). Todas las monedas: acá solo se cuentan
// movimientos, no se suman importes.
// Alcance vacío (sin empresas o sin unidades): devuelve [] SIN consultar.
export async function leerMovimientosPorSemana(
  alcance: Alcance,
  rango: { desde: string; hasta: string }
): Promise<FilaDeLote[]> {
  exigirAlcance(alcance);
  if (!esFechaIso(rango.desde) || !esFechaIso(rango.hasta)) {
    throw new Error("El rango de fechas tiene que ser AAAA-MM-DD.");
  }
  if (alcance.vacio || alcance.unidades.length === 0) return [];
  const unidades = [...alcance.unidades];

  const filas = await prisma.$queryRaw<
    { lunes: string; periodo: string; estado: "ABIERTA" | "CERRADA"; movimientos: number; ultima: string }[]
  >`
    WITH mov AS (
      SELECT mb.id, mb.fecha, mb."unidadNegocio", es.estado::text AS estado
      FROM "MovimientoBancario" mb
      JOIN "EjecucionSemanal" es ON mb."ejecucionId" = es.id
      WHERE NOT mb.ignorado
        AND mb.fecha >= ${rango.desde}::date AND mb.fecha < ${rango.hasta}::date
    )
    SELECT to_char(date_trunc('week', x.fecha), 'YYYY-MM-DD') AS lunes,
           to_char(x.fecha, 'YYYY-MM') AS periodo,
           x.estado,
           COUNT(DISTINCT x.id)::int AS movimientos,
           to_char(MAX(x.fecha), 'YYYY-MM-DD') AS ultima
    FROM (
      SELECT m.id, m.fecha, m.estado FROM mov m
      WHERE upper(btrim(m."unidadNegocio")) = ANY(${unidades}::text[])
        AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = m.id)
      UNION ALL
      SELECT m.id, m.fecha, m.estado FROM mov m
      JOIN "MovimientoBancarioDesglose" d ON d."movimientoId" = m.id
      WHERE upper(btrim(d."unidadNegocio")) = ANY(${unidades}::text[])
    ) x
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `;
  return filas.map((f) => ({
    lunes: f.lunes,
    periodo: f.periodo,
    estado: f.estado,
    movimientos: f.movimientos,
    ultimaFecha: f.ultima,
  }));
}
