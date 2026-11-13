import { CLASIFICACIONES_POR_EMPRESA } from "@/lib/config";
import { normalizarEtiqueta } from "./etiquetasPeru";

// Equivalencias APROBADAS (Romina, 2026-11) entre lo que el contador de Bradenton escribió a mano en la pestaña CHASE de los libros PF
// (la columna «Check or Slip #», que en el libro es la etiqueta de clasificación) y los valores de la lista de la empresa
// (lib/config.ts: CLASIFICACIONES_POR_EMPRESA.bradenton). Se validaron contra la columna «Ejecutado» del libro (septiembre y octubre):
// sumando las filas mapeadas sale, al centavo, el importe de cada concepto.
//
// Una regla va por TIPO de movimiento y no por etiqueta: todo cheque pagado (Type = CHECK_PAID) es «CHEQ EMITIDOS (DEBITADOS)»,
// aunque el contador lo haya etiquetado PROVEEDORES, ADMINISTRATION FEE o REPARACION Y MANTENIMIENTO (el libro los resume aparte).
// Lo que no figura acá NO se mapea (queda afuera del historial de arranque, no se inventa una equivalencia).

const LISTA_BRADENTON = CLASIFICACIONES_POR_EMPRESA["bradenton"] ?? [];

export const CLASIFICACION_CHEQUES_BRADENTON = "CHEQ EMITIDOS (DEBITADOS)";

const EQUIVALENCIAS: Readonly<Record<string, string>> = {
  REBATE: "REBATE",
  "REBATE COMBUSTIBLE": "REBATE",
  SUELDOS: "SUELDOS",
  LOTTERY: "LOTTERY",
  "SALE TAX": "TAX",
  "FOOD TRUCK": "COBRO FOOD TRUCK",
  "VENTA ICE": "VENTA ICE MACHINE-TC",
  "DEPOSITO ICE MACHINE": "VENTA ICE MACHINE-TC",
  "GASTOS BANCARIOS": "COM Y GTOS BRIOS",
  "COMISIONES Y GASTOS BANCARIOS": "COM Y GTOS BRIOS",
  DEPOSITO: "DEP EFECTIVO",
  CORPORATE: "EXPENSAS",
  TELEFONO: "SERVICIOS",
  SEGURO: "SERVICIOS",
  AGUA: "SERVICIOS",
  "ENERGIA ELECTRICA": "SERVICIOS",
  ALARMA: "SERVICIOS",
  INTERNET: "SERVICIOS",
  ELISTAR: "SERVICIOS",
  "REPARACION Y MANTENIMIENTO": "MANTENIMIENTO Y REPARACIONES",
  "ADMINISTRATION FEE": "HONORARIOS + ABONOS MENSUALES",
  "MOVILIDAD Y VIATICOS": "HONORARIOS + ABONOS MENSUALES",
  PROVEEDORES: "COMPRA MERCS C-STORE",
  NAC: "OTROS",
};

// El valor de la lista de Bradenton que corresponde a la fila del libro, o null si no hay equivalencia.
export function equivalenciaBradenton(etiqueta: string, tipo?: string, lista: readonly string[] = LISTA_BRADENTON): string | null {
  const destino = (v: string) => (lista.includes(v) ? v : null);
  if (normalizarEtiqueta(tipo ?? "") === "CHECK_PAID") return destino(CLASIFICACION_CHEQUES_BRADENTON);
  const e = normalizarEtiqueta(etiqueta);
  if (e === "") return null;
  // «EFT RCV-23174», «EFT RCV-23426»…: un número distinto por fila; son la acreditación neta de cupones (ingresos y reversas).
  if (/^EFT RCV-\d+$/.test(e)) return destino("COBRANZAS");
  const directo = lista.find((c) => normalizarEtiqueta(c) === e);
  if (directo) return directo;
  const alias = EQUIVALENCIAS[e];
  return alias !== undefined ? destino(alias) : null;
}
