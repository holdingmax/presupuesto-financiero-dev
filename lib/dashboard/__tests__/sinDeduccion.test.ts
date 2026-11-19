import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contarMovimientosDelAlcance,
  desglosePorEmpresa,
  importeDelAlcance,
  porcentajeDelAlcance,
  rotuloDeTotal,
  soloDelAlcance,
  sumarImportesDelAlcance,
  totalDelAlcance,
  unidadEnAlcance,
  type MovimientoConPorciones,
} from "@/lib/dashboard/sinDeduccion";
import { IDS_ACTIVAS, alcanceDe } from "@/lib/dashboard/__tests__/fixturesAlcance";

// Que un usuario no pueda deducir otras empresas: totales, porcentajes, conteos y prorrateos solo con lo del alcance.
// Importes en centavos con signo de banco (egreso negativo).

const mov = (unidadNegocio: string, importeCentavos: number, porciones: { unidadNegocio: string; importeCentavos: number }[] = []): MovimientoConPorciones => ({
  unidadNegocio,
  importeCentavos,
  porciones,
});

test("unidadEnAlcance: compara normalizado (mayúsculas y espacios) y solo con las unidades del alcance", async () => {
  const a = await alcanceDe("GERENTE", ["conexion"]);
  assert.equal(unidadEnAlcance("LOGISTICA", a), true);
  assert.equal(unidadEnAlcance(" spp ", a), true);
  assert.equal(unidadEnAlcance("BRILLANTE", a), false);
  assert.equal(unidadEnAlcance("SIN ASIGNAR", a), false);
  assert.equal(unidadEnAlcance("", a), false);
});

// ---- Prorrateo: solo cuenta la porción de la unidad del alcance ---------------------------------------------------

// Un pago de 1.000,00 prorrateado: 600,00 de Brillante y 400,00 de Radio (egreso: negativo). La unidad del padre es Brillante.
const PRORRATEADO = mov("BRILLANTE", -100_000, [
  { unidadNegocio: "BRILLANTE", importeCentavos: -60_000 },
  { unidadNegocio: "RADIO", importeCentavos: -40_000 },
]);

test("prorrateo: cada alcance ve SOLO su porción, nunca el importe del padre ni el de la otra unidad", async () => {
  const soloBrillante = await alcanceDe("GERENTE", ["brillante"]);
  const soloRadio = await alcanceDe("GERENTE", ["radio"]);
  assert.equal(importeDelAlcance(PRORRATEADO, soloBrillante), -60_000);
  assert.equal(importeDelAlcance(PRORRATEADO, soloRadio), -40_000);
  assert.notEqual(importeDelAlcance(PRORRATEADO, soloBrillante), PRORRATEADO.importeCentavos);
});

test("prorrateo: con las dos unidades en el alcance se suman las dos porciones; sin ninguna, el movimiento no existe", async () => {
  const ambas = await alcanceDe("GERENTE", ["brillante", "radio"]);
  const ninguna = await alcanceDe("GERENTE", ["avianor"]);
  assert.equal(importeDelAlcance(PRORRATEADO, ambas), -100_000);
  assert.equal(importeDelAlcance(PRORRATEADO, ninguna), null);
});

test("prorrateo: la unidad del padre NO cuenta si el movimiento está prorrateado (cuenta solo por sus porciones)", async () => {
  // El padre dice BRILLANTE, pero ninguna porción es de Brillante: para Brillante no hay nada.
  const soloRadio = mov("BRILLANTE", -50_000, [{ unidadNegocio: "RADIO", importeCentavos: -50_000 }]);
  assert.equal(importeDelAlcance(soloRadio, await alcanceDe("GERENTE", ["brillante"])), null);
  assert.equal(importeDelAlcance(soloRadio, await alcanceDe("GERENTE", ["radio"])), -50_000);
});

test("prorrateo: lo que ve el alcance de Brillante NO cambia aunque cambie lo de Radio (no se puede deducir)", async () => {
  const brillante = await alcanceDe("GERENTE", ["brillante"]);
  const variantes = [-40_000, -1, -999_999].map((radio) =>
    mov("BRILLANTE", -60_000 + radio, [
      { unidadNegocio: "BRILLANTE", importeCentavos: -60_000 },
      { unidadNegocio: "RADIO", importeCentavos: radio },
    ])
  );
  for (const v of variantes) assert.equal(importeDelAlcance(v, brillante), -60_000);
  // y el padre sí cambia: usarlo dejaría deducir a Radio
  assert.equal(new Set(variantes.map((v) => v.importeCentavos)).size, 3);
});

test("movimiento sin prorrateo: cuenta por su unidad; las unidades de otras empresas no existen para el alcance", async () => {
  const a = await alcanceDe("GERENTE", ["brillante"]);
  assert.equal(importeDelAlcance(mov("BRILLANTE", 5_000), a), 5_000);
  assert.equal(importeDelAlcance(mov(" brillante ", -5_000), a), -5_000);
  assert.equal(importeDelAlcance(mov("RADIO", 5_000), a), null);
  assert.equal(importeDelAlcance(mov("SIN ASIGNAR", 5_000), a), null);
});

test("una porción en 0 sigue siendo del alcance (0, no null); una porción de otra unidad en 0 no", async () => {
  const a = await alcanceDe("GERENTE", ["brillante"]);
  const m = mov("BRILLANTE", -10_000, [
    { unidadNegocio: "BRILLANTE", importeCentavos: 0 },
    { unidadNegocio: "RADIO", importeCentavos: -10_000 },
  ]);
  assert.equal(importeDelAlcance(m, a), 0);
});

test("contar y sumar: un prorrateado cuenta UNA vez aunque tenga varias porciones propias; no entra lo ajeno", async () => {
  const a = await alcanceDe("GERENTE", ["brillante", "conexion"]);
  const movs = [
    mov("BRILLANTE", 10_000),
    mov("RADIO", 99_999),
    mov("LOGISTICA", -2_000),
    mov("HAVANNA", -1, [
      { unidadNegocio: "LOGISTICA", importeCentavos: -300 },
      { unidadNegocio: "SPP", importeCentavos: -200 },
      { unidadNegocio: "HAVANNA", importeCentavos: 500 },
    ]),
  ];
  assert.equal(contarMovimientosDelAlcance(movs, a), 3);
  assert.equal(sumarImportesDelAlcance(movs, a), 10_000 - 2_000 - 500);
});

test("soloDelAlcance filtra filas por su unidad", async () => {
  const a = await alcanceDe("GERENTE", ["radio"]);
  const filas = [{ u: "RADIO", n: 1 }, { u: "BRILLANTE", n: 2 }, { u: "radio", n: 3 }];
  assert.deepEqual(soloDelAlcance(filas, a, (f) => f.u).map((f) => f.n), [1, 3]);
});

// ---- Totales y porcentajes ------------------------------------------------------------------------------------

const DATOS = new Map<string, number>([
  ["brillante", 600_000],
  ["radio", 250_000],
  ["avianor", 90_000],
  ["conexion", 60_000],
]);

test("totalDelAlcance: suma solo las empresas del alcance e IGNORA el resto aunque venga en los datos", async () => {
  assert.equal(totalDelAlcance(DATOS, await alcanceDe("GERENTE", ["brillante"])).centavos, 600_000);
  assert.equal(totalDelAlcance(DATOS, await alcanceDe("GERENTE", ["brillante", "radio"])).centavos, 850_000);
  assert.equal(totalDelAlcance(DATOS, await alcanceDe("GERENTE", ["hwc"])).centavos, 0);
  assert.equal(totalDelAlcance(DATOS, await alcanceDe("ADMIN", [])).centavos, 1_000_000);
});

test("el total de una empresa no cambia aunque cambien los datos de las otras (no se puede deducir)", async () => {
  const a = await alcanceDe("GERENTE", ["brillante"]);
  const otros = new Map(DATOS);
  otros.set("radio", 1);
  otros.set("avianor", 9_999_999);
  otros.set("empresa-que-no-existe", 5);
  assert.equal(totalDelAlcance(otros, a).centavos, totalDelAlcance(DATOS, a).centavos);
});

test("rotuloDeTotal: «del holding» solo para ADMIN; un VIEWER con las 12 empresas y el resto dicen «de tus empresas»; nunca llevan números", async () => {
  assert.equal(rotuloDeTotal(await alcanceDe("ADMIN", [])), "Total del holding");
  for (const rol of ["FINANZAS", "GERENTE", "VIEWER"] as const) {
    const a = await alcanceDe(rol, IDS_ACTIVAS);
    assert.equal(rotuloDeTotal(a), "Total de tus empresas", rol);
  }
  for (const ids of [["brillante"], ["brillante", "radio"], IDS_ACTIVAS]) {
    assert.doesNotMatch(rotuloDeTotal(await alcanceDe("GERENTE", ids)), /\d/);
  }
  assert.equal(totalDelAlcance(DATOS, await alcanceDe("VIEWER", IDS_ACTIVAS)).rotulo, "Total de tus empresas");
});

test("porcentajeDelAlcance: sobre el total del alcance; con total 0 no divide; no cambia con los datos de otras empresas", async () => {
  const a = await alcanceDe("GERENTE", ["brillante", "radio"]);
  const total = totalDelAlcance(DATOS, a); // 850.000
  assert.equal(porcentajeDelAlcance(250_000, total), (250_000 / 850_000) * 100);
  assert.equal(porcentajeDelAlcance(850_000, total), 100);
  const vacio = totalDelAlcance(new Map(), a);
  assert.equal(porcentajeDelAlcance(1, vacio), null);
  // Un usuario con UNA sola empresa que mira esa empresa: su porcentaje es sobre sí misma, no sobre el holding.
  const una = await alcanceDe("GERENTE", ["brillante"]);
  assert.equal(porcentajeDelAlcance(600_000, totalDelAlcance(DATOS, una)), 100);
  const holding = await alcanceDe("ADMIN", []);
  assert.equal(porcentajeDelAlcance(600_000, totalDelAlcance(DATOS, holding)), 60);
});

test("desglosePorEmpresa: de un neto por unidad, solo las empresas del alcance (con sus dos unidades en Conexión); lo ajeno se ignora", async () => {
  const porUnidad = new Map<string, number>([
    ["BRILLANTE", 100],
    ["LOGISTICA", 30],
    ["SPP", 20],
    ["RADIO", 7_000],
    ["SIN ASIGNAR", 9_999],
  ]);
  const a = await alcanceDe("GERENTE", ["brillante", "conexion", "hwc"]);
  assert.deepEqual(desglosePorEmpresa(porUnidad, a), [
    { empresaId: "brillante", nombre: "Brillante", centavos: 100 },
    { empresaId: "conexion", nombre: "Conexión Logística", centavos: 50 },
    { empresaId: "hwc", nombre: "Handyway Cargo", centavos: 0 },
  ]);
  // sin RADIO ni SIN ASIGNAR en los datos, el resultado es idéntico
  const sinAjenos = new Map(porUnidad);
  sinAjenos.delete("RADIO");
  sinAjenos.delete("SIN ASIGNAR");
  assert.deepEqual(desglosePorEmpresa(sinAjenos, a), desglosePorEmpresa(porUnidad, a));
});

test("el resultado de un alcance de una empresa no trae NINGUNA otra empresa, ni siquiera con valor 0", async () => {
  for (const id of IDS_ACTIVAS) {
    const a = await alcanceDe("VIEWER", [id]);
    const filas = desglosePorEmpresa(new Map([["BRILLANTE", 1], ["RADIO", 2], ["AVIANOR", 3]]), a);
    assert.deepEqual(filas.map((f) => f.empresaId), [id]);
  }
});
