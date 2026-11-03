import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, camposManuales, validarPlantilla, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { camposTipeables } from "@/lib/reporte/tipeoDirecto";
import { esFilaManualEditable } from "@/lib/reporte/cargaGerente";

// Desde 2026-10, «Cobranza Bancos» de Havanna resta el Real manual de «Cobranzas locales» y de «Acreditacion Tarjetas
// pendientes»: los dos conceptos ya están dentro de COBRANZAS y se tipean aparte, así que sin restar se contarían dos veces.
// Antes de 2026-10 nada cambia, y la Acreditación conserva su R = P en mes cerrado.

const HAVANNA = PLANTILLAS_POR_SLUG["havanna"];
const BANCOS = "hv.cobranzaBancos";
const LOCALES = "hv.cobranzasLocales";
const ACREDITACION = "hv.acreditacionTarjetas";
const TARJETA = "hv.tarjetaNoIngresada";
const FCI = "hv.resultadoFci";
const TOTAL_INGRESOS = "hv.totalIngresos";

// Centavos. Octubre de Kike: 341.668.383 + 123.629.700 + 50.142.971 = 515.441.054.
const COBRANZAS = 51_544_105_400;
const VALOR_LOCALES = 12_362_970_000;
const VALOR_ACREDITACION = 5_014_297_100;
// Resto de ingresos de octubre (578.226.972 − 515.441.054), tipeado en una fila cualquiera para chequear el total.
const VALOR_FCI = 6_278_591_800;

function mes(periodo: string, extra: Partial<DatosMes> = {}, real: [string, number][] = []): DatosMes {
  return {
    periodo,
    real: new Map([["COBRANZAS", COBRANZAS]]),
    presupuesto: new Map(),
    semanasCerradas: 4,
    mesCerrado: true,
    manuales: { presupuesto: new Map(), real: new Map<string, number>(real) },
    ...extra,
  };
}

const CON_MANUALES: [string, number][] = [[LOCALES, VALOR_LOCALES], [ACREDITACION, VALOR_ACREDITACION], [FCI, VALOR_FCI]];

// El último mes del arreglo (los anteriores son de contexto, para el espejo del mes anterior).
function celda(meses: DatosMes[], clave: string) {
  const reporte = armarReporte(HAVANNA, meses, meses.length - 1);
  return reporte.filas.find((f) => f.fila.clave === clave)!.celdas[0];
}

test("octubre 2026 con los dos manuales: Cobranza Bancos 341.668.383 y Total ingresos 578.226.972", () => {
  const m = [mes("2026-10", {}, CON_MANUALES)];
  assert.equal(celda(m, BANCOS).real, 34_166_838_300); // 341.668.383
  assert.equal(celda(m, LOCALES).real, VALOR_LOCALES);
  assert.equal(celda(m, ACREDITACION).real, VALOR_ACREDITACION);
  // Los tres conceptos suman lo mismo que COBRANZAS: nada se cuenta dos veces.
  assert.equal(celda(m, BANCOS).real! + VALOR_LOCALES + VALOR_ACREDITACION, COBRANZAS);
  assert.equal(celda(m, TOTAL_INGRESOS).real, 57_822_697_200); // 578.226.972
});

test("octubre con el espejo de Kike (50.142.970,60) en vez de lo tipeado: el total no cambia", () => {
  const m = [mes("2026-10", {}, [[LOCALES, VALOR_LOCALES], [ACREDITACION, 5_014_297_060], [FCI, VALOR_FCI]])];
  assert.equal(celda(m, BANCOS).real, 34_166_838_340); // 341.668.383,40
  assert.equal(celda(m, TOTAL_INGRESOS).real, 57_822_697_200);
});

test("septiembre y agosto 2026, y meses anteriores: Cobranza Bancos queda igual (COBRANZAS completo)", () => {
  for (const periodo of ["2026-09", "2026-08", "2026-07", "2025-12"]) {
    assert.equal(celda([mes(periodo, {}, CON_MANUALES)], BANCOS).real, COBRANZAS, periodo);
  }
});

test("septiembre y agosto: la Acreditación conserva R = P en mes cerrado y no toma el valor tipeado", () => {
  const julio = mes("2026-07", {}, [[TARJETA, -4_807_128_000]]);
  for (const periodo of ["2026-09", "2026-08"]) {
    const cerrado = [julio, mes(periodo, {}, [[ACREDITACION, 999]])];
    assert.equal(celda(cerrado, ACREDITACION).presupuestado, 4_807_128_000, periodo);
    assert.equal(celda(cerrado, ACREDITACION).real, 4_807_128_000, periodo); // R = P, ignora el manual 999
    const abierto = [julio, mes(periodo, { mesCerrado: false }, [])];
    assert.equal(celda(abierto, ACREDITACION).real, null, periodo); // en curso, R vacío
  }
});

test("octubre sin tipear: no resta nada (queda duplicado hasta que se tipeen) y la Acreditación no se completa sola", () => {
  const m = [mes("2026-09", {}, [[TARJETA, -5_014_297_060]]), mes("2026-10", {}, [])];
  assert.equal(celda(m, BANCOS).real, COBRANZAS);
  assert.equal(celda(m, LOCALES).real, null);
  assert.equal(celda(m, ACREDITACION).real, null); // mes cerrado y espejo cargado: igual no hay R = P desde 2026-10
  assert.equal(celda(m, ACREDITACION).presupuestado, 5_014_297_060); // el espejo sigue en el Presupuestado
});

test("octubre sin semanas cerradas: Cobranza Bancos es null, no un negativo", () => {
  assert.equal(celda([mes("2026-10", { semanasCerradas: 0 }, CON_MANUALES)], BANCOS).real, null);
});

test("espejo pisable: sin manual da el espejo del mes anterior; con manual gana el manual", () => {
  const septiembre = mes("2026-09", {}, [[TARJETA, -5_014_297_060]]);
  assert.equal(celda([septiembre, mes("2026-10")], ACREDITACION).presupuestado, 5_014_297_060);
  const conManual = mes("2026-10", { manuales: { presupuesto: new Map([[ACREDITACION, 5_014_297_100]]), real: new Map() } });
  assert.equal(celda([septiembre, conManual], ACREDITACION).presupuestado, 5_014_297_100);
  // Sin mes anterior y sin manual no hay valor; con manual sí.
  assert.equal(celda([mes("2026-10")], ACREDITACION).presupuestado, null);
  assert.equal(celda([conManual], ACREDITACION).presupuestado, 5_014_297_100);
});

test("el flag pisableConManual solo lo usa Havanna", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const usan = plantilla.filas.filter((f) => f.tipo === "linea" && f.presupuesto.tipo === "espejo" && f.presupuesto.pisableConManual);
    assert.deepEqual(usan.map((f) => f.clave), slug === "havanna" ? [ACREDITACION] : [], slug);
  }
});

test("campos manuales de Havanna: Locales y Acreditación en Real, Acreditación también en Presupuestado", () => {
  const campos = camposManuales(HAVANNA).map((c) => `${c.clave}|${c.columna}`);
  for (const c of [`${LOCALES}|REAL`, `${ACREDITACION}|REAL`, `${ACREDITACION}|PRESUPUESTADO`]) assert.ok(campos.includes(c), c);
});

test("el Real se tipea en el Reporte; el Presupuestado de la Acreditación solo en /reporte/carga, no lo carga el gerente", () => {
  const tipeables = camposTipeables(HAVANNA, "havanna").map((c) => `${c.clave}|${c.columna}`);
  assert.ok(tipeables.includes(`${LOCALES}|REAL`));
  assert.ok(tipeables.includes(`${ACREDITACION}|REAL`));
  assert.equal(tipeables.includes(`${ACREDITACION}|PRESUPUESTADO`), false);
  const fila = HAVANNA.filas.find((f) => f.clave === ACREDITACION)!;
  assert.equal(esFilaManualEditable(fila), false);
});

test("la plantilla de Havanna es válida", () => {
  assert.deepEqual(validarPlantilla(HAVANNA), []);
});
