import { MONEDA_PREDETERMINADA } from "@/lib/conteoMovimientos";

// Moneda de los movimientos de Ejecución: símbolos, formato y totales POR moneda (nunca se suman monedas
// distintas entre sí). Parte pura, sin base: la usan tanto el servidor como los componentes del navegador.

// Símbolo de cada moneda que hoy existe. Una moneda que no está acá se muestra con su código ISO.
export const SIMBOLOS_MONEDA: Readonly<Record<string, string>> = {
  ARS: "$",
  PEN: "S/",
  USD: "US$",
  UYU: "$U",
};

// Sin dato o vacío es pesos (lo cargado antes de la columna moneda); el resto, el código en mayúsculas.
export function normalizarMoneda(moneda: string | null | undefined): string {
  const m = (moneda ?? "").trim().toUpperCase();
  return m === "" ? MONEDA_PREDETERMINADA : m;
}

export function esMonedaPredeterminada(moneda: string | null | undefined): boolean {
  return normalizarMoneda(moneda) === MONEDA_PREDETERMINADA;
}

export function simboloMoneda(moneda: string | null | undefined): string {
  const m = normalizarMoneda(moneda);
  return SIMBOLOS_MONEDA[m] ?? m;
}

// Lo que va delante del número. Pesos: "$" PEGADO al número, como se vio siempre ("$1.234,56", "$-1.234,56").
// Otras monedas: símbolo + espacio ("S/ 1.234,56", "US$ 1.234,56").
export function prefijoMoneda(moneda: string | null | undefined): string {
  return esMonedaPredeterminada(moneda) ? SIMBOLOS_MONEDA[MONEDA_PREDETERMINADA] : `${simboloMoneda(moneda)} `;
}

// Con centavos, es-AR. Para pesos devuelve EXACTAMENTE lo mismo que `$${formatearImporteConCentavos(valor)}`.
export function formatearConMoneda(valor: number, moneda: string | null | undefined): string {
  return `${prefijoMoneda(moneda)}${valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Pesos primero, después las demás por código.
export function compararMonedas(a: string, b: string): number {
  const pa = esMonedaPredeterminada(a);
  const pb = esMonedaPredeterminada(b);
  if (pa !== pb) return pa ? -1 : 1;
  return normalizarMoneda(a).localeCompare(normalizarMoneda(b), "es");
}

// ---------- Totales por moneda ----------

export type TotalMoneda = { moneda: string; centavos: number };

// Suma en centavos enteros, una entrada por moneda, ordenadas (pesos primero). Una moneda sin filas no
// aparece. Las monedas nunca se mezclan.
export function sumarPorMoneda(filas: readonly { moneda?: string | null; centavos: number }[]): TotalMoneda[] {
  const porMoneda = new Map<string, number>();
  for (const f of filas) {
    const m = normalizarMoneda(f.moneda);
    porMoneda.set(m, (porMoneda.get(m) ?? 0) + f.centavos);
  }
  return Array.from(porMoneda, ([moneda, centavos]) => ({ moneda, centavos })).sort((a, b) => compararMonedas(a.moneda, b.moneda));
}

// Junta varias listas de totales (ej. una por semana) moneda por moneda.
export function unirTotales(listas: readonly (readonly TotalMoneda[])[]): TotalMoneda[] {
  return sumarPorMoneda(listas.flat());
}

// El total en pesos (0 si no hay): es lo que sigue alimentando `totalImporte` y a todo lo que lo consume.
export function centavosEnPesos(totales: readonly TotalMoneda[]): number {
  return totales.find((x) => esMonedaPredeterminada(x.moneda))?.centavos ?? 0;
}

export function totalEnPesos(totales: readonly TotalMoneda[]): number {
  return centavosEnPesos(totales) / 100;
}

export type LineaDeTotal = { moneda: string; valor: number; texto: string; signo: "negativo" | "positivo" | "cero" };

// Lo que muestra el TOTAL de una pantalla: una línea por moneda. Sin ninguna fila (o solo ignoradas) se
// muestra el total en pesos en cero, igual que antes de que hubiera monedas.
export function lineasDeTotal(totales: readonly TotalMoneda[]): LineaDeTotal[] {
  const base = totales.length > 0 ? totales : [{ moneda: MONEDA_PREDETERMINADA, centavos: 0 }];
  return base.map((t) => {
    const valor = t.centavos / 100;
    return {
      moneda: t.moneda,
      valor,
      texto: formatearConMoneda(valor, t.moneda),
      signo: valor < 0 ? "negativo" : valor > 0 ? "positivo" : "cero",
    };
  });
}

// Moneda sin símbolo propio ni mapa: el código (para el Excel y los textos).
export function hayOtraMoneda(monedas: readonly (string | null | undefined)[]): boolean {
  return monedas.some((m) => !esMonedaPredeterminada(m));
}
