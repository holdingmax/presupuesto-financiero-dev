import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, camposManuales, validarPlantilla, type DatosMes, type Plantilla } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import {
  abajo,
  capital,
  disp,
  disponible,
  PRESUPUESTO_DISPONIBLE,
  PRESUPUESTO_DISPONIBLE_PISABLE,
  SIN_REAL,
  total,
} from "@/lib/reporte/plantillas/filas";

// Presupuestado «disponible» con `pisableConManual` (Mantenor «Prestamos»): un valor tipeado lo pisa; sin valor sigue
// siendo el Disponible. Una fila «disponible» sin el flag no cambia.

const PLANTILLA: Plantilla = {
  empresa: "Prueba",
  filas: [
    disp("banco", "BANCO", "cuadre"),
    total("totalDisp", "DISPONIBILIDADES", "TOTAL DISPONIBILIDADES", ["banco"], { rol: "totalDisponibilidades" }),
    abajo("pisable", "Pisable", SIN_REAL, PRESUPUESTO_DISPONIBLE_PISABLE),
    abajo("comun", "Común", SIN_REAL, PRESUPUESTO_DISPONIBLE),
    capital("capital", "CAPITAL", "manual"),
    disponible("disp", "DISPONIBLE", "totalDisp", "capital"),
  ],
};

const manuales = (p: [string, number][] = [], r: [string, number][] = []) => ({ presupuesto: new Map(p), real: new Map(r) });

function mes(extra: Partial<DatosMes> = {}): DatosMes {
  return { periodo: "2026-10", real: new Map(), presupuesto: new Map(), semanasCerradas: 0, ...extra };
}

function celda(r: ReturnType<typeof armarReporte>, clave: string) {
  return r.filas.find((f) => f.fila.clave === clave)!.celdas[0];
}

const BASE: [string, number][] = [["banco", 100000]];

test("la plantilla de prueba es válida", () => {
  assert.deepEqual(validarPlantilla(PLANTILLA), []);
});

test("sin valor manual, la fila pisable sigue siendo el Disponible", () => {
  const r = armarReporte(PLANTILLA, [mes({ manuales: manuales([["capital", 30000]], BASE) })]);
  assert.equal(celda(r, "disp").presupuestado, 70000);
  assert.equal(celda(r, "pisable").presupuestado, 70000);
});

test("con valor manual, la fila pisable toma el valor tipeado y el Disponible no cambia", () => {
  const r = armarReporte(PLANTILLA, [mes({ manuales: manuales([["capital", 30000], ["pisable", 5000]], BASE) })]);
  assert.equal(celda(r, "pisable").presupuestado, 5000);
  assert.equal(celda(r, "disp").presupuestado, 70000);
});

test("un manual en 0 también pisa", () => {
  const r = armarReporte(PLANTILLA, [mes({ manuales: manuales([["capital", 30000], ["pisable", 0]], BASE) })]);
  assert.equal(celda(r, "pisable").presupuestado, 0);
});

test("con valor manual y sin Capital, la fila pisable muestra el valor (Mantenor sin Capital de octubre)", () => {
  const r = armarReporte(PLANTILLA, [mes({ manuales: manuales([["pisable", 5000]], BASE) })]);
  assert.equal(celda(r, "pisable").presupuestado, 5000);
  assert.equal(celda(r, "disp").presupuestado, null);
});

test("otra fila «disponible» sin el flag ignora el valor manual", () => {
  const r = armarReporte(PLANTILLA, [mes({ manuales: manuales([["capital", 30000], ["comun", 1], ["pisable", 5000]], BASE) })]);
  assert.equal(celda(r, "comun").presupuestado, 70000);
});

test("camposManuales: solo la fila con el flag ofrece Presupuestado", () => {
  const campos = camposManuales(PLANTILLA).map((c) => `${c.clave}|${c.columna}`);
  assert.ok(campos.includes("pisable|PRESUPUESTADO"));
  assert.equal(campos.includes("comun|PRESUPUESTADO"), false);
});

test("el flag lo usa solo Mantenor «Prestamos»", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const usan = plantilla.filas.filter((f) => f.tipo === "linea" && f.presupuesto.tipo === "disponible" && f.presupuesto.pisableConManual);
    assert.deepEqual(usan.map((f) => f.clave), slug === "mantenor" ? ["mn.prestamos"] : [], slug);
  }
});
