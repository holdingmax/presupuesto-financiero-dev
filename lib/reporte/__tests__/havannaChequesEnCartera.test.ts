import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, camposManuales, type DatosMes, type FilaLinea } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { camposTipeables } from "@/lib/reporte/tipeoDirecto";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";

// Havanna: fila «CHEQUES EN CARTERA» en Disponibilidades, entre DOLARES y RESERVA AGUINALDO (misma clave y tratamiento que
// Plate Silver / HWC: "cuadre", Real manual, P = R). Todo en centavos.

const HAVANNA = PLANTILLAS_POR_SLUG["havanna"];
const CLAVE = "hv.dChequesEnCartera";

const mes = (periodo: string, real: [string, number][]): DatosMes => ({
  periodo,
  real: new Map(),
  presupuesto: new Map(),
  semanasCerradas: 0,
  manuales: { presupuesto: new Map(), real: new Map(real) },
});
const celda = (r: ReturnType<typeof armarReporte>, clave: string, i = 0) => r.filas.find((f) => f.fila.clave === clave)!.celdas[i];

test("Havanna: la fila está entre DOLARES y RESERVA AGUINALDO, con el texto CHEQUES EN CARTERA", () => {
  const claves = HAVANNA.filas.map((f) => f.clave);
  const i = claves.indexOf(CLAVE);
  assert.ok(i > 0);
  assert.equal(claves[i - 1], "hv.dDolares");
  assert.equal(claves[i + 1], "hv.dReservaAguinaldo");
  const fila = HAVANNA.filas[i] as FilaLinea;
  assert.equal(fila.texto, "CHEQUES EN CARTERA");
  assert.equal(fila.arrastre, "cuadre");
});

test("Havanna: entra una sola vez en TOTAL DISPONIBILIDADES y no hay otra fila de Havanna que la espeje", () => {
  const total = HAVANNA.filas.find((f) => f.tipo === "total" && f.rol === "totalDisponibilidades");
  assert.ok(total && total.tipo === "total");
  assert.equal(total.suma.filter((c) => c === CLAVE).length, 1);
  // Ninguna otra fila de la plantilla la referencia (ni espejo, ni capital, ni total de Ingresos).
  const otras = JSON.stringify(HAVANNA.filas.filter((f) => f.clave !== CLAVE && f.clave !== total.clave));
  assert.equal(otras.includes(CLAVE), false);
});

test("Havanna: sumar Cheques en cartera mueve el total en ese importe y los demás componentes no cambian", () => {
  const base: [string, number][] = [
    ["hv.dBancoFci", 18468433041],
    ["hv.dEfectivo", 4502825061],
    ["hv.dDolares", 123456],
    ["hv.dReservaAguinaldo", -500000],
  ];
  const sin = armarReporte(HAVANNA, [mes("2026-11", base)], 0);
  const con = armarReporte(HAVANNA, [mes("2026-11", [...base, [CLAVE, 1000000]])], 0);
  assert.equal(celda(sin, CLAVE).real, null, "vacía si no hay valor");
  assert.equal(celda(sin, CLAVE).presupuestado, null);
  assert.equal(celda(con, CLAVE).real, 1000000);
  assert.equal(celda(con, CLAVE).presupuestado, 1000000, "repetida en Presupuestado");
  for (const [clave] of base) {
    assert.equal(celda(con, clave).real, celda(sin, clave).real, clave);
    assert.equal(celda(con, clave).presupuestado, celda(sin, clave).presupuestado, clave);
  }
  const t = "hv.totalDisponibilidades";
  assert.equal(celda(sin, t).real, 18468433041 + 4502825061 + 123456 - 500000, "sin la fila, el total es el de siempre");
  assert.equal(celda(con, t).real, celda(sin, t).real! + 1000000);
  assert.equal(celda(con, t).presupuestado, celda(sin, t).presupuestado! + 1000000);
});

test("Havanna: el control «no cuadra» de Disponibilidades cuenta la fila (es 'cuadre', no 'ajuste')", () => {
  // Julio cierra en 100.000 (sin ingresos ni egresos). Agosto: banco 60.000 + cheques en cartera 40.000 = 100.000 → cuadra.
  const r = armarReporte(HAVANNA, [mes("2026-07", [["hv.dBancoFci", 10000000]]), mes("2026-08", [["hv.dBancoFci", 6000000], [CLAVE, 4000000]])]);
  assert.equal(r.arrastre[1]!.cierreRealAnterior, 10000000);
  assert.equal(r.arrastre[1]!.ajustes, 0);
  assert.equal(r.arrastre[1]!.diferencia, 0);
  assert.equal(r.arrastre[1]!.cuadra, true);
  // Sin la fila el mismo mes NO cuadra: el control la detecta.
  const sin = armarReporte(HAVANNA, [mes("2026-07", [["hv.dBancoFci", 10000000]]), mes("2026-08", [["hv.dBancoFci", 6000000]])]);
  assert.equal(sin.arrastre[1]!.diferencia, -4000000);
  assert.equal(sin.arrastre[1]!.cuadra, false);
});

test("Havanna: se tipea en /carga y en el Reporte (Real), y el gerente la ve en solo lectura", () => {
  assert.ok(camposManuales(HAVANNA).some((c) => c.clave === CLAVE && c.columna === "REAL"));
  assert.ok(camposTipeables(HAVANNA, "havanna").some((c) => c.clave === CLAVE));
  // El gerente: ve Disponibilidades (interruptor) y la fila sale con valor; no la edita (tipeo directo es solo ADMIN/FINANZAS).
  const gerente = armarReporte(HAVANNA, [mes("2026-11", [[CLAVE, 1000000]])], 0, { verBloquesReservados: accesoReservadosDelReporte(false, "havanna") });
  const fila = gerente.filas.find((f) => f.fila.clave === CLAVE);
  assert.ok(fila, "el gerente ve la fila");
  assert.equal(fila.celdas[0].real, 1000000);
  assert.equal(fila.celdas[0].presupuestado, 1000000);
  assert.equal(gerente.filas.some((f) => f.fila.clave === "hv.totalDisponibilidades"), true);
});

test("ninguna otra empresa tiene la clave nueva; Havanna Perú y las demás conservan sus filas de Disponibilidades", () => {
  for (const [slug, p] of Object.entries(PLANTILLAS_POR_SLUG)) {
    if (slug === "havanna") continue;
    assert.equal(p.filas.some((f) => f.clave === CLAVE), false, slug);
  }
  const textos = (slug: string) =>
    PLANTILLAS_POR_SLUG[slug].filas.filter((f) => f.tipo === "linea" && f.bloque === "DISPONIBILIDADES").map((f) => f.texto);
  assert.equal(textos("havanna-peru").includes("CHEQUES EN CARTERA"), false);
});
