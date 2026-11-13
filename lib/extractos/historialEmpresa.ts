import { normalizarConcepto, signoDeImporte, type GrupoHistorial } from "@/lib/clasificacionHistorial";

// Historial de arranque de UNA empresa: agrega las filas clasificadas a mano de los libros PF en grupos (concepto normalizado + signo +
// clasificación + veces). PURO: quien lee los libros (prisma/scripts/sembrar-historial-empresa.ts) le pasa las filas y la función de
// equivalencia de etiquetas de la empresa (lib/extractos/etiquetas*.ts).
//
// Un mismo movimiento puede estar en dos libros (cada libro arrastra pestañas de meses anteriores) y hay que contarlo una sola vez.
//   · dedup "global": una fila cuya clave (fecha + Nº de documento + importe + concepto) ya se vio en CUALQUIER lugar no se cuenta
//     (Havanna Perú: el Nº de documento es único por movimiento).
//   · dedup "entre-origenes": solo se descartan las filas cuya clave ya estaba en un libro ANTERIOR; dentro de un mismo libro se
//     cuentan todas, incluso las repetidas (Chase no trae Nº de documento: dos movimientos legítimos pueden ser idénticos).

export type FilaLibro = {
  // Libro (archivo) del que sale la fila; solo importa con dedup "entre-origenes".
  origen: string;
  fecha: string; // AAAA-MM-DD
  nroDoc: string;
  concepto: string;
  importe: number;
  etiqueta: string;
  // Tipo de movimiento del banco, si el libro lo trae (Chase: CHECK_PAID, DEPOSIT…).
  tipo?: string;
};

export type EquivalenciaFila = (fila: { etiqueta: string; tipo?: string }) => string | null;

export type ResultadoHistorial = {
  grupos: GrupoHistorial[];
  leidas: number;
  repetidas: number;
  sinEtiqueta: number;
  conceptoVacio: number;
  // Etiquetas del libro sin equivalencia en la lista de la empresa → cuántas filas (no entran al historial).
  sinEquivalencia: Record<string, number>;
  usadas: number;
};

export function agregarHistorial(
  filas: Iterable<FilaLibro>,
  equivalencia: EquivalenciaFila,
  opciones: { dedup: "global" | "entre-origenes" }
): ResultadoHistorial {
  const vistasAntes = new Set<string>(); // claves de libros ya terminados (o de todo, con dedup "global")
  let vistasPropias = new Set<string>(); // claves del libro en curso (dedup "entre-origenes")
  let origenActual: string | null = null;
  const conteo = new Map<string, GrupoHistorial>();
  const r: ResultadoHistorial = { grupos: [], leidas: 0, repetidas: 0, sinEtiqueta: 0, conceptoVacio: 0, sinEquivalencia: {}, usadas: 0 };
  for (const f of filas) {
    r.leidas++;
    if (origenActual !== f.origen) {
      // Cambió de libro: lo visto en el anterior pasa a ser «de libros anteriores».
      for (const k of vistasPropias) vistasAntes.add(k);
      vistasPropias = new Set<string>();
      origenActual = f.origen;
    }
    const clave = JSON.stringify([f.fecha, f.nroDoc.replace(/^0+/, ""), Math.round(f.importe * 100), f.concepto.trim()]);
    if (vistasAntes.has(clave)) { r.repetidas++; continue; }
    if (opciones.dedup === "global") vistasAntes.add(clave);
    else vistasPropias.add(clave);
    if (f.etiqueta.trim() === "") { r.sinEtiqueta++; continue; }
    const clasificacion = equivalencia({ etiqueta: f.etiqueta, tipo: f.tipo });
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
