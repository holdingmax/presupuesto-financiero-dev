import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { calcularSinClasificarDelPeriodo } from "@/lib/reporte";
import {
  armarBloqueSinClasificar,
  TEXTO_SIN_CLASIFICAR_ABIERTAS,
  TEXTO_SIN_CLASIFICAR_CERRADAS,
  type FilaSinClasificar,
} from "@/lib/reporte/sinClasificar";

// Bloque "Sin clasificar" del Reporte: solo lectura, separa semanas cerradas de la abierta y las monedas.

const t = (movimientos: number, centavos: number) => ({ movimientos, centavos });
const fila = (
  estado: "ABIERTA" | "CERRADA",
  moneda: string,
  ingresos: { movimientos: number; centavos: number },
  egresos: { movimientos: number; centavos: number }
): FilaSinClasificar => ({ estado, moneda, ingresos, egresos });

test("sin movimientos: el bloque no se muestra (null)", () => {
  assert.equal(armarBloqueSinClasificar([]), null);
  assert.equal(armarBloqueSinClasificar([fila("CERRADA", "ARS", t(0, 0), t(0, 0))]), null);
});

test("ingresos y egresos van por separado (no se netean), por moneda (pesos primero), cerradas y abierta aparte", () => {
  const b = armarBloqueSinClasificar([
    fila("CERRADA", "USD", t(0, 0), t(2, -150000)),
    fila("CERRADA", "ARS", t(1, 2000000), t(2, -765500)),
    fila("ABIERTA", "UYU", t(1, 500), t(0, 0)),
  ])!;
  assert.deepEqual(b.cerradas, [
    { moneda: "ARS", ingresos: t(1, 2000000), egresos: t(2, -765500) },
    { moneda: "USD", ingresos: t(0, 0), egresos: t(2, -150000) },
  ]);
  assert.deepEqual(b.abiertas, [{ moneda: "UYU", ingresos: t(1, 500), egresos: t(0, 0) }]);
});

test("solo hay abiertas: cerradas queda vacío (y viceversa)", () => {
  const soloAbierta = armarBloqueSinClasificar([fila("ABIERTA", "PEN", t(4, 100), t(0, 0))])!;
  assert.equal(soloAbierta.cerradas.length, 0);
  assert.equal(soloAbierta.abiertas.length, 1);
  const soloCerrada = armarBloqueSinClasificar([fila("CERRADA", "ARS", t(0, 0), t(1, -100))])!;
  assert.equal(soloCerrada.abiertas.length, 0);
});

test("una moneda escrita distinto (minúsculas, vacía) se junta con la normal, sentido por sentido", () => {
  const b = armarBloqueSinClasificar([
    fila("CERRADA", "ars", t(1, 100), t(1, -50)),
    fila("CERRADA", "", t(2, 200), t(0, 0)),
  ])!;
  assert.deepEqual(b.cerradas, [{ moneda: "ARS", ingresos: t(3, 300), egresos: t(1, -50) }]);
});

test("los textos son los pedidos", () => {
  assert.match(TEXTO_SIN_CLASIFICAR_CERRADAS, /no suman al Real/);
  assert.match(TEXTO_SIN_CLASIFICAR_ABIERTAS, /pendientes de clasificar/);
  assert.match(TEXTO_SIN_CLASIFICAR_ABIERTAS, /provisorio/);
});

// ---- La consulta: se prueba cambiando prisma.$queryRaw por un doble ----

async function conBaseSimulada<T>(responder: () => unknown[], correr: () => Promise<T>) {
  const llamadas: { sql: string; valores: unknown[] }[] = [];
  const original = prisma.$queryRaw;
  (prisma as unknown as { $queryRaw: unknown }).$queryRaw = async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    llamadas.push({ sql: strings.join("?"), valores });
    return responder();
  };
  try {
    return { resultado: await correr(), llamadas };
  } finally {
    (prisma as unknown as { $queryRaw: unknown }).$queryRaw = original;
  }
}

test("la consulta: no ignorados, SIN CLASIFICAR, del período, mismo criterio de unidad/prorrateo que el Real, sin filtrar estado ni moneda", async () => {
  const { resultado, llamadas } = await conBaseSimulada(
    () => [
      { estado: "CERRADA", moneda: "ARS", ing_movimientos: 1, ing_total: "500.00", egr_movimientos: 2, egr_total: "-1734.56" },
      { estado: "ABIERTA", moneda: "USD", ing_movimientos: 1, ing_total: "10.00", egr_movimientos: 0, egr_total: "0" },
    ],
    () => calcularSinClasificarDelPeriodo("2026-11", ["HAVANNA"])
  );
  assert.equal(llamadas.length, 1);
  const { sql, valores } = llamadas[0];
  assert.match(sql, /NOT mb\.ignorado/);
  assert.match(sql, /mb\.clasificacion = 'SIN CLASIFICAR'/);
  assert.match(sql, /es\.periodo = \?/);
  assert.match(sql, /MovimientoBancarioDesglose/);
  assert.match(sql, /x\.importe > 0/);
  assert.match(sql, /x\.importe < 0/);
  assert.match(sql, /x\.importe > 0/, "ingresos aparte");
  assert.match(sql, /x\.importe < 0/, "egresos aparte");
  assert.doesNotMatch(sql, /mb\.moneda = \?/, "no filtra por moneda: las agrupa");
  assert.doesNotMatch(sql, /es\.estado = /, "trae cerradas y abiertas");
  assert.ok(valores.includes("2026-11"));
  assert.deepEqual(resultado, [
    { estado: "CERRADA", moneda: "ARS", ingresos: t(1, 50000), egresos: t(2, -173456) },
    { estado: "ABIERTA", moneda: "USD", ingresos: t(1, 1000), egresos: t(0, 0) },
  ]);
});

test("la consulta: una empresa sin unidades no consulta nada", async () => {
  const { resultado, llamadas } = await conBaseSimulada(() => [], () => calcularSinClasificarDelPeriodo("2026-11", []));
  assert.deepEqual(resultado, []);
  assert.equal(llamadas.length, 0);
});
