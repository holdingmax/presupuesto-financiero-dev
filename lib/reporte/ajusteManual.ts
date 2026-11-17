import { leerCuenta } from "@/lib/importes";
import { formatearCentavos } from "@/lib/reporte/bloqueo";
import { filaConAjusteManual, type Fila } from "@/lib/reporte/motor";

// Filas con parte calculada + tipeo (motor.filaConAjusteManual): la casilla del Real muestra el TOTAL (calculado + lo guardado a
// mano) y al guardar se persiste solo la DIFERENCIA: lo escrito menos el calculado que se mostró al cargar la pantalla. Así lo
// guardado es siempre la parte manual y el total no se duplica. Puro: sin Prisma ni next/*.

export type ManualDesdeTotal =
  | { ok: true; centavos: number | null; nota: string | null }
  | { ok: false; error: string };

// `texto`: lo escrito en la casilla (un número o una cuenta como 321.235,44+17.755,22: primero se resuelve el resultado y
// después se resta el calculado). `calculado`: centavos del calculado mostrado al cargar. Vacío, o un total igual al calculado,
// = sin parte manual (null: borra el valor guardado, o no escribe nada si no había). Respeta los centavos (enteros).
export function manualDesdeTotal(texto: string, calculado: number): ManualDesdeTotal {
  if (!Number.isSafeInteger(calculado)) return { ok: false, error: "Falta el valor calculado que se mostró: recargá el Reporte y probá de nuevo." };
  if (texto.trim() === "") return { ok: true, centavos: null, nota: null };
  const cuenta = leerCuenta(texto);
  if (!cuenta.ok) return { ok: false, error: cuenta.error };
  const diferencia = cuenta.centavos - calculado;
  if (diferencia === 0) return { ok: true, centavos: null, nota: null };
  return {
    ok: true,
    centavos: diferencia,
    nota: cuenta.nota === null ? null : `${cuenta.nota} (total) − ${formatearCentavos(calculado)} calculado`,
  };
}

// Lo que hace el guardado con UNA entrada de Real: si la fila no es de las que llevan calculado, no aplica (se guarda como siempre);
// si lo es, la pantalla tiene que haber mandado el calculado que mostró (sin él, guardar el total como manual lo duplicaría).
export type EntradaConAjuste =
  | { tipo: "no-aplica" }
  | { tipo: "error"; error: string }
  | { tipo: "cambio"; centavos: number | null; nota: string | null };

export function resolverEntradaReal(
  fila: Fila | undefined,
  periodo: string,
  columna: "PRESUPUESTADO" | "REAL",
  texto: string,
  calculadoMostrado: number | undefined
): EntradaConAjuste {
  if (columna !== "REAL" || !fila || !filaConAjusteManual(fila, periodo)) return { tipo: "no-aplica" };
  if (typeof calculadoMostrado !== "number") {
    return { tipo: "error", error: "la pantalla quedó desactualizada. Recargá el Reporte y probá de nuevo." };
  }
  const r = manualDesdeTotal(texto, calculadoMostrado);
  return r.ok ? { tipo: "cambio", centavos: r.centavos, nota: r.nota } : { tipo: "error", error: r.error };
}
