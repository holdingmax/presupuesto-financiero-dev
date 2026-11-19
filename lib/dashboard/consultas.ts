import { prisma } from "@/lib/prisma";
import { exigirAlcance, type Alcance } from "@/lib/dashboard/alcance";
import { esFechaIso, lunesDeSemana, semanaSiguiente, type FilaDeLote } from "@/lib/dashboard/semana";
import { armarControlDepositos, esDepositoDeCheques, puedeVerControlDepositos, type ControlDepositosDeCheques } from "@/lib/dashboard/controles";
import { centavosDeDecimalTexto } from "@/lib/conteoMovimientos";

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

// Control «Depósitos de cheques pendientes de registro» (DEP CH 3°) de UNA semana calendario, solo ADMIN. Para cualquier otro
// rol (FINANZAS, GERENTE, VIEWER, aunque tenga la casilla de bloques reservados) devuelve null SIN consultar la base: el
// bloque no existe, ni importe, ni cantidad, ni aviso. Con la misma regla de unidad y de prorrateo que el resto; no se suma a
// ningún total (ver lib/dashboard/controles.ts). Neto en la moneda del movimiento, una fila por moneda.
export async function leerControlDepositosDeCheques(
  alcance: Alcance,
  fecha: string
): Promise<ControlDepositosDeCheques | null> {
  exigirAlcance(alcance);
  // El filtro de rol va ANTES de cualquier otra cosa (también antes de validar la fecha): para quien no es ADMIN la
  // respuesta es siempre null, sin consulta y sin mensajes distintos.
  if (!puedeVerControlDepositos(alcance)) return null;
  if (!esFechaIso(fecha)) throw new Error("La fecha tiene que ser AAAA-MM-DD.");
  const lunes = lunesDeSemana(fecha);
  const desde = lunes;
  const hasta = semanaSiguiente(lunes);
  if (alcance.vacio || alcance.unidades.length === 0) return armarControlDepositos(lunes, []);
  const unidades = [...alcance.unidades];

  // Valores guardados de la clasificación (con la equivalencia del Reporte), como hace lib/reporte.ts: se resuelven en
  // código y se pasan crudos al SQL.
  const guardadas = await prisma.$queryRaw<{ clasificacion: string }[]>`
    SELECT DISTINCT mb.clasificacion
    FROM "MovimientoBancario" mb
    WHERE mb.fecha >= ${desde}::date AND mb.fecha < ${hasta}::date
  `;
  const crudas = guardadas.map((f) => f.clasificacion).filter(esDepositoDeCheques);
  if (crudas.length === 0) return armarControlDepositos(lunes, []);

  const filas = await prisma.$queryRaw<{ moneda: string; neto: string | null; movimientos: number; abiertos: number }[]>`
    WITH mov AS (
      SELECT mb.id, mb.importe, mb.moneda, mb."unidadNegocio", es.estado::text AS estado
      FROM "MovimientoBancario" mb
      JOIN "EjecucionSemanal" es ON mb."ejecucionId" = es.id
      WHERE NOT mb.ignorado
        AND mb.fecha >= ${desde}::date AND mb.fecha < ${hasta}::date
        AND mb.clasificacion = ANY(${crudas}::text[])
    )
    SELECT x.moneda, SUM(x.importe)::text AS neto,
           COUNT(DISTINCT x.id)::int AS movimientos,
           (COUNT(DISTINCT x.id) FILTER (WHERE x.estado = 'ABIERTA'))::int AS abiertos
    FROM (
      SELECT m.id, m.moneda, m.estado, m.importe FROM mov m
      WHERE upper(btrim(m."unidadNegocio")) = ANY(${unidades}::text[])
        AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = m.id)
      UNION ALL
      SELECT m.id, m.moneda, m.estado, d.importe FROM mov m
      JOIN "MovimientoBancarioDesglose" d ON d."movimientoId" = m.id
      WHERE upper(btrim(d."unidadNegocio")) = ANY(${unidades}::text[])
    ) x
    GROUP BY x.moneda
    ORDER BY x.moneda
  `;
  return armarControlDepositos(
    lunes,
    filas.map((f) => ({
      moneda: f.moneda,
      netoCentavos: f.neto === null ? 0 : centavosDeDecimalTexto(f.neto),
      movimientos: f.movimientos,
      enLotesAbiertos: f.abiertos,
    }))
  );
}
