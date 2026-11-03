import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, camposManuales, validarPlantilla, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { camposTipeables } from "@/lib/reporte/tipeoDirecto";
import { esFilaManualEditable, esFilaDeCategoria } from "@/lib/reporte/cargaGerente";

// Desde 2026-10, «Cobranza Mantenor Jujuy» resta el Real manual de «Otros Clientes Jujuy», «Otros Clientes Tucuman»,
// «MSM COLUMNAS» y «MSM PINTURA VIAL»: esos cobros ya están dentro de COBRANZAS de la unidad y se tipean aparte, así que
// sin restar se contarían dos veces. Antes de 2026-10 nada cambia.

const MANTENOR = PLANTILLAS_POR_SLUG["mantenor"];
const PRINCIPAL = "mn.cobranzaJujuy";
const JUJUY = "mn.otrosClientesJujuy";
const TUCUMAN = "mn.otrosClientesTucuman";
const COLUMNAS = "mn.msmColumnas";
const PINTURA = "mn.msmPinturaVial";
const FCI = "mn.resultadoFci";
const TOTAL_INGRESOS = "mn.totalIngresos";

// Centavos. Octubre de Kike: 429.573.632,50 de COBRANZAS.
const COBRANZAS = 42_957_363_250;
const VALOR_JUJUY = 588_009_336; // 5.880.093,36
const VALOR_COLUMNAS = 14_171_615_194; // 141.716.151,94
const VALOR_PINTURA = 22_941_322_315; // 229.413.223,15
const PRINCIPAL_ESPERADA = 5_256_416_405; // 52.564.164,05
// Resto del total de octubre (432.989.088 − 429.573.632,50 = 3.415.455,50), tipeado en una fila cualquiera.
const VALOR_FCI = 341_545_550;

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

const CON_MANUALES: [string, number][] = [[JUJUY, VALOR_JUJUY], [COLUMNAS, VALOR_COLUMNAS], [PINTURA, VALOR_PINTURA], [FCI, VALOR_FCI]];

function celda(datos: DatosMes, clave: string) {
  const reporte = armarReporte(MANTENOR, [datos], 0);
  return reporte.filas.find((f) => f.fila.clave === clave)!.celdas[0];
}

test("octubre 2026 (Tucumán sin valor): Cobranza Mantenor Jujuy 52.564.164,05 y las cinco filas suman COBRANZAS", () => {
  const m = mes("2026-10", {}, CON_MANUALES);
  assert.equal(celda(m, PRINCIPAL).real, PRINCIPAL_ESPERADA);
  assert.equal(celda(m, TUCUMAN).real, null);
  const suma = celda(m, PRINCIPAL).real! + VALOR_JUJUY + VALOR_COLUMNAS + VALOR_PINTURA;
  assert.equal(suma, COBRANZAS); // 429.573.632,50: nada se cuenta dos veces
  assert.equal(celda(m, TOTAL_INGRESOS).real, COBRANZAS + VALOR_FCI); // 432.989.088
  assert.equal(celda(m, TOTAL_INGRESOS).real, 43_298_908_800);
});

test("septiembre, agosto y julio 2026, y meses anteriores: Cobranza Mantenor Jujuy queda igual (COBRANZAS completo)", () => {
  for (const periodo of ["2026-09", "2026-08", "2026-07", "2025-12"]) {
    assert.equal(celda(mes(periodo, {}, CON_MANUALES), PRINCIPAL).real, COBRANZAS, periodo);
  }
});

test("octubre sin semanas cerradas: Cobranza Mantenor Jujuy es null, no un negativo", () => {
  assert.equal(celda(mes("2026-10", { semanasCerradas: 0 }, CON_MANUALES), PRINCIPAL).real, null);
});

test("octubre sin tipear: no resta nada (queda duplicado hasta que se tipeen)", () => {
  assert.equal(celda(mes("2026-10", {}, []), PRINCIPAL).real, COBRANZAS);
  assert.equal(celda(mes("2026-10", {}, []), JUJUY).real, null);
});

test("noviembre en adelante también netea", () => {
  assert.equal(celda(mes("2026-11", {}, CON_MANUALES), PRINCIPAL).real, PRINCIPAL_ESPERADA);
});

test("las cuatro filas nuevas: Real y Presupuestado manual, en este orden entre la cobranza y MSNT", () => {
  const campos = camposManuales(MANTENOR).map((c) => `${c.clave}|${c.columna}`);
  for (const k of [JUJUY, TUCUMAN, COLUMNAS, PINTURA]) {
    assert.ok(campos.includes(`${k}|REAL`), `${k} REAL`);
    assert.ok(campos.includes(`${k}|PRESUPUESTADO`), `${k} PRESUPUESTADO`);
  }
  const claves = MANTENOR.filas.map((f) => f.clave);
  assert.deepEqual(claves.slice(claves.indexOf(PRINCIPAL), claves.indexOf("mn.cobranzaMsnt") + 1), [
    PRINCIPAL, JUJUY, TUCUMAN, COLUMNAS, PINTURA, "mn.cobranzaMsnt",
  ]);
  const textos = MANTENOR.filas.filter((f) => [JUJUY, TUCUMAN, COLUMNAS, PINTURA].includes(f.clave)).map((f) => (f.tipo === "titulo" ? "" : f.texto));
  assert.deepEqual(textos, ["Otros Clientes Jujuy", "Otros Clientes Tucuman", "MSM COLUMNAS", "MSM PINTURA VIAL"]);
});

test("el Real se tipea en el Reporte (ADMIN/FINANZAS); el gerente carga la principal como categoría y las otras como P manual", () => {
  const tipeables = camposTipeables(MANTENOR, "mantenor").map((c) => `${c.clave}|${c.columna}`);
  for (const k of [JUJUY, TUCUMAN, COLUMNAS, PINTURA]) {
    assert.ok(tipeables.includes(`${k}|REAL`), k);
    assert.equal(tipeables.includes(`${k}|PRESUPUESTADO`), false, k);
    assert.equal(esFilaManualEditable(MANTENOR.filas.find((f) => f.clave === k)!), true, k);
  }
  const principal = MANTENOR.filas.find((f) => f.clave === PRINCIPAL)!;
  assert.equal(esFilaDeCategoria(principal), true);
  assert.equal(esFilaManualEditable(principal), false);
});

test("la plantilla de Mantenor es válida", () => {
  assert.deepEqual(validarPlantilla(MANTENOR), []);
});
