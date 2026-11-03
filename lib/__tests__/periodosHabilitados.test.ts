import { test } from "node:test";
import assert from "node:assert/strict";
import { PERIODOS_HABILITADOS, PERIODO_EN_CARGA_GERENTE, PERIODO_POR_DEFECTO } from "@/lib/config";
import {
  PeriodoNoHabilitadoError,
  enlacesDePeriodos,
  esPeriodoHabilitado,
  avisoPeriodoSoloLectura,
  mensajePeriodoSoloLectura,
  nombreLegibleDePeriodo,
  puedeEditarPeriodoComoGerente,
  puedeVerPeriodo,
} from "@/lib/periodosHabilitados";
import { ocultaPestanaPresupuesto } from "@/lib/navegacionEmpresa";

test("config: los períodos habilitados son septiembre, octubre y noviembre de 2026", () => {
  assert.deepEqual([...PERIODOS_HABILITADOS], ["2026-09", "2026-10", "2026-11"]);
});

test("config: el período por defecto está en la lista", () => {
  assert.ok(PERIODOS_HABILITADOS.includes(PERIODO_POR_DEFECTO));
});

test("config: la lista no tiene duplicados, está ordenada y todos son AAAA-MM con mes de 01 a 12", () => {
  assert.equal(new Set(PERIODOS_HABILITADOS).size, PERIODOS_HABILITADOS.length);
  assert.deepEqual([...PERIODOS_HABILITADOS], [...PERIODOS_HABILITADOS].sort());
  for (const p of PERIODOS_HABILITADOS) assert.match(p, /^\d{4}-(0[1-9]|1[0-2])$/, p);
});

test("esPeriodoHabilitado: acepta cada período de la lista", () => {
  for (const p of ["2026-09", "2026-10", "2026-11"]) assert.equal(esPeriodoHabilitado(p), true, p);
});

test("esPeriodoHabilitado: rechaza cualquier otro valor, incluidos meses inválidos y formas raras", () => {
  for (const p of ["2026-08", "2026-12", "2027-09", "2026-13", "2026-00", "2026-9", "", " 2026-09", "2026-09 ", "septiembre", "2026-09-01"]) {
    assert.equal(esPeriodoHabilitado(p), false, JSON.stringify(p));
  }
});

test("esPeriodoHabilitado: usa la lista que se le pase", () => {
  assert.equal(esPeriodoHabilitado("2026-08", ["2026-08"]), true);
  assert.equal(esPeriodoHabilitado("2026-09", ["2026-08"]), false);
  assert.equal(esPeriodoHabilitado("2026-09", []), false);
});

test("puedeVerPeriodo: ADMIN y FINANZAS abren cualquier período", () => {
  for (const p of ["2026-09", "2026-08", "2027-01", "2026-13"]) {
    assert.equal(puedeVerPeriodo(p, true), true, p);
  }
});

test("puedeVerPeriodo: el resto solo abre los habilitados", () => {
  assert.equal(puedeVerPeriodo("2026-10", false), true);
  assert.equal(puedeVerPeriodo("2026-08", false), false);
  assert.equal(puedeVerPeriodo("2026-13", false), false);
});

test("enlacesDePeriodos: un link por período, en orden, hacia la pantalla de Presupuesto", () => {
  const enlaces = enlacesDePeriodos("fredy-publicidad", "2026-10");
  assert.deepEqual(
    enlaces.map((e) => e.href),
    [
      "/fredy-publicidad/2026-09/presupuesto",
      "/fredy-publicidad/2026-10/presupuesto",
      "/fredy-publicidad/2026-11/presupuesto",
    ]
  );
});

test("enlacesDePeriodos: marca como activo solo el período actual", () => {
  const enlaces = enlacesDePeriodos("hwc", "2026-11");
  assert.deepEqual(
    enlaces.map((e) => [e.periodo, e.activo]),
    [
      ["2026-09", false],
      ["2026-10", false],
      ["2026-11", true],
    ]
  );
});

test("enlacesDePeriodos: con un período fuera de la lista (ADMIN o FINANZAS) no marca ninguno", () => {
  assert.ok(enlacesDePeriodos("hwc", "2026-08").every((e) => !e.activo));
});

test("PeriodoNoHabilitadoError: es un Error identificable y guarda el período", () => {
  const error = new PeriodoNoHabilitadoError("2026-08");
  assert.ok(error instanceof Error);
  assert.ok(error instanceof PeriodoNoHabilitadoError);
  assert.equal(error.periodo, "2026-08");
});

test("config: el período en carga del gerente es 2026-11 y está en la lista de habilitados", () => {
  assert.equal(PERIODO_EN_CARGA_GERENTE, "2026-11");
  assert.ok(PERIODOS_HABILITADOS.includes(PERIODO_EN_CARGA_GERENTE));
});

test("puedeEditarPeriodoComoGerente: ADMIN y FINANZAS editan cualquier período", () => {
  for (const p of ["2026-09", "2026-10", "2026-11", "2026-08", "2027-01", "2026-13", ""]) {
    assert.equal(puedeEditarPeriodoComoGerente(p, true), true, JSON.stringify(p));
  }
});

test("puedeEditarPeriodoComoGerente: el gerente edita solo el período en curso", () => {
  assert.equal(puedeEditarPeriodoComoGerente("2026-11", false), true);
  for (const p of ["2026-09", "2026-10", "2026-12", "2026-08", "2027-11", "2026-1", " 2026-11", "2026-11 ", "2026-11-01", ""]) {
    assert.equal(puedeEditarPeriodoComoGerente(p, false), false, JSON.stringify(p));
  }
});

test("puedeEditarPeriodoComoGerente: usa el período que se le pase", () => {
  assert.equal(puedeEditarPeriodoComoGerente("2026-12", false, "2026-12"), true);
  assert.equal(puedeEditarPeriodoComoGerente("2026-11", false, "2026-12"), false);
  assert.equal(puedeEditarPeriodoComoGerente("2026-11", true, "2026-12"), true);
});

test("mensajePeriodoSoloLectura: nombra el mes en curso en formato legible", () => {
  assert.match(mensajePeriodoSoloLectura(), /Noviembre 2026/);
  assert.match(mensajePeriodoSoloLectura("2026-12"), /Diciembre 2026/);
  assert.doesNotMatch(mensajePeriodoSoloLectura(), /2026-11/);
});

test("nombreLegibleDePeriodo: mes con mayúscula y año; un texto inválido vuelve tal cual", () => {
  assert.equal(nombreLegibleDePeriodo("2026-11"), "Noviembre 2026");
  assert.equal(nombreLegibleDePeriodo("2026-01"), "Enero 2026");
  assert.equal(nombreLegibleDePeriodo("2026-12"), "Diciembre 2026");
  for (const p of ["2026-13", "2026-00", "2026-9", "abc", ""]) assert.equal(nombreLegibleDePeriodo(p), p);
});

test("avisoPeriodoSoloLectura: ADMIN y FINANZAS nunca ven el cartel", () => {
  for (const p of ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]) {
    assert.equal(avisoPeriodoSoloLectura(p, true), null, p);
  }
});

test("avisoPeriodoSoloLectura: el gerente no ve cartel en el mes en curso", () => {
  assert.equal(avisoPeriodoSoloLectura("2026-11", false), null);
});

test("avisoPeriodoSoloLectura: el gerente ve el texto exacto en cualquier otro mes, con el mes EN CURSO nombrado", () => {
  const esperado = "Solo se puede cargar el mes en curso (Noviembre 2026). Este mes está en solo lectura.";
  for (const p of ["2026-09", "2026-10", "2026-12", "2026-08"]) {
    assert.equal(avisoPeriodoSoloLectura(p, false), esperado, p);
  }
  assert.equal(
    avisoPeriodoSoloLectura("2026-11", false, "2026-12"),
    "Solo se puede cargar el mes en curso (Diciembre 2026). Este mes está en solo lectura."
  );
});

test("avisoPeriodoSoloLectura: hay cartel si y solo si puedeEditarPeriodoComoGerente es false (UI y servidor no divergen)", () => {
  for (const p of ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-11", "2026-1", " 2026-11", ""]) {
    for (const adminOFinanzas of [true, false]) {
      assert.equal(
        avisoPeriodoSoloLectura(p, adminOFinanzas) === null,
        puedeEditarPeriodoComoGerente(p, adminOFinanzas),
        `${JSON.stringify(p)} admin=${adminOFinanzas}`
      );
    }
  }
});

test("selector de mes del Reporte: aparece cuando la pestaña está oculta, para todos los roles (interruptor encendido), y sus links van al Reporte", () => {
  for (const admin of [true, false]) {
    assert.equal(ocultaPestanaPresupuesto(admin, "hwc", undefined, undefined, true), true, `admin=${admin}`);
  }
  // Apagado, ADMIN y FINANZAS conservan la pestaña y no necesitan el selector del Reporte.
  assert.equal(ocultaPestanaPresupuesto(true, "hwc", undefined, undefined, false), false);
  assert.ok(enlacesDePeriodos("hwc", "2026-11", undefined, "reporte").every((e) => e.href.endsWith("/reporte")));
});

test("enlacesDePeriodos: con segmento reporte los links van al Reporte; sin segmento, a Presupuesto", () => {
  assert.deepEqual(
    enlacesDePeriodos("hwc", "2026-11", undefined, "reporte").map((e) => e.href),
    ["/hwc/2026-09/reporte", "/hwc/2026-10/reporte", "/hwc/2026-11/reporte"]
  );
  assert.ok(enlacesDePeriodos("hwc", "2026-11").every((e) => e.href.endsWith("/presupuesto")));
});

test("enlacesDePeriodos: consultaExtra suma un parámetro por período y se combina con la vista; sin ella los links no cambian", () => {
  const extra = (p: string) => (p === "2026-11" ? "modo=anteriores" : "");
  assert.deepEqual(
    enlacesDePeriodos("hwc", "2026-10", undefined, "reporte", undefined, extra).map((e) => e.href),
    ["/hwc/2026-09/reporte", "/hwc/2026-10/reporte", "/hwc/2026-11/reporte?modo=anteriores"]
  );
  assert.deepEqual(
    enlacesDePeriodos("hwc", "2026-10", undefined, "reporte", "todo", extra).map((e) => e.href),
    ["/hwc/2026-09/reporte?vista=todo", "/hwc/2026-10/reporte?vista=todo", "/hwc/2026-11/reporte?vista=todo&modo=anteriores"]
  );
});
