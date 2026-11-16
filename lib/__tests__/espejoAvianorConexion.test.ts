import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  armarReporte,
  clasificacionesDePlantilla,
  espejoUnidadDePlantilla,
  validarPlantilla,
  type DatosMes,
  type Plantilla,
} from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { clasif } from "@/lib/reporte/plantillas/filas";
import {
  clasificacionesConFila,
  sinFilaDeAvianor,
  unidadesDelAvisoEspejo,
  type FilaPorClasificacion,
} from "@/lib/reporte/avisoEspejo";
import { leerFilasMadre } from "@/lib/extractos/madre";
import { unidadDeLaLista } from "@/lib/unidadesNegocio";

// Espejo Avianor-Conexión: desde 2026-11 «Gastos Avion a recuperar» de Conexión es el NETO de los movimientos de la unidad
// AVIANOR (con las clasificaciones de las filas de Avianor); hasta 2026-10 sigue leyendo la clasificación AVION. Solo motor
// puro y parseo del madre: no prueba la consulta SQL ni la pantalla.

const AV = PLANTILLAS_POR_SLUG["avianor"];
const CX = PLANTILLAS_POR_SLUG["conexion-logistica"];
const M = 1_000_000 * 100; // 1 millón en centavos

function mes(periodo: string, over: Partial<DatosMes> = {}): DatosMes {
  return {
    periodo,
    real: new Map(),
    presupuesto: new Map(),
    semanasCerradas: 4,
    manuales: { presupuesto: new Map(), real: new Map() },
    ...over,
  };
}

const filaReal = (plantilla: Plantilla, datos: DatosMes, clave: string) =>
  armarReporte(plantilla, [datos], 0).filas.find((f) => f.fila.clave === clave)!.celdas[0].real;

// Movimientos de la unidad AVIANOR de noviembre, por clasificación cruda (neto, centavos con signo de banco). La última
// (COMISIONES ESPECIALES) NO figura en ninguna fila de Avianor.
const AVIANOR_NOV = new Map<string, number>([
  ["COBRANZAS", 10 * M],
  ["SUELDOS", -3 * M],
  ["EXPENSAS", -1 * M],
  ["PROV Y SERV", -2 * M],
  ["CHEQUES DIFERIDOS", -0.5 * M],
  ["COMISIONES ESPECIALES", -0.7 * M],
]);

test("las plantillas siguen siendo válidas y Conexión declara el espejo desde 2026-11 sobre la unidad AVIANOR", () => {
  assert.deepEqual(validarPlantilla(AV), []);
  assert.deepEqual(validarPlantilla(CX), []);
  const e = espejoUnidadDePlantilla(CX);
  assert.deepEqual([e?.desde, e?.unidades], ["2026-11", ["AVIANOR"]]);
  assert.equal(espejoUnidadDePlantilla(AV), null);
});

test("la lista de clasificaciones del espejo sale de la plantilla de Avianor, no es una copia", () => {
  assert.deepEqual(espejoUnidadDePlantilla(CX)!.clasificaciones, clasificacionesDePlantilla(AV));
  // Y no incluye lo que Avianor no tiene en ninguna fila.
  assert.equal(clasificacionesDePlantilla(AV).includes("COMISIONES ESPECIALES"), false);
});

test("Conexión = Avianor sobre los mismos movimientos, con una clasificación sin fila afuera de los dos", () => {
  const avianor = armarReporte(AV, [mes("2026-11", { real: AVIANOR_NOV })], 0);
  const conexion = armarReporte(CX, [mes("2026-11", { realEspejo: AVIANOR_NOV })], 0);
  const avTot = (rol: string) => avianor.filas.find((f) => f.fila.tipo === "total" && f.fila.rol === rol)!.celdas[0].real!;
  const gastoAvion = conexion.filas.find((f) => f.fila.clave === "cx.gastosAvion")!.celdas[0].real!;
  // Ingresos 10M, egresos 3 + 1 + 2 + 0,5 = 6,5M: el neto de Avianor es +3,5M; Conexión muestra el gasto a recuperar.
  assert.equal(avTot("totalIngresos"), 10 * M);
  assert.equal(avTot("totalEgresos"), 6.5 * M);
  assert.equal(gastoAvion, avTot("totalEgresos") - avTot("totalIngresos"));
  // COMISIONES ESPECIALES (−0,7M) no suma a ninguno de los dos: lo avisa el Reporte.
  assert.equal(gastoAvion, -(10 - 3 - 1 - 2 - 0.5) * M);
});

test("sin doble conteo: desde 2026-11 la clasificación AVION de las unidades de Conexión ya no suma, y lo de AVIANOR no entra en sus otras filas", () => {
  const datos = mes("2026-11", {
    real: new Map([["AVION", -3 * M], ["PROV Y SERV", -5 * M]]), // lo que ve Conexión por LOGISTICA + SPP
    realEspejo: new Map([["PROV Y SERV", -2 * M]]), // lo que ve la unidad AVIANOR
  });
  assert.equal(filaReal(CX, datos, "cx.gastosAvion"), 2 * M);
  assert.equal(filaReal(CX, datos, "cx.proveedores"), 5 * M);
});

test("movimiento prorrateado: cada porción cuenta una sola vez, en la empresa de su unidad", () => {
  // Un pago de 10M prorrateado 6M SPP + 4M AVIANOR: la consulta del Real le da a cada empresa solo su porción.
  const conexion = mes("2026-11", {
    real: new Map([["PROV Y SERV", -6 * M]]),
    realEspejo: new Map([["PROV Y SERV", -4 * M]]),
  });
  assert.equal(filaReal(CX, conexion, "cx.proveedores"), 6 * M);
  assert.equal(filaReal(CX, conexion, "cx.gastosAvion"), 4 * M);
  assert.equal(filaReal(CX, conexion, "cx.proveedores")! + filaReal(CX, conexion, "cx.gastosAvion")!, 10 * M);
  const avianor = mes("2026-11", { real: new Map([["PROV Y SERV", -4 * M]]) });
  assert.equal(filaReal(AV, avianor, "av.proveedores"), 4 * M);
  assert.equal(filaReal(CX, conexion, "cx.gastosAvion"), filaReal(AV, avianor, "av.proveedores"));
});

// Plantilla de Conexión como era antes del espejo: la fila lee solo la clasificación AVION.
const CX_ANTES: Plantilla = {
  ...CX,
  filas: CX.filas.map((f) => (f.clave === "cx.gastosAvion" && f.tipo === "linea" ? { ...f, real: clasif("AVION") } : f)),
};

for (const periodo of ["2026-07", "2026-09", "2026-10"]) {
  test(`${periodo} no cambia: todo el Reporte de Conexión da lo mismo que con la fuente anterior, aunque haya datos de AVIANOR`, () => {
    const datos = mes(periodo, {
      real: new Map([["AVION", -3 * M], ["PROV Y SERV", -5 * M], ["COBRANZAS", 20 * M], ["SUELDOS", -4 * M]]),
      realEspejo: AVIANOR_NOV, // no debe leerse antes de 2026-11
    });
    const nuevo = armarReporte(CX, [datos], 0).filas.map((f) => f.celdas[0]?.real ?? null);
    const viejo = armarReporte(CX_ANTES, [datos], 0).filas.map((f) => f.celdas[0]?.real ?? null);
    assert.deepEqual(nuevo, viejo);
    assert.equal(filaReal(CX, datos, "cx.gastosAvion"), 3 * M);
  });
}

test("2026-11 sin ejecución cerrada: la fila queda en «—», no en 0", () => {
  assert.equal(filaReal(CX, mes("2026-11", { semanasCerradas: 0, realEspejo: AVIANOR_NOV }), "cx.gastosAvion"), null);
});

test("2026-11 con ejecución pero sin movimientos de AVIANOR: 0", () => {
  assert.equal(filaReal(CX, mes("2026-11"), "cx.gastosAvion"), 0);
});

test("aviso: solo las clasificaciones de la unidad AVIANOR que no figuran en ninguna fila de Avianor", () => {
  const f = (clasificacion: string, estado: "ABIERTA" | "CERRADA" = "CERRADA"): FilaPorClasificacion => ({
    estado,
    moneda: "ARS",
    clasificacion,
    movimientos: 2,
    centavos: -100,
  });
  const filas = [
    f("COBRANZAS"),
    f("PROV Y SERV"),
    f("COM Y GTOS BRIOS"), // tiene fila (Gastos Bancarios)
    f("Gastos bancarios"), // alias de la misma
    f("SIN CLASIFICAR"), // tiene su propio bloque
    f("OTROS"),
    f("COMISIONES ESPECIALES", "ABIERTA"),
  ];
  const sinFila = sinFilaDeAvianor(filas, clasificacionesConFila(AV));
  assert.deepEqual(sinFila.map((x) => [x.clasificacion, x.estado]), [
    ["OTROS", "CERRADA"],
    ["COMISIONES ESPECIALES", "ABIERTA"],
  ]);
  assert.deepEqual(sinFilaDeAvianor([f("COBRANZAS")], clasificacionesConFila(AV)), []);
});

test("el aviso se muestra solo en los Reportes de Avianor y Conexión", () => {
  assert.deepEqual(unidadesDelAvisoEspejo(AV), ["AVIANOR"]);
  assert.deepEqual(unidadesDelAvisoEspejo(CX), ["AVIANOR"]);
  assert.equal(unidadesDelAvisoEspejo(PLANTILLAS_POR_SLUG["hwc"]), null);
  assert.equal(unidadesDelAvisoEspejo(PLANTILLAS_POR_SLUG["brillante"]), null);
});

// ---- madre.ts: alias de la columna UNIDAD ----

function hojaMadre(encabezados: string[], filas: (string | number | Date | null)[][]) {
  const ws = new ExcelJS.Workbook().addWorksheet("Hoja1");
  ws.addRow(encabezados);
  for (const f of filas) ws.addRow(f);
  return ws;
}
const FECHA = new Date(Date.UTC(2026, 10, 3));
const ENC = ["Fecha", "Concepto", "Importe", "BANCO Y CTA", "Clasificación", "UNIDAD DE NEG"];

test("madre: «AVION» en la columna UNIDAD se lee como AVIANOR y la clasificación AVION no se toca", () => {
  const r = leerFilasMadre(
    hojaMadre(ENC, [
      [FECHA, "PAGO HANGAR", -100, "MACRO 599", "AVION", "AVION"], // la cuenta es de SPP, pero la unidad explícita gana
      [FECHA, "PAGO COMBUSTIBLE", -50, "MACRO 599", "AVION", " avión "], // sin mayúsculas, tildes ni espacios
      [FECHA, "SUELDO PILOTO", -70, "MACRO 599", "SUELDOS", "AVIANOR"],
      [FECHA, "PAGO SPP", -10, "MACRO 599", "PROV Y SERV", "SPP"],
    ])
  );
  assert.ok(r.ok);
  assert.deepEqual(
    r.filas.map((f) => [f.unidadNegocio, f.clasificacion, f.unidadSugeridaPorSistema]),
    [
      ["AVIANOR", "AVION", false],
      ["AVIANOR", "AVION", false],
      ["AVIANOR", "SUELDOS", false],
      ["SPP", "PROV Y SERV", false],
    ]
  );
});

test("madre: el alias es solo de la columna UNIDAD — en la columna EMPRESA «AVION» no es una razón social conocida", () => {
  const r = leerFilasMadre(
    hojaMadre(["Fecha", "Concepto", "Importe", "BANCO Y CTA", "Clasificación", "EMPRESA"], [
      [FECHA, "PAGO", -100, "BANCO RARO 1", "AVION", "AVION"],
    ])
  );
  assert.ok(r.ok);
  assert.equal(r.filas[0].unidadNegocio, "SIN ASIGNAR");
  assert.equal(r.filas[0].clasificacion, "AVION");
});

test("«AVION» no pasa a ser una unidad de la lista (no aparece en los desplegables ni se acepta como unidad válida)", () => {
  assert.equal(unidadDeLaLista("AVION"), null);
});
