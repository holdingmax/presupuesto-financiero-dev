import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claveMovimiento,
  contarPorClave,
  monedaParaClave,
  separarNuevas,
  MONEDA_PREDETERMINADA,
  type CamposClave,
} from "@/lib/conteoMovimientos";
import { analizarContinuidad, verificarContinuidadSaldo, type FilaContinuidad } from "@/lib/extractos/continuidad";
import { ordenarPorCadenaDeSaldo, type FilaOrdenable } from "@/lib/ordenSaldo";
import { prisma } from "@/lib/prisma";
import { calcularNoAsignadoDelPeriodo, calcularRealPorClasificacion, calcularRealPorRubro } from "@/lib/reporte";

// Moneda por movimiento (paso 1 de los extractos propios por empresa). Lo que hay que garantizar:
// (1) la clave de lo ya cargado (todo en pesos) NO cambia ni un byte; (2) otra moneda no se confunde con
// pesos ni se pisa con un duplicado; (3) las sumas y las cadenas de saldo no mezclan monedas.

// ---- Claves de referencia: calculadas con claveMovimiento ANTES de este cambio (origin/main 86fcc22) ----
// y pegadas literalmente. Si alguna cambia, lo ya cargado se volvería a cargar como "nuevo".
const CASOS: { campos: CamposClave; claveHistorica: string }[] = [
  {
    campos: {
      fecha: new Date("2026-10-05T00:00:00Z"),
      importeCentavos: -123456,
      bancoYCuenta: "MACRO 599",
      concepto: "Débito Imp. Ley 25413 | Ref",
      nroReferencia: "00012345",
      saldoCentavos: 98765432,
    },
    claveHistorica: '["2026-10-05",-123456,"MACRO 599","DEBITO IMP. LEY 25413 | REF","00012345",98765432]',
  },
  {
    campos: {
      fecha: new Date("2026-10-06T00:00:00Z"),
      importeCentavos: 250000050,
      bancoYCuenta: "frances  891",
      concepto: "TRANSFERENCIA RECIBIDA",
      nroReferencia: null,
      saldoCentavos: null,
    },
    claveHistorica: '["2026-10-06",250000050,"FRANCES 891","TRANSFERENCIA RECIBIDA","",null]',
  },
  {
    campos: {
      fecha: new Date("2026-10-07T00:00:00Z"),
      importeCentavos: -5,
      bancoYCuenta: "GALICIA 336",
      concepto: "Comisión mantenimiento",
      nroReferencia: "  77 ",
      saldoCentavos: 0,
    },
    claveHistorica: '["2026-10-07",-5,"GALICIA 336","COMISION MANTENIMIENTO","77",0]',
  },
];

test("clave en pesos: byte a byte igual a la de antes, venga la moneda como venga", () => {
  for (const { campos, claveHistorica } of CASOS) {
    assert.equal(claveMovimiento(campos), claveHistorica, "sin moneda (como llamaba todo el código hasta hoy)");
    for (const moneda of [undefined, null, "", "ARS", "ars", " ARS "]) {
      assert.equal(claveMovimiento({ ...campos, moneda }), claveHistorica, `moneda ${JSON.stringify(moneda)}`);
    }
  }
});

test("clave en otra moneda: la misma clave de pesos más la moneda al final, y distinta de pesos y de otra moneda", () => {
  for (const { campos, claveHistorica } of CASOS) {
    const pen = claveMovimiento({ ...campos, moneda: "PEN" });
    const usd = claveMovimiento({ ...campos, moneda: "usd" });
    assert.notEqual(pen, claveHistorica);
    assert.notEqual(usd, claveHistorica);
    assert.notEqual(pen, usd);
    // Mismo prefijo: la moneda solo agrega un elemento (en mayúsculas) al final.
    assert.deepEqual(JSON.parse(pen), [...JSON.parse(claveHistorica), "PEN"]);
    assert.deepEqual(JSON.parse(usd), [...JSON.parse(claveHistorica), "USD"]);
  }
});

test("monedaParaClave: pesos y vacío no agregan nada; el resto, el código en mayúsculas", () => {
  assert.equal(MONEDA_PREDETERMINADA, "ARS");
  assert.deepEqual(monedaParaClave(undefined), []);
  assert.deepEqual(monedaParaClave(null), []);
  assert.deepEqual(monedaParaClave(""), []);
  assert.deepEqual(monedaParaClave("ARS"), []);
  assert.deepEqual(monedaParaClave("PEN"), ["PEN"]);
  assert.deepEqual(monedaParaClave(" usd "), ["USD"]);
});

test("reconocimiento de lo ya cargado: pesos con pesos; una fila en otra moneda no es duplicado de una en pesos", () => {
  const { campos } = CASOS[0];
  // En la base ya hay esa fila en pesos (la clave de la base se arma con la moneda guardada: "ARS").
  const enBase = contarPorClave([claveMovimiento({ ...campos, moneda: "ARS" })]);

  // El archivo trae la misma fila en pesos (sin moneda: así llaman hoy los lectores): ya cargada.
  const enPesos = separarNuevas([claveMovimiento(campos)], (c) => c, enBase);
  assert.equal(enPesos.cantidadYaCargadas, 1);
  assert.equal(enPesos.nuevas.length, 0);

  // Misma fecha, importe, cuenta, concepto y saldo pero en soles: es otro movimiento, se carga.
  const enSoles = separarNuevas([claveMovimiento({ ...campos, moneda: "PEN" })], (c) => c, enBase);
  assert.equal(enSoles.cantidadYaCargadas, 0);
  assert.equal(enSoles.nuevas.length, 1);

  // Y una resubida del mismo archivo en soles ya se reconoce contra lo cargado en soles.
  const solesEnBase = contarPorClave([claveMovimiento({ ...campos, moneda: "PEN" })]);
  const resubida = separarNuevas([claveMovimiento({ ...campos, moneda: "PEN" })], (c) => c, solesEnBase);
  assert.equal(resubida.cantidadYaCargadas, 1);
  assert.equal(resubida.nuevas.length, 0);
});

// ---- Continuidad de saldo ----

const dia = new Date(Date.UTC(2026, 9, 5));
const cont = (numeroFila: number, importe: number, saldo: number, moneda?: string): FilaContinuidad => ({
  numeroFila,
  fecha: dia,
  concepto: `mov ${numeroFila}`,
  importe,
  saldo,
  bancoYCuenta: "BCP 001",
  ...(moneda === undefined ? {} : { moneda }),
});

test("continuidad: sin moneda y con 'ARS' dan exactamente el mismo resultado que antes", () => {
  // Cadena con una ruptura a propósito (el tercer saldo no cierra) para que el resultado no sea vacío.
  const base = [
    { importe: -100, saldo: 900 },
    { importe: 50, saldo: 950 },
    { importe: -10, saldo: 900 },
  ];
  const sinMoneda = base.map((b, i) => cont(i + 1, b.importe, b.saldo));
  const conArs = base.map((b, i) => cont(i + 1, b.importe, b.saldo, "ARS"));
  assert.deepEqual(analizarContinuidad(conArs), analizarContinuidad(sinMoneda));
  assert.deepEqual(verificarContinuidadSaldo(conArs), verificarContinuidadSaldo(sinMoneda));
  assert.equal(verificarContinuidadSaldo(sinMoneda)[0].cantidad, 1);
});

test("continuidad: dos monedas de la misma cuenta son dos cadenas, no se mezclan", () => {
  // Intercaladas en el archivo. Cada moneda por separado encadena perfecto (saldo posterior).
  const filas: FilaContinuidad[] = [
    cont(1, -100, 900, "PEN"),
    cont(2, -5, 495, "USD"),
    cont(3, 50, 950, "PEN"),
    cont(4, -5, 490, "USD"),
  ];
  assert.deepEqual(verificarContinuidadSaldo(filas), []);
  const grupos = analizarContinuidad(filas);
  assert.equal(grupos.length, 2);
  assert.ok(grupos.every((g) => g.enlaces === 1 && g.rupturas.length === 0));

  // Contraprueba: sin distinguir la moneda (como antes) esas mismas filas SÍ darían rupturas.
  const sinDistinguir = filas.map(({ moneda: _m, ...resto }) => (void _m, resto));
  assert.ok(verificarContinuidadSaldo(sinDistinguir).length > 0);
});

// ---- Orden de la vista por cadena de saldo ----

type F = FilaOrdenable & { id: string };
const ord = (id: string, importe: number, saldo: number, moneda?: string): F => ({
  id,
  fecha: "2026-10-05",
  bancoYCuenta: "BCP 001",
  importeCentavos: importe,
  saldoCentavos: saldo,
  ...(moneda === undefined ? {} : { moneda }),
});
const ids = (filas: F[]) => filas.map((x) => x.id);

test("orden por saldo: pesos explícitos o sin moneda se ordenan igual que siempre", () => {
  // Cadena real a (+100 → 1100), b (-300 → 800), c (+50 → 850); llegan c, a, b.
  const sin = [ord("c", 5000, 85000), ord("a", 10000, 110000), ord("b", -30000, 80000)];
  const con = [ord("c", 5000, 85000, "ARS"), ord("a", 10000, 110000, "ARS"), ord("b", -30000, 80000, "ARS")];
  assert.deepEqual(ids(ordenarPorCadenaDeSaldo(sin)), ["a", "b", "c"]);
  assert.deepEqual(ids(ordenarPorCadenaDeSaldo(con)), ["a", "b", "c"]);
});

test("orden por saldo: otra moneda de la misma cuenta y día es otro grupo", () => {
  // Pesos: x (+100 → 1100) luego y (-300 → 800), llegan y, x. Dólares: z1 (+10 → 10) y z2 (+5 → 15).
  const entrada = [
    ord("y", -30000, 80000),
    ord("z2", 500, 1500, "USD"),
    ord("x", 10000, 110000),
    ord("z1", 1000, 1000, "USD"),
  ];
  // Cada moneda reordena solo dentro de sí misma y reutiliza las posiciones que ya ocupaba.
  assert.deepEqual(ids(ordenarPorCadenaDeSaldo(entrada)), ["x", "z1", "y", "z2"]);
  // Sin distinguir la moneda, el grupo mezclado no tiene una cadena única y quedaría como venía.
  const mezcladas = entrada.map(({ moneda: _m, ...resto }) => (void _m, resto));
  assert.deepEqual(ids(ordenarPorCadenaDeSaldo(mezcladas)), ["y", "z2", "x", "z1"]);
});

// ---- Sumas del Real (lib/reporte.ts): se prueban cambiando prisma.$queryRaw por un doble ----

type Llamada = { sql: string; valores: unknown[] };

async function conBaseSimulada<T>(
  responder: (sql: string) => unknown[],
  correr: () => Promise<T>
): Promise<{ resultado: T; llamadas: Llamada[] }> {
  const llamadas: Llamada[] = [];
  const original = prisma.$queryRaw;
  (prisma as unknown as { $queryRaw: unknown }).$queryRaw = async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join("?");
    llamadas.push({ sql, valores });
    return responder(sql);
  };
  try {
    return { resultado: await correr(), llamadas };
  } finally {
    (prisma as unknown as { $queryRaw: unknown }).$queryRaw = original;
  }
}

// Responde como la base: la consulta de clasificaciones guardadas (DISTINCT) y la de sumas.
const respuestaDeReal = (sql: string): unknown[] =>
  sql.includes("SELECT DISTINCT mb.clasificacion")
    ? [{ clasificacion: "COBRANZAS" }]
    : [{ periodo: "2026-10", clasificacion: "COBRANZAS", total: "1500.50", creditos: "2000.00", debitos: "-499.50" }];

test("calcularRealPorClasificacion: por defecto suma solo pesos y el resultado es el mismo de antes", async () => {
  const { resultado, llamadas } = await conBaseSimulada(respuestaDeReal, () =>
    calcularRealPorClasificacion(["2026-10"], ["HAVANNA"], ["COBRANZAS"])
  );
  const suma = llamadas.find((l) => !l.sql.includes("SELECT DISTINCT mb.clasificacion"))!;
  assert.match(suma.sql, /mb\.moneda = \?/);
  assert.ok(suma.valores.includes("ARS"), "la moneda se pasa como parámetro y es ARS");
  assert.equal(resultado.get("2026-10")!.neto.get("COBRANZAS"), 150050);
  assert.equal(resultado.get("2026-10")!.creditos.get("COBRANZAS"), 200000);
  assert.equal(resultado.get("2026-10")!.debitos.get("COBRANZAS"), -49950);
});

test("calcularRealPorClasificacion: con otra moneda filtra por esa moneda", async () => {
  const { llamadas } = await conBaseSimulada(respuestaDeReal, () =>
    calcularRealPorClasificacion(["2026-10"], ["HAVANNA PERU"], ["COBRANZAS"], "PEN")
  );
  const suma = llamadas.find((l) => !l.sql.includes("SELECT DISTINCT mb.clasificacion"))!;
  assert.ok(suma.valores.includes("PEN"));
  assert.ok(!suma.valores.includes("ARS"));
});

test("calcularRealPorRubro y calcularNoAsignadoDelPeriodo: filtran por moneda (pesos por defecto)", async () => {
  const responder = (sql: string): unknown[] =>
    sql.includes("SELECT DISTINCT mb.clasificacion") ? [{ clasificacion: "COBRANZAS" }] : [];
  const rubros = ["COBRANZAS"];

  const porRubro = await conBaseSimulada(responder, () => calcularRealPorRubro("2026-10", ["HAVANNA"], rubros));
  const sumaRubro = porRubro.llamadas.find((l) => !l.sql.includes("SELECT DISTINCT mb.clasificacion"))!;
  assert.match(sumaRubro.sql, /mb\.moneda = \?/);
  assert.ok(sumaRubro.valores.includes("ARS"));

  const noAsignado = await conBaseSimulada(responder, () => calcularNoAsignadoDelPeriodo("2026-10", rubros, ["HAVANNA"]));
  const sumaNoAsig = noAsignado.llamadas.find((l) => !l.sql.includes("SELECT DISTINCT mb.clasificacion"))!;
  assert.match(sumaNoAsig.sql, /mb\.moneda = \?/);
  assert.ok(sumaNoAsig.valores.includes("ARS"));

  const enSoles = await conBaseSimulada(responder, () =>
    calcularNoAsignadoDelPeriodo("2026-10", rubros, ["HAVANNA"], "PEN")
  );
  const sumaSoles = enSoles.llamadas.find((l) => !l.sql.includes("SELECT DISTINCT mb.clasificacion"))!;
  assert.ok(sumaSoles.valores.includes("PEN"));
});
