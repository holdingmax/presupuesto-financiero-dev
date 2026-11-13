import { prisma } from "@/lib/prisma";
import { centavosDeDecimalTexto, MONEDA_PREDETERMINADA } from "@/lib/conteoMovimientos";
import { normalizarCuenta } from "@/lib/unidadesNegocio";
import { armarIndiceRubros, rubroDe } from "@/lib/rubros";
import { claveEquivalencia } from "@/lib/reporte/motor";
import type { FilaSinClasificar } from "@/lib/reporte/sinClasificar";

// REAL del Reporte por UNIDAD DE NEGOCIO, no por empresa del extracto (decisión
// 2026-10-07). Una cuenta bancaria puede mezclar unidades: un gasto de RADIO
// pagado desde un banco cargado en Havanna es REAL de Radio, no de Havanna. Por
// eso el REAL de una empresa suma, del período, en semanas CERRADAS y sin
// ignorados, de CUALQUIER empresa:
//   - los movimientos NO prorrateados cuya unidad pertenece a la empresa;
//   - las porciones de MovimientoBancarioDesglose cuya unidad pertenece a ella.
// Un movimiento prorrateado cuenta SOLO por sus porciones, nunca además por su
// unidad propia. Qué unidades tiene cada empresa: Empresa.unidadesNegocio
// (/admin/unidades-negocio), donde cada unidad pertenece a una sola empresa —
// así ningún importe se suma en dos reportes.
//
// Todo se suma en la base (numeric exacto) y vuelve como texto → centavos: nada
// de float para sumar, y ninguna fila individual viaja al servidor.
// upper(btrim()): una variante vieja como "SPP " (espacio final) cuenta como SPP.

// Todas las unidades que hoy pertenecen a alguna empresa ACTIVA (normalizadas). Lo que
// no esté acá (SIN ASIGNAR, valores viejos fuera de lista) no entra en el REAL de nadie
// y bloquea el cierre de la semana (§3.5).
export async function obtenerUnidadesConEmpresa(): Promise<string[]> {
  const filas = await prisma.$queryRaw<{ unidad: string }[]>`
    SELECT DISTINCT unnest("unidadesNegocio") AS unidad FROM "Empresa" WHERE activo
  `;
  return filas.map((f) => normalizarCuenta(f.unidad));
}

// Clasificaciones GUARDADAS en movimientos del período que pertenecen a alguno
// de los rubros pedidos, según la tabla de equivalencias (lib/rubros.ts: alias
// confirmados + comparación sin mayúsculas/tildes). Son pocas (una fila por
// valor distinto): se resuelven en código y se pasan crudas al ANY() de las
// consultas, que siguen sumando en la base.
async function clasificacionesDeRubros(periodo: string, rubros: readonly string[]): Promise<string[]> {
  const indice = armarIndiceRubros(rubros);
  const filas = await prisma.$queryRaw<{ clasificacion: string }[]>`
    SELECT DISTINCT mb.clasificacion
    FROM "MovimientoBancario" mb
    JOIN "EjecucionSemanal" es ON mb."ejecucionId" = es.id
    WHERE es.periodo = ${periodo}
  `;
  return filas.map((f) => f.clasificacion).filter((c) => rubroDe(indice, c) !== null);
}

// Las tres sumas de este archivo (por rubro, por clasificación y "no asignado") son de UNA moneda: la que se
// pasa en `moneda` (por defecto pesos, MONEDA_PREDETERMINADA). Los movimientos de otra moneda no se mezclan.
//
// Centavos (con signo) por RUBRO — ya agrupados con la tabla de equivalencias
// (ej. "COM Y GTOS BRIOS" suma en "Gastos bancarios"). El llamador decide cómo
// mostrarlos.
export async function calcularRealPorRubro(
  periodo: string,
  unidades: string[],
  rubros: readonly string[],
  moneda: string = MONEDA_PREDETERMINADA
): Promise<Map<string, number>> {
  if (unidades.length === 0) return new Map();
  const crudas = await clasificacionesDeRubros(periodo, rubros);
  if (crudas.length === 0) return new Map();
  const filas = await prisma.$queryRaw<{ clasificacion: string; total: string | null }[]>`
    WITH mov AS (
      SELECT mb.id, mb.clasificacion, mb.importe, mb."unidadNegocio"
      FROM "MovimientoBancario" mb
      JOIN "EjecucionSemanal" es ON mb."ejecucionId" = es.id
        WHERE es.periodo = ${periodo} AND es.estado = 'CERRADA' AND NOT mb.ignorado
        AND mb.clasificacion = ANY(${crudas}::text[])
        AND mb.moneda = ${moneda}
    )
    SELECT x.clasificacion, SUM(x.importe)::text AS total FROM (
      SELECT m.clasificacion, m.importe FROM mov m
      WHERE upper(btrim(m."unidadNegocio")) = ANY(${unidades}::text[])
        AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = m.id)
      UNION ALL
      SELECT m.clasificacion, d.importe FROM mov m
      JOIN "MovimientoBancarioDesglose" d ON d."movimientoId" = m.id
      WHERE upper(btrim(d."unidadNegocio")) = ANY(${unidades}::text[])
    ) x
    GROUP BY x.clasificacion
  `;
  const indice = armarIndiceRubros(rubros);
  const porRubro = new Map<string, number>();
  for (const f of filas) {
    const rubro = rubroDe(indice, f.clasificacion)!;
    porRubro.set(rubro, (porRubro.get(rubro) ?? 0) + (f.total === null ? 0 : centavosDeDecimalTexto(f.total)));
  }
  return porRubro;
}

// Reporte por plantilla (Etapa 2a): la misma suma que calcularRealPorRubro, pero
// para varios períodos en UNA consulta y devuelta por período y clasificación
// CRUDA guardada — el motor (lib/reporte/motor.ts) las agrupa por fila de la
// plantilla. Qué valores guardados entran se decide en código con la misma
// equivalencia que usa el motor (sin mayúsculas/tildes + alias de lib/rubros.ts).
// 2b: además del neto, créditos (importes > 0) y débitos (importes < 0) por
// separado, para las clasificaciones que van en dos filas según el sentido
// (Préstamo MS: entrada en Ingresos, devolución en Egresos).
export type RealDelMes = {
  neto: Map<string, number>;
  creditos: Map<string, number>;
  debitos: Map<string, number>;
};

export async function calcularRealPorClasificacion(
  periodos: string[],
  unidades: string[],
  clasificaciones: string[],
  moneda: string = MONEDA_PREDETERMINADA
): Promise<Map<string, RealDelMes>> {
  const vacio = (): RealDelMes => ({ neto: new Map(), creditos: new Map(), debitos: new Map() });
  const resultado = new Map<string, RealDelMes>(periodos.map((p) => [p, vacio()]));
  if (unidades.length === 0 || periodos.length === 0 || clasificaciones.length === 0) return resultado;
  const pedidas = new Set(clasificaciones.map(claveEquivalencia));
  const guardadas = await prisma.$queryRaw<{ clasificacion: string }[]>`
    SELECT DISTINCT mb.clasificacion
    FROM "MovimientoBancario" mb
    JOIN "EjecucionSemanal" es ON mb."ejecucionId" = es.id
    WHERE es.periodo = ANY(${periodos}::text[])
  `;
  const crudas = guardadas.map((f) => f.clasificacion).filter((c) => pedidas.has(claveEquivalencia(c)));
  if (crudas.length === 0) return resultado;
  const filas = await prisma.$queryRaw<
    { periodo: string; clasificacion: string; total: string | null; creditos: string | null; debitos: string | null }[]
  >`
    WITH mov AS (
      SELECT mb.id, es.periodo, mb.clasificacion, mb.importe, mb."unidadNegocio"
      FROM "MovimientoBancario" mb
      JOIN "EjecucionSemanal" es ON mb."ejecucionId" = es.id
        WHERE es.periodo = ANY(${periodos}::text[]) AND es.estado = 'CERRADA' AND NOT mb.ignorado
        AND mb.clasificacion = ANY(${crudas}::text[])
        AND mb.moneda = ${moneda}
    )
    SELECT x.periodo, x.clasificacion, SUM(x.importe)::text AS total,
           SUM(CASE WHEN x.importe > 0 THEN x.importe ELSE 0 END)::text AS creditos,
           SUM(CASE WHEN x.importe < 0 THEN x.importe ELSE 0 END)::text AS debitos FROM (
      SELECT m.periodo, m.clasificacion, m.importe FROM mov m
      WHERE upper(btrim(m."unidadNegocio")) = ANY(${unidades}::text[])
        AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = m.id)
      UNION ALL
      SELECT m.periodo, m.clasificacion, d.importe FROM mov m
      JOIN "MovimientoBancarioDesglose" d ON d."movimientoId" = m.id
      WHERE upper(btrim(d."unidadNegocio")) = ANY(${unidades}::text[])
    ) x
    GROUP BY x.periodo, x.clasificacion
  `;
  const centavos = (texto: string | null) => (texto === null ? 0 : centavosDeDecimalTexto(texto));
  for (const f of filas) {
    const delMes = resultado.get(f.periodo);
    if (!delMes) continue;
    delMes.neto.set(f.clasificacion, centavos(f.total));
    delMes.creditos.set(f.clasificacion, centavos(f.creditos));
    delMes.debitos.set(f.clasificacion, centavos(f.debitos));
  }
  return resultado;
}

// Semanas CERRADAS de Ejecución por período, de cualquier empresa (el Real del
// Reporte sale de las unidades, no del extracto de la empresa). Todos los
// períodos pedidos aparecen en el Map, con 0 si no tienen ninguna.
export async function contarSemanasCerradasPorPeriodo(periodos: string[]): Promise<Map<string, number>> {
  const resultado = new Map<string, number>(periodos.map((p) => [p, 0]));
  if (periodos.length === 0) return resultado;
  const filas = await prisma.$queryRaw<{ periodo: string; semanas: number }[]>`
    SELECT es.periodo, COUNT(*)::int AS semanas
    FROM "EjecucionSemanal" es
    WHERE es.periodo = ANY(${periodos}::text[]) AND es.estado = 'CERRADA'
    GROUP BY es.periodo
  `;
  for (const f of filas) resultado.set(f.periodo, f.semanas);
  return resultado;
}

export type NoAsignado = { unidad: string; centavos: number; movimientos: number };

// Bloque "No asignado a ninguna empresa" del Reporte: del PERÍODO (semanas cerradas
// de todo el holding; con Ejecución global ya no hay "extractos de esta empresa").
// Detalle de otras unidades: lo muestra la pantalla solo a ADMIN y FINANZAS. Mismo
// criterio de prorrateo que el REAL: un movimiento prorrateado aporta sus porciones,
// no su unidad propia. Agrupado por unidad, ya normalizada.
export async function calcularNoAsignadoDelPeriodo(
  periodo: string,
  rubros: readonly string[],
  unidadesConEmpresa: string[],
  moneda: string = MONEDA_PREDETERMINADA
): Promise<{ porUnidad: NoAsignado[]; semanas: number[] }> {
  const crudas = await clasificacionesDeRubros(periodo, rubros);
  if (crudas.length === 0) return { porUnidad: [], semanas: [] };
  const filas = await prisma.$queryRaw<
    { unidad: string; total: string | null; movimientos: number; semanas: number[] }[]
  >`
    WITH mov AS (
      SELECT mb.id, mb.importe, mb."unidadNegocio", es."numeroSemana"
      FROM "MovimientoBancario" mb
      JOIN "EjecucionSemanal" es ON mb."ejecucionId" = es.id
      WHERE es.periodo = ${periodo}
        AND es.estado = 'CERRADA' AND NOT mb.ignorado
        AND mb.clasificacion = ANY(${crudas}::text[])
        AND mb.moneda = ${moneda}
    )
    SELECT x.unidad, SUM(x.importe)::text AS total, COUNT(DISTINCT x.id)::int AS movimientos,
           array_agg(DISTINCT x."numeroSemana" ORDER BY x."numeroSemana") AS semanas
    FROM (
      SELECT m.id, m.importe, upper(btrim(m."unidadNegocio")) AS unidad, m."numeroSemana" FROM mov m
      WHERE NOT (upper(btrim(m."unidadNegocio")) = ANY(${unidadesConEmpresa}::text[]))
        AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = m.id)
      UNION ALL
      SELECT m.id, d.importe, upper(btrim(d."unidadNegocio")), m."numeroSemana" FROM mov m
      JOIN "MovimientoBancarioDesglose" d ON d."movimientoId" = m.id
      WHERE NOT (upper(btrim(d."unidadNegocio")) = ANY(${unidadesConEmpresa}::text[]))
    ) x
    GROUP BY x.unidad
    ORDER BY x.unidad
  `;
  const semanas = Array.from(new Set(filas.flatMap((f) => f.semanas))).sort((a, b) => a - b);
  return {
    porUnidad: filas.map((f) => ({
      unidad: f.unidad,
      centavos: f.total === null ? 0 : centavosDeDecimalTexto(f.total),
      movimientos: f.movimientos,
    })),
    semanas,
  };
}

export type SinUnidadEnSemana = { unidad: string; movimientos: number };

// Aviso de Ejecución ANTES de cerrar (decisión 2026-10-07: las semanas cerradas
// no se pueden editar, así que el aviso del Reporte llegaría tarde): cuántos
// movimientos de la semana, no ignorados, tienen una unidad que no pertenece a
// ninguna empresa — no van a entrar en el Reporte de nadie. Todas las
// clasificaciones (no solo los rubros de egresos): es un problema de asignación.
export async function contarSinUnidadEnSemana(
  ejecucionId: string,
  unidadesConEmpresa: string[]
): Promise<SinUnidadEnSemana[]> {
  return prisma.$queryRaw<SinUnidadEnSemana[]>`
    SELECT x.unidad, COUNT(DISTINCT x.id)::int AS movimientos FROM (
      SELECT mb.id, upper(btrim(mb."unidadNegocio")) AS unidad
      FROM "MovimientoBancario" mb
      WHERE mb."ejecucionId" = ${ejecucionId} AND NOT mb.ignorado
        AND NOT (upper(btrim(mb."unidadNegocio")) = ANY(${unidadesConEmpresa}::text[]))
        AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = mb.id)
      UNION ALL
      SELECT mb.id, upper(btrim(d."unidadNegocio"))
      FROM "MovimientoBancario" mb
      JOIN "MovimientoBancarioDesglose" d ON d."movimientoId" = mb.id
      WHERE mb."ejecucionId" = ${ejecucionId} AND NOT mb.ignorado
        AND NOT (upper(btrim(d."unidadNegocio")) = ANY(${unidadesConEmpresa}::text[]))
    ) x
    GROUP BY x.unidad
    ORDER BY movimientos DESC, x.unidad
  `;
}

// Bloque "Sin clasificar" del Reporte: movimientos no ignorados con clasificación «SIN CLASIFICAR» del PERÍODO,
// atribuidos a la empresa con el MISMO criterio que el Real (por unidad de negocio: los no prorrateados cuya unidad
// es de la empresa, más las porciones de prorrateo de la empresa). Por estado de la semana (CERRADA / ABIERTA), por
// moneda y por sentido: ingresos (importe > 0) y egresos (importe < 0) por separado, sin netear. Un importe 0 no
// cuenta en ninguno. Solo lee: no toca ningún total del Reporte. Importes en centavos con signo.
export async function calcularSinClasificarDelPeriodo(
  periodo: string,
  unidades: string[]
): Promise<FilaSinClasificar[]> {
  if (unidades.length === 0) return [];
  const filas = await prisma.$queryRaw<
    {
      estado: "ABIERTA" | "CERRADA";
      moneda: string;
      ing_movimientos: number;
      ing_total: string;
      egr_movimientos: number;
      egr_total: string;
    }[]
  >`
    WITH mov AS (
      SELECT mb.id, mb.importe, mb.moneda, mb."unidadNegocio", es.estado::text AS estado
      FROM "MovimientoBancario" mb
      JOIN "EjecucionSemanal" es ON mb."ejecucionId" = es.id
      WHERE es.periodo = ${periodo} AND NOT mb.ignorado AND mb.clasificacion = 'SIN CLASIFICAR'
    )
    SELECT x.estado, x.moneda,
           (COUNT(DISTINCT x.id) FILTER (WHERE x.importe > 0))::int AS ing_movimientos,
           COALESCE(SUM(x.importe) FILTER (WHERE x.importe > 0), 0)::text AS ing_total,
           (COUNT(DISTINCT x.id) FILTER (WHERE x.importe < 0))::int AS egr_movimientos,
           COALESCE(SUM(x.importe) FILTER (WHERE x.importe < 0), 0)::text AS egr_total
    FROM (
      SELECT m.id, m.estado, m.moneda, m.importe FROM mov m
      WHERE upper(btrim(m."unidadNegocio")) = ANY(${unidades}::text[])
        AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = m.id)
      UNION ALL
      SELECT m.id, m.estado, m.moneda, d.importe FROM mov m
      JOIN "MovimientoBancarioDesglose" d ON d."movimientoId" = m.id
      WHERE upper(btrim(d."unidadNegocio")) = ANY(${unidades}::text[])
    ) x
    GROUP BY x.estado, x.moneda
  `;
  return filas.map((f) => ({
    estado: f.estado,
    moneda: f.moneda,
    ingresos: { movimientos: f.ing_movimientos, centavos: centavosDeDecimalTexto(f.ing_total) },
    egresos: { movimientos: f.egr_movimientos, centavos: centavosDeDecimalTexto(f.egr_total) },
  }));
}
