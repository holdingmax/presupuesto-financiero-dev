import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, type DatosMes, type Plantilla } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { capital, cat, clasif, disp, disponible, egreso, titulo, total } from "@/lib/reporte/plantillas/filas";

const BRILLANTE = PLANTILLAS_POR_SLUG["brillante"]!;
const FIJO = 3100000000; // 31.000.000 en centavos

const manuales = (p: [string, number][] = [], r: [string, number][] = []) => ({ presupuesto: new Map(p), real: new Map(r) });

function mes(extra: Partial<DatosMes> = {}): DatosMes {
  return { periodo: "2026-10", real: new Map(), presupuesto: new Map(), semanasCerradas: 0, ...extra };
}

function celda(plantilla: Plantilla, datos: DatosMes, clave: string) {
  return armarReporte(plantilla, [datos]).filas.find((f) => f.fila.clave === clave)!.celdas[0];
}

// Mes con presupuesto cargado (otra categoría), sin Sueldos ni SAC: el motor los ve en 0, no vacíos.
const CON_PRESUPUESTO_SIN_SUELDOS = new Map([["CHEQUES DIFERIDOS", 5000]]);

test("Brillante: con presupuesto cargado y Sueldos y SAC sin valor, el Capital queda vacío", () => {
  const d = mes({ presupuesto: CON_PRESUPUESTO_SIN_SUELDOS });
  assert.equal(celda(BRILLANTE, d, "br.sueldos").presupuestado, 0);
  assert.equal(celda(BRILLANTE, d, "br.capital").presupuestado, null);
});

test("Brillante: con Sueldos y SAC explícitos en 0 el Capital también queda vacío", () => {
  const d = mes({ presupuesto: new Map([["SUELDOS", 0], ["SAC", 0]]) });
  assert.equal(celda(BRILLANTE, d, "br.capital").presupuestado, null);
});

test("Brillante: solo Sueldos con valor = Sueldos + 31.000.000", () => {
  const d = mes({ presupuesto: new Map([["SUELDOS", 1603920700]]) });
  assert.equal(celda(BRILLANTE, d, "br.capital").presupuestado, 1603920700 + FIJO); // 47.039.207
});

test("Brillante: solo SAC con valor = SAC + 31.000.000", () => {
  const d = mes({ presupuesto: new Map([["SAC", 800000000]]) });
  assert.equal(celda(BRILLANTE, d, "br.capital").presupuestado, 800000000 + FIJO);
});

test("Brillante: Sueldos y SAC con valor suman ambos más el fijo", () => {
  const d = mes({ presupuesto: new Map([["SUELDOS", 1000], ["SAC", 500]]) });
  assert.equal(celda(BRILLANTE, d, "br.capital").presupuestado, 1500 + FIJO);
});

test("Brillante: el manual presupuestado gana aunque Sueldos y SAC estén en 0", () => {
  const d = mes({ presupuesto: CON_PRESUPUESTO_SIN_SUELDOS, manuales: manuales([["br.capital", 123400]]) });
  assert.equal(celda(BRILLANTE, d, "br.capital").presupuestado, 123400);
});

test("Brillante: sin presupuesto el Capital sigue vacío", () => {
  assert.equal(celda(BRILLANTE, mes({ presupuesto: null }), "br.capital").presupuestado, null);
});

test("Brillante: Disponible queda vacío cuando el Capital está vacío, y se calcula cuando hay Capital", () => {
  const dispo: [string, number][] = [["br.dBancoFci", 100000000000]];
  const vacio = mes({ presupuesto: CON_PRESUPUESTO_SIN_SUELDOS, manuales: manuales([], dispo) });
  assert.equal(celda(BRILLANTE, vacio, "br.capital").presupuestado, null);
  assert.equal(celda(BRILLANTE, vacio, "br.disponible").presupuestado, null);

  const conSueldos = mes({ presupuesto: new Map([["SUELDOS", 1000]]), manuales: manuales([], dispo) });
  const total = celda(BRILLANTE, conSueldos, "br.totalDisponibilidades").presupuestado;
  assert.notEqual(total, null);
  assert.equal(celda(BRILLANTE, conSueldos, "br.disponible").presupuestado, total! - (1000 + FIJO));
});

// Regla con fijo y sin la bandera (el comportamiento de siempre): suma el fijo aunque los términos estén en 0.
const SIN_BANDERA: Plantilla = {
  empresa: "Prueba",
  filas: [
    titulo("tD", "DISPONIBILIDADES", "DISPONIBILIDADES"),
    disp("banco", "BANCO", "cuadre"),
    total("totalDisp", "DISPONIBILIDADES", "TOTAL DISPONIBILIDADES", ["banco"], { rol: "totalDisponibilidades" }),
    egreso("sueldos", "Sueldos", clasif("SUELDOS"), cat("SUELDOS")),
    capital("capital", "CAPITAL", { terminos: [{ fila: "sueldos", factor: 1 }], fijo: 100 }),
    disponible("disp", "DISPONIBLE", "totalDisp", "capital"),
  ],
};
const CON_BANDERA: Plantilla = {
  ...SIN_BANDERA,
  filas: SIN_BANDERA.filas.map((f) =>
    f.tipo === "capital" && f.regla !== "manual" ? { ...f, regla: { ...f.regla, fijoSoloConTerminos: true } } : f
  ),
};

test("una regla con fijo y sin la bandera sigue sumando el fijo aunque los términos estén en 0", () => {
  const d = mes({ presupuesto: new Map([["OTRA", 1]]) });
  assert.equal(celda(SIN_BANDERA, d, "capital").presupuestado, 100);
  assert.equal(celda(CON_BANDERA, d, "capital").presupuestado, null);
  const conValor = mes({ presupuesto: new Map([["SUELDOS", 50]]) });
  assert.equal(celda(SIN_BANDERA, conValor, "capital").presupuestado, 150);
  assert.equal(celda(CON_BANDERA, conValor, "capital").presupuestado, 150);
});

test("solo Brillante tiene la bandera fijoSoloConTerminos", () => {
  const conBandera = Object.entries(PLANTILLAS_POR_SLUG)
    .filter(([, p]) => p.filas.some((f) => f.tipo === "capital" && f.regla !== "manual" && f.regla.fijoSoloConTerminos))
    .map(([slug]) => slug);
  assert.deepEqual(conBandera, ["brillante"]);
});
