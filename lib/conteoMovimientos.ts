import { normalizarTexto } from "@/lib/texto";

// Reconocimiento de movimientos ya cargados al subir un extracto (decisión
// 2026-10-07). Kike sube el extracto ACUMULATIVO cada semana: sin esto, cada
// subida volvía a insertar todo lo anterior como filas nuevas (sin las ediciones
// a mano) y el Reporte, que suma todas las semanas cerradas, lo contaba dos veces.
//
// No es una deduplicación por clave única: se CUENTA. Hay movimientos reales
// idénticos en todos sus campos (ej. varios débitos iguales el mismo día), así
// que si el archivo trae N filas con una clave y el presupuesto ya tiene M, se
// cargan N − M (ninguna si da ≤ 0). Así funcionan igual el extracto acumulativo,
// la carga día a día y la resubida del mismo archivo, sin perder movimientos
// legítimos. Funciones puras: las consultas viven en ejecucion/actions.ts.

// Centavos (con signo) de un número leído del Excel, redondeando como Postgres
// redondea un numeric(18,2): mitad lejos del cero, sobre la representación
// decimal más corta del número (la misma que usa Prisma al mandarlo) — no sobre
// el binario, donde 1.005 * 100 da 100.49999. Un saldo calculado con fórmula
// puede venir como 1234.5600000001 y tiene que dar la misma clave que el 1234.56
// guardado.
export function centavosDeNumero(valor: number): number {
  const negativo = valor < 0;
  const texto = String(Math.abs(valor));
  let centavos: number;
  if (/e/i.test(texto)) {
    centavos = Math.round(Math.abs(valor) * 100);
  } else {
    const [entero, decimales = ""] = texto.split(".");
    centavos = Number(entero) * 100 + Number((decimales + "00").slice(0, 2));
    if ((decimales[2] ?? "0") >= "5") centavos += 1;
  }
  return negativo && centavos !== 0 ? -centavos : centavos;
}

// "-1234.56" (texto de un numeric(18,2) de Postgres) → -123456, sin pasar por float.
export function centavosDeDecimalTexto(texto: string): number {
  const negativo = texto.startsWith("-");
  const [entero, decimales = ""] = texto.replace("-", "").split(".");
  const centavos = Number(entero) * 100 + Number((decimales + "00").slice(0, 2));
  return negativo && centavos !== 0 ? -centavos : centavos;
}

// Centavos con signo → texto decimal exacto para Prisma ("-1234.56"). Se guarda
// así (y no el float crudo) para que lo que queda en la base sea exactamente lo
// que la clave usó.
export function decimalTextoDeCentavos(centavos: number): string {
  const magnitud = Math.abs(centavos);
  const pesos = Math.floor(magnitud / 100);
  const cent = String(magnitud % 100).padStart(2, "0");
  return `${centavos < 0 ? "-" : ""}${pesos}.${cent}`;
}

// Moneda de todo lo cargado antes de que existiera la columna (MovimientoBancario.moneda, default de la base).
export const MONEDA_PREDETERMINADA = "ARS";

// La moneda entra en una clave SOLO cuando no es la predeterminada: así las claves de los movimientos en
// pesos (todo lo ya cargado) quedan byte a byte iguales a las de antes y nada se vuelve a cargar. Vacía
// o sin dato = pesos. Devuelve lo que se agrega al final de la clave ([] para pesos).
export function monedaParaClave(moneda: string | null | undefined): string[] {
  const m = (moneda ?? "").trim().toUpperCase();
  return m === "" || m === MONEDA_PREDETERMINADA ? [] : [m];
}

export type CamposClave = {
  fecha: Date;
  importeCentavos: number;
  bancoYCuenta: string;
  concepto: string;
  nroReferencia: string | null;
  saldoCentavos: number | null; // null es un valor más de la clave
  // Sin dato o "ARS": no entra en la clave (ver monedaParaClave).
  moneda?: string | null;
};

// fecha (día) + importe + cuenta normalizada + concepto normalizado + nro de
// referencia + saldo. Con el saldo, la clave es casi única dentro de un extracto
// (medido 2026-10-06: Brillante 1 repetida en 16.521 filas, HWC 10 en 5.106 —
// sin saldo eran 142 y 156); los empates que quedan los resuelve el conteo.
// JSON.stringify: separador sin ambigüedad aunque el concepto traiga "|".
export function claveMovimiento(m: CamposClave): string {
  return JSON.stringify([
    m.fecha.toISOString().slice(0, 10),
    m.importeCentavos,
    normalizarTexto(m.bancoYCuenta),
    normalizarTexto(m.concepto),
    (m.nroReferencia ?? "").trim(),
    m.saldoCentavos,
    ...monedaParaClave(m.moneda),
  ]);
}

export function contarPorClave(claves: string[]): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const c of claves) conteo.set(c, (conteo.get(c) ?? 0) + 1);
  return conteo;
}

// Recorre el archivo en orden: de cada clave, las primeras M apariciones (M = las
// que ya están cargadas) cuentan como "ya cargadas"; el resto son nuevas. Entre
// filas con la misma clave da igual cuáles se toman — son idénticas en todo lo
// que se compara.
export function separarNuevas<T>(
  filas: T[],
  claveDe: (fila: T) => string,
  yaCargadas: Map<string, number>
): { nuevas: T[]; cantidadYaCargadas: number } {
  const restantes = new Map(yaCargadas);
  const nuevas: T[] = [];
  let cantidadYaCargadas = 0;
  for (const fila of filas) {
    const clave = claveDe(fila);
    const quedan = restantes.get(clave) ?? 0;
    if (quedan > 0) {
      restantes.set(clave, quedan - 1);
      cantidadYaCargadas++;
    } else {
      nuevas.push(fila);
    }
  }
  return { nuevas, cantidadYaCargadas };
}

// Cuenta "numerada" = tiene al menos un dígito ("MACRO 565", "BSE 042"). Las que
// no (EFECTIVO, CHEQUE, DÓLAR, "(sin banco)") se repiten entre empresas por
// naturaleza, así que no disparan el aviso de cuentas compartidas.
export function esCuentaNumerada(bancoYCuenta: string): boolean {
  return /\d/.test(normalizarTexto(bancoYCuenta));
}
