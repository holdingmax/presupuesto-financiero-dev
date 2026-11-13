import { compararMonedas, normalizarMoneda } from "@/lib/moneda";

// Bloque "Sin clasificar" del Reporte (solo lectura). Los movimientos con clasificación «SIN CLASIFICAR» no
// entran en ninguna fila del Real, así que sin este aviso desaparecen del Reporte sin que nadie se entere.
// NO cambia el Real ni ningún total, y no frena ni modifica el cierre semanal (su aviso sigue como está).
// Parte pura: la consulta está en lib/reporte.ts (calcularSinClasificarDelPeriodo).

// Ingresos (importe > 0) y egresos (importe < 0) van por separado, sin netear. Centavos con signo.
export type Tramo = { movimientos: number; centavos: number };

export type FilaSinClasificar = {
  estado: "ABIERTA" | "CERRADA";
  moneda: string;
  ingresos: Tramo;
  egresos: Tramo;
};

export type GrupoSinClasificar = { moneda: string; ingresos: Tramo; egresos: Tramo };

export type BloqueSinClasificar = {
  // Semanas CERRADAS: ya no se pueden editar y no suman al Real.
  cerradas: GrupoSinClasificar[];
  // Semana ABIERTA: todavía se pueden clasificar (provisorio).
  abiertas: GrupoSinClasificar[];
};

export const TEXTO_SIN_CLASIFICAR_CERRADAS = "Semanas cerradas: no suman al Real.";
export const TEXTO_SIN_CLASIFICAR_ABIERTAS = "Semana abierta: pendientes de clasificar (provisorio).";

function agrupar(filas: readonly FilaSinClasificar[]): GrupoSinClasificar[] {
  const porMoneda = new Map<string, GrupoSinClasificar>();
  for (const f of filas) {
    if (f.ingresos.movimientos <= 0 && f.egresos.movimientos <= 0) continue;
    const moneda = normalizarMoneda(f.moneda);
    const g = porMoneda.get(moneda) ?? {
      moneda,
      ingresos: { movimientos: 0, centavos: 0 },
      egresos: { movimientos: 0, centavos: 0 },
    };
    g.ingresos.movimientos += f.ingresos.movimientos;
    g.ingresos.centavos += f.ingresos.centavos;
    g.egresos.movimientos += f.egresos.movimientos;
    g.egresos.centavos += f.egresos.centavos;
    porMoneda.set(moneda, g);
  }
  return Array.from(porMoneda.values()).sort((a, b) => compararMonedas(a.moneda, b.moneda));
}

// null = no hay ningún movimiento sin clasificar: el bloque no se muestra.
export function armarBloqueSinClasificar(filas: readonly FilaSinClasificar[]): BloqueSinClasificar | null {
  const cerradas = agrupar(filas.filter((f) => f.estado === "CERRADA"));
  const abiertas = agrupar(filas.filter((f) => f.estado === "ABIERTA"));
  if (cerradas.length === 0 && abiertas.length === 0) return null;
  return { cerradas, abiertas };
}
