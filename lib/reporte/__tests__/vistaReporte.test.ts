import { test } from "node:test";
import assert from "node:assert/strict";
import { periodosHasta } from "@/lib/reporte/motor";
import { cantidadDeMeses, resolverVista, vistaPorDefecto } from "@/lib/reporte/vistaReporte";
import { enlacesDePeriodos } from "@/lib/periodosHabilitados";

const HABILITADOS = ["2026-09", "2026-10", "2026-11"];

test("vistaPorDefecto: todos los roles ven el período actual (un solo mes)", () => {
  assert.equal(vistaPorDefecto(false), "actual");
  assert.equal(vistaPorDefecto(true), "actual");
});

test("resolverVista: solo «actual» y «todo» valen; cualquier otra cosa vuelve al default («actual») para todos los roles", () => {
  assert.equal(resolverVista("actual", true), "actual");
  assert.equal(resolverVista("todo", false), "todo");
  for (const raro of [undefined, "", "TODO", "Actual", "todos", " todo", ["todo", "actual"], "todo;actual"]) {
    assert.equal(resolverVista(raro, false), "actual");
    assert.equal(resolverVista(raro, true), "actual");
  }
});

test("cantidadDeMeses: «actual» es un solo mes, para cualquier rol y período", () => {
  assert.equal(cantidadDeMeses("actual", "2026-11", false, HABILITADOS), 1);
  assert.equal(cantidadDeMeses("actual", "2026-11", true, HABILITADOS), 1);
  assert.equal(cantidadDeMeses("actual", "2020-01", false, HABILITADOS), 1);
});

test("cantidadDeMeses: «todo» del gerente se corta en los períodos habilitados", () => {
  assert.equal(cantidadDeMeses("todo", "2026-11", false, HABILITADOS, "2026-09"), 3); // sep, oct, nov
  assert.equal(cantidadDeMeses("todo", "2026-10", false, HABILITADOS, "2026-09"), 2); // ago no está habilitado
  assert.equal(cantidadDeMeses("todo", "2026-09", false, HABILITADOS, "2026-09"), 1);
  // Un período fuera de la lista nunca da cero columnas.
  assert.equal(cantidadDeMeses("todo", "2026-12", false, HABILITADOS, "2026-09"), 1);
});

test("cantidadDeMeses: «todo» de ADMIN y FINANZAS se corta en el inicio del historial (no ven meses ocultos)", () => {
  // Con inicio en septiembre: tope de 3 meses, pero nunca antes de septiembre.
  assert.equal(cantidadDeMeses("todo", "2026-09", true, HABILITADOS, "2026-09"), 1);
  assert.equal(cantidadDeMeses("todo", "2026-10", true, HABILITADOS, "2026-09"), 2);
  assert.equal(cantidadDeMeses("todo", "2026-11", true, HABILITADOS, "2026-09"), 3);
  assert.equal(cantidadDeMeses("todo", "2027-01", true, HABILITADOS, "2026-09"), 3); // sin tope por lista, sí por MESES_EN_TODO
});

test("cantidadDeMeses con la config real: octubre muestra solo octubre y noviembre, octubre y noviembre; para todos los roles", () => {
  for (const admin of [true, false]) {
    assert.equal(cantidadDeMeses("todo", "2026-10", admin), 1, `oct, admin=${admin}`);
    assert.equal(cantidadDeMeses("todo", "2026-11", admin), 2, `nov, admin=${admin}`);
  }
  // Ni agosto ni septiembre entran nunca en las columnas: el primer mes visible es el inicio del historial.
  for (const admin of [true, false]) {
    assert.deepEqual(periodosHasta("2026-11", cantidadDeMeses("todo", "2026-11", admin)), ["2026-10", "2026-11"]);
    assert.deepEqual(periodosHasta("2026-10", cantidadDeMeses("todo", "2026-10", admin)), ["2026-10"]);
  }
});

test("el mes de contexto invisible (+1) sigue cargándose: octubre pide septiembre, noviembre pide octubre", () => {
  // La página arma periodosHasta(periodo, cantidadDeMeses + 1); armarReporte descarta ese primer mes (mesesDeContexto = 1).
  assert.deepEqual(periodosHasta("2026-10", cantidadDeMeses("todo", "2026-10", true) + 1), ["2026-09", "2026-10"]);
  assert.deepEqual(periodosHasta("2026-10", cantidadDeMeses("actual", "2026-10", true) + 1), ["2026-09", "2026-10"]);
  assert.deepEqual(periodosHasta("2026-11", cantidadDeMeses("todo", "2026-11", true) + 1), ["2026-09", "2026-10", "2026-11"]);
});

test("enlacesDePeriodos: sin vista los links quedan como antes; con vista la conservan", () => {
  const sin = enlacesDePeriodos("brillante", "2026-11", HABILITADOS, "reporte");
  assert.equal(sin[0].href, "/brillante/2026-09/reporte");
  const con = enlacesDePeriodos("brillante", "2026-11", HABILITADOS, "reporte", "todo");
  assert.equal(con[0].href, "/brillante/2026-09/reporte?vista=todo");
  assert.equal(con[2].activo, true);
});
