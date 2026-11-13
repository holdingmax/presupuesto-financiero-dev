import { quitarDiacriticos } from "@/lib/texto";

// Sugerencia de clasificación a partir del HISTORIAL ya clasificado (los movimientos del archivo madre
// que clasificó Kike), para los extractos crudos. Funciones puras, sin base de datos: quien consulta
// arma la lista de movimientos y la pasa a construirIndice. Todo lo que devuelve es una SUGERENCIA
// (el llamador la marca sugeridaPorSistema = true y pasa por el panel de confirmación en lote):
// nada se confirma solo.

// Mayúsculas, sin tildes, sin las secuencias de 4 o más dígitos (CUIT, nros. de referencia, de
// cheque, de envío: cambian en cada movimiento y no dicen qué tipo de gasto es), sin signos raros
// y con los espacios colapsados. Los números cortos ("Suc.:809", "3OS") se conservan.
export function normalizarConcepto(concepto: string): string {
  return quitarDiacriticos(concepto)
    .toUpperCase()
    .replace(/\d{4,}/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type Signo = "I" | "E";

// Ingreso (importe > 0) o egreso: el mismo texto con signo opuesto es otra cosa (una devolución no
// es un gasto), así que el signo es parte de la clave.
export function signoDeImporte(importe: number): Signo {
  return importe > 0 ? "I" : "E";
}

const clave = (concepto: string, importe: number) => `${signoDeImporte(importe)}|${normalizarConcepto(concepto)}`;

export type MovimientoParaIndice = {
  concepto: string;
  importe: number;
  clasificacion: string;
  ignorado: boolean;
  sugeridaPorSistema: boolean;
  // Cuántos movimientos iguales representa esta fila (default 1): permite cargar el historial ya
  // agrupado por la base (concepto + signo + clasificación) en vez de traer decenas de miles de filas.
  veces?: number;
};

// clave (signo + concepto normalizado) → conteo por clasificación.
export type IndiceHistorial = Map<string, Map<string, number>>;

// Solo aprende de lo que una persona ya dio por bueno: no ignorados, con clasificación real (no
// "SIN CLASIFICAR") y que no sea una sugerencia del sistema sin confirmar. Todas las unidades juntas.
// Un concepto que queda vacío al normalizar (solo números) no se indexa.
export function construirIndice(movimientos: Iterable<MovimientoParaIndice>): IndiceHistorial {
  const indice: IndiceHistorial = new Map();
  for (const m of movimientos) {
    if (m.ignorado || m.sugeridaPorSistema) continue;
    const clasificacion = m.clasificacion.trim();
    if (clasificacion === "" || clasificacion === "SIN CLASIFICAR") continue;
    if (normalizarConcepto(m.concepto) === "") continue;
    const k = clave(m.concepto, m.importe);
    const conteos = indice.get(k) ?? new Map<string, number>();
    conteos.set(clasificacion, (conteos.get(clasificacion) ?? 0) + (m.veces ?? 1));
    indice.set(k, conteos);
  }
  return indice;
}

export type UmbralesSugerencia = {
  // Cuántas veces tiene que haber aparecido el concepto (con ese signo) en el historial.
  minApariciones: number;
  // Fracción de esas apariciones que tiene que tener la clasificación ganadora (0 a 1).
  minDominancia: number;
};

// Valores iniciales, provisorios hasta ver el backtest (prisma/scripts/backtest-clasificacion-historial.ts).
export const UMBRALES_INICIALES: UmbralesSugerencia = { minApariciones: 3, minDominancia: 0.9 };

export type SugerenciaHistorial = { clasificacion: string; apariciones: number; dominancia: number };

// null si el concepto no está en el historial, apareció pocas veces, hay empate entre dos
// clasificaciones o la ganadora no domina lo suficiente. Un empate nunca sugiere, aunque el umbral de
// dominancia fuera bajo: no hay una ganadora.
export function sugerir(
  concepto: string,
  importe: number,
  indice: IndiceHistorial,
  umbrales: UmbralesSugerencia = UMBRALES_INICIALES
): SugerenciaHistorial | null {
  if (normalizarConcepto(concepto) === "") return null;
  const conteos = indice.get(clave(concepto, importe));
  if (!conteos) return null;

  let apariciones = 0;
  let mejor: { clasificacion: string; n: number } | null = null;
  let empate = false;
  for (const [clasificacion, n] of conteos) {
    apariciones += n;
    if (mejor === null || n > mejor.n) {
      mejor = { clasificacion, n };
      empate = false;
    } else if (n === mejor.n) {
      empate = true;
    }
  }
  if (mejor === null || empate) return null;

  const dominancia = mejor.n / apariciones;
  if (apariciones < umbrales.minApariciones || dominancia < umbrales.minDominancia) return null;
  return { clasificacion: mejor.clasificacion, apariciones, dominancia };
}

// Aplica la sugerencia a las filas de un extracto crudo (todas entran "SIN CLASIFICAR"): la fila con
// historial suficiente y dominante queda con esa clasificación y sugeridaPorSistema = true (va al
// panel de confirmación en lote, nunca se confirma sola); la que no, queda SIN CLASIFICAR. No toca
// filas que ya traen otra clasificación. Devuelve filas nuevas (no muta) y cuántas se sugirieron.
export function aplicarSugerenciasDeHistorial<
  T extends { concepto: string; importe: number; clasificacion: string; sugeridaPorSistema: boolean },
>(
  filas: T[],
  indice: IndiceHistorial,
  umbrales: UmbralesSugerencia = UMBRALES_INICIALES
): { filas: T[]; sugeridas: number } {
  let sugeridas = 0;
  const resultado = filas.map((f) => {
    if (f.clasificacion !== "SIN CLASIFICAR") return f;
    const s = sugerir(f.concepto, f.importe, indice, umbrales);
    if (!s) return f;
    sugeridas++;
    return { ...f, clasificacion: s.clasificacion, sugeridaPorSistema: true };
  });
  return { filas: resultado, sugeridas };
}

// ---- Índice de UNA empresa --------------------------------------------------------------------------------------------------

// Una fila ya agrupada (concepto + signo + clasificación + cuántas veces), venga de los movimientos confirmados de la empresa o de
// su historial de arranque.
export type GrupoHistorial = { concepto: string; signo: number; clasificacion: string; veces: number };

// Índice que aprende SOLO de lo de la empresa y SOLO de valores de su lista de clasificaciones: lo que no esté en la lista (o sea
// «SIN CLASIFICAR») no cuenta, así nunca se sugiere un valor que la empresa no puede elegir. No hay respaldo global: si la
// empresa no tiene historial, el índice queda vacío y no se sugiere nada.
export function construirIndiceDeEmpresa(grupos: Iterable<GrupoHistorial>, lista: readonly string[]): IndiceHistorial {
  const permitidas = new Set(lista.map((c) => c.trim()));
  const validos: MovimientoParaIndice[] = [];
  for (const g of grupos) {
    if (!permitidas.has(g.clasificacion.trim())) continue;
    validos.push({ concepto: g.concepto, importe: g.signo, clasificacion: g.clasificacion, ignorado: false, sugeridaPorSistema: false, veces: g.veces });
  }
  return construirIndice(validos);
}
