import ExcelJS from "exceljs";
import { formatearDescarga } from "@/lib/fecha";
import { mesYAnio, nombreMesBanda, rangoDeMeses } from "@/lib/mesesReporte";
import type { Celda, FilaReporte, Reporte } from "@/lib/reporte/motor";

// Excel del Reporte (botón «Descargar Excel»). Recibe el Reporte YA armado para quien lo mira (armarReporteDePlantilla) y lo
// dibuja como la pantalla (ReportePlantilla.tsx): mismas filas, mismos meses, mismas columnas (Presupuestado, Real,
// % Avance, Falta ejecutar) y los mismos huecos (Disponibilidades, Capital y Disponible no llevan % ni Falta; Capital y
// Disponible solo Presupuestado). El Real es `celda.real`: el TOTAL (calculado + tipeado), lo mismo que se ve.
// Sin «No asignado», «Sin clasificar», control de arrastre ni pendientes: son controles, no el Reporte.
// Importes como números en pesos con el valor exacto (centavos / 100); el formato muestra pesos enteros, como la pantalla.

export const FORMATO_IMPORTE = "#,##0;[Red]-#,##0";
export const FORMATO_AVANCE = "0%";

// Colores de la pantalla (réplica de «PRESUPUESTO MES A MES»), en ARGB.
const BANDA = "FFCCD8E7";
const DATO = "FFE6ECF3";
const TOTAL = "FFD9D9D9";
const AZUL_DISPONIBILIDADES = "FF4E75A3";
const GRIS_TITULO = "FF8A8A8A";
const AZUL_SUBTITULO = "FF344E6D";

const NOMBRE_DE_ESTADO: Record<string, string> = { VALIDADO: "Validado", EN_REVISION: "En revisión", ABIERTO: "Abierto" };
export function textoDeEstado(estado: string): string {
  return NOMBRE_DE_ESTADO[estado] ?? estado;
}

export type EntradaExcelReporte = {
  empresaNombre: string;
  enDolares: boolean;
  reporte: Reporte;
  // Disponibilidades como el «Saldo» de solo lectura del gerente (disponibilidadesComoSaldo): un solo valor, bajo P y R.
  dispComoSaldo: boolean;
  // Estado del presupuesto del mes de la URL; null = la pantalla no lo muestra (no se escribe).
  estadoPresupuesto: string | null;
  descargadoEn: Date;
};

// Lo que dibuja una fila en cada mes: [Presupuestado, Real, % Avance (fracción), Falta ejecutar]; null = celda vacía.
export type ValoresDeCeldas = [number | null, number | null, number | null, number | null];

const aPesos = (centavos: number | null): number | null => (centavos === null ? null : centavos / 100);

// Misma decisión que FilaTabla / CeldasMes / CeldaSaldo de la pantalla.
export function valoresDeCeldas(fila: FilaReporte["fila"], celda: Celda, dispComoSaldo: boolean): ValoresDeCeldas {
  if (fila.tipo === "titulo") return [null, null, null, null];
  // Saldo: P y R muestran el mismo valor de solo lectura; % y Falta quedan vacíos.
  if (dispComoSaldo && fila.bloque === "DISPONIBILIDADES") return [aPesos(celda.presupuestado), aPesos(celda.real), null, null];
  const sinPorcentajes = fila.bloque === "DISPONIBILIDADES" || fila.tipo === "capital" || fila.tipo === "disponible";
  const soloP = fila.tipo === "capital" || fila.tipo === "disponible";
  return [
    aPesos(celda.presupuestado),
    soloP ? null : aPesos(celda.real),
    soloP || sinPorcentajes || celda.avance === null ? null : celda.avance / 100,
    soloP || sinPorcentajes ? null : aPesos(celda.faltaEjecutar),
  ];
}

// Marcas que la pantalla pone junto a la fila («parcial», «no suma», asterisco de los totales), en texto.
export function observacionesDeFila(f: FilaReporte, dispComoSaldo: boolean): string[] {
  const { fila, celdas } = f;
  const obs: string[] = [];
  if (fila.tipo === "linea") {
    if (fila.parcial) obs.push("Dato parcial: falta información para completar este valor");
    if (fila.excluidaDelTotal && celdas.some((c) => c.real !== null)) obs.push("No suma en el total");
  }
  const enSaldo = dispComoSaldo && fila.bloque === "DISPONIBILIDADES";
  if (
    fila.tipo === "total" &&
    !enSaldo &&
    celdas.some(
      (c) => (c.presupuestoIncompleto && c.presupuestado !== null) || (c.realIncompleto && c.real !== null)
    )
  ) {
    obs.push("Total parcial: falta información para completar este total");
  }
  return obs;
}

export async function construirExcelReporte(e: EntradaExcelReporte): Promise<Buffer> {
  const { reporte, dispComoSaldo } = e;
  const { periodos } = reporte;
  const meses = periodos.length;
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Reporte", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const observaciones = reporte.filas.map((f) => observacionesDeFila(f, dispComoSaldo));
  const conObservaciones = observaciones.some((o) => o.length > 0);
  const colObs = 2 + meses * 4;

  hoja.getColumn(1).width = 56;
  for (let i = 0; i < meses; i++) {
    const base = 2 + i * 4;
    hoja.getColumn(base).width = 17;
    hoja.getColumn(base + 1).width = 17;
    hoja.getColumn(base + 2).width = 10;
    hoja.getColumn(base + 3).width = 17;
  }
  if (conObservaciones) hoja.getColumn(colObs).width = 46;

  // Encabezado: título, empresa y meses, fecha de descarga (arriba, para que se vea al abrir), moneda y estado.
  const titulo = hoja.getCell(1, 1);
  titulo.value = "Presupuesto Financiero";
  titulo.font = { bold: true, size: 20, color: { argb: GRIS_TITULO } };
  const sub = hoja.getCell(2, 1);
  sub.value = `${e.empresaNombre} · ${rangoDeMeses(periodos)}`;
  sub.font = { bold: true, size: 11, color: { argb: AZUL_SUBTITULO } };
  const descarga = hoja.getCell(3, 1);
  descarga.value = formatearDescarga(e.descargadoEn);
  descarga.font = { bold: true, size: 11 };
  hoja.getCell(4, 1).value = `Presupuestado vs. real ejecutado (semanas cerradas), en ${e.enDolares ? "dólares" : "pesos"}.`;
  let fila = 5;
  if (e.estadoPresupuesto !== null) {
    hoja.getCell(fila, 1).value = `Estado del presupuesto de ${mesYAnio(periodos[meses - 1])}: ${textoDeEstado(e.estadoPresupuesto)}`;
    hoja.getCell(fila, 1).font = { bold: true };
    fila++;
  }
  fila++; // fila en blanco

  // Banda de cada mes y subencabezados.
  const filaBanda = fila;
  const filaSub = fila + 1;
  hoja.getCell(filaSub, 1).value = "CONCEPTO";
  hoja.getCell(filaSub, 1).font = { bold: true, size: 9, color: { argb: GRIS_TITULO } };
  for (let i = 0; i < meses; i++) {
    const base = 2 + i * 4;
    const marcas = [reporte.sinPresupuesto[i] ? "sin presupuesto" : null, reporte.sinEjecucion[i] ? "sin ejecución" : null].filter(Boolean);
    const banda = hoja.getCell(filaBanda, base);
    banda.value = nombreMesBanda(periodos[i]) + (marcas.length > 0 ? ` · ${marcas.join(" · ")}` : "");
    hoja.mergeCells(filaBanda, base, filaBanda, base + 3);
    for (let c = base; c < base + 4; c++) hoja.getCell(filaBanda, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BANDA } };
    banda.font = { bold: true };
    banda.alignment = { horizontal: "center" };
    ["PRESUPUESTADO", "REAL", "% AVANCE", "FALTA EJECUTAR"].forEach((t, k) => {
      const celda = hoja.getCell(filaSub, base + k);
      celda.value = t;
      celda.font = { bold: true, size: 9 };
      celda.alignment = { horizontal: "center" };
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DATO } };
    });
  }
  if (conObservaciones) {
    const celda = hoja.getCell(filaSub, colObs);
    celda.value = "OBSERVACIONES";
    celda.font = { bold: true, size: 9, color: { argb: GRIS_TITULO } };
  }
  hoja.views = [{ state: "frozen", xSplit: 1, ySplit: filaSub }];

  reporte.filas.forEach((f, idx) => {
    const r = filaSub + 1 + idx;
    const { fila: def } = f;
    const concepto = hoja.getCell(r, 1);
    concepto.value = def.texto.trim();

    if (def.tipo === "titulo") {
      const rotulo = def.bloque === "DISPONIBILIDADES";
      concepto.font = rotulo
        ? { bold: true, size: 11, color: { argb: AZUL_DISPONIBILIDADES } }
        : { bold: true };
      if (def.bloque === "EGRESOS") concepto.alignment = { horizontal: "center" };
      if (!rotulo) {
        for (let c = 1; c < colObs + (conObservaciones ? 1 : 0); c++) {
          hoja.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BANDA } };
        }
      } else if (dispComoSaldo) {
        // «Saldo» sobre las columnas Presupuestado y Real de cada mes, como la pantalla.
        for (let i = 0; i < meses; i++) {
          for (const k of [0, 1]) {
            const celda = hoja.getCell(r, 2 + i * 4 + k);
            celda.value = "Saldo";
            celda.font = { bold: true, size: 9, color: { argb: AZUL_DISPONIBILIDADES } };
            celda.alignment = { horizontal: "center" };
          }
        }
      }
      return;
    }

    const esTotalVisual = def.tipo === "total" || def.tipo === "capital" || def.tipo === "disponible";
    const enDisp = def.bloque === "DISPONIBILIDADES";
    if (esTotalVisual) {
      concepto.font = { bold: true };
      concepto.alignment = { horizontal: "right" };
      concepto.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL } };
    } else if (enDisp) {
      concepto.font = { bold: true };
      concepto.value = def.texto.trim().toUpperCase();
    }
    f.celdas.forEach((celda, i) => {
      const valores = valoresDeCeldas(def, celda, dispComoSaldo);
      valores.forEach((v, k) => {
        const c = hoja.getCell(r, 2 + i * 4 + k);
        c.value = v;
        c.numFmt = k === 2 ? FORMATO_AVANCE : FORMATO_IMPORTE;
        if (esTotalVisual) {
          c.font = { bold: true };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL } };
        } else if (k < 2) {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DATO } };
        }
        if (enDisp) {
          c.alignment = { horizontal: "center" };
          c.font = { bold: true };
        }
      });
    });
    if (conObservaciones && observaciones[idx].length > 0) {
      hoja.getCell(r, colObs).value = observaciones[idx].join(" · ");
      hoja.getCell(r, colObs).font = { italic: true, color: { argb: "FF6B6B6B" } };
    }
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
