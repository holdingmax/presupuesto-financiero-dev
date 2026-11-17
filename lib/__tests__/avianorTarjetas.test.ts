import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, clasificacionesDePlantilla, validarPlantilla, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { clasificacionesConFila, sinFilaDeAvianor, type FilaPorClasificacion } from "@/lib/reporte/avisoEspejo";

// Tarjetas de Avianor lee PREST BRIOS Y TC de la unidad AVIANOR y suma lo tipeado. Solo motor puro.
const AV = PLANTILLAS_POR_SLUG["avianor"];
const CX = PLANTILLAS_POR_SLUG["conexion-logistica"];
const M = 100_000_000;
const TARJETAS = -2_614_886_04; // centavos, signo de banco

function mes(periodo: string, over: Partial<DatosMes> = {}): DatosMes {
  return { periodo, real: new Map(), presupuesto: new Map(), semanasCerradas: 4, manuales: { presupuesto: new Map(), real: new Map() }, ...over };
}
const real = (p: typeof AV, d: DatosMes, clave: string) => armarReporte(p, [d], 0).filas.find((f) => f.fila.clave === clave)!.celdas[0].real;
const rol = (p: typeof AV, d: DatosMes, r: string) =>
  armarReporte(p, [d], 0).filas.find((f) => f.fila.tipo === "total" && f.fila.rol === r)!.celdas[0].real;

test("plantillas válidas y PREST BRIOS Y TC entra en la lista de Avianor", () => {
  assert.deepEqual(validarPlantilla(AV), []);
  assert.deepEqual(validarPlantilla(CX), []);
  assert.ok(clasificacionesDePlantilla(AV).includes("PREST BRIOS Y TC"));
});

test("Avianor: Tarjetas suma PREST BRIOS Y TC de la unidad AVIANOR desde noviembre", () => {
  const d = mes("2026-11", { real: new Map([["PREST BRIOS Y TC", TARJETAS]]) });
  assert.equal(real(AV, d, "av.tarjetas"), 2_614_886_04);
  assert.equal(rol(AV, d, "totalEgresos"), 2_614_886_04);
});

test("Conexión = Avianor con un movimiento PREST BRIOS Y TC en AVIANOR", () => {
  const nov = new Map([["PREST BRIOS Y TC", TARJETAS], ["COBRANZAS", 10 * M], ["PROV Y SERV", -2 * M]]);
  const av = armarReporte(AV, [mes("2026-11", { real: nov })], 0);
  const cx = mes("2026-11", { realEspejo: nov });
  const neto = rol(AV, mes("2026-11", { real: nov }), "totalEgresos")! - rol(AV, mes("2026-11", { real: nov }), "totalIngresos")!;
  assert.equal(real(CX, cx, "cx.gastosAvion"), neto);
  assert.equal(neto, 2 * M + 2_614_886_04 - 10 * M);
  assert.ok(av.filas.length > 0);
});

test("octubre sin cambios: sin movimientos AVIANOR, el valor tipeado 4.333.103,08 sigue sumando", () => {
  const d = mes("2026-10", { manuales: { presupuesto: new Map(), real: new Map([["av.tarjetas", 4_333_103_08]]) } });
  assert.equal(real(AV, d, "av.tarjetas"), 4_333_103_08);
  assert.equal(real(AV, mes("2026-10"), "av.tarjetas"), 0);
  assert.equal(real(AV, mes("2026-09", { manuales: d.manuales }), "av.tarjetas"), 4_333_103_08);
  // Sin semanas cerradas: se muestra el tipeado; sin tipeado, «—».
  assert.equal(real(AV, { ...d, semanasCerradas: 0 }, "av.tarjetas"), 4_333_103_08);
  assert.equal(real(AV, mes("2026-10", { semanasCerradas: 0 }), "av.tarjetas"), null);
});

test("sin doble conteo: el movimiento cuenta una vez en Avianor y una vez en «Gastos Avion» (no en Préstamos y tarjetas de Conexión)", () => {
  const cx = mes("2026-11", { real: new Map(), realEspejo: new Map([["PREST BRIOS Y TC", TARJETAS]]) });
  assert.equal(real(CX, cx, "cx.prestamosTarjetas"), 0);
  assert.equal(real(CX, cx, "cx.gastosAvion"), 2_614_886_04);
  assert.equal(real(AV, mes("2026-11", { real: new Map([["PREST BRIOS Y TC", TARJETAS]]) }), "av.tarjetas"), 2_614_886_04);
});

test("un movimiento PREST BRIOS Y TC en SPP sigue en «Prestamos y tarjetas» de Conexión", () => {
  const cx = mes("2026-11", { real: new Map([["PREST BRIOS Y TC", TARJETAS]]) });
  assert.equal(real(CX, cx, "cx.prestamosTarjetas"), 2_614_886_04);
  assert.equal(real(CX, cx, "cx.gastosAvion"), 0);
});

test("el aviso del espejo ya no marca PREST BRIOS Y TC (y sí otra sin fila)", () => {
  const f = (clasificacion: string): FilaPorClasificacion => ({ estado: "CERRADA", moneda: "ARS", clasificacion, movimientos: 1, centavos: -1 });
  const r = sinFilaDeAvianor([f("PREST BRIOS Y TC"), f("Prestamos y tarjetas"), f("OTROS")], clasificacionesConFila(AV));
  assert.deepEqual(r.map((x) => x.clasificacion), ["OTROS"]);
});
