import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { decimalTextoDeCentavos } from "@/lib/conteoMovimientos";
import { validarCuenta } from "@/lib/cuentasBancarias";
import { BANCO_BBVA_PERU, BANCO_CHASE, CUENTAS_CHASE, monedaDeCuentaFija } from "@/lib/extractos/bancosCuenta";
import { esCsvChase, hojaDeCsvChase, leerChase, partirCsv, referenciaDeChase } from "@/lib/extractos/chase";
import { DETECTOR_CHASE, leerPestanaHavannaPeru, listarPestanasMovimientos, seleccionarPestanaHavannaPeru } from "@/lib/extractos/havannaPeruPestanas";
import {
  aceptaDeEmpresa,
  armarFilasACargar,
  configDeEmpresa,
  datosParaCrear,
  errorDeLectura,
  errorFechasFueraDelPeriodo,
  planificarCarga,
  rangoDelPeriodo,
  resolverCuentasForzadas,
  textoSubidaExtractoEmpresa,
  type CuentaDeLaBase,
  type FilaACargar,
  type FilaExistente,
} from "@/lib/extractos/cargaEmpresa";
import { MAX_BYTES_HAVANNA_PERU, MAX_FILAS_HAVANNA_PERU } from "@/lib/extractos/limites";
import { MOVS_CHASE_OCT, SALDO_INICIAL_OCT, SERIAL_1_NOV_2026, hojaChase, libroBradenton, libroChase, type OpcionesChase } from "./fixtures/chase";

const HOY = new Date(Date.UTC(2026, 10, 10));
const EMPRESA = "emp-bradenton";
const CONFIG = configDeEmpresa("bradenton")!;
const CUENTA_OK: CuentaDeLaBase = { id: "c1", nombre: "CHASE BRADENTON", banco: BANCO_CHASE, activa: true, empresaId: EMPRESA, moneda: "USD" };
const OCTUBRE = rangoDelPeriodo("2026-10");

const grilla = (o: OpcionesChase = {}) => ({ nombre: "CHASE", filas: hojaChase(o) as never[][], date1904: false });
const lee = (o: OpcionesChase = {}) => leerChase(grilla(o), { hoy: HOY });
const comoExistentes = (filas: FilaACargar[]): FilaExistente[] =>
  filas.map((f) => ({
    fecha: f.fecha,
    importe: decimalTextoDeCentavos(f.importeCentavos),
    bancoYCuenta: f.bancoYCuenta,
    concepto: f.concepto,
    nroReferencia: f.nroReferencia,
    saldo: f.saldoCentavos === null ? null : decimalTextoDeCentavos(f.saldoCentavos),
    moneda: f.moneda,
  }));
function filasACargar(o: OpcionesChase = {}): FilaACargar[] {
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTA_OK]);
  assert.ok(r.ok);
  return armarFilasACargar(lee(o), CONFIG, r.cuentas);
}

// ------------------------------------------------------------------ lectura

test("Chase: lee los movimientos del banco (A-F), en USD, con el saldo corrido de cada fila", () => {
  const l = lee();
  assert.equal(l.filas.length, MOVS_CHASE_OCT.length);
  assert.deepEqual(l.errores, []);
  assert.equal(l.monedaAsumida, false);
  const f0 = l.filas[0];
  assert.equal(f0.fecha.toISOString().slice(0, 10), "2026-10-01");
  assert.equal(f0.importeCentavos, -55877);
  assert.equal(f0.saldoCentavos, 6719791 - 55877);
  assert.equal(f0.moneda, "USD");
  assert.equal(f0.causal, "CHECK_PAID");
  assert.equal(f0.referencia, "CHECK 1780");
  // La última fila trae el saldo final; las fechas son las del archivo (1 y 30 de octubre).
  assert.equal(l.filas[l.filas.length - 1].fecha.toISOString().slice(0, 10), "2026-10-30");
});

test("Chase: la columna G (etiqueta manual) y las de importes manuales NO se leen: todo entra sin clasificar", () => {
  const l = lee();
  for (const f of l.filas) assert.equal(f.detalle, null);
  const filas = filasACargar();
  assert.ok(filas.every((f) => f.clasificacion === "SIN CLASIFICAR" && f.clasificacion2 === null));
  assert.ok(filas.every((f) => f.unidadNegocio === "BRADENTON" && f.unidadSugeridaPorSistema === false && f.sugeridaPorSistema === false));
});

test("Chase: el concepto es la descripción con los espacios sobrantes colapsados", () => {
  const l = lee();
  const fb = l.filas.find((f) => f.concepto.startsWith("FACEBK"))!;
  assert.equal(fb.concepto, "FACEBK *V3BJM7J5Z4 FACEBOOK.COM 09/30");
  const dep = l.filas.find((f) => f.concepto.startsWith("DEPOSIT"))!;
  assert.equal(dep.concepto, "DEPOSIT ID NUMBER 293087");
});

test("Chase: referencia sacada de la descripción (TRN, cheque, depósito, trace) o ninguna", () => {
  assert.equal(referenciaDeChase("ORIG CO NAME:X TRACE#:051000010659493 EED:1 BRADENTON GAS STATI TRN: 2740659493TC"), "TRN 2740659493");
  assert.equal(referenciaDeChase("CHECK 1780 Midtown"), "CHECK 1780");
  assert.equal(referenciaDeChase("DEPOSIT  ID NUMBER 293087"), "DEPOSIT 293087");
  assert.equal(referenciaDeChase("ORIG CO NAME:X TRACE#:051000010659493 EED:1"), "TRACE 051000010659493");
  assert.equal(referenciaDeChase("FACEBK *V3BJM7J5Z4 FACEBOOK.COM 09/30"), null);
});

// ------------------------------------------------------------------ control con el Balance corrido

test("control: saldo inicial + movimientos = saldo final, y cuadra", () => {
  const l = lee();
  assert.equal(l.control.length, 1);
  const c = l.control[0];
  const suma = MOVS_CHASE_OCT.reduce((a, m) => a + Math.round(m.importe * 100), 0);
  assert.equal(c.moneda, "USD");
  assert.equal(c.inicialCentavos, Math.round(SALDO_INICIAL_OCT * 100));
  assert.equal(c.movimientosCentavos, suma);
  assert.equal(c.finalCentavos, c.inicialCentavos! + suma);
  assert.equal(c.diferenciaCentavos, 0);
  assert.equal(c.estado, "cuadra");
  assert.deepEqual(l.avisos, []);
});

test("control: si un Balance no cierra con el anterior se informa la fila y NO se carga nada", () => {
  const l = lee({ romperBalanceEnFila: 2 });
  assert.ok(l.errores.length > 0);
  assert.match(l.errores.join(" "), /Balance no cierra/);
  const msg = errorDeLectura(l, CONFIG, "CHASE");
  assert.ok(msg && /No se cargó nada\.$/.test(msg));
});

test("control: un movimiento que falta (Balance sin cerrar) es error, no aviso", () => {
  const sinUno = MOVS_CHASE_OCT.filter((_, i) => i !== 3);
  const hoja = hojaChase();
  // Se quita la fila del medio de la grilla pero el Balance de las siguientes queda como estaba.
  const filas = hoja.filter((_, i) => i !== 3 + 4);
  const l = leerChase({ nombre: "CHASE", filas: filas as never[][], date1904: false }, { hoy: HOY });
  assert.equal(sinUno.length, MOVS_CHASE_OCT.length - 1);
  assert.ok(l.errores.length > 0);
});

test("orden: un extracto del más nuevo al más viejo (como lo baja Chase) se ordena por el Balance y cuadra igual", () => {
  const l = lee({ descendente: true });
  assert.deepEqual(l.errores, []);
  assert.equal(l.control[0].estado, "cuadra");
  assert.equal(l.filas[0].referencia, "CHECK 1780");
  assert.ok(l.avisos.some((a) => /más nuevo al más viejo/.test(a)));
  const iguales = lee();
  assert.deepEqual(
    l.filas.map((f) => [f.fecha.toISOString(), f.importeCentavos, f.saldoCentavos]),
    iguales.filas.map((f) => [f.fecha.toISOString(), f.importeCentavos, f.saldoCentavos])
  );
});

test("sin fila de saldo inicial: se deriva del Balance de la primera fila, con aviso", () => {
  const sinFila = lee({ saldoInicial: null });
  assert.deepEqual(sinFila.errores, []);
  assert.equal(sinFila.control[0].estado, "cuadra");
  assert.ok(sinFila.avisos.some((a) => /no trae la fila de saldo inicial/.test(a)));
});

test("el RESUMEN de abajo (a mano) desactualizado solo avisa: lo que manda es el Balance del banco", () => {
  const l = lee({ saldoFinalResumen: 1234.56 });
  assert.deepEqual(l.errores, []);
  assert.equal(l.control[0].estado, "cuadra");
  assert.ok(l.avisos.some((a) => /SALDO FINAL BANK/.test(a)));
  assert.deepEqual(lee({ sinResumen: true }).avisos, []);
});

test("una fila con Details e importe pero sin fecha después del corte frena la lectura", () => {
  assert.throws(() => lee({ filaSinFechaConDetails: true }), /no tiene fecha en Posting Date/);
});

test("sin encabezado de Chase: error claro", () => {
  assert.throws(() => leerChase({ nombre: "X", filas: [["a", "b"]] as never[][], date1904: false }), /No encontré la fila de encabezados de Chase/);
});

// ------------------------------------------------------------------ pestaña por contenido

test("pestaña: se reconoce por contenido, no por el título ('CHASE BANK 08-2026') ni por el nombre; Ch deb y LOTTERY no cuentan", () => {
  const libro = libroBradenton();
  const candidatas = listarPestanasMovimientos(libro, DETECTOR_CHASE);
  assert.deepEqual(candidatas.map((c) => c.nombre), ["CHASE"]);
  assert.equal(candidatas[0].desde.toISOString().slice(0, 10), "2026-10-01");
  assert.equal(candidatas[0].hasta.toISOString().slice(0, 10), "2026-10-30");
  const sel = seleccionarPestanaHavannaPeru(libro, OCTUBRE, undefined, DETECTOR_CHASE);
  assert.equal(sel.tipo, "elegida");
  if (sel.tipo === "elegida") {
    assert.equal(sel.candidata.nombre, "CHASE");
    assert.equal(leerChase(sel.hoja, { hoy: HOY }).filas.length, MOVS_CHASE_OCT.length);
  }
});

test("pestaña: la pestaña con otro nombre se encuentra igual, y 'Ch deb'/'LOTTERY' elegidas a mano se rechazan", () => {
  const libro = libroChase([{ nombre: "Hoja1", filas: hojaChase() }]);
  assert.deepEqual(listarPestanasMovimientos(libro, DETECTOR_CHASE).map((c) => c.nombre), ["Hoja1"]);
  assert.throws(() => seleccionarPestanaHavannaPeru(libroBradenton(), OCTUBRE, "Ch deb", DETECTOR_CHASE), /no es una pestaña de movimientos/);
  assert.throws(() => seleccionarPestanaHavannaPeru(libroBradenton(), OCTUBRE, "LOTTERY", DETECTOR_CHASE), /no es una pestaña de movimientos/);
});

test("pestaña: un mes que no está en el libro devuelve las candidatas para elegir (no carga en silencio)", () => {
  const sel = seleccionarPestanaHavannaPeru(libroBradenton(), rangoDelPeriodo("2026-11"), undefined, DETECTOR_CHASE);
  assert.equal(sel.tipo, "candidatas");
  if (sel.tipo === "candidatas") {
    assert.equal(sel.motivo, "ninguna_en_periodo");
    assert.deepEqual(sel.candidatas.map((c) => c.nombre), ["CHASE"]);
  }
  assert.equal(SERIAL_1_NOV_2026, 46327);
});

test("pestaña: leerPestana con el detector de Chase lee solo esa pestaña y rechaza una sin el encabezado", () => {
  const libro = libroBradenton();
  assert.equal(leerPestanaHavannaPeru(libro, "CHASE", DETECTOR_CHASE).nombre, "CHASE");
  assert.throws(() => leerPestanaHavannaPeru(libro, "PRESUPUESTO MES A MES", DETECTOR_CHASE), /encabezado de movimientos de Chase/);
});

// ------------------------------------------------------------------ cuenta, config y carga

test("config: Bradenton = Chase, unidad BRADENTON, una sola cuenta en USD", () => {
  assert.equal(CONFIG.lector, "chase");
  assert.equal(CONFIG.unidad, "BRADENTON");
  assert.equal(CONFIG.banco, BANCO_CHASE);
  assert.deepEqual(CONFIG.cuentaPorMoneda, { USD: "CHASE BRADENTON" });
  assert.equal(CUENTAS_CHASE.USD, "CHASE BRADENTON");
  // Perú no cambió.
  assert.deepEqual(configDeEmpresa("havanna-peru")!.cuentaPorMoneda, { PEN: "BBVA PERÚ SOLES", USD: "BBVA PERÚ USD" });
});

test("cuenta: CHASE BRADENTON se valida con su moneda (USD) y sin terminación; otro nombre, repetida o mal banco no", () => {
  const ok = validarCuenta({ nombre: "chase bradenton", banco: BANCO_CHASE, terminacion: "" }, []);
  assert.deepEqual(ok, { ok: true, cuenta: { nombre: "CHASE BRADENTON", banco: BANCO_CHASE, terminacion: "", moneda: "USD" } });
  const otro = validarCuenta({ nombre: "CHASE 1041", banco: BANCO_CHASE, terminacion: "" }, []);
  assert.deepEqual(otro, { ok: false, error: "La cuenta de Chase es: CHASE BRADENTON." });
  assert.ok(!validarCuenta({ nombre: "CHASE BRADENTON", banco: BANCO_CHASE, terminacion: "12" }, []).ok);
  const rep = validarCuenta({ nombre: "CHASE BRADENTON", banco: BANCO_CHASE, terminacion: "" }, [{ id: "x", nombre: "CHASE BRADENTON", activa: true }]);
  assert.deepEqual(rep, { ok: false, error: "Ya existe la cuenta CHASE BRADENTON." });
  // El mensaje de Perú sigue igual que antes.
  assert.deepEqual(validarCuenta({ nombre: "BBVA PERÚ EUR", banco: BANCO_BBVA_PERU, terminacion: "" }, []), {
    ok: false,
    error: "Las cuentas de BBVA Perú son: BBVA PERÚ SOLES y BBVA PERÚ USD.",
  });
  assert.equal(monedaDeCuentaFija(BANCO_CHASE, "Chase Bradenton"), "USD");
  assert.equal(monedaDeCuentaFija(BANCO_CHASE, "BBVA PERÚ USD"), null);
  assert.equal(monedaDeCuentaFija("MACRO", "MACRO 599"), null);
});

test("cuentas forzadas: existe, activa, de ESTA empresa, banco Chase y moneda USD; si no, se rechaza diciendo qué", () => {
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTA_OK]);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(Object.keys(r.cuentas), ["USD"]);
  const falla = (c: Partial<CuentaDeLaBase> | null, texto: RegExp) => {
    const res = resolverCuentasForzadas(CONFIG, EMPRESA, c === null ? [] : [{ ...CUENTA_OK, ...c }]);
    assert.ok(!res.ok);
    if (!res.ok) {
      assert.match(res.error, texto);
      assert.match(res.error, /No se cargó nada\.$/);
    }
  };
  falla(null, /no existe la cuenta CHASE BRADENTON \(cargala en Administración → Cuentas bancarias, banco Chase, de esta empresa\)/);
  falla({ activa: false }, /está inactiva/);
  falla({ empresaId: "otra" }, /no es de esta empresa/);
  falla({ banco: "MACRO" }, /no es del banco Chase/);
  falla({ moneda: "ARS" }, /tiene moneda ARS y tiene que ser USD/);
});

test("carga: cada fila va a CHASE BRADENTON en USD con su saldo; la clave incluye el saldo", () => {
  const filas = filasACargar();
  assert.equal(filas.length, MOVS_CHASE_OCT.length);
  assert.ok(filas.every((f) => f.bancoYCuenta === "CHASE BRADENTON" && f.moneda === "USD"));
  assert.ok(filas.every((f) => f.saldoCentavos !== null));
  const datos = datosParaCrear(filas[0], "ej1");
  assert.equal(datos.saldo, decimalTextoDeCentavos(filas[0].saldoCentavos!));
  assert.equal(datos.moneda, "USD");
  assert.equal(datos.causal, "CHECK_PAID");
  assert.equal(datos.nroReferencia, "CHECK 1780");
  // Dos compras idénticas el mismo día (FACEBK) tienen claves distintas por el saldo corrido.
  const fb = filas.filter((f) => f.concepto.startsWith("FACEBK"));
  assert.equal(fb.length, 2);
  assert.notEqual(fb[0].clave, fb[1].clave);
});

test("carga: una moneda que la empresa no declara se rechaza, no se asume", () => {
  const l = lee();
  const rara = { ...l, filas: l.filas.map((f) => ({ ...f, moneda: "PEN" as const })) };
  assert.throws(() => armarFilasACargar(rara, CONFIG, { USD: { nombre: "CHASE BRADENTON" } }), /no tiene una cuenta en esa moneda/);
});

test("carga: resubir el mismo mes no duplica nada (N − M), y todas son nuevas la primera vez", () => {
  const filas = filasACargar();
  const primera = planificarCarga(filas, [], CONFIG.etiqueta);
  assert.equal(primera.nuevas.length, filas.length);
  assert.equal(primera.bloqueo, null);
  const segunda = planificarCarga(filas, comoExistentes(filas), CONFIG.etiqueta);
  assert.equal(segunda.nuevas.length, 0);
  assert.equal(segunda.cantidadYaCargadas, filas.length);
  assert.match(segunda.avisos.join(" "), /ya estaba[n]? en las cuentas de Bradenton/);
});

test("carga: si el mes ya entró por otro camino (misma fecha e importe, claves distintas) se bloquea y dice Bradenton", () => {
  const filas = filasACargar();
  const otras = comoExistentes(filas).map((e) => ({ ...e, concepto: e.concepto + " (a mano)" }));
  const plan = planificarCarga(filas, otras, CONFIG.etiqueta);
  assert.ok(plan.bloqueo && /Las cuentas de Bradenton ya tienen movimientos/.test(plan.bloqueo));
});

test("carga: las fechas del archivo tienen que caer en el período", () => {
  const filas = filasACargar();
  assert.equal(errorFechasFueraDelPeriodo(filas, "2026-10"), null);
  assert.match(errorFechasFueraDelPeriodo(filas, "2026-11") ?? "", /fuera de 2026-11/);
});

test("pantalla: el texto de la subida habla del libro de Bradenton y de CHASE BRADENTON (Perú sigue igual)", () => {
  const t = textoSubidaExtractoEmpresa("bradenton", MAX_BYTES_HAVANNA_PERU, MAX_FILAS_HAVANNA_PERU);
  assert.match(t, /libro PF de Bradenton/);
  assert.match(t, /los de dólares en CHASE BRADENTON/);
  assert.match(t, /Todo entra sin clasificar/);
  const peru = textoSubidaExtractoEmpresa("havanna-peru", MAX_BYTES_HAVANNA_PERU, MAX_FILAS_HAVANNA_PERU);
  assert.match(peru, /los de soles en BBVA PERÚ SOLES y los de dólares en BBVA PERÚ USD/);
  assert.equal(textoSubidaExtractoEmpresa("brillante", 1, 1), "");
});

test("la acción de Perú y la de Bradenton son la misma: despacha por el lector de la configuración", () => {
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  assert.match(src, /config\.lector === "chase" \? leerChase\(hoja, \{ crudo \}\)/);
  assert.match(src, /DETECTOR_CHASE/);
  assert.ok(!/cuentas\.PEN|cuentas\.USD/.test(src), "ya no está atada a las dos cuentas de Perú");
});

// ------------------------------------------------------------------ el libro REAL (se omite si no está en esta máquina)

const LIBRO_NOVIEMBRE = process.env.LIBRO_BRADENTON_NOVIEMBRE ?? "C:/Users/Usuario/Downloads/PF - BRADENTON - NOVIEMBRE 2026.xlsx";
const LIBRO_OCTUBRE = process.env.LIBRO_BRADENTON_OCTUBRE ?? "C:/Users/Usuario/Downloads/PF - BRADENTON - OCTUBRE 2026.xlsx";

test("LIBRO REAL (noviembre): la pestaña CHASE cuadra 67.197,91 + 19.911,20 = 87.109,11, 182 movimientos de octubre", { skip: !existsSync(LIBRO_NOVIEMBRE) }, () => {
  const bytes = new Uint8Array(readFileSync(LIBRO_NOVIEMBRE));
  const candidatas = listarPestanasMovimientos(bytes, DETECTOR_CHASE);
  assert.deepEqual(candidatas.map((c) => c.nombre), ["CHASE"], "Ch deb y LOTTERY (subconjuntos) no son candidatas");
  const sel = seleccionarPestanaHavannaPeru(bytes, OCTUBRE, undefined, DETECTOR_CHASE);
  assert.equal(sel.tipo, "elegida");
  if (sel.tipo !== "elegida") return;
  const l = leerChase(sel.hoja, { hoy: HOY });
  assert.deepEqual(l.errores, []);
  assert.equal(l.filas.length, 182);
  const c = l.control[0];
  assert.equal(c.inicialCentavos, 6719791);
  assert.equal(c.movimientosCentavos, 1991120);
  assert.equal(c.finalCentavos, 8710911);
  assert.equal(c.estado, "cuadra");
  assert.deepEqual(l.avisos, [], "el resumen a mano coincide con el banco");
  // Todo cae en octubre, todo USD, todo SIN CLASIFICAR en la unidad BRADENTON, y se carga entero la primera vez.
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTA_OK]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const filas = armarFilasACargar(l, CONFIG, r.cuentas);
  assert.equal(errorFechasFueraDelPeriodo(filas, "2026-10"), null);
  assert.ok(filas.every((f) => f.moneda === "USD" && f.unidadNegocio === "BRADENTON" && f.clasificacion === "SIN CLASIFICAR"));
  assert.equal(filas.length, new Set(filas.map((f) => f.clave)).size, "ninguna clave repetida: no se pierde ningún movimiento por reconocimiento");
  const plan = planificarCarga(filas, [], CONFIG.etiqueta);
  assert.equal(plan.nuevas.length, 182);
  assert.equal(planificarCarga(filas, comoExistentes(filas), CONFIG.etiqueta).nuevas.length, 0, "resubir no duplica");
  // Los depósitos (DEPOSIT ID NUMBER, pase de caja a banco) entran como cualquier otra fila, sin clasificar.
  const depositos = filas.filter((f) => /^DEPOSIT ID NUMBER/.test(f.concepto));
  assert.equal(depositos.length, 34);
  assert.equal(depositos.reduce((a, f) => a + f.importeCentavos, 0), 7443600 + 131900 + 200000);
});

test("LIBRO REAL (octubre): la pestaña CHASE trae septiembre y también cuadra", { skip: !existsSync(LIBRO_OCTUBRE) }, () => {
  const bytes = new Uint8Array(readFileSync(LIBRO_OCTUBRE));
  const sel = seleccionarPestanaHavannaPeru(bytes, rangoDelPeriodo("2026-09"), undefined, DETECTOR_CHASE);
  assert.equal(sel.tipo, "elegida");
  if (sel.tipo !== "elegida") return;
  const l = leerChase(sel.hoja, { hoy: HOY });
  assert.deepEqual(l.errores, []);
  assert.equal(l.filas.length, 172);
  assert.equal(l.control[0].estado, "cuadra");
});

// ------------------------------------------------------------------ CSV original de Chase

const ENCABEZADO_CSV = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #";
// Como lo baja Chase: del más nuevo al más viejo, coma de más al final de cada fila (8 campos), fechas MM/DD/AAAA,
// importes con punto, descripciones entre comillas (con comas adentro y espacios de más) y el Nº de cheque en la 7ª.
const CSV_CHASE = [
  ENCABEZADO_CSV,
  'DEBIT,10/30/2026,"MONTHLY SERVICE FEE",-11.00,FEE_TRANSACTION,1015.00,,',
  'CHECK,10/30/2026,"CHECK 1785  ",-100.50,CHECK_PAID,1026.00,1785,',
  'CREDIT,10/05/2026,"ORIG CO NAME:ACME, INC.       ORIG ID:1 TRACE#:051000010659493 EED:261001   TRN: 2740659493TC",126.50,ACH_CREDIT,1126.50,,',
  'DSLIP,10/01/2026,"DEPOSIT  ID NUMBER 293053",1000.00,DEPOSIT,1000.00,,',
  "",
].join("\r\n");
const bytesCsv = (t: string) => new TextEncoder().encode(t);
const leeCsv = (t: string = CSV_CHASE) => leerChase(hojaDeCsvChase(bytesCsv(t)), { crudo: true, hoy: HOY });

test("CSV: se reconoce por contenido (no por la extensión) y no se confunde con un .xlsx", () => {
  assert.equal(esCsvChase(bytesCsv(CSV_CHASE)), true);
  assert.equal(esCsvChase(libroBradenton()), false, "un .xlsx empieza con PK");
  assert.equal(esCsvChase(bytesCsv("a,b,c\n1,2,3\n")), false);
  assert.equal(esCsvChase(bytesCsv("\uFEFF" + CSV_CHASE)), true, "con BOM");
});

test("CSV: lee tal cual el original de Chase (coma final, fechas MM/DD/AAAA, del más nuevo al más viejo)", () => {
  const l = leeCsv();
  assert.deepEqual(l.errores, []);
  assert.equal(l.filas.length, 4);
  // Cronológico: la más vieja primero.
  assert.deepEqual(l.filas.map((f) => f.fecha.toISOString().slice(0, 10)), ["2026-10-01", "2026-10-05", "2026-10-30", "2026-10-30"]);
  assert.deepEqual(l.filas.map((f) => f.importeCentavos), [100000, 12650, -10050, -1100]);
  assert.deepEqual(l.filas.map((f) => f.saldoCentavos), [100000, 112650, 102600, 101500]);
  const c = l.control[0];
  assert.equal(c.inicialCentavos, 0, "sin fila de saldo inicial: se deriva de la cadena (1000 − 1000)");
  assert.equal(c.finalCentavos, 101500);
  assert.equal(c.estado, "cuadra");
  assert.deepEqual(l.avisos, [], "venir del más nuevo al más viejo y sin saldo inicial es lo normal en el CSV: no se avisa");
  // La coma dentro de las comillas no parte el campo; las referencias salen de la descripción.
  assert.equal(l.filas[1].concepto.startsWith("ORIG CO NAME:ACME, INC."), true);
  assert.equal(l.filas[1].referencia, "TRN 2740659493");
  assert.equal(l.filas[2].referencia, "CHECK 1785");
  assert.equal(l.filas[2].concepto, "CHECK 1785", "los espacios de más del final se recortan");
  assert.equal(l.filas[0].referencia, "DEPOSIT 293053");
});

test("CSV: la fecha es MM/DD/AAAA (01/02 es el 2 de enero, no el 1 de febrero)", () => {
  const csv = [ENCABEZADO_CSV, 'DEBIT,01/02/2026,"X",-5.00,DEBIT_CARD,95.00,,', 'DEBIT,01/01/2026,"Y",100.00,DEPOSIT,100.00,,'].join("\n");
  const l = leeCsv(csv);
  assert.deepEqual(l.errores, []);
  assert.deepEqual(l.filas.map((f) => f.fecha.toISOString().slice(0, 10)), ["2026-01-01", "2026-01-02"]);
});

test("CSV: un Balance que no encadena se informa y no se carga; un movimiento que falta también", () => {
  const roto = CSV_CHASE.replace("1026.00", "1030.00");
  assert.match(leeCsv(roto).errores.join(" "), /Balance no cierra/);
  const sinUno = CSV_CHASE.split("\r\n").filter((l) => !l.includes("ACME")).join("\r\n");
  assert.ok(leeCsv(sinUno).errores.length > 0);
});

test("CSV: errores claros (fecha imposible, importe en otro formato, sin encabezado)", () => {
  assert.throws(() => leeCsv(CSV_CHASE.replace("10/05/2026", "13/05/2026")), /fecha inválida/);
  assert.throws(() => leeCsv(CSV_CHASE.replace("126.50,ACH_CREDIT", '"1.234,56",ACH_CREDIT')), /no pude leer el importe/);
  assert.throws(() => hojaDeCsvChase(bytesCsv("a,b\n1,2\n")), /No encontré la fila de encabezados del CSV de Chase/);
});

test("CSV: partirCsv respeta comillas, comillas dobles y saltos de línea dentro del campo", () => {
  assert.deepEqual(partirCsv('a,"b,c","d ""e""",\r\nf,"g\nh",,'), [["a", "b,c", 'd "e"', ""], ["f", "g\nh", "", ""]]);
});

test("CSV: pasa por el mismo camino de carga que la pestaña (cuenta, USD, unidad, SIN CLASIFICAR) y resubir no duplica", () => {
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTA_OK]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const filas = armarFilasACargar(leeCsv(), CONFIG, r.cuentas);
  assert.ok(filas.every((f) => f.bancoYCuenta === "CHASE BRADENTON" && f.moneda === "USD" && f.unidadNegocio === "BRADENTON" && f.clasificacion === "SIN CLASIFICAR"));
  assert.equal(planificarCarga(filas, [], CONFIG.etiqueta).nuevas.length, 4);
  assert.equal(planificarCarga(filas, comoExistentes(filas), CONFIG.etiqueta).nuevas.length, 0);
});

test("la acción: el .csv solo lo acepta Bradenton (Chase); Perú sigue aceptando solo .xlsx", () => {
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  assert.match(src, /const aceptaCsv = config\.lector === "chase"/);
  assert.match(src, /El archivo tiene que ser un \.xlsx \(libro PF\) o el \.csv de Chase\./);
  assert.match(src, /: "El archivo tiene que ser un \.xlsx\."/);
  assert.match(src, /leerChase\(hoja, \{ crudo \}\)/);
  assert.equal(aceptaDeEmpresa("bradenton"), ".xlsx,.csv");
  assert.equal(aceptaDeEmpresa("havanna-peru"), ".xlsx");
  assert.match(textoSubidaExtractoEmpresa("bradenton", MAX_BYTES_HAVANNA_PERU, MAX_FILAS_HAVANNA_PERU), /\.csv original de Chase \(\.xlsx o \.csv,/);
});

// ------------------------------------------------------------------ el CSV REAL de Romina (se omite si no está en esta máquina)

const CSV_REAL = process.env.CSV_BRADENTON ?? "C:/Users/Usuario/Downloads/Chase3255_Activity_20261111 (1).csv";

test("CSV REAL (Chase3255_Activity_20261111): 182 movimientos, 67.197,91 + 19.911,20 = 87.109,11, sin avisos", { skip: !existsSync(CSV_REAL) }, () => {
  const bytes = new Uint8Array(readFileSync(CSV_REAL));
  assert.equal(esCsvChase(bytes), true);
  const l = leerChase(hojaDeCsvChase(bytes), { crudo: true, hoy: HOY });
  assert.deepEqual(l.errores, []);
  assert.deepEqual(l.avisos, []);
  assert.equal(l.filas.length, 182);
  const c = l.control[0];
  assert.equal(c.inicialCentavos, 6719791);
  assert.equal(c.movimientosCentavos, 1991120);
  assert.equal(c.finalCentavos, 8710911);
  assert.equal(c.estado, "cuadra");
  // La más vieja primero (el CSV viene al revés): el depósito 293053 del 1/10, y la última es la del 30/10.
  assert.equal(l.filas[0].referencia, "DEPOSIT 293053");
  assert.equal(l.filas[0].fecha.toISOString().slice(0, 10), "2026-10-01");
  assert.equal(l.filas[181].fecha.toISOString().slice(0, 10), "2026-10-30");
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTA_OK]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const filas = armarFilasACargar(l, CONFIG, r.cuentas);
  assert.equal(errorFechasFueraDelPeriodo(filas, "2026-10"), null);
  assert.equal(new Set(filas.map((f) => f.clave)).size, 182, "claves únicas");
  assert.equal(planificarCarga(filas, [], CONFIG.etiqueta).nuevas.length, 182);
  assert.equal(planificarCarga(filas, comoExistentes(filas), CONFIG.etiqueta).nuevas.length, 0, "CSV → CSV: resubir no duplica");
});

test("CSV REAL vs libro: las dos fuentes traen los mismos 182 movimientos (fecha e importe), pero NO las mismas claves", { skip: !existsSync(CSV_REAL) || !existsSync(LIBRO_NOVIEMBRE) }, () => {
  const csv = leerChase(hojaDeCsvChase(new Uint8Array(readFileSync(CSV_REAL))), { crudo: true, hoy: HOY });
  const sel = seleccionarPestanaHavannaPeru(new Uint8Array(readFileSync(LIBRO_NOVIEMBRE)), OCTUBRE, undefined, DETECTOR_CHASE);
  assert.equal(sel.tipo, "elegida");
  if (sel.tipo !== "elegida") return;
  const libro = leerChase(sel.hoja, { hoy: HOY });
  const par = (f: { fecha: Date; importeCentavos: number }) => `${f.fecha.toISOString().slice(0, 10)}|${f.importeCentavos}`;
  const contar = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  assert.deepEqual([...contar(csv.filas.map(par))].sort(), [...contar(libro.filas.map(par))].sort(), "mismos movimientos");
  assert.equal(csv.control[0].finalCentavos, libro.control[0].finalCentavos);
  // Pero el Balance intermedio del libro lo reordenó Kike dentro de cada día y 44 descripciones vienen de otra exportación:
  // las claves (que incluyen el saldo y el concepto) no coinciden. Mezclar las dos fuentes en el mismo mes se frena (no duplica).
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTA_OK]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const delLibro = armarFilasACargar(libro, CONFIG, r.cuentas);
  const delCsv = armarFilasACargar(csv, CONFIG, r.cuentas);
  const plan = planificarCarga(delCsv, comoExistentes(delLibro), CONFIG.etiqueta);
  assert.equal(plan.cantidadYaCargadas, 0);
  assert.ok(plan.bloqueo && /ya tienen movimientos cargados/.test(plan.bloqueo), "se bloquea: no se carga nada");
});
