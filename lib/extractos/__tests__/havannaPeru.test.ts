import { test } from "node:test";
import assert from "node:assert/strict";
import { claveHavannaPeru, leerHavannaPeru } from "@/lib/extractos/havannaPeru";
import {
  leerPestanaHavannaPeru,
  listarPestanasMovimientos,
  seleccionarPestanaHavannaPeru,
} from "@/lib/extractos/havannaPeruPestanas";
import {
  MAX_BYTES_EXTRACTO,
  MAX_BYTES_HAVANNA_PERU,
  MAX_BYTES_MADRE,
  MAX_FILAS_EXTRACTO,
  MAX_FILAS_HAVANNA_PERU,
  MAX_FILAS_MADRE,
  verificarCantidadFilasHavannaPeru,
  verificarTamanoHavannaPeru,
} from "@/lib/extractos/limites";
import { ErrorExtracto } from "@/lib/extractos/tipos";
import {
  ENCABEZADO_ESTANDAR,
  HOJA1_DISTRACTOR,
  MOVS_OCTUBRE,
  SERIAL_1_NOV_2026,
  hojaMovimientos,
  libroCompleto,
  libroHavannaPeru,
  type OpcionesLibro,
} from "./fixtures/havannaPeru";

const HOY = new Date(Date.UTC(2026, 10, 10));
const OCTUBRE = { desde: new Date(Date.UTC(2026, 9, 1)), hasta: new Date(Date.UTC(2026, 9, 31)) };

function leerOct(libro: OpcionesLibro = {}, monedaCuenta: "PEN" | "USD" = "PEN") {
  const bytes = libroCompleto(libro);
  const hoja = leerPestanaHavannaPeru(bytes, "MOVIMIENTOS OCTUBRE 26");
  return leerHavannaPeru(hoja, { monedaCuenta, hoy: HOY });
}

const mensajeDeError = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof ErrorExtracto, "tiene que ser un ErrorExtracto con mensaje para el usuario");
    return e.message;
  }
  assert.fail("tenía que fallar");
};

// ---------------------------------------------------------------- lectura básica

test("mini-libro real: filas, moneda por fila, fechas, Nº Doc con ceros, causal, sin saldo", () => {
  const l = leerOct();
  assert.equal(l.filas.length, 5);
  assert.deepEqual(l.filas.map((f) => f.moneda), ["PEN", "PEN", "PEN", "USD", "USD"]); // Soles→PEN, USD→USD
  assert.deepEqual(l.filas.map((f) => f.fecha.toISOString().slice(0, 10)), [
    "2026-10-01", "2026-10-01", "2026-10-02", "2026-10-02", "2026-10-03",
  ]);
  assert.equal(l.filas[0].referencia, "0000221444", "conserva los ceros a la izquierda");
  assert.equal(l.filas[0].causal, "612", "Código va a causal");
  assert.equal(l.filas[0].importeCentavos, -100050);
  assert.ok(l.filas.every((f) => f.saldoCentavos === null));
  assert.deepEqual(l.avisos, []);
  assert.deepEqual(l.errores, []);
});

test("las columnas ignoradas (F. Valor, TC, DETALLE) y los pivots al costado no se mezclan", () => {
  const l = leerOct();
  // El pivot (K-L) trae "COBRANZAS CLIENTES"/123 en la primera fila: no entra en ningún campo.
  assert.ok(l.filas.every((f) => f.detalle === null));
  assert.ok(!l.filas.some((f) => f.concepto.includes("COBRANZAS CLIENTES")));
  assert.equal(l.filas.length, 5);
});

test("encabezado con tildes y mayúsculas distintas", () => {
  for (const enc of [
    ["MONEDA", "F. OPERACIÓN", "F. VALOR", "CÓDIGO", "Nº. DOC.", "CONCEPTO", "IMPORTE", "TC", "DETALLE"],
    ["moneda", "f. operacion", "f. valor", "codigo", "nº. doc.", "concepto", "importe", "tc", "detalle"],
    ["Moneda", "F. Operación", "F. Valor", "Código", "  Nº. Doc.  ", "Concepto", "Importe", "TC", "DETALLE"],
  ]) {
    const l = leerOct({ encabezado: enc });
    assert.equal(l.filas.length, 5, enc.join("|"));
    assert.equal(l.filas[0].referencia, "0000221444");
    assert.equal(l.filas[0].causal, "612");
  }
});

test("Nº Doc: tolera Nº, N°, No, Nro (y variantes con/sin punto)", () => {
  for (const nombre of ["Nº. Doc.", "N°. Doc.", "N° Doc", "No. Doc.", "No Doc", "Nro. Doc.", "NRO DOC", "Nº Doc.", "Nº. Documento"]) {
    const enc = [...ENCABEZADO_ESTANDAR];
    enc[4] = nombre;
    const l = leerOct({ encabezado: enc });
    assert.equal(l.filas.length, 5, nombre);
    assert.equal(l.filas[2].referencia, "0000221499", nombre);
  }
});

test("el encabezado puede estar más abajo (filas vacías antes)", () => {
  const l = leerOct({ filasAntes: 4 });
  assert.equal(l.filas.length, 5);
  assert.equal(l.filas[0].numeroFila, 6);
});

test("falta una columna obligatoria: error claro", () => {
  const enc = [...ENCABEZADO_ESTANDAR];
  enc[4] = "Referencia";
  const bytes = libroCompleto({ encabezado: enc });
  assert.throws(() => leerPestanaHavannaPeru(bytes, "MOVIMIENTOS OCTUBRE 26"), ErrorExtracto);
});

// ---------------------------------------------------------------- moneda

test("sin columna Moneda: usa la moneda de la cuenta y devuelve un aviso visible", () => {
  const solo = { movimientos: MOVS_OCTUBRE.filter((m) => m.mon === "Soles"), conMoneda: false };
  const l = leerOct(solo, "PEN");
  assert.equal(l.filas.length, 3);
  assert.ok(l.filas.every((f) => f.moneda === "PEN"));
  assert.ok(l.avisos.some((a) => a.includes("no tiene columna Moneda") && a.includes("PEN")));
  const lUsd = leerOct(solo, "USD");
  assert.ok(lUsd.filas.every((f) => f.moneda === "USD"));
  assert.ok(lUsd.avisos.some((a) => a.includes("USD")));
});

test("moneda desconocida o vacía en una fila: error con el número de fila", () => {
  const raro = { movimientos: MOVS_OCTUBRE.map((m, i) => (i === 2 ? { ...m, mon: "EUR" } : m)) };
  const msg = mensajeDeError(() => leerOct(raro));
  assert.match(msg, /Fila 4.*EUR/);
  const vacia = { movimientos: MOVS_OCTUBRE.map((m, i) => (i === 0 ? { ...m, mon: "" } : m)) };
  assert.match(mensajeDeError(() => leerOct(vacia)), /Fila 2.*no tiene moneda/);
});

// ---------------------------------------------------------------- errores de datos

test("fecha inválida (texto que parece fecha, serial absurdo): error con la fila", () => {
  assert.match(mensajeDeError(() => leerOct({ fechaInvalida: "31/02/2026" })), /Fila 3.*fecha inválida/);
  assert.match(mensajeDeError(() => leerOct({ fechaInvalida: 9_999_999 })), /Fila 3.*fecha inválida/);
});

test("fila sin fecha pegada al encabezado: error explícito, no pérdida silenciosa", () => {
  const msg = mensajeDeError(() => leerOct({ filaSinFechaPegada: true }));
  assert.match(msg, /Fila 2.*no tiene fecha/);
});

test("fila sin fecha en el medio de los datos: no se descarta en silencio", () => {
  const hoja = hojaMovimientos();
  hoja[3][1] = null; // la 3ª fila de datos pierde la fecha
  const bytes = libroHavannaPeru([{ nombre: "MOVIMIENTOS OCTUBRE 26", filas: hoja }]);
  const h = leerPestanaHavannaPeru(bytes, "MOVIMIENTOS OCTUBRE 26");
  assert.throws(() => leerHavannaPeru(h, { monedaCuenta: "PEN", hoy: HOY }), ErrorExtracto);
});

test("Nº Doc vacío: error (es obligatorio)", () => {
  const sin = { movimientos: MOVS_OCTUBRE.map((m, i) => (i === 1 ? { ...m, doc: "" } : m)) };
  assert.match(mensajeDeError(() => leerOct(sin)), /Fila 3.*Nº\. Doc/);
});

test("importe ilegible: error con la fila", () => {
  const mal = { movimientos: MOVS_OCTUBRE.map((m, i) => (i === 0 ? { ...m, importe: "-4,571.21" as unknown as number } : m)) };
  assert.match(mensajeDeError(() => leerOct(mal)), /Fila 2.*importe/);
});

// ---------------------------------------------------------------- pie

test("pie que cuadra: control por moneda en soles y USD", () => {
  const l = leerOct();
  assert.deepEqual(l.control.map((c) => [c.moneda, c.estado, c.diferenciaCentavos]), [
    ["PEN", "cuadra", 0],
    ["USD", "cuadra", 0],
  ]);
  const pen = l.control.find((c) => c.moneda === "PEN")!;
  assert.equal(pen.inicialCentavos, 500000);
  assert.equal(pen.movimientosCentavos, -100050 - 25025 + 300000);
  assert.equal(pen.finalCentavos, 500000 + pen.movimientosCentavos);
  assert.deepEqual(l.errores, []);
});

test("pie que NO cuadra: se marca como error (no se oculta) y dice la moneda y la diferencia", () => {
  const l = leerOct({ saldoFinalPen: 1234.56 });
  assert.equal(l.control.find((c) => c.moneda === "PEN")!.estado, "no_cuadra");
  assert.equal(l.control.find((c) => c.moneda === "USD")!.estado, "cuadra");
  assert.ok(l.errores.some((e) => e.includes("no cuadra en PEN")));
  assert.ok(!l.errores.some((e) => e.includes("no cuadra en USD")));
  // Las filas igual se devuelven: la decisión de no cargar es de quien llama.
  assert.equal(l.filas.length, 5);
});

test("pie que no cuadra solo en USD", () => {
  const l = leerOct({ saldoFinalUsd: 1.01 });
  assert.ok(l.errores.some((e) => e.includes("no cuadra en USD")));
});

test("falta una fila del archivo pero el pie sigue igual: no cuadra", () => {
  const hoja = hojaMovimientos();
  hoja.splice(3, 1); // se pierde una fila de datos
  const bytes = libroHavannaPeru([{ nombre: "MOVIMIENTOS OCTUBRE 26", filas: hoja }]);
  const l = leerHavannaPeru(leerPestanaHavannaPeru(bytes, "MOVIMIENTOS OCTUBRE 26"), { monedaCuenta: "PEN", hoy: HOY });
  assert.ok(l.errores.length > 0);
});

test("sin pie: no se inventa un control; aviso visible", () => {
  const l = leerOct({ sinPie: true });
  assert.ok(l.control.every((c) => c.estado === "sin_pie"));
  assert.ok(l.avisos.some((a) => a.includes("Saldo Inicial / Saldo Final")));
  assert.deepEqual(l.errores, []);
});

// ---------------------------------------------------------------- pestañas

test("Hoja1 se ignora: no se usa la regla de nombre de leerXlsx", () => {
  const bytes = libroCompleto();
  const nombres = listarPestanasMovimientos(bytes).map((c) => c.nombre);
  assert.ok(!nombres.includes("Hoja1"));
  assert.ok(!nombres.includes("PRESUPUESTO MES A MES"));
  assert.deepEqual(nombres, ["MOVIMIENTOS OCTUBRE 26", "MOVIMIENTOS NOVIEMBRE 26"]);
  const sel = seleccionarPestanaHavannaPeru(bytes, OCTUBRE);
  assert.equal(sel.tipo, "elegida");
});

test("una pestaña llamada Hoja1 que SÍ tiene movimientos no tiene trato especial: se elige por período", () => {
  const bytes = libroHavannaPeru([
    { nombre: "Hoja1", filas: hojaMovimientos({ movimientos: [{ mon: "Soles", dia: 0, cod: 1, doc: "0001", concepto: "A", importe: -1, serialBase: SERIAL_1_NOV_2026 }], sinPie: true }) },
    { nombre: "MOVIMIENTOS OCTUBRE 26", filas: hojaMovimientos() },
  ]);
  const sel = seleccionarPestanaHavannaPeru(bytes, OCTUBRE);
  assert.equal(sel.tipo, "elegida");
  if (sel.tipo === "elegida") assert.equal(sel.candidata.nombre, "MOVIMIENTOS OCTUBRE 26");
});

test("selección por período: octubre y noviembre", () => {
  const bytes = libroCompleto();
  const oct = seleccionarPestanaHavannaPeru(bytes, OCTUBRE);
  assert.equal(oct.tipo === "elegida" && oct.candidata.nombre, "MOVIMIENTOS OCTUBRE 26");
  if (oct.tipo === "elegida") {
    assert.equal(oct.candidata.filas, 5);
    assert.equal(oct.candidata.desde.toISOString().slice(0, 10), "2026-10-01");
    assert.equal(oct.candidata.hasta.toISOString().slice(0, 10), "2026-10-03");
    assert.equal(oct.hoja.nombre, "MOVIMIENTOS OCTUBRE 26");
  }
  const nov = seleccionarPestanaHavannaPeru(bytes, { desde: new Date(Date.UTC(2026, 10, 1)), hasta: new Date(Date.UTC(2026, 10, 30)) });
  assert.equal(nov.tipo === "elegida" && nov.candidata.nombre, "MOVIMIENTOS NOVIEMBRE 26");
});

test("varias candidatas en el período: devuelve la lista (con desde/hasta/filas) para el selector", () => {
  const bytes = libroHavannaPeru([
    { nombre: "MOVIMIENTOS OCTUBRE 26", filas: hojaMovimientos() },
    { nombre: "MOVIMIENTOS OCTUBRE 26 (copia)", filas: hojaMovimientos() },
  ]);
  const sel = seleccionarPestanaHavannaPeru(bytes, OCTUBRE);
  assert.equal(sel.tipo, "candidatas");
  if (sel.tipo === "candidatas") {
    assert.equal(sel.motivo, "varias_en_periodo");
    assert.equal(sel.candidatas.length, 2);
    assert.equal(sel.candidatas[0].filas, 5);
    assert.ok(sel.candidatas[0].desde instanceof Date && sel.candidatas[0].hasta instanceof Date);
  }
});

test("ninguna en el período: devuelve todas las pestañas de movimientos", () => {
  const bytes = libroCompleto();
  const sel = seleccionarPestanaHavannaPeru(bytes, { desde: new Date(Date.UTC(2026, 11, 1)), hasta: new Date(Date.UTC(2026, 11, 31)) });
  assert.equal(sel.tipo, "candidatas");
  if (sel.tipo === "candidatas") {
    assert.equal(sel.motivo, "ninguna_en_periodo");
    assert.equal(sel.candidatas.length, 2);
  }
});

test("una pestaña con fechas de dos meses no cuenta como 'del período'", () => {
  const movs = [...MOVS_OCTUBRE, { mon: "Soles", dia: 0, cod: 1, doc: "0000000009", concepto: "DE NOVIEMBRE", importe: -1, serialBase: SERIAL_1_NOV_2026 }];
  const bytes = libroHavannaPeru([{ nombre: "MOVIMIENTOS MIXTA", filas: hojaMovimientos({ movimientos: movs, sinPie: true }) }]);
  const sel = seleccionarPestanaHavannaPeru(bytes, OCTUBRE);
  assert.equal(sel.tipo, "candidatas");
});

test("el usuario eligió una pestaña en el selector: se lee esa directo", () => {
  const bytes = libroCompleto();
  const sel = seleccionarPestanaHavannaPeru(bytes, OCTUBRE, "MOVIMIENTOS NOVIEMBRE 26");
  assert.equal(sel.tipo === "elegida" && sel.hoja.nombre, "MOVIMIENTOS NOVIEMBRE 26");
  assert.throws(() => seleccionarPestanaHavannaPeru(bytes, OCTUBRE, "Hoja1"), ErrorExtracto);
});

test("libro sin ninguna pestaña de movimientos: lista vacía", () => {
  const bytes = libroHavannaPeru([{ nombre: "Hoja1", filas: HOJA1_DISTRACTOR }]);
  assert.deepEqual(listarPestanasMovimientos(bytes), []);
  const sel = seleccionarPestanaHavannaPeru(bytes, OCTUBRE);
  assert.equal(sel.tipo === "candidatas" && sel.candidatas.length, 0);
});

// ---------------------------------------------------------------- clave de reconocimiento

test("clave: la resubida del mismo mes da exactamente las mismas claves (no duplica)", () => {
  const a = leerOct().filas.map((f) => claveHavannaPeru(f, "HAVANNA PERU BCP"));
  const b = leerOct().filas.map((f) => claveHavannaPeru(f, "HAVANNA PERU BCP"));
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

test("clave: mismo movimiento con Nº Doc distinto da claves distintas", () => {
  const dos = {
    movimientos: [
      { mon: "Soles", dia: 0, cod: 527, doc: "0000000001", concepto: "ITF", importe: -1.45 },
      { mon: "Soles", dia: 0, cod: 527, doc: "0000000002", concepto: "ITF", importe: -1.45 },
    ],
    sinPie: true,
  };
  const claves = leerOct(dos).filas.map((f) => claveHavannaPeru(f, "HAVANNA PERU BCP"));
  assert.equal(new Set(claves).size, 2);
});

test("clave: la moneda forma parte (misma fila en PEN y en USD no chocan) y la cuenta también", () => {
  const dos = {
    movimientos: [
      { mon: "Soles", dia: 0, cod: 1, doc: "0000000001", concepto: "X", importe: -10 },
      { mon: "USD", dia: 0, cod: 1, doc: "0000000001", concepto: "X", importe: -10 },
    ],
    sinPie: true,
  };
  const filas = leerOct(dos).filas;
  const [pen, usd] = filas.map((f) => claveHavannaPeru(f, "HAVANNA PERU BCP"));
  assert.notEqual(pen, usd);
  assert.notEqual(pen, claveHavannaPeru(filas[0], "OTRA CUENTA"));
  assert.ok(JSON.parse(pen).includes("PEN"));
});

test("clave: sin saldo (null) y con el Nº Doc en nroReferencia", () => {
  const f = leerOct().filas[0];
  const c = JSON.parse(claveHavannaPeru(f, "HAVANNA PERU BCP"));
  assert.equal(c[0], "2026-10-01");
  assert.equal(c[1], -100050);
  assert.equal(c[4], "0000221444");
  assert.equal(c[5], null);
  assert.equal(c[6], "PEN");
});

// ---------------------------------------------------------------- topes propios

test("topes propios: ~4 MB y 3.000 filas, sin tocar los de siempre", () => {
  assert.equal(MAX_BYTES_HAVANNA_PERU, 4 * 1024 * 1024);
  assert.equal(MAX_FILAS_HAVANNA_PERU, 3000);
  assert.equal(MAX_BYTES_EXTRACTO, 1024 * 1024);
  assert.equal(MAX_FILAS_EXTRACTO, 1000);
  assert.equal(MAX_BYTES_MADRE, 2 * 1024 * 1024);
  assert.equal(MAX_FILAS_MADRE, 20000);
  assert.equal(verificarTamanoHavannaPeru(MAX_BYTES_HAVANNA_PERU).ok, true);
  assert.equal(verificarTamanoHavannaPeru(MAX_BYTES_HAVANNA_PERU + 1).ok, false);
  assert.equal(verificarCantidadFilasHavannaPeru(3000).ok, true);
  const r = verificarCantidadFilasHavannaPeru(3001);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.error.includes("3.000"));
});

test("el camino rechaza una pestaña con más de 3.000 filas", () => {
  const muchas = Array.from({ length: 3001 }, (_, i) => ({
    mon: "Soles", dia: i % 28, cod: 1, doc: String(i).padStart(10, "0"), concepto: "X", importe: -1,
  }));
  const bytes = libroHavannaPeru([{ nombre: "MOVIMIENTOS OCTUBRE 26", filas: hojaMovimientos({ movimientos: muchas, sinPie: true }) }]);
  assert.match(mensajeDeError(() => leerPestanaHavannaPeru(bytes, "MOVIMIENTOS OCTUBRE 26")), /3\.000/);
});
