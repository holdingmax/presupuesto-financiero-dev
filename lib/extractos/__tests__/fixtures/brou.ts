import * as XLSX from "xlsx";
import type { Celda } from "@/lib/extractos/tipos";

// Fixtures SINTÉTICOS con la forma del "Detalle de Movimiento de Cuenta" del BROU (no son datos reales del banco).

export const CUENTA_UYU = "110509829-00001";
export const CUENTA_USD = "110509829-00002";

export type MovBrou = { serial: number; descripcion: string; doc: string; asunto: string; debito?: number; credito?: number };

// Serial de Excel de un día de octubre de 2026 (46296 = 1/10/2026).
export const serialOct = (dia: number) => 46295 + dia;

const VACIA: Celda[] = [];

export type OpcionesHojaBrou = { cuenta?: string; monedaTexto?: string; movs: MovBrou[]; leyenda?: boolean };

// Del más nuevo al más viejo, como lo baja el banco.
export function hojaBrou(opciones: OpcionesHojaBrou): Celda[][] {
  const { cuenta = CUENTA_USD, monedaTexto = "U$S", movs, leyenda = true } = opciones;
  const filas: Celda[][] = [];
  filas.push(VACIA, ["Fecha: 11/11/2026 12:18"], ["Saldos y Movimientos"], VACIA, [cuenta]);
  filas.push([`Saldo disponible\n${monedaTexto} 82.256,11`, null, `Nº de Cuenta\nCA ${cuenta}`, null, `Moneda\n${monedaTexto}`, "N° de Cuenta anterior\nCA 600-7472688"]);
  for (let i = filas.length; i < 29; i++) filas.push(VACIA);
  filas.push(["Movimientos"], VACIA, VACIA);
  filas.push(["Fecha", "Descripción", null, "Número de documento", "Asunto", "Dependencia", "Débito", "Crédito"]);
  for (const m of movs) {
    filas.push([m.serial, m.descripcion, null, m.doc, m.asunto, "171 - Canales Digitales", m.debito ?? null, m.credito ?? null]);
  }
  if (leyenda) {
    filas.push(VACIA, VACIA, ["Esta información es la que consta en los Sistemas del Banco en el día y hora indicados, y está supeditada a los ajustes que pudieran realizarse en los mismos."]);
  }
  return filas;
}

export const grillaBrou = (o: OpcionesHojaBrou) => ({ nombre: "Hoja1 - Table 1", filas: hojaBrou(o), date1904: false });

// .xls binario (BIFF8) de verdad, para probar el camino de bytes.
export function xlsBrou(o: OpcionesHojaBrou): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(hojaBrou(o).map((f) => f.map((c) => (c === null ? undefined : c))));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hoja1 - Table 1");
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "biff8" }));
}

// 8 movimientos USD: un trío y un par de comisiones sin Nº de documento (con asuntos distintos), débitos y créditos.
export const MOVS_USD: MovBrou[] = [
  { serial: serialOct(27), descripcion: "SPI - COMISIÓN", doc: "", asunto: "Pago UI 20 al 26 de Octubre 2026", debito: 1.71 },
  { serial: serialOct(22), descripcion: "TRF. E-BROU OTROS", doc: "2610220686522288", asunto: "PLATESILVER S.A. - VTA USD A UYU", debito: 13417.72 },
  { serial: serialOct(14), descripcion: "SPI - COMISIÓN", doc: "", asunto: "Pago factura 2381", debito: 1.71 },
  { serial: serialOct(14), descripcion: "SPI - COMISIÓN", doc: "", asunto: "Pago factura 322", debito: 1.71 },
  { serial: serialOct(14), descripcion: "SPI - COMISIÓN", doc: "", asunto: "Pago UI 06 al 12 de Octubre 2026", debito: 1.71 },
  { serial: serialOct(6), descripcion: "TRANSFERENCIA RECIBIDA SPI", doc: "00123456", asunto: "", credito: 2500 },
  { serial: serialOct(6), descripcion: "SPI - COMISIÓN", doc: "", asunto: "Pago factura A 8507", debito: 1.7 },
  { serial: serialOct(1), descripcion: "DEPÓSITO CON CHEQUE", doc: "4567", asunto: "", credito: 100.5 },
];
