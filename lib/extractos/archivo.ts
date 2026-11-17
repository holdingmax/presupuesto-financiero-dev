import ExcelJS from "exceljs";
import {
  grillaDeHojaExcelJs,
  grillasDeBytes,
  grillasDeSheetJs,
  tipoContenedor,
} from "./contenedor";
import { detectarFormato, leerCrudo } from "./detectar";
import { leerFilasMadre, type FilaDescartadaMadre, type FilaMadre } from "./madre";
import { ErrorExtracto, type HojaGrilla, type LecturaExtracto, type OpcionesLectura } from "./tipos";

// Del archivo subido a filas, decidiendo el camino POR CONTENIDO (no por la extensión):
//   - .xlsx con la firma del madre, o cualquier .xlsx que no sea un extracto de banco
//     reconocido → camino madre, exactamente como hasta ahora (lib/extractos/madre.ts).
//   - extracto crudo de un banco (.xlsx de Galicia, .xls BIFF, texto/CSV) → su lector.
// Sin base de datos: la validación de la cuenta elegida y la carga viven en subirExtracto.

export type ArchivoLeido =
  | { tipo: "madre"; filas: FilaMadre[]; descartadas: FilaDescartadaMadre[]; hoja: string }
  | { tipo: "crudo"; lectura: LecturaExtracto }
  | { tipo: "error"; error: string }
  // Más de una hoja y ninguna se llama "Hoja1": se le pide elegir al usuario.
  | { tipo: "seleccionHoja"; hojas: string[] };

const NOMBRE_HOJA_EXTRACTO = "Hoja1";
// Alcanza con las primeras filas para ver los encabezados (el madre los trae en la fila 1;
// los bancos, dentro de las primeras ~40).
const FILAS_PARA_DETECTAR = 45;

function mensajeNoReconocido() {
  return "No reconozco este formato de extracto. Los soportados son Macro, Galicia, BBVA Francés, Nación, Santander y Santiago del Estero (descargados tal cual del banco) y el archivo madre (.xlsx).";
}

export async function leerArchivoSubido(
  bytes: Uint8Array,
  hojaElegida?: string,
  opciones: OpcionesLectura = {}
): Promise<ArchivoLeido> {
  try {
    if (tipoContenedor(bytes) === "xlsx") return await leerXlsx(bytes, hojaElegida, opciones);
    return leerNoXlsx(bytes, opciones);
  } catch (e) {
    if (e instanceof ErrorExtracto) return { tipo: "error", error: e.message };
    throw e;
  }
}

async function leerXlsx(bytes: Uint8Array, hojaElegida: string | undefined, opciones: OpcionesLectura): Promise<ArchivoLeido> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(bytes as unknown as ExcelJS.Buffer);

  // Si el usuario ya eligió una hoja explícitamente (reintento tras el selector), se usa
  // esa directo sin volver a evaluar nada.
  let hoja = hojaElegida ? libro.getWorksheet(hojaElegida) : undefined;
  if (hojaElegida && !hoja) return { tipo: "error", error: `No encontré la hoja "${hojaElegida}" en el archivo.` };

  if (!hoja) {
    if (libro.worksheets.length === 1) {
      hoja = libro.worksheets[0];
    } else {
      const hojaPorNombre = libro.getWorksheet(NOMBRE_HOJA_EXTRACTO);
      if (hojaPorNombre) {
        hoja = hojaPorNombre;
      } else {
        // Más de una hoja y ninguna se llama "Hoja1": antes se tomaba worksheets[0] en
        // silencio, lo que podía traer los movimientos de la empresa equivocada sin ningún
        // aviso. Ahora se corta acá y se le pide al usuario que elija.
        return { tipo: "seleccionHoja", hojas: libro.worksheets.map((h) => h.name) };
      }
    }
  }
  if (!hoja) return { tipo: "error", error: "El archivo no tiene ninguna hoja." };

  // ExcelJS solo para DETECTAR (encabezados): lee mal las fechas t="d" de Galicia (año 1905).
  const formato = detectarFormato(grillaDeHojaExcelJs(hoja, FILAS_PARA_DETECTAR));
  if (formato !== null && formato !== "MADRE") {
    const nombre = hoja.name;
    const grillas = grillasDeSheetJs(bytes);
    const grilla = grillas.find((g) => g.nombre === nombre) ?? grillas[0];
    return { tipo: "crudo", lectura: leerCrudo(grilla, formato, opciones) };
  }

  // MADRE, o un .xlsx que no se reconoce como banco: camino madre de siempre (si no tiene
  // las columnas esperadas, responde con su mensaje de siempre).
  const r = leerFilasMadre(hoja);
  if (!r.ok) return { tipo: "error", error: r.error };
  return { tipo: "madre", filas: r.filas, descartadas: r.descartadas, hoja: hoja.name };
}

function leerNoXlsx(bytes: Uint8Array, opciones: OpcionesLectura): ArchivoLeido {
  const hojas: HojaGrilla[] = grillasDeBytes(bytes);
  for (const hoja of hojas) {
    const formato = detectarFormato(hoja);
    if (formato === null) continue;
    if (formato === "MADRE") {
      return { tipo: "error", error: "El archivo madre tiene que subirse como .xlsx." };
    }
    return { tipo: "crudo", lectura: leerCrudo(hoja, formato, opciones) };
  }
  return { tipo: "error", error: mensajeNoReconocido() };
}
