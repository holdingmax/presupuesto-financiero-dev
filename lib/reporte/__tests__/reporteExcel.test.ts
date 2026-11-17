import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { formatearDescarga } from "@/lib/fecha";
import { veBloquesReservadosDelReporte } from "@/lib/permisosEjecucion";
import { armarReporte, type DatosMes, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { edicionDelReporte } from "@/lib/reporte/vistaReporte";
import { dispComoSaldoDelReporte } from "@/lib/reporte/descargaExcel";
import { armarVistaTipeo } from "@/lib/reporte/tipeoDirecto";
import { construirExcelReporte, FORMATO_AVANCE, FORMATO_IMPORTE } from "@/lib/reporte/reporteExcel";
import { CENTINELA, mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";

const ABIERTO = { abiertas: 1, cerradas: 0 };
const AHORA = new Date("2026-11-18T02:40:00Z"); // martes 17/11/2026 23:40 en Argentina (miércoles en UTC)
const SLUG = "brillante";

const ROLES = [
  { nombre: "ADMIN", rol: "ADMIN", puedeCargarReal: true },
  { nombre: "FINANZAS", rol: "FINANZAS", puedeCargarReal: true },
  { nombre: "GERENTE con permiso de tipeo", rol: "GERENTE", puedeCargarReal: true },
  { nombre: "GERENTE sin permiso de tipeo", rol: "GERENTE", puedeCargarReal: false },
] as const;

// octubre (contexto) y noviembre: los dos meses habilitados, para que valgan las reglas de «desde» de las plantillas.
function mesesOctNov(slug: string): DatosMes[] {
  return mesesDePrueba(PLANTILLAS_POR_SLUG[slug]).map((m, i) => ({ ...m, periodo: i === 0 ? "2026-10" : "2026-11" }));
}

function armarParaRol(slug: string, r: (typeof ROLES)[number], meses: DatosMes[]) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const adminOFinanzas = r.rol !== "GERENTE";
  const acceso = accesoReservadosDelReporte(veBloquesReservadosDelReporte({ rol: r.rol }), slug);
  const reporte = armarReporte(plantilla, meses, 1, { verBloquesReservados: acceso });
  const edicion = edicionDelReporte({ periodo: "2026-11", marca: undefined, esAdminOFinanzas: adminOFinanzas, puedeCargarReal: r.puedeCargarReal });
  const dispComoSaldo = dispComoSaldoDelReporte({
    sinBloquesReservados: reporte.sinBloquesReservados,
    edicionTipeo: edicion.tipeo,
    empresaSlug: slug,
    entradaTipeo: () => ({
      plantilla,
      esAdminOFinanzas: adminOFinanzas,
      puedeCargarReal: r.puedeCargarReal,
      periodo: "2026-11",
      actual: "2026-11",
      semanas: ABIERTO,
      valoresReales: new Map(),
    }),
  });
  return { reporte, dispComoSaldo };
}

async function exportar(reporte: Reporte, dispComoSaldo: boolean, estado: string | null = "VALIDADO") {
  const buffer = await construirExcelReporte({
    empresaNombre: "Brillante S.A.",
    enDolares: false,
    reporte,
    dispComoSaldo,
    estadoPresupuesto: estado,
    descargadoEn: AHORA,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const hoja = wb.worksheets[0];
  // La primera fila de datos es la siguiente a la de los subencabezados («CONCEPTO»).
  let filaSub = 0;
  hoja.eachRow((row, n) => {
    if (row.getCell(1).value === "CONCEPTO") filaSub = n;
  });
  assert.ok(filaSub > 0, "falta la fila de encabezados");
  return { hoja, primeraFila: filaSub + 1, filaSub };
}

// Lo que la pantalla muestra en cada celda, escrito a mano a partir de las celdas del Reporte (sin usar el exportador).
function esperadoDeCelda(f: Reporte["filas"][number], i: number, dispComoSaldo: boolean): (number | null)[] {
  const { fila, celdas } = f;
  const c = celdas[i];
  const pesos = (x: number | null) => (x === null ? null : x / 100);
  if (fila.tipo === "titulo") return [null, null, null, null];
  if (dispComoSaldo && fila.bloque === "DISPONIBILIDADES") return [pesos(c.presupuestado), pesos(c.real), null, null];
  if (fila.tipo === "capital" || fila.tipo === "disponible") return [pesos(c.presupuestado), null, null, null];
  if (fila.bloque === "DISPONIBILIDADES") return [pesos(c.presupuestado), pesos(c.real), null, null];
  return [pesos(c.presupuestado), pesos(c.real), c.avance === null ? null : c.avance / 100, pesos(c.faltaEjecutar)];
}

function valorNumerico(v: ExcelJS.CellValue): number | null {
  if (v === null || v === undefined || v === "") return null;
  assert.equal(typeof v, "number", `se esperaba un número, llegó ${JSON.stringify(v)}`);
  return v as number;
}

// ---- Las celdas del Reporte coinciden con las filas exportadas, por rol -------------------------------

for (const r of ROLES) {
  test(`${r.nombre}: cada fila y cada celda del Reporte está en el Excel, con los mismos valores`, async () => {
    const { reporte, dispComoSaldo } = armarParaRol(SLUG, r, mesesOctNov(SLUG));
    const { hoja, primeraFila } = await exportar(reporte, dispComoSaldo);

    assert.equal(reporte.periodos.length, 1);
    assert.ok(reporte.filas.length > 10);
    // Ni una fila de más ni de menos.
    assert.equal(hoja.rowCount, primeraFila - 1 + reporte.filas.length);
    reporte.filas.forEach((f, idx) => {
      const fila = hoja.getRow(primeraFila + idx);
      const esperadoTexto =
        f.fila.tipo === "linea" && f.fila.bloque === "DISPONIBILIDADES"
          ? f.fila.texto.trim().toUpperCase()
          : f.fila.texto.trim();
      assert.equal(fila.getCell(1).value, esperadoTexto, `concepto de ${f.fila.clave}`);
      reporte.periodos.forEach((_, i) => {
        const esperado = esperadoDeCelda(f, i, dispComoSaldo);
        for (let k = 0; k < 4; k++) {
          const c = fila.getCell(2 + i * 4 + k);
          if (f.fila.tipo === "titulo" && dispComoSaldo && f.fila.bloque === "DISPONIBILIDADES" && k < 2) {
            assert.equal(c.value, "Saldo", `rótulo Saldo en ${f.fila.clave}`);
            continue;
          }
          assert.equal(valorNumerico(c.value), esperado[k], `${f.fila.clave} mes ${i} columna ${k}`);
        }
      });
    });
  });
}

test("ADMIN y FINANZAS reciben exactamente las mismas filas; el gerente, solo lo que ve", () => {
  const meses = mesesOctNov(SLUG);
  const claves = (r: (typeof ROLES)[number]) => armarParaRol(SLUG, r, meses).reporte.filas.map((f) => f.fila.clave);
  assert.deepEqual(claves(ROLES[0]), claves(ROLES[1]));
  assert.ok(claves(ROLES[2]).length < claves(ROLES[0]).length);
  assert.deepEqual(claves(ROLES[2]), claves(ROLES[3]));
});

// ---- Disponibilidades como «Saldo» --------------------------------------------------------------------

test("GERENTE sin permiso de tipeo: Disponibilidades en «Saldo» (rótulo bajo P y R, un solo valor, sin % ni Falta)", async () => {
  const { reporte, dispComoSaldo } = armarParaRol(SLUG, ROLES[3], mesesOctNov(SLUG));
  assert.equal(dispComoSaldo, true);
  const { hoja, primeraFila } = await exportar(reporte, dispComoSaldo);
  const iTitulo = reporte.filas.findIndex((f) => f.fila.tipo === "titulo" && f.fila.bloque === "DISPONIBILIDADES");
  assert.ok(iTitulo >= 0);
  assert.equal(hoja.getRow(primeraFila + iTitulo).getCell(2).value, "Saldo");
  assert.equal(hoja.getRow(primeraFila + iTitulo).getCell(3).value, "Saldo");
  reporte.filas.forEach((f, idx) => {
    if (f.fila.tipo !== "linea" || f.fila.bloque !== "DISPONIBILIDADES") return;
    const fila = hoja.getRow(primeraFila + idx);
    assert.equal(valorNumerico(fila.getCell(4).value), null, `${f.fila.clave} sin %`);
    assert.equal(valorNumerico(fila.getCell(5).value), null, `${f.fila.clave} sin Falta`);
  });
});

test("ADMIN, FINANZAS y GERENTE con permiso: Disponibilidades sin rótulo «Saldo»", async () => {
  for (const r of ROLES.slice(0, 3)) {
    const { reporte, dispComoSaldo } = armarParaRol(SLUG, r, mesesOctNov(SLUG));
    assert.equal(dispComoSaldo, false, r.nombre);
    const { hoja } = await exportar(reporte, dispComoSaldo);
    let saldos = 0;
    hoja.eachRow((row) => row.eachCell((c) => (c.value === "Saldo" ? saldos++ : 0)));
    assert.equal(saldos, 0, r.nombre);
  }
});

test("GERENTE de una empresa sin Disponibilidades ni Cierre prendidos: no hay ni una celda de esos bloques (ni el centinela)", async () => {
  const plantilla = PLANTILLAS_POR_SLUG[SLUG];
  const meses = mesesOctNov(SLUG);
  const reporte = armarReporte(plantilla, meses, 1, { verBloquesReservados: accesoReservadosDelReporte(false, "empresa-sin-interruptores") });
  assert.equal(reporte.sinBloquesReservados, true);
  const { hoja } = await exportar(reporte, true);
  const titulos = reporte.filas.filter((f) => f.fila.bloque === "DISPONIBILIDADES" || f.fila.bloque === "CIERRE");
  assert.equal(titulos.length, 0);
  let centinelas = 0;
  hoja.eachRow((row) =>
    row.eachCell((c) => {
      if (typeof c.value === "number" && Math.abs(c.value) >= CENTINELA / 100) centinelas++;
    })
  );
  assert.equal(centinelas, 0);
});

// ---- El Real exportado es el total (calculado + tipeado) ---------------------------------------------

test("fila con parte calculada + tipeo: el Excel trae el TOTAL, igual que la casilla de Real del mes en curso", async () => {
  const plantilla = PLANTILLAS_POR_SLUG[SLUG];
  const calculado = 1_234_500; // centavos del egreso que salen de la Ejecución (SAC); en el banco entra con signo negativo
  const tipeado = 250_000; // centavos guardados a mano
  const mes = (periodo: string, conTipeo: boolean): DatosMes => ({
    periodo,
    real: new Map([["SAC", -calculado]]),
    presupuesto: new Map(),
    mesCerrado: false,
    semanasCerradas: 4,
    manuales: { presupuesto: new Map(), real: new Map(conTipeo ? [["br.sac", tipeado]] : []) },
  });
  const meses = [mes("2026-10", false), mes("2026-11", true)];
  const reporte = armarReporte(plantilla, meses, 1, { verBloquesReservados: true });
  const iSac = reporte.filas.findIndex((f) => f.fila.clave === "br.sac");
  const celda = reporte.filas[iSac].celdas[0];

  // El Reporte ya trae el total; el calculado va aparte.
  assert.equal(celda.real, calculado + tipeado);
  assert.equal(celda.realCalculado, calculado);

  const { hoja, primeraFila } = await exportar(reporte, false);
  const real = hoja.getRow(primeraFila + iSac).getCell(3).value;
  assert.equal(real, (calculado + tipeado) / 100);
  assert.notEqual(real, calculado / 100, "no es solo el calculado");
  assert.notEqual(real, tipeado / 100, "no es solo lo tipeado");

  // Y es el mismo número que muestra la casilla editable de Real (tipeo directo) en esa fila.
  const tipeo = armarVistaTipeo({
    empresaSlug: SLUG,
    plantilla,
    esAdminOFinanzas: true,
    periodo: "2026-11",
    actual: "2026-11",
    semanas: ABIERTO,
    valoresReales: meses[1].manuales!.real,
    calculados: new Map(
      reporte.filas.flatMap((f) => (f.celdas[0]?.realCalculado === undefined ? [] : [[f.fila.clave, f.celdas[0].realCalculado] as const]))
    ),
  });
  const casilla = tipeo!.celdas.find((c) => c.clave === "br.sac" && c.columna === "REAL");
  assert.ok(casilla, "la fila no tiene casilla de Real");
  assert.equal(casilla.centavos, celda.real);
  assert.equal((casilla.centavos as number) / 100, real);
});

test("sin parte tipeada el total es el calculado; sin ejecución ni tipeo la celda queda vacía (no 0)", async () => {
  const plantilla = PLANTILLAS_POR_SLUG[SLUG];
  const meses: DatosMes[] = ["2026-10", "2026-11"].map((periodo) => ({
    periodo,
    real: new Map(),
    presupuesto: new Map(),
    mesCerrado: false,
    semanasCerradas: 0,
    manuales: { presupuesto: new Map(), real: new Map() },
  }));
  const reporte = armarReporte(plantilla, meses, 1, { verBloquesReservados: true });
  const iSac = reporte.filas.findIndex((f) => f.fila.clave === "br.sac");
  assert.equal(reporte.filas[iSac].celdas[0].real, null);
  const { hoja, primeraFila } = await exportar(reporte, false);
  assert.equal(valorNumerico(hoja.getRow(primeraFila + iSac).getCell(3).value), null);
});

// ---- Cabecera, formato y estructura -----------------------------------------------------------------

test("la fecha y el día de descarga van arriba, en hora de Argentina, como texto", async () => {
  const { reporte, dispComoSaldo } = armarParaRol(SLUG, ROLES[0], mesesOctNov(SLUG));
  const { hoja } = await exportar(reporte, dispComoSaldo);
  // 18/11 02:40 UTC es martes 17/11 23:40 en Argentina.
  assert.equal(hoja.getCell(3, 1).value, "Descargado el martes 17/11/2026 23:40");
  assert.equal(hoja.getCell(3, 1).value, formatearDescarga(AHORA));
  assert.equal(hoja.getCell(1, 1).value, "Presupuesto Financiero");
  assert.equal(hoja.getCell(2, 1).value, "Brillante S.A. · Noviembre 2026");
});

test("estado «Validado» del mes de la URL en la cabecera; si la pantalla no lo muestra, no se escribe", async () => {
  const { reporte, dispComoSaldo } = armarParaRol(SLUG, ROLES[0], mesesOctNov(SLUG));
  const con = await exportar(reporte, dispComoSaldo, "VALIDADO");
  assert.equal(con.hoja.getCell(5, 1).value, "Estado del presupuesto de Noviembre 2026: Validado");
  const revision = await exportar(reporte, dispComoSaldo, "EN_REVISION");
  assert.equal(revision.hoja.getCell(5, 1).value, "Estado del presupuesto de Noviembre 2026: En revisión");
  const sin = await exportar(reporte, dispComoSaldo, null);
  for (let n = 1; n < sin.filaSub; n++) assert.ok(!String(sin.hoja.getCell(n, 1).value ?? "").startsWith("Estado"));
  assert.equal(sin.filaSub, con.filaSub - 1);
});

test("columnas juntas: una banda y cuatro columnas por mes, en orden; formatos de número y de porcentaje", async () => {
  const plantilla = PLANTILLAS_POR_SLUG[SLUG];
  const meses = mesesDePrueba(plantilla).map((m, i) => ({ ...m, periodo: i === 0 ? "2026-10" : "2026-11" }));
  const reporte = armarReporte(plantilla, [meses[0], meses[1], { ...meses[1], periodo: "2026-12" }], 0, { verBloquesReservados: true });
  assert.equal(reporte.periodos.length, 3);
  const { hoja, filaSub, primeraFila } = await exportar(reporte, false);
  assert.equal(hoja.getCell(filaSub - 1, 2).value, "OCTUBRE");
  assert.equal(hoja.getCell(filaSub - 1, 6).value, "NOVIEMBRE");
  assert.equal(hoja.getCell(filaSub - 1, 10).value, "DICIEMBRE");
  assert.deepEqual(
    [2, 3, 4, 5].map((c) => hoja.getCell(filaSub, c).value),
    ["PRESUPUESTADO", "REAL", "% AVANCE", "FALTA EJECUTAR"]
  );
  const iLinea = reporte.filas.findIndex((f) => f.fila.tipo === "linea" && f.fila.bloque === "EGRESOS" && f.celdas[0].avance !== null);
  assert.ok(iLinea >= 0);
  const fila = hoja.getRow(primeraFila + iLinea);
  assert.equal(fila.getCell(2).numFmt, FORMATO_IMPORTE);
  assert.equal(fila.getCell(4).numFmt, FORMATO_AVANCE);
  assert.equal(fila.getCell(5).numFmt, FORMATO_IMPORTE);
  // Cada mes trae sus propios valores.
  reporte.periodos.forEach((_, i) => {
    assert.equal(valorNumerico(fila.getCell(2 + i * 4).value), (reporte.filas[iLinea].celdas[i].presupuestado ?? NaN) / 100 || null);
  });
});

test("«sin presupuesto» y «sin ejecución» se marcan en la banda del mes; los paneles quedan congelados", async () => {
  const plantilla = PLANTILLAS_POR_SLUG[SLUG];
  const meses = mesesOctNov(SLUG).map((m, i) => (i === 1 ? { ...m, presupuesto: null, semanasCerradas: 0 } : m));
  const reporte = armarReporte(plantilla, meses, 1, { verBloquesReservados: true });
  const { hoja, filaSub } = await exportar(reporte, false);
  assert.equal(hoja.getCell(filaSub - 1, 2).value, "NOVIEMBRE · sin presupuesto · sin ejecución");
  const vista = hoja.views[0];
  assert.equal(vista.state, "frozen");
  assert.equal((vista as { ySplit?: number }).ySplit, filaSub);
  assert.equal((vista as { xSplit?: number }).xSplit, 1);
});

test("empresa en dólares: la nota de moneda lo dice", async () => {
  const { reporte } = armarParaRol(SLUG, ROLES[0], mesesOctNov(SLUG));
  const buffer = await construirExcelReporte({
    empresaNombre: "Bradenton",
    enDolares: true,
    reporte,
    dispComoSaldo: false,
    estadoPresupuesto: null,
    descargadoEn: AHORA,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  assert.match(String(wb.worksheets[0].getCell(4, 1).value), /en dólares\.$/);
});

test("no exporta controles: ni «No asignado», «Sin clasificar», arrastre ni pendientes (K)", async () => {
  const { reporte, dispComoSaldo } = armarParaRol(SLUG, ROLES[0], mesesOctNov(SLUG));
  const { hoja } = await exportar(reporte, dispComoSaldo);
  const textos: string[] = [];
  hoja.eachRow((row) => row.eachCell((c) => textos.push(String(c.value))));
  const todo = textos.join("\n");
  assert.doesNotMatch(todo, /No asignado|Sin clasificar|Arrastre|Pendiente de confirmar/i);
  assert.doesNotMatch(todo, /\bK\d+\b/);
});
