import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cruzaDeMes,
  datosAl,
  domingoDeSemana,
  estadoDeParte,
  estadoDeSemana,
  esFechaIso,
  formatoDdMm,
  lunesDeSemana,
  partesPorMes,
  semanaAnterior,
  semanaSiguiente,
  ultimaFechaDeDatos,
  ultimasSemanas,
  type FilaDeLote,
} from "@/lib/dashboard/semana";

// Reglas puras de semana (lunes a domingo según la fecha del movimiento). Fechas de referencia reales: el martes 17/11/2026
// (lo dice reporteExcel.test.ts) fija el calendario; la semana del 26/10 cruza de octubre a noviembre y hoy tiene un lote
// abierto con 60 movimientos (testing, 2026-11).

test("lunesDeSemana: cualquier día de la semana devuelve su lunes; el domingo pertenece a la semana que termina", () => {
  assert.equal(lunesDeSemana("2026-11-16"), "2026-11-16"); // lunes
  assert.equal(lunesDeSemana("2026-11-17"), "2026-11-16"); // martes
  assert.equal(lunesDeSemana("2026-11-18"), "2026-11-16");
  assert.equal(lunesDeSemana("2026-11-21"), "2026-11-16"); // sábado
  assert.equal(lunesDeSemana("2026-11-22"), "2026-11-16"); // domingo: NO es de la semana siguiente
  assert.equal(lunesDeSemana("2026-11-23"), "2026-11-23");
});

test("domingoDeSemana, semanaAnterior y semanaSiguiente", () => {
  assert.equal(domingoDeSemana("2026-11-18"), "2026-11-22");
  assert.equal(semanaAnterior("2026-11-18"), "2026-11-09");
  assert.equal(semanaAnterior("2026-11-16"), "2026-11-09");
  assert.equal(semanaSiguiente("2026-11-22"), "2026-11-23");
  assert.equal(semanaAnterior("2026-01-01"), "2025-12-22"); // cruza de año
});

test("ultimasSemanas: los lunes de las últimas N semanas, la más vieja primero", () => {
  assert.deepEqual(ultimasSemanas("2026-11-18", 3), ["2026-11-02", "2026-11-09", "2026-11-16"]);
  assert.deepEqual(ultimasSemanas("2026-11-18", 1), ["2026-11-16"]);
  assert.throws(() => ultimasSemanas("2026-11-18", 0));
  assert.throws(() => ultimasSemanas("2026-11-18", 1.5));
});

test("fechas inválidas o inexistentes se rechazan", () => {
  for (const f of ["", "abc", "2026-1-1", "2026-02-30", "2026-13-01", "2026-11-31", "17/11/2026", "2026-11-17T00:00:00Z"]) {
    assert.throws(() => lunesDeSemana(f), f);
    assert.equal(esFechaIso(f), false, f);
  }
  assert.equal(esFechaIso("2028-02-29"), true); // bisiesto
  assert.equal(esFechaIso("2026-02-29"), false);
});

test("para todos los días de 2026 a 2028: el lunes es lunes, el domingo está a 6 días y el día cae dentro de la semana", () => {
  const fin = Date.UTC(2028, 11, 31);
  for (let t = Date.UTC(2026, 0, 1); t <= fin; t += 86_400_000) {
    const dia = new Date(t).toISOString().slice(0, 10);
    const lunes = lunesDeSemana(dia);
    const domingo = domingoDeSemana(dia);
    assert.equal(new Date(`${lunes}T00:00:00Z`).getUTCDay(), 1, `${dia}: ${lunes} no es lunes`);
    assert.equal(new Date(`${domingo}T00:00:00Z`).getUTCDay(), 0, `${dia}: ${domingo} no es domingo`);
    assert.ok(lunes <= dia && dia <= domingo, dia);
    assert.equal(lunesDeSemana(lunes), lunes, `idempotente ${dia}`);
  }
});

// ---- Cruce de mes ----------------------------------------------------------------------------------------------

test("una semana dentro de un mes no se parte", () => {
  assert.deepEqual(partesPorMes("2026-11-18"), [{ periodo: "2026-11", desde: "2026-11-16", hasta: "2026-11-22", dias: 7 }]);
  assert.equal(cruzaDeMes("2026-11-18"), false);
});

test("la semana del 26/10 al 1/11 se parte en octubre (6 días) y noviembre (1 día)", () => {
  const esperado = [
    { periodo: "2026-10", desde: "2026-10-26", hasta: "2026-10-31", dias: 6 },
    { periodo: "2026-11", desde: "2026-11-01", hasta: "2026-11-01", dias: 1 },
  ];
  // da lo mismo con qué día de la semana se la pida
  for (const dia of ["2026-10-26", "2026-10-29", "2026-10-31", "2026-11-01"]) assert.deepEqual(partesPorMes(dia), esperado, dia);
  assert.equal(cruzaDeMes("2026-10-28"), true);
});

test("cruce de año y año bisiesto", () => {
  assert.deepEqual(partesPorMes("2026-12-30"), [
    { periodo: "2026-12", desde: "2026-12-28", hasta: "2026-12-31", dias: 4 },
    { periodo: "2027-01", desde: "2027-01-01", hasta: "2027-01-03", dias: 3 },
  ]);
  assert.deepEqual(partesPorMes("2024-02-28"), [
    { periodo: "2024-02", desde: "2024-02-26", hasta: "2024-02-29", dias: 4 },
    { periodo: "2024-03", desde: "2024-03-01", hasta: "2024-03-03", dias: 3 },
  ]);
});

test("las partes de cualquier semana de 2026 a 2028 suman 7 días, no se pisan y cada una es de un solo mes", () => {
  for (let lunes = Date.UTC(2026, 0, 5); lunes <= Date.UTC(2028, 11, 25); lunes += 7 * 86_400_000) {
    const dia = new Date(lunes).toISOString().slice(0, 10);
    const partes = partesPorMes(dia);
    assert.ok(partes.length === 1 || partes.length === 2, dia);
    assert.equal(partes.reduce((s, p) => s + p.dias, 0), 7, dia);
    assert.equal(partes[0].desde, dia);
    assert.equal(partes[partes.length - 1].hasta, domingoDeSemana(dia));
    for (const p of partes) {
      assert.equal(p.desde.slice(0, 7), p.periodo);
      assert.equal(p.hasta.slice(0, 7), p.periodo);
    }
    if (partes.length === 2) assert.equal(semanaSiguiente(partes[0].hasta).length, 10);
  }
});

// ---- Semana completa o provisoria --------------------------------------------------------------------------------

const fila = (lunes: string, periodo: string, estado: "ABIERTA" | "CERRADA", movimientos: number, ultimaFecha: string): FilaDeLote => ({
  lunes,
  periodo,
  estado,
  movimientos,
  ultimaFecha,
});

// Lo que hay en testing alrededor del 26/10: la semana tiene 4.311 movimientos en lotes cerrados de octubre, 60 en un lote
// abierto de octubre y unos pocos del 1/11 en un lote cerrado de noviembre.
const FILAS = [
  fila("2026-10-19", "2026-10", "CERRADA", 4794, "2026-10-25"),
  fila("2026-10-26", "2026-10", "CERRADA", 4311, "2026-10-31"),
  fila("2026-10-26", "2026-10", "ABIERTA", 60, "2026-10-30"),
  fila("2026-10-26", "2026-11", "CERRADA", 120, "2026-11-01"),
  fila("2026-11-02", "2026-11", "CERRADA", 4322, "2026-11-08"),
  fila("2026-11-09", "2026-11", "CERRADA", 4093, "2026-11-13"),
];

test("semana completa: todos sus movimientos están en lotes cerrados", () => {
  assert.deepEqual(estadoDeSemana(FILAS, "2026-11-04"), { tipo: "completa", movimientosIncluidos: 4322, movimientosAfuera: 0 });
  assert.deepEqual(estadoDeSemana(FILAS, "2026-10-19"), { tipo: "completa", movimientosIncluidos: 4794, movimientosAfuera: 0 });
});

test("semana provisoria: algún movimiento está en un lote abierto; informa cuántos quedan afuera", () => {
  assert.deepEqual(estadoDeSemana(FILAS, "2026-10-26"), { tipo: "provisoria", movimientosIncluidos: 4431, movimientosAfuera: 60 });
  // cualquier día de esa semana da el mismo resultado
  assert.deepEqual(estadoDeSemana(FILAS, "2026-11-01"), estadoDeSemana(FILAS, "2026-10-26"));
});

test("semana sin movimientos: sinDatos (ni completa ni provisoria)", () => {
  assert.deepEqual(estadoDeSemana(FILAS, "2026-11-16"), { tipo: "sinDatos", movimientosIncluidos: 0, movimientosAfuera: 0 });
  assert.deepEqual(estadoDeSemana([], "2026-11-16"), { tipo: "sinDatos", movimientosIncluidos: 0, movimientosAfuera: 0 });
});

test("una semana con SOLO lotes abiertos es provisoria con 0 incluidos", () => {
  assert.deepEqual(estadoDeSemana([fila("2026-11-16", "2026-11", "ABIERTA", 10, "2026-11-17")], "2026-11-16"), {
    tipo: "provisoria",
    movimientosIncluidos: 0,
    movimientosAfuera: 10,
  });
});

test("las filas de otras semanas no cuentan", () => {
  const otras = [fila("2026-11-09", "2026-11", "ABIERTA", 999, "2026-11-13"), fila("2026-11-23", "2026-11", "ABIERTA", 999, "2026-11-24")];
  assert.equal(estadoDeSemana(otras, "2026-11-16").tipo, "sinDatos");
});

test("semana que cruza de mes: el estado de cada parte es propio (octubre provisoria, noviembre completa) y el de la semana, el de las dos juntas", () => {
  assert.deepEqual(estadoDeParte(FILAS, "2026-10-28", "2026-10"), { tipo: "provisoria", movimientosIncluidos: 4311, movimientosAfuera: 60 });
  assert.deepEqual(estadoDeParte(FILAS, "2026-10-28", "2026-11"), { tipo: "completa", movimientosIncluidos: 120, movimientosAfuera: 0 });
  assert.equal(estadoDeParte(FILAS, "2026-10-28", "2026-12").tipo, "sinDatos");
  const entera = estadoDeSemana(FILAS, "2026-10-28");
  const oct = estadoDeParte(FILAS, "2026-10-28", "2026-10");
  const nov = estadoDeParte(FILAS, "2026-10-28", "2026-11");
  assert.equal(entera.movimientosIncluidos, oct.movimientosIncluidos + nov.movimientosIncluidos);
  assert.equal(entera.movimientosAfuera, oct.movimientosAfuera + nov.movimientosAfuera);
});

test("datos inválidos se rechazan: período mal escrito, movimientos negativos", () => {
  assert.throws(() => estadoDeParte(FILAS, "2026-10-28", "octubre"), /Período inválido/);
  assert.throws(() => estadoDeSemana([fila("2026-11-16", "2026-11", "CERRADA", -1, "2026-11-16")], "2026-11-16"), /inválida/);
});

// ---- «Datos al dd/mm» ------------------------------------------------------------------------------------------

test("datosAl: la última fecha con movimientos del alcance; por defecto solo lotes cerrados (los del Reporte)", () => {
  const filas = [...FILAS, fila("2026-11-09", "2026-11", "ABIERTA", 5, "2026-11-15")];
  assert.equal(ultimaFechaDeDatos(filas), "2026-11-13");
  assert.equal(datosAl(filas), "13/11");
  assert.equal(ultimaFechaDeDatos(filas, { soloCerradas: false }), "2026-11-15");
  assert.equal(datosAl(filas, { soloCerradas: false }), "15/11");
});

test("datosAl: sin datos devuelve null; las filas con 0 movimientos no cuentan; solo abiertos y soloCerradas da null", () => {
  assert.equal(datosAl([]), null);
  assert.equal(datosAl([fila("2026-11-09", "2026-11", "CERRADA", 0, "2026-11-13")]), null);
  assert.equal(datosAl([fila("2026-11-09", "2026-11", "ABIERTA", 3, "2026-11-13")]), null);
  assert.equal(datosAl([fila("2026-11-09", "2026-11", "ABIERTA", 3, "2026-11-13")], { soloCerradas: false }), "13/11");
});

test("formatoDdMm", () => {
  assert.equal(formatoDdMm("2026-11-13"), "13/11");
  assert.equal(formatoDdMm("2026-01-05"), "05/01");
  assert.throws(() => formatoDdMm("13/11/2026"));
});
