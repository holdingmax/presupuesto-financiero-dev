import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, camposManuales, validarPlantilla, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { motivoBloqueo } from "@/lib/reporte/bloqueo";

// Avianor: Cobranza clientes, Sueldos, Expensas y Proveedores suman, desde 2026-10, lo calculado MÁS el valor tipeado.
// Solo motor puro: no prueba la pantalla ni la base.

const AV = PLANTILLAS_POR_SLUG["avianor"];
const CX = PLANTILLAS_POR_SLUG["conexion-logistica"];
const FILAS = { "av.cobranzaClientes": "COBRANZAS", "av.sueldos": "SUELDOS", "av.expensas": "EXPENSAS", "av.proveedores": "PROV Y SERV" } as const;
const CALCULADO = 10_000_000; // 100.000,00 de Ejecución (ingreso en positivo, egreso con signo de banco)
const TIPEADO = 1_234_567;

function mes(periodo: string, manuales: [string, number][] = [], over: Partial<DatosMes> = {}): DatosMes {
  const real = new Map<string, number>([["COBRANZAS", CALCULADO]]);
  for (const c of ["SUELDOS", "EXPENSAS", "PROV Y SERV"]) real.set(c, -CALCULADO);
  return {
    periodo,
    real,
    presupuesto: new Map(),
    semanasCerradas: 4,
    manuales: { presupuesto: new Map(), real: new Map(manuales) },
    ...over,
  };
}

const celda = (plantilla = AV, datos: DatosMes, clave: string) =>
  armarReporte(plantilla, [datos], 0).filas.find((f) => f.fila.clave === clave)!.celdas[0];
const totalPorRol = (datos: DatosMes, rol: string, plantilla = AV) =>
  armarReporte(plantilla, [datos], 0).filas.find((f) => f.fila.tipo === "total" && f.fila.rol === rol)!.celdas[0].real;

test("la plantilla de Avianor sigue siendo válida y ofrece las cuatro filas como Real tipeable", () => {
  assert.deepEqual(validarPlantilla(AV), []);
  const reales = camposManuales(AV).filter((c) => c.columna === "REAL").map((c) => c.clave);
  for (const k of Object.keys(FILAS)) assert.ok(reales.includes(k), k);
});

for (const clave of Object.keys(FILAS)) {
  test(`${clave}: desde 2026-10 el Real es calculado + tipeado; antes o sin tipear, igual que antes`, () => {
    assert.equal(celda(AV, mes("2026-10", [[clave, TIPEADO]]), clave).real, CALCULADO + TIPEADO);
    assert.equal(celda(AV, mes("2026-10"), clave).real, CALCULADO);
    assert.equal(celda(AV, mes("2026-09", [[clave, TIPEADO]]), clave).real, CALCULADO);
  });
  test(`${clave}: sin semanas cerradas muestra solo el tipeado; sin él, «—»`, () => {
    assert.equal(celda(AV, mes("2026-10", [[clave, TIPEADO]], { semanasCerradas: 0 }), clave).real, TIPEADO);
    assert.equal(celda(AV, mes("2026-10", [], { semanasCerradas: 0 }), clave).real, null);
  });
}

test("Total ingresos, Total egresos y Saldo reflejan lo tipeado en las cuatro filas", () => {
  const todos = Object.keys(FILAS).map((k) => [k, TIPEADO] as [string, number]);
  // Con efectivo inicial tipeado para que el Saldo tenga valor.
  const base: [string, number][] = [["av.dEfectivo", 5_000_000]];
  const sin = mes("2026-10", base);
  const con = mes("2026-10", [...base, ...todos]);
  // Ingresos: solo Cobranza clientes. Egresos: Sueldos + Expensas + Proveedores.
  assert.equal(totalPorRol(con, "totalIngresos")! - totalPorRol(sin, "totalIngresos")!, TIPEADO);
  assert.equal(totalPorRol(con, "totalEgresos")! - totalPorRol(sin, "totalEgresos")!, 3 * TIPEADO);
  assert.equal(totalPorRol(con, "totalEgresosOperativos")! - totalPorRol(sin, "totalEgresosOperativos")!, 3 * TIPEADO);
  const saldoSin = totalPorRol(sin, "saldo");
  const saldoCon = totalPorRol(con, "saldo");
  assert.notEqual(saldoSin, null);
  assert.equal(saldoCon! - saldoSin!, TIPEADO - 3 * TIPEADO);
});

test("cada cuenta del total cierra: ingreso tipeado en Cobranza = +TIPEADO; egreso tipeado = −TIPEADO en Saldo", () => {
  const base: [string, number][] = [["av.dEfectivo", 5_000_000]];
  const saldo = (extra: [string, number][]) => totalPorRol(mes("2026-10", [...base, ...extra]), "saldo")!;
  const s0 = saldo([]);
  assert.equal(saldo([["av.cobranzaClientes", TIPEADO]]) - s0, TIPEADO);
  for (const k of ["av.sueldos", "av.expensas", "av.proveedores"]) assert.equal(saldo([[k, TIPEADO]]) - s0, -TIPEADO, k);
});

test("Conexión no cambia con valores tipeados de Avianor: su Real, incluido «Gastos Avion a recuperar», sale solo de su Ejecución", () => {
  const sinAv = mes("2026-10", [], { real: new Map([["AVION", -3_000_000], ["PROV Y SERV", -CALCULADO]]) });
  const conAv = mes("2026-10", Object.keys(FILAS).map((k) => [k, TIPEADO] as [string, number]), {
    real: new Map([["AVION", -3_000_000], ["PROV Y SERV", -CALCULADO]]),
  });
  const a = armarReporte(CX, [sinAv], 0);
  const b = armarReporte(CX, [conAv], 0);
  assert.deepEqual(b.filas.map((f) => f.celdas[0]?.real ?? null), a.filas.map((f) => f.celdas[0]?.real ?? null));
  assert.equal(celda(CX, conAv, "cx.gastosAvion").real, 3_000_000);
  // La plantilla de Conexión no referencia claves de Avianor.
  assert.equal(JSON.stringify(CX).includes('"av.'), false);
});

test("bloqueo: mes pasado con semana abierta se puede cargar y corregir; sin semanas abiertas solo la primera carga", () => {
  const e = { periodo: "2026-10", actual: "2026-11", columna: "REAL" as const, bloque: "INGRESOS" as const, presupuestoValidado: false };
  assert.equal(motivoBloqueo({ ...e, semanas: { abiertas: 1, cerradas: 4 } }), null);
  assert.ok(motivoBloqueo({ ...e, semanas: { abiertas: 0, cerradas: 5 } }));
});
