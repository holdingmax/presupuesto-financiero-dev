import * as XLSX from "xlsx";
import { encabezadoHavannaPeru } from "./havannaPeru";
import { fechaDeCelda } from "./fechas";
import { verificarCantidadFilasHavannaPeru, verificarTamanoHavannaPeru } from "./limites";
import { ErrorExtracto, type Celda, type HojaGrilla } from "./tipos";

// Etapa 2, paso 2: de un libro PF con decenas de pestañas, encontrar la de movimientos del mes
// POR CONTENIDO (el encabezado), nunca por el nombre ("Hoja1" no cuenta) y leer SOLO esa con
// SheetJS (ExcelJS cargaría todo el libro: ~360 MB). Tres pasadas baratas:
//   1) nombres de pestañas (sin parsear celdas);
//   2) las primeras filas de cada pestaña, solo para ver si tiene el encabezado de movimientos;
//   3) de las que lo tienen, solo la columna F. Operación (desde/hasta/cantidad), sin conservar la grilla;
//   y al final se lee COMPLETA solo la pestaña elegida.

const FILAS_PARA_DETECTAR = 45;

export type PeriodoHavannaPeru = { desde: Date; hasta: Date }; // medianoche UTC, ambos inclusive

export type PestanaCandidata = { nombre: string; desde: Date; hasta: Date; filas: number };

export type SeleccionPestana =
  | { tipo: "elegida"; hoja: HojaGrilla; candidata: PestanaCandidata }
  // Más de una pestaña dentro del período, o ninguna: la pantalla muestra un selector.
  | { tipo: "candidatas"; motivo: "varias_en_periodo" | "ninguna_en_periodo"; candidatas: PestanaCandidata[] };

function celdaDeValor(valor: unknown): Celda {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string") return valor;
  if (valor instanceof Date) return valor;
  if (typeof valor === "boolean") return valor ? "VERDADERO" : "FALSO";
  return null;
}

function leerLibro(bytes: Uint8Array, extra: Partial<XLSX.ParsingOptions>): XLSX.WorkBook {
  try {
    return XLSX.read(bytes, {
      type: "buffer",
      raw: true,
      cellDates: false, // fechas como serial
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      cellText: false,
      bookVBA: false,
      ...extra,
    });
  } catch {
    throw new ErrorExtracto("No pude leer el archivo: está dañado o no es un Excel (.xlsx).");
  }
}

function grillaDeHoja(libro: XLSX.WorkBook, nombre: string): HojaGrilla {
  const date1904 = Boolean(libro.Workbook?.WBProps?.date1904);
  const hoja = libro.Sheets[nombre];
  const ref = hoja?.["!ref"];
  if (!hoja || !ref) return { nombre, filas: [], date1904 };
  // El rango empieza en A1 para que índice de fila/columna = posición real.
  const rango = XLSX.utils.decode_range(ref);
  rango.s = { r: 0, c: 0 };
  hoja["!ref"] = XLSX.utils.encode_range(rango);
  const crudas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: null, blankrows: true });
  return { nombre, filas: crudas.map((f) => f.map(celdaDeValor)), date1904 };
}

function verificarBytes(bytes: Uint8Array) {
  const r = verificarTamanoHavannaPeru(bytes.byteLength);
  if (!r.ok) throw new ErrorExtracto(r.error);
}

// Pasadas 1-3: pestañas con encabezado de movimientos, con su rango de fechas y cantidad de filas.
export function listarPestanasMovimientos(bytes: Uint8Array): PestanaCandidata[] {
  verificarBytes(bytes);
  const nombres = leerLibro(bytes, { bookSheets: true }).SheetNames;

  const primeras = leerLibro(bytes, { sheetRows: FILAS_PARA_DETECTAR });
  const conEncabezado = nombres.filter((n) => encabezadoHavannaPeru(grillaDeHoja(primeras, n).filas) !== null);
  if (conEncabezado.length === 0) return [];

  const libro = leerLibro(bytes, { sheets: conEncabezado });
  const candidatas: PestanaCandidata[] = [];
  for (const nombre of conEncabezado) {
    const { filas, date1904 } = grillaDeHoja(libro, nombre);
    const enc = encabezadoHavannaPeru(filas);
    if (!enc) continue;
    let desde = Infinity;
    let hasta = -Infinity;
    let cantidad = 0;
    for (let i = enc.indiceFila + 1; i < filas.length; i++) {
      const r = fechaDeCelda(filas[i][enc.col.fecha] ?? null, { date1904 });
      if (r.estado !== "ok") continue;
      cantidad++;
      desde = Math.min(desde, r.fecha.getTime());
      hasta = Math.max(hasta, r.fecha.getTime());
    }
    if (cantidad > 0) candidatas.push({ nombre, desde: new Date(desde), hasta: new Date(hasta), filas: cantidad });
    // La grilla de esta pestaña no se conserva (solo desde/hasta/filas).
  }
  return candidatas;
}

// Lee SOLO la pestaña pedida (y verifica el tope de filas del camino).
export function leerPestanaHavannaPeru(bytes: Uint8Array, nombre: string): HojaGrilla {
  verificarBytes(bytes);
  const libro = leerLibro(bytes, { sheets: [nombre] });
  if (!libro.Sheets[nombre]) throw new ErrorExtracto(`No encontré la pestaña "${nombre}" en el archivo.`);
  const hoja = grillaDeHoja(libro, nombre);
  const enc = encabezadoHavannaPeru(hoja.filas);
  if (!enc) throw new ErrorExtracto(`La pestaña "${nombre}" no tiene el encabezado de movimientos de Havanna Perú.`);
  const lim = verificarCantidadFilasHavannaPeru(Math.max(0, hoja.filas.length - enc.indiceFila - 1));
  if (!lim.ok) throw new ErrorExtracto(lim.error);
  return hoja;
}

// Elige por contenido: la única pestaña con TODAS sus fechas dentro del período. Si hay más de
// una o ninguna, devuelve la lista de candidatas (con desde/hasta y filas) para el selector.
// `nombreElegido` = el usuario ya eligió en el selector: se lee esa directo.
export function seleccionarPestanaHavannaPeru(
  bytes: Uint8Array,
  periodo: PeriodoHavannaPeru,
  nombreElegido?: string
): SeleccionPestana {
  const candidatas = listarPestanasMovimientos(bytes);
  if (nombreElegido !== undefined) {
    const c = candidatas.find((x) => x.nombre === nombreElegido);
    if (!c) throw new ErrorExtracto(`La pestaña "${nombreElegido}" no es una pestaña de movimientos del archivo.`);
    return { tipo: "elegida", hoja: leerPestanaHavannaPeru(bytes, c.nombre), candidata: c };
  }
  const dentro = candidatas.filter((c) => c.desde >= periodo.desde && c.hasta <= periodo.hasta);
  if (dentro.length === 1) {
    return { tipo: "elegida", hoja: leerPestanaHavannaPeru(bytes, dentro[0].nombre), candidata: dentro[0] };
  }
  if (dentro.length > 1) return { tipo: "candidatas", motivo: "varias_en_periodo", candidatas: dentro };
  return { tipo: "candidatas", motivo: "ninguna_en_periodo", candidatas };
}

