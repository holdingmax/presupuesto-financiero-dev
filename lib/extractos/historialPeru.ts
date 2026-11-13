import { agregarHistorial, type ResultadoHistorial } from "./historialEmpresa";
import { equivalenciaEtiquetaPeru } from "./etiquetasPeru";

// Historial de arranque de Havanna Perú: agrega las filas clasificadas a mano de los libros PF (columna DETALLE). Es el caso particular
// de lib/extractos/historialEmpresa.ts con las equivalencias de etiquetas de Perú y el dedup global (el Nº de documento es único).

export type FilaLibroPeru = { fecha: string; nroDoc: string; concepto: string; importe: number; etiqueta: string };

export type ResultadoHistorialPeru = ResultadoHistorial;

export function agregarHistorialPeru(filas: Iterable<FilaLibroPeru>, lista?: readonly string[]): ResultadoHistorialPeru {
  const conOrigen = (function* () {
    for (const f of filas) yield { ...f, origen: "" };
  })();
  return agregarHistorial(conOrigen, (f) => equivalenciaEtiquetaPeru(f.etiqueta, lista), { dedup: "global" });
}
