import { CLASIFICACIONES_POR_EMPRESA } from "@/lib/config";
import { normalizarEtiqueta } from "./etiquetasPeru";

// Equivalencias APROBADAS (Romina, 2026-11) entre la columna «Detalle» de las pestañas BANCO de los libros PF de Plate Silver y los
// valores de la lista de la empresa (lib/config.ts: CLASIFICACIONES_POR_EMPRESA["plate-silver"]). Lo que no figura acá no se mapea.
//
// Quedan SIN SUGERIR, por decisión de Romina («son dos cosas separadas»):
//   · PROVEEDORES: se reparte entre 14 conceptos de la lista según el beneficiario; la etiqueta del libro no lo distingue.
//   · IMPUESTOS: se reparte entre 5 conceptos de impuestos y el texto del movimiento es genérico.

const LISTA_PLATE_SILVER = CLASIFICACIONES_POR_EMPRESA["plate-silver"] ?? [];

const EQUIVALENCIAS: Readonly<Record<string, string>> = {
  SUELDOS: "SUELDO",
  AGUINALDOS: "AGUINALDO",
  COMISION: "COMISION BANCARIA",
  // En el resumen del libro «Otro (retención UI)» es IMPUESTO PERCEPCION IVA (UI), NO el «OTROS» de la lista.
  "OTROS (PERCEPCION UI)": "IMPUESTO PERCEPCION IVA (UI)",
  "OTRO (PERCEPCION UI)": "IMPUESTO PERCEPCION IVA (UI)",
  "OTRO REPOSICION DE FONDO FIJO": "REPOSICION FONDO FIJO",
  "OTRO REPOSICION DE FONDOS FIJOS": "REPOSICION FONDO FIJO",
};

const SIN_SUGERIR = new Set(["PROVEEDORES", "IMPUESTOS"]);

// El valor de la lista de Plate Silver que corresponde a la etiqueta del libro, o null si no hay equivalencia (o está excluida).
export function equivalenciaEtiquetaPlateSilver(etiqueta: string, lista: readonly string[] = LISTA_PLATE_SILVER): string | null {
  const e = normalizarEtiqueta(etiqueta);
  if (e === "" || SIN_SUGERIR.has(e) || !isNaN(Number(e))) return null;
  const directo = lista.find((c) => normalizarEtiqueta(c) === e);
  if (directo) return directo;
  const alias = EQUIVALENCIAS[e];
  return alias !== undefined && lista.includes(alias) ? alias : null;
}
