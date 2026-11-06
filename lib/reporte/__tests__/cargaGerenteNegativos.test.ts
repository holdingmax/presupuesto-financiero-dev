import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import {
  DETALLE_CARGA_DESDE_REPORTE,
  planDeCarga,
  validarImporteCarga,
  vistaDeCarga,
  type LineaParaCarga,
  type ValorManualParaCarga,
} from "@/lib/reporte/cargaGerente";

// Decisión de Kike (2026-11): el gerente carga negativos en todas las filas que hoy carga. Sin base de datos:
// validarImporteCarga es lo que decide (aplicarCarga lo llama con esAdminOFinanzas=false para el gerente), y lo que
// sigue —plan, pantalla y motor— solo ve el importe con signo.

const HAVANNA = PLANTILLAS_POR_SLUG["havanna"]!;
const INGRESO_MANUAL = "hv.cobranzasLocales"; // Ingresos, Presupuestado manual
const EGRESO_CATEGORIA = "hv.chequesDiferidos"; // Egresos, categoría CHEQUES DIFERIDOS

const linea = (clasificacion: string, importeCentavos: number): LineaParaCarga => ({
  id: `l-${clasificacion}`,
  clasificacion,
  detalle: DETALLE_CARGA_DESDE_REPORTE,
  importeCentavos,
  tieneDesglose: false,
});
const manual = (filaClave: string, centavos: number): ValorManualParaCarga => ({
  filaClave,
  centavos,
  nota: null,
  cargadoPor: "Gerente Havanna",
  actualizadoEn: new Date("2026-11-05T15:00:00Z"),
});

test("gerente: un negativo en una fila de Ingresos (manual) se acepta y queda con su signo", () => {
  const importe = validarImporteCarga("-1.500.000", false);
  assert.deepEqual(importe, { ok: true, centavos: -150_000_000, nota: null });
  const plan = planDeCarga(HAVANNA, [], [manual(INGRESO_MANUAL, -150_000_000)]);
  assert.equal(plan.manuales[INGRESO_MANUAL].valorCentavos, -150_000_000);
  const celda = vistaDeCarga(plan).celdas.find((c) => c.id === `manual|${INGRESO_MANUAL}`)!;
  assert.equal(celda.centavos, -150_000_000);
  assert.match(celda.importeInicial, /^[-−]/);
});

test("gerente: un negativo en una fila de Egresos (categoría) se acepta y queda con su signo", () => {
  const importe = validarImporteCarga("-250.000,50", false);
  assert.deepEqual(importe, { ok: true, centavos: -25_000_050, nota: null });
  const plan = planDeCarga(HAVANNA, [linea("CHEQUES DIFERIDOS", -25_000_050)]);
  const celda = plan.filas[EGRESO_CATEGORIA];
  assert.equal(celda.modo, "editable");
  assert.equal(celda.modo === "editable" ? celda.valorCentavos : null, -25_000_050);
  const vista = vistaDeCarga(plan).celdas.find((c) => c.id === `fila|${EGRESO_CATEGORIA}`)!;
  assert.equal(vista.centavos, -25_000_050);
});

test("gerente y ADMIN/FINANZAS dan el mismo resultado con cualquier importe", () => {
  for (const t of ["-500", "500", "10-50", "321.235,44+17.755,22", "", "0"]) {
    assert.deepEqual(validarImporteCarga(t, false), validarImporteCarga(t, true), t);
  }
});

// Impacto en el motor: un negativo en una fila de Egresos RESTA del total de egresos (baja el total), igual que
// cualquier otro importe; un egreso positivo lo sube. Egreso normal: 2.000.000; con el negativo: -300.000.
test("motor: un negativo en Egresos entra con su signo en TOTAL EGRESOS OPERATIVOS, TOTAL EGRESOS y el Saldo", () => {
  const mes = (cheques: number, cobranzas: number): DatosMes => ({
    periodo: "2026-11",
    real: new Map(),
    presupuesto: new Map([["CHEQUES DIFERIDOS", cheques]]),
    semanasCerradas: 0,
    manuales: {
      presupuesto: new Map([[INGRESO_MANUAL, cobranzas]]),
      real: new Map([["hv.dBancoFci", 0]]),
    },
  });
  const valor = (cheques: number, cobranzas: number, clave: string) =>
    armarReporte(HAVANNA, [mes(cheques, cobranzas)]).filas.find((f) => f.fila.clave === clave)!.celdas[0].presupuestado;

  const positivo = valor(200_000_000, 1_000_000_000, "hv.totalEgresosOperativos");
  const conNegativo = valor(-30_000_000, 1_000_000_000, "hv.totalEgresosOperativos");
  assert.equal(positivo! - conNegativo!, 230_000_000); // la diferencia es exactamente 2.000.000 − (−300.000)
  assert.equal(valor(-30_000_000, 1_000_000_000, "hv.totalEgresos")! - valor(200_000_000, 1_000_000_000, "hv.totalEgresos")!, -230_000_000);
  // Ingresos: un negativo resta del TOTAL INGRESOS.
  assert.equal(valor(0, -100_000_000, "hv.totalIngresos")! - valor(0, 0, "hv.totalIngresos")!, -100_000_000);
  // El saldo sube lo que bajaron los egresos.
  const saldoPos = valor(200_000_000, 1_000_000_000, "hv.saldo");
  const saldoNeg = valor(-30_000_000, 1_000_000_000, "hv.saldo");
  if (saldoPos !== null && saldoNeg !== null) assert.equal(saldoNeg - saldoPos, 230_000_000);
});
