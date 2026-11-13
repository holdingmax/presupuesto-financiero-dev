import { normalizarConcepto, signoDeImporte, type GrupoHistorial } from "@/lib/clasificacionHistorial";
import { equivalenciaEtiquetaPeru } from "./etiquetasPeru";

// Historial de arranque de Havanna Perú: agrega las filas clasificadas a mano de los libros PF (columna DETALLE) en grupos
// (concepto normalizado + signo + clasificación + veces). PURO: quien lee los libros (prisma/scripts/sembrar-historial-peru.ts)
// le pasa las filas. Un mismo movimiento puede estar en dos libros (cada libro arrastra las pestañas de los meses anteriores):
// se cuenta una sola vez, por fecha + Nº de documento + importe + concepto.

export type FilaLibroPeru = { fecha: string; nroDoc: string; concepto: string; importe: number; etiqueta: string };

export type ResultadoHistorialPeru = {
  grupos: GrupoHistorial[];
  leidas: number;
  repetidas: number;
  sinEtiqueta: number;
  conceptoVacio: number;
  // Etiquetas del libro sin equivalencia en la lista de Perú → cuántas filas (no entran al historial).
  sinEquivalencia: Record<string, number>;
  usadas: number;
};

export function agregarHistorialPeru(filas: Iterable<FilaLibroPeru>, lista?: readonly string[]): ResultadoHistorialPeru {
  const vistas = new Set<string>();
  const conteo = new Map<string, GrupoHistorial>();
  const r: ResultadoHistorialPeru = { grupos: [], leidas: 0, repetidas: 0, sinEtiqueta: 0, conceptoVacio: 0, sinEquivalencia: {}, usadas: 0 };
  for (const f of filas) {
    r.leidas++;
    const clave = JSON.stringify([f.fecha, f.nroDoc.replace(/^0+/, ""), Math.round(f.importe * 100), f.concepto.trim()]);
    if (vistas.has(clave)) { r.repetidas++; continue; }
    vistas.add(clave);
    if (f.etiqueta.trim() === "") { r.sinEtiqueta++; continue; }
    const clasificacion = equivalenciaEtiquetaPeru(f.etiqueta, lista);
    if (clasificacion === null) {
      const k = f.etiqueta.replace(/\s+/g, " ").trim().toUpperCase();
      r.sinEquivalencia[k] = (r.sinEquivalencia[k] ?? 0) + 1;
      continue;
    }
    const concepto = normalizarConcepto(f.concepto);
    if (concepto === "") { r.conceptoVacio++; continue; }
    const signo = signoDeImporte(f.importe) === "I" ? 1 : -1;
    const k = JSON.stringify([concepto, signo, clasificacion]);
    const g = conteo.get(k) ?? { concepto, signo, clasificacion, veces: 0 };
    g.veces++;
    conteo.set(k, g);
    r.usadas++;
  }
  r.grupos = [...conteo.values()];
  return r;
}
