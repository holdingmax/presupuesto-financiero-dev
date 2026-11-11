import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { formatearConMoneda, simboloMoneda } from "@/lib/moneda";
import { ErrorExtracto } from "@/lib/extractos/tipos";
import { claveBrou, hojaDeBytesBrou, leerBrou, metadataBrou, resumenControlBrou } from "@/lib/extractos/brou";
import { CUENTA_USD, CUENTA_UYU, MOVS_USD, grillaBrou, hojaBrou, serialOct, xlsBrou, type OpcionesHojaBrou } from "./fixtures/brou";

const HOY = new Date(Date.UTC(2026, 10, 11));
const CUENTAS = { UYU: CUENTA_UYU, USD: CUENTA_USD } as const;
const lee = (o: OpcionesHojaBrou) => leerBrou(grillaBrou(o), { cuentaPorMoneda: CUENTAS, hoy: HOY });
const leeGrilla = (filas: ReturnType<typeof hojaBrou>) => leerBrou({ nombre: "x", filas, date1904: false }, { cuentaPorMoneda: CUENTAS, hoy: HOY });
const rechaza = (f: () => unknown, patron: RegExp) => assert.throws(f, (e: unknown) => e instanceof ErrorExtracto && patron.test(e.message));

test("BROU: cuenta y moneda salen del encabezado (U$S → USD) y el importe es crédito menos débito, con signo", () => {
  const l = lee({ movs: MOVS_USD });
  assert.equal(l.cuentaEnArchivo, CUENTA_USD);
  assert.equal(l.filas.length, 8);
  assert.ok(l.filas.every((f) => f.moneda === "USD" && f.saldoCentavos === null));
  assert.deepEqual(l.errores, []);
  assert.equal(l.filas.find((f) => f.concepto.includes("VTA USD A UYU"))!.importeCentavos, -1341772);
  const cred = l.filas.find((f) => f.referencia === "00123456")!;
  assert.equal(cred.importeCentavos, 250000);
  assert.equal(cred.referencia, "00123456", "conserva los ceros a la izquierda");
});

test("BROU: «$» es pesos uruguayos (UYU)", () => {
  const l = lee({ cuenta: CUENTA_UYU, monedaTexto: "$", movs: [{ serial: serialOct(30), descripcion: "COMISIÓN POR ADMINISTRACIÓN", doc: "", asunto: "", debito: 200.48 }] });
  assert.equal(l.filas[0].moneda, "UYU");
  assert.equal(l.filas[0].importeCentavos, -20048);
  assert.equal(l.filas[0].referencia, null);
});

test("BROU: la moneda UYU se muestra con «$U» y las demás monedas siguen igual", () => {
  assert.equal(simboloMoneda("UYU"), "$U");
  assert.equal(formatearConMoneda(1234.5, "UYU"), "$U 1.234,50");
  assert.equal(formatearConMoneda(1234.5, "USD"), "US$ 1.234,50");
  assert.equal(formatearConMoneda(1234.5, "PEN"), "S/ 1.234,50");
  assert.equal(formatearConMoneda(1234.5, "ARS"), "$1.234,50");
});

test("BROU: el concepto es «Descripción — Asunto» y sin asunto queda solo la descripción", () => {
  const l = lee({ movs: MOVS_USD });
  assert.ok(l.filas.some((f) => f.concepto === "TRF. E-BROU OTROS — PLATESILVER S.A. - VTA USD A UYU"));
  assert.ok(l.filas.some((f) => f.concepto === "DEPÓSITO CON CHEQUE"));
});

test("BROU: sale en orden cronológico (el archivo viene del más nuevo al más viejo) y la leyenda final se ignora", () => {
  const l = lee({ movs: MOVS_USD });
  const fechas = l.filas.map((f) => f.fecha.getTime());
  assert.deepEqual(fechas, [...fechas].sort((a, b) => a - b));
  assert.equal(l.filas.length, MOVS_USD.length);
});

test("BROU: control sin saldo = cantidad, débitos, créditos, neto y rango de fechas", () => {
  const [c] = lee({ movs: MOVS_USD }).control;
  assert.equal(c.estado, "sin_pie");
  assert.equal(c.cantidad, 8);
  assert.equal(c.debitoCentavos, 1341772 + 171 * 4 + 170);
  assert.equal(c.creditoCentavos, 250000 + 10050);
  assert.equal(c.movimientosCentavos, c.creditoCentavos! - c.debitoCentavos!);
  assert.equal(c.desde, "2026-10-01");
  assert.equal(c.hasta, "2026-10-27");
  assert.match(resumenControlBrou(c), /^8 movimientos · débitos 13\.426,26 · créditos 2\.600,50 · neto -10\.825,76$/);
});

test("BROU: las repetidas sin Nº de documento quedan distintas por el asunto; si repiten TODO, la clave es igual y no se pierde ninguna", () => {
  const l = lee({ movs: MOVS_USD });
  const claves = l.filas.map((f) => claveBrou(f, "BROU USD"));
  assert.equal(new Set(claves).size, claves.length, "las 8 son distintas");
  const igual = lee({ movs: [MOVS_USD[2], { ...MOVS_USD[2] }] });
  const [a, b] = igual.filas.map((f) => claveBrou(f, "BROU USD"));
  assert.equal(a, b);
  assert.equal(igual.filas.length, 2);
});

test("BROU: rechaza una cuenta que no está dada de alta", () => {
  rechaza(() => lee({ cuenta: "999999999-00009", movs: MOVS_USD }), /999999999-00009.*no es una de las cuentas dadas de alta/);
});

test("BROU: rechaza si la moneda del encabezado no es la de la cuenta", () => {
  rechaza(() => lee({ cuenta: CUENTA_UYU, monedaTexto: "U$S", movs: MOVS_USD }), /es en UYU pero el encabezado.*USD/);
  rechaza(() => lee({ cuenta: CUENTA_USD, monedaTexto: "$", movs: MOVS_USD }), /es en USD pero el encabezado.*UYU/);
});

test("BROU: rechaza moneda desconocida, y sin Nº de cuenta o sin moneda en el encabezado", () => {
  rechaza(() => lee({ monedaTexto: "EUR", movs: MOVS_USD }), /No reconozco la moneda/);
  const sinCuenta = hojaBrou({ movs: MOVS_USD }).map((f) => f.map((c) => (typeof c === "string" && (c.startsWith("Nº de Cuenta") || c === CUENTA_USD) ? null : c)));
  rechaza(() => leeGrilla(sinCuenta), /Nº de Cuenta/);
  const sinMoneda = hojaBrou({ movs: MOVS_USD }).map((f) => f.map((c) => (typeof c === "string" && c.startsWith("Moneda") ? null : c)));
  rechaza(() => leeGrilla(sinMoneda), /Moneda/);
});

test("BROU: «N° de Cuenta anterior» no se confunde con el número de cuenta", () => {
  const m = metadataBrou(hojaBrou({ movs: MOVS_USD }));
  assert.equal(m.numeroCuenta, CUENTA_USD);
  assert.equal(m.monedaTexto, "U$S");
});

test("BROU: débito y crédito a la vez, ninguno, o un valor ilegible frenan la carga", () => {
  rechaza(() => lee({ movs: [{ serial: serialOct(2), descripcion: "X", doc: "1", asunto: "", debito: 5, credito: 5 }] }), /débito y crédito a la vez/);
  rechaza(() => lee({ movs: [{ serial: serialOct(2), descripcion: "X", doc: "1", asunto: "" }] }), /no tiene débito ni crédito/);
  const g = hojaBrou({ movs: [{ serial: serialOct(2), descripcion: "X", doc: "1", asunto: "", debito: 5 }], leyenda: false });
  g[g.length - 1][6] = "abc";
  rechaza(() => leeGrilla(g), /no pude leer el débito/);
});

test("BROU: sin movimientos o sin la tabla, error claro", () => {
  rechaza(() => lee({ movs: [] }), /no tiene movimientos/);
  rechaza(() => leerBrou({ nombre: "x", filas: [["otra cosa"]], date1904: false }, { cuentaPorMoneda: CUENTAS }), /No encontré la tabla/);
});

test("BROU: lee un .xls binario (BIFF8) de punta a punta, y rechaza lo que no es .xls", () => {
  const bytes = xlsBrou({ movs: MOVS_USD });
  assert.equal(bytes[0], 0xd0, "es OLE2 de verdad");
  const l = leerBrou(hojaDeBytesBrou(bytes), { cuentaPorMoneda: CUENTAS, hoy: HOY });
  assert.equal(l.filas.length, 8);
  assert.equal(l.control[0].debitoCentavos, 1341772 + 171 * 4 + 170);
  rechaza(() => hojaDeBytesBrou(new TextEncoder().encode("Fecha,Descripción\n1,2")), /tiene que ser el \.xls/);
  rechaza(() => hojaDeBytesBrou(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])), /tiene que ser el \.xls/);
});

// ---- Archivos REALES del BROU de Plate Silver (octubre 2026). Se leen en SOLO LECTURA desde BROU_REALES_DIR y no se
// copian al repo. Los totales esperados salen de una lectura independiente (SheetJS en un script aparte), no de este lector.
const DIR = process.env.BROU_REALES_DIR;
const omitir = DIR && existsSync(DIR) ? false : "BROU_REALES_DIR no está definida";

function real(sufijo: string): Uint8Array {
  const nombre = readdirSync(DIR!).find((n) => n.startsWith("Detalle_Movimiento_Cuenta") && n.includes(sufijo) && n.endsWith(".xls"));
  assert.ok(nombre, `no encuentro el archivo con ${sufijo} en ${DIR}`);
  return new Uint8Array(readFileSync(join(DIR!, nombre)));
}

test("BROU real UYU (110509829-00001): 19 movimientos, débitos 989.012,77, créditos 990.000,00, neto +987,23, del 6 al 30/10", { skip: omitir }, () => {
  const l = leerBrou(hojaDeBytesBrou(real("112132")), { cuentaPorMoneda: CUENTAS, hoy: HOY });
  const c = l.control[0];
  assert.equal(l.cuentaEnArchivo, CUENTA_UYU);
  assert.equal(c.moneda, "UYU");
  assert.equal(c.cantidad, 19);
  assert.equal(c.debitoCentavos, 98901277);
  assert.equal(c.creditoCentavos, 99000000);
  assert.equal(c.movimientosCentavos, 98723);
  assert.equal(c.desde, "2026-10-06");
  assert.equal(c.hasta, "2026-10-30");
  assert.equal(l.filas.filter((f) => f.referencia === null).length, 1);
  assert.equal(new Set(l.filas.map((f) => claveBrou(f, "BROU UYU"))).size, 19);
});

test("BROU real USD (110509829-00002): 208 movimientos, débitos 105.817,86, créditos 108.423,56, neto +2.605,70, del 1 al 30/10", { skip: omitir }, () => {
  const l = leerBrou(hojaDeBytesBrou(real("112144")), { cuentaPorMoneda: CUENTAS, hoy: HOY });
  const c = l.control[0];
  assert.equal(l.cuentaEnArchivo, CUENTA_USD);
  assert.equal(c.moneda, "USD");
  assert.equal(c.cantidad, 208);
  assert.equal(c.debitoCentavos, 10581786);
  assert.equal(c.creditoCentavos, 10842356);
  assert.equal(c.movimientosCentavos, 260570);
  assert.equal(c.desde, "2026-10-01");
  assert.equal(c.hasta, "2026-10-30");
  assert.equal(l.filas.filter((f) => f.referencia === null).length, 7, "7 filas sin Nº de documento");
  // Con el asunto en el concepto ninguna de las 208 repite clave: no se pierde ningún movimiento real.
  assert.equal(new Set(l.filas.map((f) => claveBrou(f, "BROU USD"))).size, 208);
  assert.ok(l.filas.every((f) => f.fecha.getUTCFullYear() === 2026 && f.fecha.getUTCMonth() === 9), "todas en octubre 2026 (sin el 1905)");
});

test("BROU real: las 4 «VTA USD A UYU» están en las dos cuentas con el mismo Nº de documento", { skip: omitir }, () => {
  const uyu = leerBrou(hojaDeBytesBrou(real("112132")), { cuentaPorMoneda: CUENTAS, hoy: HOY });
  const usd = leerBrou(hojaDeBytesBrou(real("112144")), { cuentaPorMoneda: CUENTAS, hoy: HOY });
  const docs = (l: typeof uyu) => l.filas.filter((f) => f.concepto.includes("VTA USD A UYU")).map((f) => f.referencia).sort();
  assert.equal(docs(uyu).length, 4);
  assert.deepEqual(docs(uyu), docs(usd));
});
