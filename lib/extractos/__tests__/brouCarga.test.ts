import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EMPRESAS_CON_EXTRACTO_POR_EMPRESA } from "@/lib/config";
import { decimalTextoDeCentavos } from "@/lib/conteoMovimientos";
import { validarCuenta } from "@/lib/cuentasBancarias";
import { BANCO_BROU, CUENTAS_BROU, NUMEROS_CUENTA_BROU, monedaDeCuentaFija } from "@/lib/extractos/bancosCuenta";
import { hojaDeBytesBrou, leerBrou } from "@/lib/extractos/brou";
import {
  CLASIFICACION_SIN_CLASIFICAR,
  aceptaDeEmpresa,
  archivoDeUnaCuenta,
  armarFilasACargar,
  configDeEmpresa,
  datosParaCrear,
  errorDeLectura,
  errorFechasFueraDelPeriodo,
  monedasDeConfig,
  planificarCarga,
  resolverCuentasForzadas,
  textoSubidaExtractoEmpresa,
  type CuentaDeLaBase,
  type FilaACargar,
  type FilaExistente,
} from "@/lib/extractos/cargaEmpresa";
import { MAX_BYTES_HAVANNA_PERU, MAX_FILAS_HAVANNA_PERU } from "@/lib/extractos/limites";
import { puedeConfirmarVistaPrevia, puedeVerSubidaExtractoEmpresa } from "@/lib/extractos/pantallaExtractoEmpresa";
import { MOVS_USD, grillaBrou, serialOct } from "./fixtures/brou";

const HOY = new Date(Date.UTC(2026, 10, 11));
const EMPRESA = "emp-plate";
const CONFIG = configDeEmpresa("plate-silver")!;
const CUENTA_UYU_DB: CuentaDeLaBase = { id: "c1", nombre: "BROU UYU", banco: BANCO_BROU, activa: true, empresaId: EMPRESA, moneda: "UYU" };
const CUENTA_USD_DB: CuentaDeLaBase = { id: "c2", nombre: "BROU USD", banco: BANCO_BROU, activa: true, empresaId: EMPRESA, moneda: "USD" };

const comoExistentes = (filas: FilaACargar[]): FilaExistente[] =>
  filas.map((f) => ({
    fecha: f.fecha,
    importe: decimalTextoDeCentavos(f.importeCentavos),
    bancoYCuenta: f.bancoYCuenta,
    concepto: f.concepto,
    nroReferencia: f.nroReferencia,
    saldo: null,
    moneda: f.moneda,
  }));

function filasUsd(movs = MOVS_USD): FilaACargar[] {
  const lectura = leerBrou(grillaBrou({ movs }), { cuentaPorMoneda: CONFIG.numeroCuentaPorMoneda!, hoy: HOY });
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTA_UYU_DB, CUENTA_USD_DB], ["USD"]);
  assert.ok(r.ok);
  return armarFilasACargar(lectura, CONFIG, r.cuentas);
}

// ------------------------------------------------------------------ config y cuentas

test("config: Plate Silver = BROU, unidad PLATE SILVER, dos cuentas (UYU y USD) con su número de cuenta, un archivo por cuenta", () => {
  assert.ok(EMPRESAS_CON_EXTRACTO_POR_EMPRESA.includes("plate-silver"));
  assert.equal(CONFIG.lector, "brou");
  assert.equal(CONFIG.unidad, "PLATE SILVER");
  assert.equal(CONFIG.banco, BANCO_BROU);
  assert.deepEqual(CONFIG.cuentaPorMoneda, { UYU: "BROU UYU", USD: "BROU USD" });
  assert.deepEqual(CONFIG.numeroCuentaPorMoneda, { UYU: "110509829-00001", USD: "110509829-00002" });
  assert.deepEqual(monedasDeConfig(CONFIG), ["UYU", "USD"]);
  assert.equal(archivoDeUnaCuenta(CONFIG), true);
  // Perú y Bradenton no cambian: archivo con todas sus cuentas, sin número de cuenta.
  assert.equal(archivoDeUnaCuenta(configDeEmpresa("havanna-peru")!), false);
  assert.equal(archivoDeUnaCuenta(configDeEmpresa("bradenton")!), false);
  assert.equal(configDeEmpresa("havanna-peru")!.lector, "havanna-peru");
  assert.equal(configDeEmpresa("bradenton")!.lector, "chase");
});

test("cuentas: BROU UYU y BROU USD se validan con su moneda; otro nombre o repetida no", () => {
  const uyu = validarCuenta({ nombre: "brou uyu", banco: BANCO_BROU, terminacion: "" }, []);
  assert.deepEqual(uyu, { ok: true, cuenta: { nombre: CUENTAS_BROU.UYU, banco: BANCO_BROU, terminacion: "", moneda: "UYU" } });
  const usd = validarCuenta({ nombre: "BROU USD", banco: BANCO_BROU, terminacion: "" }, []);
  assert.ok(usd.ok && usd.cuenta.moneda === "USD");
  assert.ok(!validarCuenta({ nombre: "BROU EUR", banco: BANCO_BROU, terminacion: "" }, []).ok);
  assert.ok(!validarCuenta({ nombre: "BROU USD", banco: BANCO_BROU, terminacion: "" }, [{ id: "x", nombre: "BROU USD", activa: true }]).ok);
  assert.equal(monedaDeCuentaFija(BANCO_BROU, "BROU UYU"), "UYU");
  assert.equal(NUMEROS_CUENTA_BROU.USD, "110509829-00002");
});

test("cuentas forzadas (archivo de una cuenta): solo hace falta la cuenta de la moneda del archivo", () => {
  const solo = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTA_USD_DB], ["USD"]);
  assert.ok(solo.ok);
  assert.deepEqual(Object.keys(solo.cuentas), ["USD"]);
  const falta = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTA_USD_DB], ["UYU"]);
  assert.ok(!falta.ok);
  assert.match(falta.error, /no existe la cuenta BROU UYU/);
  assert.match(falta.error, /No se cargó nada/);
  // Sin el parámetro (Perú, Bradenton) exige todas las de la empresa, como siempre.
  const todas = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTA_USD_DB]);
  assert.ok(!todas.ok);
  assert.match(todas.error, /BROU UYU/);
  // Las demás reglas siguen: de ESTA empresa, activa, del banco y con la moneda.
  assert.ok(!resolverCuentasForzadas(CONFIG, EMPRESA, [{ ...CUENTA_USD_DB, empresaId: "otra" }], ["USD"]).ok);
  assert.ok(!resolverCuentasForzadas(CONFIG, EMPRESA, [{ ...CUENTA_USD_DB, activa: false }], ["USD"]).ok);
  assert.ok(!resolverCuentasForzadas(CONFIG, EMPRESA, [{ ...CUENTA_USD_DB, moneda: "ARS" }], ["USD"]).ok);
  assert.ok(!resolverCuentasForzadas(CONFIG, EMPRESA, [{ ...CUENTA_USD_DB, banco: "CHASE" }], ["USD"]).ok);
});

// ------------------------------------------------------------------ filas y carga

test("carga: cada fila va a BROU USD, unidad PLATE SILVER, SIN CLASIFICAR, sin saldo, con el concepto «Descripción — Asunto»", () => {
  const filas = filasUsd();
  assert.equal(filas.length, 8);
  for (const f of filas) {
    assert.equal(f.bancoYCuenta, "BROU USD");
    assert.equal(f.moneda, "USD");
    assert.equal(f.unidadNegocio, "PLATE SILVER");
    assert.equal(f.clasificacion, CLASIFICACION_SIN_CLASIFICAR);
    assert.equal(f.saldoCentavos, null);
    assert.equal(f.unidadSugeridaPorSistema, false);
  }
  const d = datosParaCrear(filas.find((f) => f.concepto.includes("VTA USD A UYU"))!, "ej1");
  assert.equal(d.saldo, null);
  assert.equal(d.moneda, "USD");
  assert.equal(d.importe, "-13417.72");
  assert.equal(d.concepto, "TRF. E-BROU OTROS — PLATESILVER S.A. - VTA USD A UYU");
});

test("carga: resubir el mismo archivo suma 0, y con otra cuenta cargada (UYU) no hay ruido ni bloqueo", () => {
  const filas = filasUsd();
  const primera = planificarCarga(filas, [], CONFIG.etiqueta);
  assert.equal(primera.nuevas.length, 8);
  assert.equal(primera.bloqueo, null);
  const segunda = planificarCarga(filas, comoExistentes(filas), CONFIG.etiqueta);
  assert.equal(segunda.nuevas.length, 0);
  assert.equal(segunda.cantidadYaCargadas, 8);
  assert.equal(segunda.bloqueo, null);
});

test("carga: movimientos que repiten TODO (fecha, descripción, asunto, Nº de documento e importe) se cuentan N − M: no se pierde ninguno", () => {
  const triple = [MOVS_USD[2], { ...MOVS_USD[2] }, { ...MOVS_USD[2] }];
  const filas = filasUsd(triple);
  assert.equal(filas.length, 3);
  assert.equal(new Set(filas.map((f) => f.clave)).size, 1, "las tres tienen la misma clave");
  assert.equal(planificarCarga(filas, [], CONFIG.etiqueta).nuevas.length, 3, "las tres entran la primera vez");
  const yaDos = comoExistentes(filas.slice(0, 2));
  const p = planificarCarga(filas, yaDos, CONFIG.etiqueta);
  assert.equal(p.cantidadYaCargadas, 2);
  assert.equal(p.nuevas.length, 1, "con 2 ya cargadas entra la que falta");
  assert.equal(planificarCarga(filas, comoExistentes(filas), CONFIG.etiqueta).nuevas.length, 0, "resubir da 0");
});

test("carga: las fechas del archivo tienen que caer en el período (un archivo de otro mes no se carga)", () => {
  const filas = filasUsd();
  assert.equal(errorFechasFueraDelPeriodo(filas, "2026-10"), null);
  assert.match(errorFechasFueraDelPeriodo(filas, "2026-11")!, /fuera de 2026-11/);
});

test("lectura: sin errores no frena; el control sin saldo (sin_pie) no bloquea Confirmar", () => {
  const lectura = leerBrou(grillaBrou({ movs: MOVS_USD }), { cuentaPorMoneda: CONFIG.numeroCuentaPorMoneda!, hoy: HOY });
  assert.equal(errorDeLectura(lectura, CONFIG, "Hoja1 - Table 1"), null);
  assert.equal(puedeConfirmarVistaPrevia({ nuevas: 8, control: lectura.control }), true);
  assert.equal(puedeConfirmarVistaPrevia({ nuevas: 0, control: lectura.control }), false);
});

// ------------------------------------------------------------------ pantalla y acción

test("pantalla: Plate Silver ve la subida (con permiso); acepta solo .xls; el texto habla del BROU", () => {
  assert.equal(puedeVerSubidaExtractoEmpresa("plate-silver", true), true);
  assert.equal(puedeVerSubidaExtractoEmpresa("plate-silver", false), false);
  assert.equal(aceptaDeEmpresa("plate-silver"), ".xls");
  assert.equal(aceptaDeEmpresa("havanna-peru"), ".xlsx");
  assert.equal(aceptaDeEmpresa("bradenton"), ".xlsx,.csv");
  const t = textoSubidaExtractoEmpresa("plate-silver", MAX_BYTES_HAVANNA_PERU, MAX_FILAS_HAVANNA_PERU);
  assert.match(t, /\.xls del BROU/);
  assert.match(t, /BROU UYU o BROU USD/);
  assert.match(t, /no trae saldo/);
  assert.match(t, /Todo entra sin clasificar/);
});

test("la acción: BROU solo acepta .xls, resuelve la cuenta del archivo y bloquea y reconoce solo esa cuenta; Perú y Bradenton quedan igual", () => {
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  assert.match(src, /if \(!\/\\\.xls\$\/i\.test\(archivo\.name\)\)/);
  assert.match(src, /else if \(!esCsv && !\/\\\.xlsx\$\/i\.test\(archivo\.name\)\)/, "los demás siguen con .xlsx / .csv");
  assert.match(src, /resolverCuentasForzadas\(config, empresa\.id, cuentasDeLaBase, monedas\)/);
  assert.match(src, /archivoDeUnaCuenta\(config\)/);
  assert.match(src, /const nombresCuentas = monedas\.map\(\(m\) => cuentas\[m\]\.nombre\)/);
  assert.match(src, /config\.lector === "chase" \? leerChase\(hoja, \{ crudo \}\) : leerHavannaPeru/);
});

// ------------------------------------------------------------------ archivos REALES (BROU_REALES_DIR)

const DIR = process.env.BROU_REALES_DIR;
const omitir = DIR && existsSync(DIR) ? false : "BROU_REALES_DIR no está definida";

function realFilas(sufijo: string, moneda: "UYU" | "USD"): FilaACargar[] {
  const nombre = readdirSync(DIR!).find((n) => n.startsWith("Detalle_Movimiento_Cuenta") && n.includes(sufijo) && n.endsWith(".xls"))!;
  const bytes = new Uint8Array(readFileSync(join(DIR!, nombre)));
  const lectura = leerBrou(hojaDeBytesBrou(bytes), { cuentaPorMoneda: CONFIG.numeroCuentaPorMoneda!, hoy: HOY });
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTA_UYU_DB, CUENTA_USD_DB], [moneda]);
  assert.ok(r.ok);
  return armarFilasACargar(lectura, CONFIG, r.cuentas);
}

test("REAL: los dos archivos de octubre entran completos, en octubre, y resubirlos suma 0 (sin perder los repetidos)", { skip: omitir }, () => {
  const uyu = realFilas("112132", "UYU");
  const usd = realFilas("112144", "USD");
  assert.equal(uyu.length, 19);
  assert.equal(usd.length, 208);
  for (const filas of [uyu, usd]) {
    assert.equal(errorFechasFueraDelPeriodo(filas, "2026-10"), null);
    const nuevas = planificarCarga(filas, [], CONFIG.etiqueta);
    assert.equal(nuevas.nuevas.length, filas.length);
    const otra = planificarCarga(filas, comoExistentes(filas), CONFIG.etiqueta);
    assert.equal(otra.nuevas.length, 0);
    assert.equal(otra.bloqueo, null);
  }
  // Cada cuenta tiene su moneda y su nombre; nada se mezcla.
  assert.ok(uyu.every((f) => f.moneda === "UYU" && f.bancoYCuenta === "BROU UYU"));
  assert.ok(usd.every((f) => f.moneda === "USD" && f.bancoYCuenta === "BROU USD"));
  // Cargada la cuenta UYU, subir la USD no ve nada de la otra cuenta: la consulta de existentes es por cuenta.
  const conUyuCargada = planificarCarga(usd, comoExistentes(uyu).filter((e) => e.bancoYCuenta === "BROU USD"), CONFIG.etiqueta);
  assert.equal(conUyuCargada.nuevas.length, 208);
  assert.deepEqual(conUyuCargada.avisos, []);
  // Importe neto cargado = el neto del archivo.
  assert.equal(uyu.reduce((a, f) => a + f.importeCentavos, 0), 98723);
  assert.equal(usd.reduce((a, f) => a + f.importeCentavos, 0), 260570);
  assert.ok(serialOct(1) > 0);
});
