import { test } from "node:test";
import assert from "node:assert/strict";
import { leerCuenta } from "@/lib/importes";
import { armarReporte, camposManuales, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { camposTipeables, motivoRechazoTipeo } from "@/lib/reporte/tipeoDirecto";

// Radio con carga directa en el Reporte: Expensas pasa a Real manual y las Disponibilidades que tipea Macchi
// suman con el motor real (armarReporte), sin datos de la fixture. Todo en centavos.

const RADIO = PLANTILLAS_POR_SLUG["radio"];

const celda = (r: ReturnType<typeof armarReporte>, clave: string) => r.filas.find((f) => f.fila.clave === clave)!.celdas[0];

// Lo que se tipea en cada celda se pasa por leerCuenta, igual que en el guardado (guardarValoresManuales).
function centavos(texto: string): number {
  const c = leerCuenta(texto);
  assert.ok(c.ok, texto);
  return c.centavos;
}

test("Radio: Expensas es Real manual (tipeable y en /carga); Expensas - No socios sigue sin Real", () => {
  const manuales = camposManuales(RADIO).map((c) => `${c.clave}|${c.columna}`);
  assert.ok(manuales.includes("ra.expensas|REAL"));
  assert.equal(manuales.includes("ra.expensasNoSocios|REAL"), false);
  assert.ok(manuales.includes("ra.expensasNoSocios|PRESUPUESTADO"));
  const tipeables = camposTipeables(RADIO, "radio").map((c) => c.clave);
  assert.deepEqual(tipeables.filter((c) => !c.startsWith("ra.d")), ["ra.resultadoFci", "ra.expensas", "ra.costoIva"]);
  assert.equal(tipeables.length, 10);
  const args = { empresaSlug: "radio", plantilla: RADIO, esAdminOFinanzas: true };
  assert.equal(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: "ra.expensas", columna: "REAL", texto: "1.000,00" }] }), null);
  assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: "ra.expensasNoSocios", columna: "REAL", texto: "1.000,00" }] }));
});

test("Radio: BANCO Y FCI 43.665.360,08+0,01 + EFECTIVO 7.811.100,06 + CHEQUES EN CARTERA 1.711.566,78 = TOTAL DISPONIBILIDADES 53.188.026,93", () => {
  const banco = centavos("43.665.360,08+0,01");
  assert.equal(banco, 4366536009); // la cuenta se resuelve a 43665360.09
  const efectivo = centavos("7.811.100,06");
  const cheques = centavos("1.711.566,78");
  assert.equal(efectivo, 781110006);
  assert.equal(cheques, 171156678);

  const mes: DatosMes = {
    periodo: "2026-10",
    real: new Map(),
    presupuesto: new Map(),
    semanasCerradas: 0,
    manuales: {
      presupuesto: new Map(),
      real: new Map([
        ["ra.dBancoFci", banco],
        ["ra.dEfectivo", efectivo],
        ["ra.dChequesEnCartera", cheques],
      ]),
    },
  };
  const total = celda(armarReporte(RADIO, [mes], 0), "ra.totalDisponibilidades");
  assert.equal(total.presupuestado, 5318802693, "TOTAL DISPONIBILIDADES (53188026.93) en Presupuestado");
  assert.equal(total.real, 5318802693, "TOTAL DISPONIBILIDADES (53188026.93) en Real");
});

test("Radio: el Real de Expensas suma en TOTAL EGRESOS OPERATIVOS", () => {
  const mes = (expensas: number | null): DatosMes => ({
    periodo: "2026-10",
    real: new Map(),
    presupuesto: new Map(),
    semanasCerradas: 1,
    manuales: {
      presupuesto: new Map(),
      real: new Map(expensas === null ? [] : [["ra.expensas", expensas]]),
    },
  });
  const sin = armarReporte(RADIO, [mes(null)], 0);
  const con = armarReporte(RADIO, [mes(123456789)], 0);
  assert.equal(celda(sin, "ra.expensas").real, null);
  assert.equal(celda(con, "ra.expensas").real, 123456789);
  assert.equal(celda(con, "ra.totalEgresosOperativos").real, (celda(sin, "ra.totalEgresosOperativos").real ?? 0) + 123456789);
});
