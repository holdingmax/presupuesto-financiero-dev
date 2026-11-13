import { quitarDiacriticos } from "@/lib/texto";
import { CLASIFICACIONES_POR_EMPRESA } from "@/lib/config";

// Equivalencias entre las etiquetas que el contador de Havanna Perú escribió a mano en la columna DETALLE de los libros PF (la
// redacción cambió de un mes a otro) y los valores de la lista de la empresa (lib/config.ts: CLASIFICACIONES_POR_EMPRESA). Sin
// esto los votos del historial se reparten entre variantes del mismo concepto y el motor casi no llega a sugerir. Lo que no
// figura acá ni coincide con la lista NO se mapea (queda afuera del historial de arranque, no se inventa una equivalencia).

export function normalizarEtiqueta(etiqueta: string): string {
  return quitarDiacriticos(etiqueta).toUpperCase().replace(/\s+/g, " ").trim();
}

const EQUIVALENCIAS: Readonly<Record<string, string>> = {
  "COBRANZA CLIENTES": "COBRANZAS CLIENTES",
  "COMISIONES BCRIAS": "COMISIONES BANCARIAS",
  "PROVEED Y SERV": "PROVEEDORES Y SERVICIOS",
  "PROVEEDORES Y SERVICIO": "PROVEEDORES Y SERVICIOS",
  "SOLES A USD": "SOLES A DOLARES",
  PRESTAMO: "PRESTAMOS",
  "TARJETA DE CREDITO": "TARJETA",
  TARJETAS: "TARJETA",
  "IMPORTACION HAVANNA": "IMPORTACION",
};

const LISTA_PERU = CLASIFICACIONES_POR_EMPRESA["havanna-peru"] ?? [];

// El valor de la lista de Perú que corresponde a la etiqueta del libro, o null si no hay equivalencia segura.
export function equivalenciaEtiquetaPeru(etiqueta: string, lista: readonly string[] = LISTA_PERU): string | null {
  const e = normalizarEtiqueta(etiqueta);
  if (e === "") return null;
  const directo = lista.find((c) => normalizarEtiqueta(c) === e);
  if (directo) return directo;
  const alias = EQUIVALENCIAS[e];
  return alias !== undefined && lista.includes(alias) ? alias : null;
}
