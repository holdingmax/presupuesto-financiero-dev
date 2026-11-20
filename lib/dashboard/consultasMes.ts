import { prisma } from "@/lib/prisma";
import { exigirAlcance, type Alcance } from "@/lib/dashboard/alcance";
import { rangoDeMes } from "@/lib/dashboard/semana";
import type { FilaDeCalidadPorLote, FilaDeClasificacion, FilaSinAsignar } from "@/lib/dashboard/calidad";
import type { PresupuestoLeido } from "@/lib/dashboard/avance";
import { MONEDA_PREDETERMINADA, centavosDeDecimalTexto } from "@/lib/conteoMovimientos";

// Consultas por MES del Dashboard consolidado (Entrega 2): calidad del dato y avance del mes. Solo leen. Igual que
// consultas.ts: toda función exportada recibe un Alcance primero y lo valida con exigirAlcance antes de consultar (lo controla
// lib/dashboard/__tests__/estatico.test.ts), con SQL parametrizado y la misma regla de unidad y de prorrateo que el Real del
// Reporte: un movimiento sin prorrateo cuenta por su unidad; uno prorrateado, por las porciones de las unidades del alcance.
// Sin ignorados. Alcance vacío: devuelven [] sin consultar.

function sinDatos(alcance: Alcance): boolean {
  return alcance.vacio || alcance.unidades.length === 0;
}

// Indicadores de calidad del mes (por fecha del movimiento), uno por estado de lote. `verSaldos` lo decide quien llama según
// el rol: sin permiso, «saldo faltante» llega siempre en 0 (y la capa pura ni siquiera lo muestra).
export async function leerCalidadPorLote(
  alcance: Alcance,
  periodo: string,
  opciones: { verSaldos: boolean }
): Promise<FilaDeCalidadPorLote[]> {
  exigirAlcance(alcance);
  const { desde, hasta } = rangoDeMes(periodo);
  if (sinDatos(alcance)) return [];
  const unidades = [...alcance.unidades];
  const verSaldos = opciones.verSaldos === true;
  const pesos = MONEDA_PREDETERMINADA;
  const filas = await prisma.$queryRaw<
    {
      estado: "ABIERTA" | "CERRADA";
      movimientos: number;
      sin_clasificar: number;
      clasif_sugerida: number;
      unidad_sugerida: number;
      cheque_iva: number;
      saldo_faltante: number;
      otra_moneda: number;
    }[]
  >`
    WITH mov AS (
      SELECT mb.id, mb.clasificacion, mb."sugeridaPorSistema" AS sug, mb."unidadSugeridaPorSistema" AS usug,
             mb."chequeIvaAmbiguo" AS civa, mb.moneda, mb.saldo, mb."bancoYCuenta" AS cuenta, mb."unidadNegocio",
             es.estado::text AS estado
      FROM "MovimientoBancario" mb
      JOIN "EjecucionSemanal" es ON mb."ejecucionId" = es.id
      WHERE NOT mb.ignorado
        AND mb.fecha >= ${desde}::date AND mb.fecha < ${hasta}::date
    ), propios AS (
      SELECT m.* FROM mov m
      WHERE upper(btrim(m."unidadNegocio")) = ANY(${unidades}::text[])
        AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = m.id)
      UNION
      SELECT m.* FROM mov m
      WHERE EXISTS (
        SELECT 1 FROM "MovimientoBancarioDesglose" d
        WHERE d."movimientoId" = m.id AND upper(btrim(d."unidadNegocio")) = ANY(${unidades}::text[])
      )
    )
    SELECT p.estado,
           COUNT(*)::int AS movimientos,
           (COUNT(*) FILTER (WHERE p.clasificacion = 'SIN CLASIFICAR'))::int AS sin_clasificar,
           (COUNT(*) FILTER (WHERE p.sug))::int AS clasif_sugerida,
           (COUNT(*) FILTER (WHERE p.usug AND upper(btrim(p."unidadNegocio")) = ANY(${unidades}::text[])))::int AS unidad_sugerida,
           (COUNT(*) FILTER (WHERE p.civa))::int AS cheque_iva,
           (COUNT(*) FILTER (WHERE ${verSaldos}::boolean AND p.saldo IS NULL AND p.cuenta !~* '^(efectivo|cheque|brou|d.lar|[(]sin banco[)])'))::int AS saldo_faltante,
           (COUNT(*) FILTER (WHERE p.moneda <> ${pesos}))::int AS otra_moneda
    FROM propios p
    GROUP BY p.estado
    ORDER BY p.estado
  `;
  return filas.map((f) => ({
    estado: f.estado,
    movimientos: f.movimientos,
    sinClasificar: f.sin_clasificar,
    clasificacionSugerida: f.clasif_sugerida,
    unidadSugerida: f.unidad_sugerida,
    chequeIvaAmbiguo: f.cheque_iva,
    saldoFaltante: verSaldos ? f.saldo_faltante : 0,
    otraMoneda: f.otra_moneda,
  }));
}

// Movimientos en pesos del mes del alcance por (unidad, clasificación): la capa pura decide cuáles no tienen fila en el
// Reporte de su empresa. Una fila por porción propia en los prorrateados.
export async function leerClasificacionesDelMes(alcance: Alcance, periodo: string): Promise<FilaDeClasificacion[]> {
  exigirAlcance(alcance);
  const { desde, hasta } = rangoDeMes(periodo);
  if (sinDatos(alcance)) return [];
  const unidades = [...alcance.unidades];
  const pesos = MONEDA_PREDETERMINADA;
  const filas = await prisma.$queryRaw<{ unidad: string; clasificacion: string; movimientos: number }[]>`
    WITH mov AS (
      SELECT mb.id, mb.clasificacion, mb."unidadNegocio"
      FROM "MovimientoBancario" mb
      WHERE NOT mb.ignorado
        AND mb.fecha >= ${desde}::date AND mb.fecha < ${hasta}::date
        AND mb.moneda = ${pesos}
    )
    SELECT x.unidad, x.clasificacion, COUNT(DISTINCT x.id)::int AS movimientos
    FROM (
      SELECT m.id, upper(btrim(m."unidadNegocio")) AS unidad, m.clasificacion FROM mov m
      WHERE upper(btrim(m."unidadNegocio")) = ANY(${unidades}::text[])
        AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = m.id)
      UNION ALL
      SELECT m.id, upper(btrim(d."unidadNegocio")) AS unidad, m.clasificacion FROM mov m
      JOIN "MovimientoBancarioDesglose" d ON d."movimientoId" = m.id
      WHERE upper(btrim(d."unidadNegocio")) = ANY(${unidades}::text[])
    ) x
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
  return filas.map((f) => ({ unidad: f.unidad, clasificacion: f.clasificacion, movimientos: f.movimientos }));
}

// «Sin asignar»: movimientos sin unidad del mes. SOLO ADMIN (alcance.esHolding): para cualquier otro rol devuelve null SIN
// consultar, sin importar el período. Es del conjunto, sin dueño: a otro usuario no le sirve y puede cruzarse con lo suyo.
export async function leerSinAsignar(alcance: Alcance, periodo: string): Promise<FilaSinAsignar[] | null> {
  exigirAlcance(alcance);
  if (!alcance.esHolding) return null;
  const { desde, hasta } = rangoDeMes(periodo);
  const sinUnidad = "SIN ASIGNAR";
  const filas = await prisma.$queryRaw<
    { moneda: string; movimientos: number; abiertos: number; ingresos: string | null; egresos: string | null }[]
  >`
    SELECT mb.moneda,
           COUNT(*)::int AS movimientos,
           (COUNT(*) FILTER (WHERE es.estado::text = 'ABIERTA'))::int AS abiertos,
           SUM(CASE WHEN mb.importe > 0 THEN mb.importe ELSE 0 END)::text AS ingresos,
           SUM(CASE WHEN mb.importe < 0 THEN mb.importe ELSE 0 END)::text AS egresos
    FROM "MovimientoBancario" mb
    JOIN "EjecucionSemanal" es ON mb."ejecucionId" = es.id
    WHERE NOT mb.ignorado
      AND mb.fecha >= ${desde}::date AND mb.fecha < ${hasta}::date
      AND upper(btrim(mb."unidadNegocio")) = ${sinUnidad}
      AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = mb.id)
    GROUP BY mb.moneda
    ORDER BY mb.moneda
  `;
  return filas.map((f) => ({
    moneda: f.moneda,
    movimientos: f.movimientos,
    enLotesAbiertos: f.abiertos,
    ingresosCentavos: f.ingresos === null ? 0 : centavosDeDecimalTexto(f.ingresos),
    egresosCentavos: f.egresos === null ? 0 : centavosDeDecimalTexto(f.egresos),
  }));
}

// Última fecha con movimientos en lotes CERRADOS (los que cuenta el Reporte), por unidad del alcance y dentro del mes.
// Sirve para el «datos al» y el ritmo de cada empresa.
export async function leerCortesPorUnidad(alcance: Alcance, periodo: string): Promise<{ unidad: string; ultima: string }[]> {
  exigirAlcance(alcance);
  const { desde, hasta } = rangoDeMes(periodo);
  if (sinDatos(alcance)) return [];
  const unidades = [...alcance.unidades];
  const filas = await prisma.$queryRaw<{ unidad: string; ultima: string }[]>`
    WITH mov AS (
      SELECT mb.id, mb.fecha, mb."unidadNegocio"
      FROM "MovimientoBancario" mb
      JOIN "EjecucionSemanal" es ON mb."ejecucionId" = es.id
      WHERE NOT mb.ignorado AND es.estado::text = 'CERRADA'
        AND mb.fecha >= ${desde}::date AND mb.fecha < ${hasta}::date
    )
    SELECT x.unidad, to_char(MAX(x.fecha), 'YYYY-MM-DD') AS ultima
    FROM (
      SELECT upper(btrim(m."unidadNegocio")) AS unidad, m.fecha FROM mov m
      WHERE upper(btrim(m."unidadNegocio")) = ANY(${unidades}::text[])
        AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = m.id)
      UNION ALL
      SELECT upper(btrim(d."unidadNegocio")) AS unidad, m.fecha FROM mov m
      JOIN "MovimientoBancarioDesglose" d ON d."movimientoId" = m.id
      WHERE upper(btrim(d."unidadNegocio")) = ANY(${unidades}::text[])
    ) x
    GROUP BY x.unidad
    ORDER BY x.unidad
  `;
  return filas;
}

// Estado del presupuesto del mes de cada empresa del alcance (id de empresa -> estado y cantidad de líneas). Las empresas
// sin presupuesto del mes no aparecen. Los ids salen del Alcance validado.
export async function leerPresupuestosDelMes(alcance: Alcance, periodo: string): Promise<Map<string, PresupuestoLeido>> {
  exigirAlcance(alcance);
  rangoDeMes(periodo); // valida el formato
  const resultado = new Map<string, PresupuestoLeido>();
  if (alcance.vacio) return resultado;
  const filas = await prisma.presupuestoMensual.findMany({
    where: { periodo, empresaId: { in: alcance.empresas.map((e) => e.id) } },
    select: { empresaId: true, estado: true, _count: { select: { lineas: true } } },
  });
  for (const f of filas) resultado.set(f.empresaId, { estado: f.estado, lineas: f._count.lineas });
  return resultado;
}
