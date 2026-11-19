import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { bloquesReservadosDelUsuario } from "@/lib/permisosViewer";
import { veBloquesReservadosDelReporte } from "@/lib/permisosEjecucion";
import { armarReporte, type DatosMes, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { dispComoSaldoDelReporte } from "@/lib/reporte/descargaExcel";
import { edicionDelReporte } from "@/lib/reporte/vistaReporte";
import { construirExcelReporte } from "@/lib/reporte/reporteExcel";
import { CENTINELA, mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";

// Casilla «ve bloques reservados» del VIEWER (Usuario.veBloquesReservados), de punta a punta en el motor y en el Excel:
// el Reporte se arma con la MISMA decisión que usan la pantalla y la descarga (bloquesReservadosDelUsuario), y se exporta con
// el exportador real. Brillante tiene Disponibilidades y Cierre prendidos para el gerente (lib/config.ts): es el caso en
// el que el VIEWER sin casilla tiene que quedar igual afuera (la regla «gana sobre los interruptores»).

const SLUG = "brillante";
const AHORA = new Date("2026-11-18T02:40:00Z");

type Quien = { rol: "ADMIN" | "FINANZAS" | "GERENTE" | "VIEWER"; veBloquesReservados?: boolean; puedeCargarReal: boolean };

function meses(): DatosMes[] {
  return mesesDePrueba(PLANTILLAS_POR_SLUG[SLUG]).map((m, i) => ({ ...m, periodo: i === 0 ? "2026-10" : "2026-11" }));
}

// Mismo camino que reporte/page.tsx y reporte/excel/route.ts -> armarReporteDePlantilla (lib/reporte/armarReporteDePlantilla.ts).
function armar(q: Quien) {
  const plantilla = PLANTILLAS_POR_SLUG[SLUG];
  const reservados = bloquesReservadosDelUsuario(q, veBloquesReservadosDelReporte(q));
  const acceso = reservados.sinBloquesReservados
    ? false
    : accesoReservadosDelReporte(reservados.verBloquesReservados, SLUG);
  const reporte = armarReporte(plantilla, meses(), 1, { verBloquesReservados: acceso });
  const adminOFinanzas = q.rol === "ADMIN" || q.rol === "FINANZAS";
  const edicion = edicionDelReporte({ periodo: "2026-11", marca: undefined, esAdminOFinanzas: adminOFinanzas, puedeCargarReal: q.puedeCargarReal });
  const dispComoSaldo = dispComoSaldoDelReporte({
    sinBloquesReservados: reporte.sinBloquesReservados,
    edicionTipeo: edicion.tipeo,
    empresaSlug: SLUG,
    entradaTipeo: () => ({
      plantilla,
      esAdminOFinanzas: adminOFinanzas,
      puedeCargarReal: q.puedeCargarReal,
      periodo: "2026-11",
      actual: "2026-11",
      semanas: { abiertas: 1, cerradas: 0 },
      valoresReales: new Map(),
    }),
  });
  return { reporte, dispComoSaldo, acceso };
}

async function celdas(reporte: Reporte, dispComoSaldo: boolean): Promise<(string | number | null)[][]> {
  const buffer = await construirExcelReporte({
    empresaNombre: "Brillante S.A.",
    enDolares: false,
    reporte,
    dispComoSaldo,
    estadoPresupuesto: null,
    descargadoEn: AHORA,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const filas: (string | number | null)[][] = [];
  wb.worksheets[0].eachRow((row) => {
    const vals: (string | number | null)[] = [];
    row.eachCell({ includeEmpty: true }, (c) => vals.push(typeof c.value === "number" || typeof c.value === "string" ? c.value : null));
    filas.push(vals);
  });
  return filas;
}

const claves = (r: Reporte) => r.filas.map((f) => f.fila.clave);
const reservadas = (r: Reporte) => r.filas.filter((f) => f.fila.bloque === "DISPONIBILIDADES" || f.fila.bloque === "CIERRE");
const centinelas = (filas: (string | number | null)[][]) =>
  filas.flat().filter((v) => typeof v === "number" && Math.abs(v) >= CENTINELA / 100).length;

const ADMIN: Quien = { rol: "ADMIN", puedeCargarReal: true };
const VIEWER_SIN: Quien = { rol: "VIEWER", veBloquesReservados: false, puedeCargarReal: false };
const VIEWER_CON: Quien = { rol: "VIEWER", veBloquesReservados: true, puedeCargarReal: false };

test("VIEWER sin casilla: el Reporte sale SIN Disponibilidades ni Cierre, aunque Brillante los muestre al gerente", async () => {
  const e = armar(VIEWER_SIN);
  assert.equal(e.acceso, false);
  assert.equal(e.reporte.sinBloquesReservados, true);
  assert.equal(reservadas(e.reporte).length, 0);
  // y el gerente de la misma empresa SÍ los ve (la regla del VIEWER es más estricta, a propósito)
  assert.ok(reservadas(armar({ rol: "GERENTE", puedeCargarReal: false }).reporte).length > 0);
  const filas = await celdas(e.reporte, e.dispComoSaldo);
  assert.equal(centinelas(filas), 0, "ningún valor reservado en el Excel");
});

test("VIEWER sin casilla: tener la casilla indefinida es lo mismo que false", () => {
  const sin = armar({ rol: "VIEWER", puedeCargarReal: false });
  assert.deepEqual(claves(sin.reporte), claves(armar(VIEWER_SIN).reporte));
  assert.equal(sin.reporte.sinBloquesReservados, true);
});

test("VIEWER con casilla: recibe las mismas filas que ADMIN, con Disponibilidades y Cierre, y no como «Saldo»", () => {
  const v = armar(VIEWER_CON);
  const a = armar(ADMIN);
  assert.equal(v.acceso, true);
  assert.equal(v.reporte.sinBloquesReservados, false);
  assert.ok(reservadas(v.reporte).length > 0);
  assert.deepEqual(claves(v.reporte), claves(a.reporte));
  assert.equal(v.dispComoSaldo, false, "sin tipeo y con acceso completo se dibuja como lo ve ADMIN, de solo lectura");
});

test("VIEWER con casilla: el Excel trae los mismos valores que el de ADMIN, incluidos los reservados", async () => {
  const v = armar(VIEWER_CON);
  const a = armar(ADMIN);
  const excelV = await celdas(v.reporte, v.dispComoSaldo);
  const excelA = await celdas(a.reporte, a.dispComoSaldo);
  assert.ok(centinelas(excelV) > 0, "los valores reservados llegan al Excel");
  assert.deepEqual(excelV, excelA);
});

test("la casilla solo cuenta para el VIEWER: GERENTE con la casilla en true ve lo mismo que sin ella", async () => {
  const sin = armar({ rol: "GERENTE", veBloquesReservados: false, puedeCargarReal: false });
  const con = armar({ rol: "GERENTE", veBloquesReservados: true, puedeCargarReal: false });
  assert.deepEqual(claves(con.reporte), claves(sin.reporte));
  assert.equal(con.reporte.sinBloquesReservados, sin.reporte.sinBloquesReservados);
  assert.deepEqual(await celdas(con.reporte, con.dispComoSaldo), await celdas(sin.reporte, sin.dispComoSaldo));
});

test("ADMIN y FINANZAS no dependen de la casilla", () => {
  for (const rol of ["ADMIN", "FINANZAS"] as const) {
    for (const casilla of [undefined, false, true]) {
      const e = armar({ rol, veBloquesReservados: casilla, puedeCargarReal: true });
      assert.equal(e.acceso, true, `${rol} ${casilla}`);
      assert.equal(e.reporte.sinBloquesReservados, false, `${rol} ${casilla}`);
    }
  }
});
