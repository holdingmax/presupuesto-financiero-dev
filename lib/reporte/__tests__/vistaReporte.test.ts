import { test } from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(cantidadDeMeses("todo", "2026-11", false, HABILITADOS), 3); // sep, oct, nov
  assert.equal(cantidadDeMeses("todo", "2026-10", false, HABILITADOS), 2); // ago no está habilitado
  assert.equal(cantidadDeMeses("todo", "2026-09", false, HABILITADOS), 1);
  // Un período fuera de la lista nunca da cero columnas.
  assert.equal(cantidadDeMeses("todo", "2026-12", false, HABILITADOS), 1);
});

test("cantidadDeMeses: «todo» de ADMIN y FINANZAS no tiene tope (como siempre)", () => {
  assert.equal(cantidadDeMeses("todo", "2026-09", true, HABILITADOS), 3);
  assert.equal(cantidadDeMeses("todo", "2026-11", true, HABILITADOS), 3);
});

test("enlacesDePeriodos: sin vista los links quedan como antes; con vista la conservan", () => {
  const sin = enlacesDePeriodos("brillante", "2026-11", HABILITADOS, "reporte");
  assert.equal(sin[0].href, "/brillante/2026-09/reporte");
  const con = enlacesDePeriodos("brillante", "2026-11", HABILITADOS, "reporte", "todo");
  assert.equal(con[0].href, "/brillante/2026-09/reporte?vista=todo");
  assert.equal(con[2].activo, true);
});
