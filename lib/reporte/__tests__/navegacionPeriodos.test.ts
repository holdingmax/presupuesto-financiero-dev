import { test } from "node:test";
import assert from "node:assert/strict";
import { PERIODOS_HABILITADOS, PERIODO_EN_CARGA_GERENTE, PERIODO_INICIO_HISTORIAL } from "@/lib/config";
import {
  cantidadDeMeses,
  enlacesDeModo,
  mesesAnteriores,
  modoDePeriodo,
  resolverVista,
  vistaEfectiva,
  vistaPorDefecto,
} from "@/lib/reporte/vistaReporte";
import { enlacesDePeriodos } from "@/lib/periodosHabilitados";

test("config: PERIODOS_HABILITADOS no cambió y el inicio del historial es anterior al mes en curso", () => {
  assert.deepEqual([...PERIODOS_HABILITADOS], ["2026-09", "2026-10", "2026-11"]);
  assert.equal(PERIODO_INICIO_HISTORIAL, "2026-09");
  assert.ok(PERIODO_INICIO_HISTORIAL < PERIODO_EN_CARGA_GERENTE);
  assert.match(PERIODO_INICIO_HISTORIAL, /^\d{4}-(0[1-9]|1[0-2])$/);
});

test("modoDePeriodo: el mes en curso y los posteriores son «en-curso»; los anteriores, «anteriores»", () => {
  assert.equal(modoDePeriodo("2026-11", "2026-11"), "en-curso");
  assert.equal(modoDePeriodo("2026-12", "2026-11"), "en-curso");
  assert.equal(modoDePeriodo("2027-01", "2026-11"), "en-curso");
  assert.equal(modoDePeriodo("2026-10", "2026-11"), "anteriores");
  assert.equal(modoDePeriodo("2026-09", "2026-11"), "anteriores");
  assert.equal(modoDePeriodo("2025-12", "2026-01"), "anteriores");
  assert.equal(modoDePeriodo(PERIODO_EN_CARGA_GERENTE), "en-curso"); // usa PERIODO_EN_CARGA_GERENTE
});

test("mesesAnteriores: desde el inicio hasta el mes previo al en curso, sin incluirlo", () => {
  assert.deepEqual(mesesAnteriores("2026-09", "2026-11"), ["2026-09", "2026-10"]);
  assert.deepEqual(mesesAnteriores("2026-07", "2026-11"), ["2026-07", "2026-08", "2026-09", "2026-10"]);
});

test("mesesAnteriores: con la rotación del mes en curso la lista crece y cruza de año", () => {
  assert.deepEqual(mesesAnteriores("2026-09", "2026-12"), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(mesesAnteriores("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01"]);
});

test("mesesAnteriores: vacía si el inicio no es anterior al mes en curso", () => {
  assert.deepEqual(mesesAnteriores("2026-11", "2026-11"), []);
  assert.deepEqual(mesesAnteriores("2026-12", "2026-11"), []);
});

test("mesesAnteriores: con la config real, ninguno es el mes en curso y todos son anteriores", () => {
  const meses = mesesAnteriores();
  assert.ok(meses.length > 0);
  assert.ok(!meses.includes(PERIODO_EN_CARGA_GERENTE));
  for (const m of meses) assert.equal(modoDePeriodo(m), "anteriores", m);
});

test("vistaPorDefecto: un solo mes para todos los roles", () => {
  assert.equal(vistaPorDefecto(true), "actual");
  assert.equal(vistaPorDefecto(false), "actual");
});

test("vistaEfectiva: en el mes en curso (o posterior) «todo» se ignora; en anteriores se respeta", () => {
  assert.equal(vistaEfectiva("todo", "2026-11", "2026-11"), "actual");
  assert.equal(vistaEfectiva("todo", "2026-12", "2026-11"), "actual");
  assert.equal(vistaEfectiva("actual", "2026-11", "2026-11"), "actual");
  assert.equal(vistaEfectiva("todo", "2026-10", "2026-11"), "todo");
  assert.equal(vistaEfectiva("actual", "2026-10", "2026-11"), "actual");
});

test("links viejos: ?vista=actual y ?vista=todo siguen siendo valores válidos", () => {
  assert.equal(resolverVista("actual", true), "actual");
  assert.equal(resolverVista("todo", false), "todo");
});

test("enlacesDeModo: «Mes en curso» va al período en curso sin parámetros; «Meses anteriores», al último mes previo", () => {
  const e = enlacesDeModo("brillante", "2026-11", "2026-11", "2026-09");
  assert.deepEqual(
    e.map((x) => [x.texto, x.href]),
    [
      ["Mes en curso", "/brillante/2026-11/reporte"],
      ["Meses anteriores", "/brillante/2026-10/reporte"],
    ]
  );
});

test("enlacesDeModo: marca el modo que se está viendo, deducido del período", () => {
  const activo = (periodo: string) =>
    enlacesDeModo("hwc", periodo, "2026-11", "2026-09").filter((x) => x.activo).map((x) => x.modo);
  assert.deepEqual(activo("2026-11"), ["en-curso"]);
  assert.deepEqual(activo("2026-12"), ["en-curso"]);
  assert.deepEqual(activo("2026-10"), ["anteriores"]);
  assert.deepEqual(activo("2026-09"), ["anteriores"]);
});

test("enlacesDeModo: sin meses anteriores solo queda «Mes en curso»", () => {
  const e = enlacesDeModo("hwc", "2026-11", "2026-11", "2026-11");
  assert.deepEqual(e.map((x) => x.modo), ["en-curso"]);
});

test("botones de mes: salen de mesesAnteriores, conservan la vista y marcan el mes visto", () => {
  const enlaces = enlacesDePeriodos("brillante", "2026-10", mesesAnteriores("2026-07", "2026-11"), "reporte", "todo");
  assert.deepEqual(
    enlaces.map((x) => x.href),
    [
      "/brillante/2026-07/reporte?vista=todo",
      "/brillante/2026-08/reporte?vista=todo",
      "/brillante/2026-09/reporte?vista=todo",
      "/brillante/2026-10/reporte?vista=todo",
    ]
  );
  assert.deepEqual(enlaces.filter((x) => x.activo).map((x) => x.periodo), ["2026-10"]);
});

test("cantidadDeMeses con el historial: el gerente en «todo» nunca pasa de los meses disponibles", () => {
  const meses = mesesAnteriores();
  meses.forEach((m, i) => {
    assert.equal(cantidadDeMeses("todo", m, false, PERIODOS_HABILITADOS), Math.min(3, i + 1), m);
    assert.equal(cantidadDeMeses("actual", m, false, PERIODOS_HABILITADOS), 1, m);
  });
});
