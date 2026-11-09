import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNIDADES_NEGOCIO,
  esUnidadDeLaLista,
  opcionesUnidad,
  proponerUnidadPorCuenta,
  proponerUnidadPorRazonSocial,
  unidadDeLaLista,
} from "@/lib/unidadesNegocio";

// Tabla oficial de Kike (2026-10-13).
test("razón social → unidad: TUCSON, CREAR y LI ya no son mixtas; HANDYWAY es HWC", () => {
  assert.equal(proponerUnidadPorRazonSocial("TUCSON"), "RADIO");
  assert.equal(proponerUnidadPorRazonSocial("CREAR"), "MANTENOR");
  assert.equal(proponerUnidadPorRazonSocial("LI"), "BRILLANTE");
  assert.equal(proponerUnidadPorRazonSocial("HANDYWAY"), "HWC");
  // Tolera mayúsculas, tildes y espacios.
  assert.equal(proponerUnidadPorRazonSocial(" Tucson "), "RADIO");
});

test("razón social: LI RATIO, SPP RATIO y CIELOS siguen como estaban", () => {
  assert.equal(proponerUnidadPorRazonSocial("LI RATIO"), null);
  assert.equal(proponerUnidadPorRazonSocial("CIELOS"), null);
  assert.equal(proponerUnidadPorRazonSocial("SPP RATIO"), "SPP");
});

test("razón social: las que ya coincidían no cambian", () => {
  for (const r of ["FREDY", "QUINTEROS", "SIERRA", "WHEELER", "GONZALEZ", "ESTEVEZ"]) {
    assert.equal(proponerUnidadPorRazonSocial(r), "FREDY");
  }
  assert.equal(proponerUnidadPorRazonSocial("INFO"), "RADIO");
  assert.equal(proponerUnidadPorRazonSocial("RADIO"), "RADIO");
  assert.equal(proponerUnidadPorRazonSocial("PANINI"), "HAVANNA");
  assert.equal(proponerUnidadPorRazonSocial("GOLD SEGURIDAD"), "BRILLANTE");
  assert.equal(proponerUnidadPorRazonSocial("SPP"), "SPP");
  assert.equal(proponerUnidadPorRazonSocial("WEB MASTER"), "LOGISTICA");
});

// Kike, 2026-10-17: HWC y HANDYWAY son la misma unidad.
test("HANDYWAY ya no es una unidad propia: no está en la lista y un valor viejo se muestra como extra", () => {
  assert.ok(!esUnidadDeLaLista("HANDYWAY"));
  assert.ok(esUnidadDeLaLista("HWC"));
  const opciones = opcionesUnidad(["HANDYWAY", "HWC"]);
  assert.equal(opciones[0], "HANDYWAY");
  assert.equal(opciones.filter((o) => o === "HANDYWAY").length, 1);
});

test("EXPENSAS sigue siendo una unidad cargable", () => {
  assert.ok(esUnidadDeLaLista("EXPENSAS"));
});

test("ninguna cuenta del mapa apunta a HANDYWAY", () => {
  for (const c of ["BNA 241", "SANT 099", "FRANCES 525", "MACRO 833", "MACRO 918"]) {
    assert.notEqual(proponerUnidadPorCuenta(c), "HANDYWAY", c);
  }
});

test("cuenta Galicia 455 → SPP, en cualquier grafía", () => {
  assert.equal(proponerUnidadPorCuenta("GALICIA 455"), "SPP");
  assert.equal(proponerUnidadPorCuenta("Galicia  455 "), "SPP");
});

test("toda unidad de las razones sociales y las cuentas está en la lista cerrada", () => {
  const razones = ["TUCSON", "CREAR", "LI", "HANDYWAY", "FREDY", "INFO", "PANINI", "GOLD SEGURIDAD", "SPP", "WEB MASTER", "HWC", "FID ADM 2", "SPP RATIO"];
  for (const r of razones) assert.ok(esUnidadDeLaLista(proponerUnidadPorRazonSocial(r)!), r);
  for (const c of ["GALICIA 455", "GALICIA 336", "MACRO 037", "FRANCES 891"]) {
    assert.ok(esUnidadDeLaLista(proponerUnidadPorCuenta(c)!), c);
  }
  assert.equal(new Set(UNIDADES_NEGOCIO).size, UNIDADES_NEGOCIO.length);
});

test("cuenta → unidad: BNA 241 y SANT 099 son de HWC (madre de Kike, EMPRESA = HWC)", () => {
  assert.equal(proponerUnidadPorCuenta("BNA 241"), "HWC");
  assert.equal(proponerUnidadPorCuenta("SANT 099"), "HWC");
  assert.equal(proponerUnidadPorCuenta(" sant  099 "), "HWC");
  assert.equal(proponerUnidadPorCuenta("SANTANDER 099"), null);
});

test("cuenta → unidad: lista vigente de Flavia (2026-10-16)", () => {
  const esperado: Record<string, string> = {
    "MACRO 575": "SPP",
    "MACRO 247": "SPP",
    "MACRO 546": "BRILLANTE",
    "MACRO 450": "BRILLANTE",
    "MACRO 571": "MANTENOR",
    "MACRO 831": "FREDY",
    "MACRO 715": "RADIO",
    "MACRO 906": "RADIO",
  };
  for (const [c, u] of Object.entries(esperado)) assert.equal(proponerUnidadPorCuenta(c), u, c);
  // FRANCES 907 va con la misma unidad que FRANCES 891 (Web Master).
  assert.equal(proponerUnidadPorCuenta("FRANCES 907"), proponerUnidadPorCuenta("FRANCES 891"));
  assert.equal(proponerUnidadPorCuenta("FRANCES 907"), "LOGISTICA");
  // MACRO 8037 ya no se usa pero se conserva por los movimientos viejos.
  assert.equal(proponerUnidadPorCuenta("MACRO 8037"), "BRILLANTE");
});

test("cuenta → unidad: las 11 cuentas de los madres HWC y Fredy", () => {
  for (const c of ["FRANCES 525", "MACRO 833", "MACRO 918"]) assert.equal(proponerUnidadPorCuenta(c), "HWC", c);
  for (const c of ["GALICIA 249", "MACRO 160", "MACRO 154", "MACRO 432", "MACRO 789", "MACRO 669", "MACRO 672", "MACRO 870"]) {
    assert.equal(proponerUnidadPorCuenta(c), "FREDY", c);
  }
});

test("HAVANNA PERU y PLATE SILVER están en la lista, JPS no, y no hay duplicados", () => {
  assert.ok(esUnidadDeLaLista("HAVANNA PERU"));
  assert.ok(esUnidadDeLaLista("PLATE SILVER"));
  assert.ok(!esUnidadDeLaLista("JPS"));
  assert.ok(!(UNIDADES_NEGOCIO as readonly string[]).includes("JPS"));
  assert.equal(new Set(UNIDADES_NEGOCIO).size, UNIDADES_NEGOCIO.length);
});

test("una fila vieja con unidad JPS no se rompe: JPS sale como opción extra", () => {
  const opciones = opcionesUnidad(["JPS"]);
  assert.equal(opciones[0], "JPS");
  assert.equal(opciones.filter((o) => o === "JPS").length, 1);
  assert.ok(opciones.includes("HAVANNA PERU") && opciones.includes("PLATE SILVER"));
});

test("unidadDeLaLista reconoce las dos unidades nuevas sin mayúsculas ni espacios de más", () => {
  assert.equal(unidadDeLaLista("plate silver"), "PLATE SILVER");
  assert.equal(unidadDeLaLista(" Havanna  Perú "), "HAVANNA PERU");
  assert.equal(unidadDeLaLista("HAVANNA"), "HAVANNA");
  assert.equal(unidadDeLaLista("JPS"), null);
});
