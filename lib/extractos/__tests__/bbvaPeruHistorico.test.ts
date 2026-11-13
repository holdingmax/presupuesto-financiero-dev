import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { decimalTextoDeCentavos } from "@/lib/conteoMovimientos";
import { BANCO_BBVA_PERU, CUENTAS_BBVA_PERU } from "@/lib/extractos/bancosCuenta";
import { celdasDeHtml, esHistoricoBbvaPeru, leerHistoricoBbvaPeru, leerHistoricosBbvaPeru } from "@/lib/extractos/bbvaPeruHistorico";
import {
  aceptaDeEmpresa,
  aceptaVariosArchivos,
  armarFilasACargar,
  configDeEmpresa,
  errorDeLectura,
  errorFechasFueraDelPeriodo,
  planificarCarga,
  resolverCuentasForzadas,
  textoSubidaExtractoEmpresa,
  type CuentaDeLaBase,
  type FilaACargar,
  type FilaExistente,
} from "@/lib/extractos/cargaEmpresa";
import { MAX_BYTES_HAVANNA_PERU, MAX_FILAS_HAVANNA_PERU } from "@/lib/extractos/limites";
import { ErrorExtracto } from "@/lib/extractos/tipos";
import { MOVS_USD, htmlHistorico, movsSinteticos, type MovHist } from "./fixtures/bbvaPeruHistorico";

const HOY = new Date(Date.UTC(2026, 10, 13));
const CONFIG = configDeEmpresa("havanna-peru")!;
const EMPRESA = "emp-peru";
const SOLES_DB: CuentaDeLaBase = { id: "c1", nombre: CUENTAS_BBVA_PERU.PEN, banco: BANCO_BBVA_PERU, activa: true, empresaId: EMPRESA, moneda: "PEN" };
const USD_DB: CuentaDeLaBase = { id: "c2", nombre: CUENTAS_BBVA_PERU.USD, banco: BANCO_BBVA_PERU, activa: true, empresaId: EMPRESA, moneda: "USD" };

const arch = (nombre: string, bytes: Uint8Array) => ({ nombre, bytes });

function aCargar(lectura: ReturnType<typeof leerHistoricosBbvaPeru>, monedas: ("PEN" | "USD")[]): FilaACargar[] {
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, [SOLES_DB, USD_DB], monedas);
  assert.ok(r.ok);
  return armarFilasACargar(lectura, CONFIG, r.cuentas);
}
const comoExistentes = (filas: FilaACargar[]): FilaExistente[] =>
  filas.map((f) => ({ fecha: f.fecha, importe: decimalTextoDeCentavos(f.importeCentavos), bancoYCuenta: f.bancoYCuenta, concepto: f.concepto, nroReferencia: f.nroReferencia, saldo: null, moneda: f.moneda }));

test("lee un histórico USD: moneda del encabezado, movimientos, saldos solo para el control", () => {
  const bytes = htmlHistorico({ inicial: "5000.00", movs: MOVS_USD });
  assert.equal(esHistoricoBbvaPeru(bytes), true);
  const l = leerHistoricoBbvaPeru(arch("usd.xls", bytes));
  assert.equal(l.moneda, "USD");
  assert.equal(l.cuenta, "0011-9999-0100000001");
  assert.equal(l.titular, "EMPRESA DE PRUEBA SAC");
  assert.equal(l.filas.length, 4); // las filas de saldo NO son movimientos
  assert.deepEqual(l.filas.map((f) => f.importeCentavos), [-150050, 300000, -1230, -25000]);
  assert.equal(l.filas[0].referencia, "000123"); // conserva ceros
  assert.equal(l.filas[2].referencia, null);
  assert.equal(l.filas[0].fecha.toISOString().slice(0, 10), "2026-10-02");
  assert.equal(l.inicialCentavos, 500000);
  assert.equal(l.finalCentavos, 500000 - 150050 + 300000 - 1230 - 25000);
  assert.equal(l.fechaFinal, "2026-10-09");
  assert.equal(l.errorControl, null);
});

test("la moneda no es fija: PEN va a BBVA PERÚ SOLES y USD a BBVA PERÚ USD", () => {
  const pen = leerHistoricosBbvaPeru([arch("pen.xls", htmlHistorico({ moneda: "PEN", cuenta: "0011-9999-0100000002", inicial: "100.00", movs: MOVS_USD }))], { hoy: HOY });
  const usd = leerHistoricosBbvaPeru([arch("usd.xls", htmlHistorico({ moneda: "USD", inicial: "100.00", movs: MOVS_USD }))], { hoy: HOY });
  assert.ok(pen.filas.every((f) => f.moneda === "PEN"));
  assert.ok(usd.filas.every((f) => f.moneda === "USD"));
  assert.ok(aCargar(pen, ["PEN"]).every((f) => f.bancoYCuenta === "BBVA PERÚ SOLES" && f.clasificacion === "SIN CLASIFICAR" && f.unidadNegocio === "HAVANNA PERU"));
  assert.ok(aCargar(usd, ["USD"]).every((f) => f.bancoYCuenta === "BBVA PERÚ USD"));
  assert.equal(pen.control[0].estado, "cuadra");
});

test("control que no cuadra: error que dice la diferencia y el día, y errorDeLectura bloquea", () => {
  const bytes = htmlHistorico({ inicial: "5000.00", movs: MOVS_USD, saldoFinalForzado: "1.00" });
  const l = leerHistoricosBbvaPeru([arch("roto.xls", bytes)], { hoy: HOY });
  assert.equal(l.control[0].estado, "no_cuadra");
  assert.equal(l.errores.length, 1);
  assert.match(l.errores[0], /roto\.xls: el saldo no cuadra/);
  assert.match(l.errores[0], /2026-10-09/);
  assert.match(errorDeLectura(l, CONFIG, "x") ?? "", /No se cargó nada/);
});

test("errores de formato: importe con coma, fecha inválida, sin «Importes en», moneda desconocida, sin saldo", () => {
  const dec = (movs: MovHist[], extra = {}) => () => leerHistoricoBbvaPeru(arch("a.xls", htmlHistorico({ inicial: "0.00", movs, ...extra })));
  assert.throws(dec([{ fecha: "02-10-2026", concepto: "X", importe: "1.500,50" }]), (e) => e instanceof ErrorExtracto && /no pude leer el importe/.test(e.message));
  assert.throws(dec([{ fecha: "02-10-2026", concepto: "X", importe: "1,5" }]), /no pude leer el importe/);
  // El banco real separa los miles con coma: «1,500.50» es válido (1500,50).
  assert.equal(leerHistoricoBbvaPeru(arch("m.xls", htmlHistorico({ inicial: "0.00", movs: [{ fecha: "02-10-2026", concepto: "X", importe: "-1500.50" }], formatoMiles: true }))).filas[0].importeCentavos, -150050);
  assert.throws(dec([{ fecha: "31-02-2026", concepto: "X", importe: "1.00" }]), /fecha inválida/);
  assert.throws(dec(MOVS_USD, { sinImportesEn: true }), /Importes en/);
  assert.throws(dec(MOVS_USD, { moneda: "EUR" }), /no reconozco la moneda/);
  assert.throws(() => leerHistoricoBbvaPeru(arch("a.xls", new TextEncoder().encode("<html><table><tr><td>Otra cosa</td></tr></table></html>"))), /no es un «Histórico/);
  assert.throws(() => leerHistoricoBbvaPeru(arch("a.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))), /tal cual se descargó/);
  const html = Buffer.from(htmlHistorico({ inicial: "0.00", movs: MOVS_USD })).toString("utf8").replace(/Saldo Final: \d\d-\d\d-\d{4}/g, "Total");
  assert.throws(() => leerHistoricoBbvaPeru(arch("a.xls", new TextEncoder().encode(html))), /Saldo Final/);
});

test("acepta latin1 con entidades HTML y celdas sin cerrar", () => {
  const bytes = htmlHistorico({ inicial: "5000.00", movs: MOVS_USD, charset: "latin1" });
  assert.equal(leerHistoricoBbvaPeru(arch("l.xls", bytes)).filas.length, 4);
  const g = celdasDeHtml("<table><tr><td>a&nbsp;b<td>c<br>d<tr><td>&oacute;&#241;");
  assert.deepEqual(g, [["a b", "c d"], ["óñ"]]);
});

// ---- varios archivos de la misma cuenta, con fechas que se pisan
const TODOS: MovHist[] = [
  { fecha: "01-10-2026", doc: "1", concepto: "A", importe: "-10.00" },
  { fecha: "02-10-2026", doc: "2", concepto: "B", importe: "-20.00" },
  { fecha: "02-10-2026", doc: "2", concepto: "B", importe: "-20.00" }, // idéntico: son DOS
  { fecha: "03-10-2026", doc: "3", concepto: "C", importe: "300.00" },
  { fecha: "04-10-2026", doc: "4", concepto: "D", importe: "-40.00" },
  { fecha: "05-10-2026", doc: "5", concepto: "E", importe: "50.00" },
];
const dd = (m: MovHist) => Number(m.fecha.slice(0, 2));
const tramo = (desde: number, hasta: number, inicial: string) =>
  htmlHistorico({ inicial, desde: `${String(desde).padStart(2, "0")}-10-2026`, movs: TODOS.filter((m) => dd(m) >= desde && dd(m) <= hasta) });

test("varios archivos que se pisan: cada movimiento entra una vez (idénticos del mismo día siguen siendo dos) y el control cuadra", () => {
  // Octubre arranca en 1000.00. Antes del día 2 queda 990.00.
  const a = tramo(1, 3, "1000.00");
  const b = tramo(2, 5, "990.00");
  const l = leerHistoricosBbvaPeru([arch("b.xls", b), arch("a.xls", a)], { hoy: HOY }); // en cualquier orden
  assert.equal(l.filas.length, 6);
  assert.deepEqual(l.errores, []);
  assert.equal(l.control.length, 1);
  assert.equal(l.control[0].estado, "cuadra");
  assert.equal(l.control[0].inicialCentavos, 100000);
  assert.equal(l.control[0].finalCentavos, 100000 - 1000 - 2000 - 2000 + 30000 - 4000 + 5000);
  assert.ok(l.avisos.some((x) => /se pisan/.test(x)));
  assert.deepEqual(l.filas.map((f) => f.fecha.toISOString().slice(8, 10)), ["01", "02", "02", "03", "04", "05"]);
  assert.equal(l.detalleArchivos.length, 2);
});

test("varios archivos: falta un tramo → no cuadra y se dice; cuentas distintas de la misma moneda → rechazo", () => {
  const a = tramo(1, 2, "1000.00");
  const c = tramo(5, 5, "1000.00"); // salta los días 3 y 4
  const l = leerHistoricosBbvaPeru([arch("a.xls", a), arch("c.xls", c)], { hoy: HOY });
  assert.equal(l.control[0].estado, "no_cuadra");
  assert.ok(l.errores.some((e) => /no forman un tramo continuo/.test(e)));
  const otra = htmlHistorico({ cuenta: "0011-0000-0000000009", inicial: "0.00", movs: [{ fecha: "01-10-2026", concepto: "X", importe: "1.00" }] });
  assert.throws(() => leerHistoricosBbvaPeru([arch("a.xls", a), arch("o.xls", otra)], { hoy: HOY }), /cuentas distintas/);
});

test("soles y dólares juntos: dos controles, cada fila a la cuenta de su moneda", () => {
  const usd = htmlHistorico({ moneda: "USD", inicial: "10.00", movs: [{ fecha: "01-10-2026", concepto: "U", importe: "5.00" }] });
  const pen = htmlHistorico({ moneda: "PEN", cuenta: "0011-9999-0100000002", inicial: "20.00", movs: [{ fecha: "01-10-2026", concepto: "P", importe: "-5.00" }] });
  const l = leerHistoricosBbvaPeru([arch("u.xls", usd), arch("p.xls", pen)], { hoy: HOY });
  assert.deepEqual(l.control.map((c) => c.moneda).sort(), ["PEN", "USD"]);
  const filas = aCargar(l, ["PEN", "USD"]);
  assert.deepEqual(filas.map((f) => [f.moneda, f.bancoYCuenta]).sort(), [["PEN", "BBVA PERÚ SOLES"], ["USD", "BBVA PERÚ USD"]]);
});

// ---- dedupe contra la base
test("resubir el mismo archivo da 0 nuevas; subir un tramo que pisa a otro ya cargado carga solo lo nuevo", () => {
  const l1 = leerHistoricosBbvaPeru([arch("a.xls", tramo(1, 3, "1000.00"))], { hoy: HOY });
  const f1 = aCargar(l1, ["USD"]);
  assert.equal(planificarCarga(f1, [], CONFIG.etiqueta).nuevas.length, 4);
  const otra = planificarCarga(f1, comoExistentes(f1), CONFIG.etiqueta);
  assert.equal(otra.nuevas.length, 0);
  assert.equal(otra.bloqueo, null);
  const l2 = leerHistoricosBbvaPeru([arch("b.xls", tramo(2, 5, "990.00"))], { hoy: HOY });
  const f2 = aCargar(l2, ["USD"]);
  const p = planificarCarga(f2, comoExistentes(f1), CONFIG.etiqueta);
  assert.equal(p.cantidadYaCargadas, 3); // 2 idénticos del día 2 + el del día 3
  assert.equal(p.nuevas.length, 2); // días 4 y 5
  assert.equal(errorFechasFueraDelPeriodo(f2, "2026-10"), null);
  assert.match(errorFechasFueraDelPeriodo(f2, "2026-11") ?? "", /fuera de 2026-11/);
});

// ---- volumen
for (const n of [1377, 3000]) {
  test(`volumen: ${n} movimientos (subidos dos veces) se leen, combinan y planifican rápido y cuadran`, () => {
    const bytes = htmlHistorico({ inicial: "113818.25", movs: movsSinteticos(n) });
    const t0 = performance.now();
    const l = leerHistoricosBbvaPeru([arch("grande.xls", bytes), arch("grande2.xls", bytes)], { hoy: HOY });
    const filas = aCargar(l, ["USD"]);
    const plan = planificarCarga(filas, comoExistentes(filas.slice(0, 500)), CONFIG.etiqueta);
    const ms = performance.now() - t0;
    assert.equal(l.filas.length, n);
    assert.equal(l.control[0].estado, "cuadra");
    assert.equal(plan.cantidadYaCargadas, 500);
    assert.ok(ms < 3000, `tardó ${ms} ms`);
  });
}

test("más de 3.000 movimientos se rechaza (tope de este camino)", () => {
  const bytes = htmlHistorico({ inicial: "0.00", movs: movsSinteticos(MAX_FILAS_HAVANNA_PERU + 1) });
  assert.throws(() => leerHistoricosBbvaPeru([arch("x.xls", bytes)], { hoy: HOY }), /máximo es/);
});

// ---- pantalla, acción y libro PF intactos
test("el libro PF sigue: .xlsx se acepta y su texto no cambia; el histórico se suma como .xls con varios archivos", () => {
  assert.match(aceptaDeEmpresa("havanna-peru"), /\.xlsx/);
  assert.match(aceptaDeEmpresa("havanna-peru"), /\.xls$/);
  assert.equal(aceptaVariosArchivos("havanna-peru"), true);
  assert.equal(aceptaVariosArchivos("plate-silver"), false);
  assert.equal(aceptaVariosArchivos("bradenton"), false);
  const t = textoSubidaExtractoEmpresa("havanna-peru", MAX_BYTES_HAVANNA_PERU, MAX_FILAS_HAVANNA_PERU);
  assert.match(t, /el libro PF de Perú/);
  assert.match(t, /Histórico de Movimientos/);
});

test("la acción: el .xlsx de Perú sigue por la pestaña del libro PF; el .xls va al histórico; nunca se mezclan", () => {
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  assert.match(src, /seleccionarPestanaHavannaPeru\(/);
  assert.match(src, /leerHavannaPeru\(hoja, \{ monedaCuenta: "PEN" \}\)/);
  assert.match(src, /esHistorico = config\.lector === "havanna-peru" && \/\\\.xls\$\/i\.test\(archivo\.name\)/);
  assert.match(src, /leerHistoricosBbvaPeru\(crudos\)/);
  assert.match(src, /No se pueden mezclar el libro PF/);
  assert.match(src, /resolverCuentasForzadas\(config, empresa\.id, cuentasDeLaBase, monedas\)/);
});

// ---- archivos REALES (BBVA_PERU_REALES_DIR): solo lectura, se saltan si no está definida
const DIR = process.env.BBVA_PERU_REALES_DIR;
const omitir = DIR && existsSync(DIR) ? false : "BBVA_PERU_REALES_DIR no está definida";

test("REAL: los archivos de la carpeta se leen, cuadran y resubirlos suma 0", { skip: omitir }, () => {
  const nombres = readdirSync(DIR!).filter((n) => /\.xls$/i.test(n));
  assert.ok(nombres.length > 0);
  for (const n of nombres) {
    const l = leerHistoricosBbvaPeru([arch(n, new Uint8Array(readFileSync(join(DIR!, n))))], { hoy: HOY });
    assert.deepEqual(l.errores, [], n);
    assert.equal(l.control[0].estado, "cuadra", n);
    const filas = aCargar(l, [l.control[0].moneda as "PEN" | "USD"]);
    assert.equal(planificarCarga(filas, comoExistentes(filas), CONFIG.etiqueta).nuevas.length, 0);
  }
});
