import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { MONEDA_PREDETERMINADA } from "@/lib/conteoMovimientos";
import {
  centavosEnPesos,
  compararMonedas,
  formatearConMoneda,
  hayOtraMoneda,
  lineasDeTotal,
  normalizarMoneda,
  prefijoMoneda,
  simboloMoneda,
  sumarPorMoneda,
  totalEnPesos,
  unirTotales,
} from "@/lib/moneda";
import { formatearImporteConCentavos } from "@/app/ejecucion/formato";
import TotalesPorMoneda from "@/app/ejecucion/TotalesPorMoneda";
import { mapearMovimiento, sumarImporteDeUnidades, totalesVisibles, vistaDeLaSemana } from "@/lib/ejecucionVista";
import { SIN_FILTROS } from "@/lib/filtrosEjecucion";
import { construirExcelMovimientos } from "@/lib/ejecucionExcel";
import { sumarTotalesSemanales, sumarTotalesSemanalesPorMoneda } from "@/lib/ejecucionMes";

// Ejecución POR MONEDA: el TOTAL no suma pesos con soles con dólares, cada importe lleva el símbolo de su
// moneda, y para una empresa en pesos TODO sale carácter por carácter como antes. Real del Reporte,
// chequeos y cierre siguen contando solo pesos.

const raiz = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");

// ---------- El formato de pesos de antes, copiado literalmente de lo que mostraban las pantallas ----------
// (`$${formatearImporteConCentavos(x)}` en TablaMovimientos, PanelImputacion y las 3 pantallas de Ejecución.)
const formatoDePesosDeAntes = (x: number) => `$${formatearImporteConCentavos(x)}`;
// Clases del TOTAL de antes: negativo / positivo / cero.
const claseDeAntes = (x: number) =>
  `tabular text-2xl font-semibold ${x < 0 ? "text-negative" : x > 0 ? "text-positive" : "text-ink"}`;

const VALORES_EN_PESOS = [
  0, 0.01, -0.01, 1, -1, 12.5, -12.5, 999.99, 1000, -1000, 1234.56, -1234.56, 98765432.1, -98765432.1,
  307760513, 684679266, 684679266.5, -79105.39, 0.005, -0.005, 1e9, -1e9, 123456789012.34,
];

// ---------- lib/moneda.ts ----------

test("pesos: el texto es IDÉNTICO al de antes ('$' pegado, signo, separadores) para todos los valores", () => {
  for (const v of VALORES_EN_PESOS) {
    assert.equal(formatearConMoneda(v, "ARS"), formatoDePesosDeAntes(v), `ARS ${v}`);
    assert.equal(formatearConMoneda(v, undefined), formatoDePesosDeAntes(v), `sin moneda ${v}`);
    assert.equal(formatearConMoneda(v, null), formatoDePesosDeAntes(v), `null ${v}`);
    assert.equal(formatearConMoneda(v, ""), formatoDePesosDeAntes(v), `vacía ${v}`);
    assert.equal(formatearConMoneda(v, "ars"), formatoDePesosDeAntes(v), `minúsculas ${v}`);
    assert.equal(`${prefijoMoneda("ARS")}${formatearImporteConCentavos(v)}`, formatoDePesosDeAntes(v));
  }
});

test("pesos: ejemplos concretos tal como se ven hoy", () => {
  assert.equal(formatearConMoneda(1234.56, "ARS"), "$1.234,56");
  assert.equal(formatearConMoneda(-1234.56, "ARS"), "$-1.234,56");
  assert.equal(formatearConMoneda(0, "ARS"), "$0,00");
  assert.equal(formatearConMoneda(307760513, "ARS"), "$307.760.513,00");
  assert.equal(formatearConMoneda(684679266, "ARS"), "$684.679.266,00");
});

test("símbolos: ARS '$', PEN 'S/', USD 'US$'; una moneda desconocida muestra su código", () => {
  assert.equal(simboloMoneda("ARS"), "$");
  assert.equal(simboloMoneda("PEN"), "S/");
  assert.equal(simboloMoneda("USD"), "US$");
  assert.equal(simboloMoneda(undefined), "$");
  assert.equal(simboloMoneda("EUR"), "EUR");
  assert.equal(formatearConMoneda(-70567.43, "PEN"), "S/ -70.567,43");
  assert.equal(formatearConMoneda(-8537.96, "USD"), "US$ -8.537,96");
  assert.equal(formatearConMoneda(1500, "usd"), "US$ 1.500,00");
  assert.equal(prefijoMoneda("PEN"), "S/ ");
});

test("la moneda predeterminada es la de siempre (pesos) y se reutiliza", () => {
  assert.equal(MONEDA_PREDETERMINADA, "ARS");
  assert.equal(normalizarMoneda(undefined), MONEDA_PREDETERMINADA);
  assert.equal(normalizarMoneda("  pen "), "PEN");
  assert.equal(hayOtraMoneda(["ARS", undefined, null, ""]), false);
  assert.equal(hayOtraMoneda(["ARS", "PEN"]), true);
});

test("orden de monedas: pesos primero, después por código", () => {
  assert.deepEqual(["USD", "PEN", "ARS"].sort(compararMonedas), ["ARS", "PEN", "USD"]);
});

// ---------- Totales: nunca se mezclan monedas ----------

test("el caso de Havanna Perú: soles y dólares NO se suman como si fueran pesos", () => {
  const totales = sumarPorMoneda([
    { moneda: "PEN", centavos: -7056743 },
    { moneda: "USD", centavos: -853796 },
  ]);
  assert.deepEqual(totales, [
    { moneda: "PEN", centavos: -7056743 },
    { moneda: "USD", centavos: -853796 },
  ]);
  // Ninguna entrada vale la suma cruzada que mostraba la pantalla (-79.105,39).
  assert.equal(totales.some((t) => t.centavos === -7910539), false);
  const lineas = lineasDeTotal(totales);
  assert.deepEqual(lineas.map((l) => l.texto), ["S/ -70.567,43", "US$ -8.537,96"]);
  assert.equal(JSON.stringify(lineas).includes("79.105"), false);
  // Sin pesos, el total en pesos es 0: alimenta a totalImporte sin ensuciarlo.
  assert.equal(totalEnPesos(totales), 0);
  assert.equal(centavosEnPesos(totales), 0);
});

test("semana mezclada: una línea por moneda, pesos primero, cada una con lo suyo", () => {
  const totales = sumarPorMoneda([
    { moneda: "USD", centavos: -100 },
    { moneda: "ARS", centavos: 250050 },
    { moneda: "PEN", centavos: 5 },
    { moneda: "ARS", centavos: -50 },
    { moneda: "PEN", centavos: 10 },
  ]);
  assert.deepEqual(totales, [
    { moneda: "ARS", centavos: 250000 },
    { moneda: "PEN", centavos: 15 },
    { moneda: "USD", centavos: -100 },
  ]);
  assert.equal(totalEnPesos(totales), 2500);
});

test("la suma es en centavos enteros (sin deriva de coma flotante) y las filas sin moneda son pesos", () => {
  assert.deepEqual(sumarPorMoneda([{ centavos: 10 }, { moneda: "ARS", centavos: 20 }]), [{ moneda: "ARS", centavos: 30 }]);
  assert.deepEqual(sumarPorMoneda([]), []);
});

test("total del mes: por moneda, semana a semana, y en pesos da lo mismo que la suma de antes", () => {
  const semanas = [
    [{ moneda: "ARS", centavos: 1010 }],
    [{ moneda: "ARS", centavos: 2020 }, { moneda: "PEN", centavos: 500 }],
    [{ moneda: "PEN", centavos: -200 }, { moneda: "USD", centavos: 99 }],
  ];
  assert.deepEqual(sumarTotalesSemanalesPorMoneda(semanas), [
    { moneda: "ARS", centavos: 3030 },
    { moneda: "PEN", centavos: 300 },
    { moneda: "USD", centavos: 99 },
  ]);
  assert.deepEqual(unirTotales(semanas), sumarTotalesSemanalesPorMoneda(semanas));
  // Solo pesos: igual que la suma por semana de antes.
  const soloPesos = [10.1, 20.2, -5.05];
  assert.equal(
    totalEnPesos(sumarTotalesSemanalesPorMoneda(soloPesos.map((n) => [{ moneda: "ARS", centavos: Math.round(n * 100) }]))),
    sumarTotalesSemanales(soloPesos)
  );
});

// ---------- El TOTAL de las pantallas: pesos idéntico a antes ----------

test("TOTAL en pesos: una línea con el mismo texto y las mismas clases de antes, para todos los valores", () => {
  for (const v of VALORES_EN_PESOS) {
    const centavos = Math.round(v * 100);
    const lineas = lineasDeTotal([{ moneda: "ARS", centavos }]);
    assert.equal(lineas.length, 1);
    assert.equal(lineas[0].texto, formatoDePesosDeAntes(centavos / 100), `texto ${v}`);
  }
});

test("TOTAL sin movimientos (o solo ignorados): '$0,00' como antes", () => {
  const lineas = lineasDeTotal([]);
  assert.deepEqual(lineas.map((l) => l.texto), ["$0,00"]);
  assert.equal(lineas[0].signo, "cero");
});

function htmlDeAntes(totalImporte: number) {
  // El <p> que tenían las 4 pantallas antes de este cambio.
  return renderToStaticMarkup(
    createElement("p", { className: claseDeAntes(totalImporte) }, `$${formatearImporteConCentavos(totalImporte)}`)
  );
}

test("TOTAL en pesos: el HTML renderizado es idéntico al de antes (positivo, negativo y cero)", () => {
  for (const v of [1234.56, -79105.39, 0, 307760513, -0.01]) {
    const nuevo = renderToStaticMarkup(createElement(TotalesPorMoneda, { totales: [{ moneda: "ARS", centavos: Math.round(v * 100) }] }));
    assert.equal(nuevo, htmlDeAntes(v), `valor ${v}`);
  }
  assert.equal(renderToStaticMarkup(createElement(TotalesPorMoneda, { totales: [] })), htmlDeAntes(0));
});

test("TOTAL semana solo PEN/USD: dos líneas, ninguna en pesos; semana mezclada: tres líneas", () => {
  const soloPeru = renderToStaticMarkup(
    createElement(TotalesPorMoneda, {
      totales: [
        { moneda: "PEN", centavos: -7056743 },
        { moneda: "USD", centavos: -853796 },
      ],
    })
  );
  assert.match(soloPeru, /S\/ -70\.567,43/);
  assert.match(soloPeru, /US\$ -8\.537,96/);
  assert.equal(soloPeru.includes("$0,00"), false);
  assert.equal((soloPeru.match(/<p /g) ?? []).length, 2);
  assert.equal(soloPeru.includes("79.105"), false);

  const mezclada = renderToStaticMarkup(
    createElement(TotalesPorMoneda, {
      totales: [
        { moneda: "ARS", centavos: 123456 },
        { moneda: "PEN", centavos: -7056743 },
        { moneda: "USD", centavos: 100 },
      ],
    })
  );
  assert.equal((mezclada.match(/<p /g) ?? []).length, 3);
  assert.ok(mezclada.indexOf("$1.234,56") < mezclada.indexOf("S/ ") && mezclada.indexOf("S/ ") < mezclada.indexOf("US$ "));
});

// ---------- mapearMovimiento: la moneda viaja y lo demás queda igual ----------

const fila = {
  id: "m1",
  fecha: new Date("2026-10-05T00:00:00Z"),
  concepto: "PAGO",
  importe: "-1000.00",
  bancoYCuenta: "MACRO 599",
  clasificacion: "PROV",
  unidadNegocio: "SPP",
  detalle: null,
  ignorado: false,
  sugeridaPorSistema: false,
  chequeIvaAmbiguo: false,
  unidadSugeridaPorSistema: false,
  desglose: [] as { id: string; unidadNegocio: string; importe: unknown }[],
};

test("mapearMovimiento: sin moneda es pesos; con moneda la lleva; las demás claves no cambian", () => {
  const ars = mapearMovimiento(fila);
  assert.equal(ars.moneda, "ARS");
  assert.equal(mapearMovimiento({ ...fila, moneda: "ARS" }).moneda, "ARS");
  assert.equal(mapearMovimiento({ ...fila, moneda: "PEN" }).moneda, "PEN");
  assert.equal(mapearMovimiento({ ...fila, moneda: "USD" }, undefined, { verSaldo: true, }).moneda, "USD");
  const { moneda: _m, ...resto } = ars;
  void _m;
  assert.deepEqual(Object.keys(resto), [
    "id", "fecha", "concepto", "importe", "bancoYCuenta", "clasificacion", "unidadNegocio", "detalle", "ignorado",
    "sugeridaPorSistema", "chequeIvaAmbiguo", "unidadSugeridaPorSistema", "desglose",
  ]);
  assert.equal(resto.importe, -1000);
});

// ---------- Consultas (con la base simulada) ----------

test("sumarImporteDeUnidades: agrupa por moneda en la base y devuelve un total por moneda", async () => {
  let sqlVisto = "";
  const original = prisma.$queryRaw;
  (prisma as unknown as { $queryRaw: unknown }).$queryRaw = async (strings: TemplateStringsArray) => {
    sqlVisto = strings.join("?");
    return [
      { moneda: "USD", total: "-8537.96" },
      { moneda: "PEN", total: "-70567.43" },
    ];
  };
  try {
    const totales = await sumarImporteDeUnidades("ej1", ["HAVANNA PERU"]);
    assert.deepEqual(totales, [
      { moneda: "PEN", centavos: -7056743 },
      { moneda: "USD", centavos: -853796 },
    ]);
    assert.match(sqlVisto, /GROUP BY x\.moneda/);
    assert.match(sqlVisto, /SELECT mb\.moneda, mb\.importe/);
    assert.match(sqlVisto, /SELECT mb\.moneda, d\.importe/);
    assert.equal(await sumarImporteDeUnidades("ej1", []).then((t) => t.length), 0);
  } finally {
    (prisma as unknown as { $queryRaw: unknown }).$queryRaw = original;
  }
});

test("vistaDeLaSemana: totalCentavos sigue siendo el total en pesos y totalesPorMoneda separa cada moneda", async () => {
  const filas = [
    { id: "a", fecha: new Date("2026-10-05T00:00:00Z"), concepto: "x", bancoYCuenta: "SANT 1", moneda: "ARS", importe: 100.5, saldo: null, clasificacion: "COBRANZAS", unidadNegocio: "U", ignorado: false },
    { id: "b", fecha: new Date("2026-10-05T00:00:00Z"), concepto: "y", bancoYCuenta: "BBVA PERÚ SOLES", moneda: "PEN", importe: -70567.43, saldo: null, clasificacion: "COBRANZAS", unidadNegocio: "U", ignorado: false },
    { id: "c", fecha: new Date("2026-10-06T00:00:00Z"), concepto: "z", bancoYCuenta: "BBVA PERÚ USD", moneda: "USD", importe: -8537.96, saldo: null, clasificacion: "COBRANZAS", unidadNegocio: "U", ignorado: false },
    { id: "d", fecha: new Date("2026-10-06T00:00:00Z"), concepto: "w", bancoYCuenta: "BBVA PERÚ USD", moneda: "USD", importe: -999, saldo: null, clasificacion: "COBRANZAS", unidadNegocio: "U", ignorado: true },
    { id: "e", fecha: new Date("2026-10-07T00:00:00Z"), concepto: "v", bancoYCuenta: "SANT 1", moneda: "ARS", importe: -0.5, saldo: null, clasificacion: "COBRANZAS", unidadNegocio: "U", ignorado: false },
  ];
  const mov = prisma.movimientoBancario as unknown as { findMany: unknown };
  const original = mov.findMany;
  mov.findMany = async () => filas;
  try {
    const vista = await vistaDeLaSemana("ej1", SIN_FILTROS);
    assert.equal(vista.cantidad, 5); // los ignorados siguen visibles en la tabla
    assert.equal(vista.totalCentavos, 10000); // solo pesos: 100,50 - 0,50
    assert.deepEqual(vista.totalesPorMoneda, [
      { moneda: "ARS", centavos: 10000 },
      { moneda: "PEN", centavos: -7056743 },
      { moneda: "USD", centavos: -853796 }, // el ignorado (-999) no cuenta
    ]);
  } finally {
    mov.findMany = original;
  }
});

test("vistaDeLaSemana de una empresa en pesos: un solo total, idéntico al de antes", async () => {
  const filas = [100.1, -50.05, 20].map((importe, i) => ({
    id: `m${i}`, fecha: new Date("2026-10-05T00:00:00Z"), concepto: "x", bancoYCuenta: "MACRO 599", moneda: "ARS",
    importe, saldo: null, clasificacion: "C", unidadNegocio: "U", ignorado: false,
  }));
  const mov = prisma.movimientoBancario as unknown as { findMany: unknown };
  const original = mov.findMany;
  mov.findMany = async () => filas;
  try {
    const vista = await vistaDeLaSemana("ej1", SIN_FILTROS);
    assert.deepEqual(vista.totalesPorMoneda, [{ moneda: "ARS", centavos: 7005 }]);
    assert.equal(vista.totalCentavos / 100, 70.05);
  } finally {
    mov.findMany = original;
  }
});

test("totalesVisibles: sin ignorados y sin mezclar", () => {
  assert.deepEqual(
    totalesVisibles([
      { ignorado: false, moneda: "ARS", importeCentavos: 100 },
      { ignorado: true, moneda: "ARS", importeCentavos: 900 },
      { ignorado: false, moneda: "PEN", importeCentavos: 5 },
    ]),
    [{ moneda: "ARS", centavos: 100 }, { moneda: "PEN", centavos: 5 }]
  );
});

// ---------- Excel ----------

function movExcel(extra: Partial<Parameters<typeof mapearMovimiento>[0]> = {}) {
  return mapearMovimiento({ ...fila, importe: -1234.5, ...extra });
}
async function hojaDe(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets[0];
}

test("Excel de una semana en pesos: las mismas columnas de siempre (sin columna Moneda)", async () => {
  const hoja = await hojaDe(await construirExcelMovimientos([movExcel(), movExcel({ moneda: "ARS" })], false));
  assert.deepEqual((hoja.getRow(1).values as unknown[]).slice(1), [
    "Fecha", "Banco y cuenta", "Concepto", "Importe", "Clasificación", "Unidad de negocio", "Prorrateo", "Detalle",
  ]);
  assert.equal(hoja.getRow(2).getCell(4).value, -1234.5);
});

test("Excel con PEN/USD: columna Moneda después de Importe, importes siguen siendo números", async () => {
  const hoja = await hojaDe(
    await construirExcelMovimientos([movExcel({ moneda: "PEN" }), movExcel({ moneda: "USD", importe: "-8.5" }), movExcel()], false)
  );
  assert.deepEqual((hoja.getRow(1).values as unknown[]).slice(1), [
    "Fecha", "Banco y cuenta", "Concepto", "Importe", "Moneda", "Clasificación", "Unidad de negocio", "Prorrateo", "Detalle",
  ]);
  assert.equal(hoja.getRow(2).getCell(4).value, -1234.5);
  assert.equal(typeof hoja.getRow(3).getCell(4).value, "number");
  assert.deepEqual([2, 3, 4].map((f) => hoja.getRow(f).getCell(5).value), ["PEN", "USD", "ARS"]);
});

// ---------- (c) Real del Reporte, chequeos y cierre cuentan SOLO pesos ----------

function archivosFuente(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next" || nombre === "__tests__") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosFuente(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

test("REAL: nadie que arme el Real del Reporte pasa una moneda: todas las llamadas usan el valor por defecto (pesos)", () => {
  const FUNCIONES = ["calcularRealPorRubro", "calcularRealPorClasificacion", "calcularNoAsignadoDelPeriodo"];
  let llamadas = 0;
  for (const ruta of [...archivosFuente(join(raiz, "app")), ...archivosFuente(join(raiz, "lib"))]) {
    if (ruta.endsWith(join("lib", "reporte.ts"))) continue; // las definiciones
    const fuente = readFileSync(ruta, "utf8");
    for (const f of FUNCIONES) {
      for (const m of fuente.matchAll(new RegExp(`${f}\\(([^)]*)\\)`, "g"))) {
        llamadas++;
        const argumentos = m[1].split(",").map((a) => a.trim()).filter(Boolean);
        // Las tres reciben exactamente tres argumentos (sin la moneda opcional del final).
        assert.equal(argumentos.length, 3, `${ruta}: ${f}(${m[1]}) no debe pasar moneda`);
        assert.equal(/ARS|PEN|USD|moneda/i.test(m[1]), false, `${ruta}: ${f} con moneda`);
      }
    }
  }
  assert.ok(llamadas >= 4, "se encontraron las llamadas del Reporte");
});

test("REAL: las tres sumas de lib/reporte.ts filtran por moneda y por defecto es MONEDA_PREDETERMINADA", () => {
  const fuente = leer("lib", "reporte.ts");
  assert.equal((fuente.match(/moneda: string = MONEDA_PREDETERMINADA/g) ?? []).length, 3);
  assert.equal((fuente.match(/AND mb\.moneda = \$\{moneda\}/g) ?? []).length, 3);
});

test("CHEQUEOS de suma cero: solo movimientos en pesos", () => {
  const fuente = leer("app", "ejecucion", "actions.ts");
  const inicio = fuente.indexOf("async function chequeosSumaCeroDeEjecucion");
  const cuerpo = fuente.slice(inicio, fuente.indexOf("export async function calcularChequeosSumaCero"));
  assert.match(cuerpo, /moneda: MONEDA_PREDETERMINADA/);
});

test("CIERRE: los chequeos del cierre solo cuentan filas (en todas las monedas) y no suman ningún importe", () => {
  const fuente = leer("lib", "cierreEjecucionDb.ts");
  const inicio = fuente.indexOf("export async function contarParaCierreDeSemana");
  const cuerpo = fuente.slice(inicio);
  assert.equal(/SUM\(|_sum|importe|\.reduce\(/.test(cuerpo), false);
  assert.equal(/moneda/.test(cuerpo), false); // cuenta sin filtrar: una fila en soles sin clasificar también avisa
  const puro = leer("lib", "cierreEjecucion.ts");
  assert.equal(/importe/.test(puro), false);
  // El cierre no escribe ningún monto: solo cambia el estado de la semana.
  const acciones = leer("app", "ejecucion", "actions.ts");
  const cierre = acciones.slice(acciones.indexOf("export async function cerrarSemana"));
  assert.match(cierre, /data: \{ estado: "CERRADA", fechaCierre: new Date\(\), cerradoPorId: usuario\.id \}/);
});

test("el Excel y las pantallas usan lib/moneda.ts: no quedó el '$' fijo en el TOTAL ni en la tabla de movimientos", () => {
  for (const ruta of [
    ["app", "ejecucion", "TablaMovimientos.tsx"],
    ["app", "ejecucion", "PanelSugerenciasPendientes.tsx"],
    ["app", "ejecucion", "PanelDesgloseMovimiento.tsx"],
  ]) {
    const f = leer(...ruta);
    assert.equal(/\$\$\{formatear|>\$\{formatear|\$\$\{formatearImporteConCentavos/.test(f), false, ruta.join("/"));
  }
  for (const ruta of [
    ["app", "ejecucion", "[periodo]", "[numeroSemana]", "page.tsx"],
    ["app", "[empresa]", "[periodo]", "ejecucion", "[numeroSemana]", "page.tsx"],
    ["app", "[empresa]", "[periodo]", "ejecucion", "mes", "page.tsx"],
  ]) {
    assert.match(leer(...ruta), /<TotalesPorMoneda totales=\{datos\.totalesPorMoneda\} \/>/, ruta.join("/"));
  }
  // totalImporte sigue en lo que devuelven las consultas (el total en pesos).
  assert.match(leer("app", "ejecucion", "actions.ts"), /totalImporte: vista\.totalCentavos \/ 100/);
  assert.match(leer("app", "[empresa]", "[periodo]", "ejecucion", "datos.ts"), /totalImporte: totalEnPesos\(/);
});

