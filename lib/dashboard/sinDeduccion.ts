import type { Alcance } from "@/lib/dashboard/alcance";
import { normalizarUnidad } from "@/lib/dashboard/unidades";

// Helpers PUROS para que el dashboard no deje DEDUCIR otras empresas (Entrega 1). Sin Prisma ni next/*.
//
// Reglas:
//  - Ningún total, porcentaje ni conteo sale del holding completo ni de la cantidad de empresas: solo de lo que está en el
//    alcance. Un usuario con una sola empresa no ve ningún número que dependa de las demás.
//  - En un movimiento prorrateado cuenta SOLO la porción de la unidad del alcance. El importe del movimiento padre no se
//    usa nunca: padre menos porción dejaría ver cuánto le tocó a las otras unidades.
//  - Sin ranking ni posiciones ("2° de 12"), sin «cantidad de empresas», sin promedios del holding.

export function unidadEnAlcance(unidad: string, alcance: Alcance): boolean {
  return alcance.unidades.includes(normalizarUnidad(unidad));
}

// Filas cuya unidad es del alcance (defensa en profundidad: la consulta ya filtra, esto vuelve a filtrar).
export function soloDelAlcance<T>(filas: readonly T[], alcance: Alcance, unidadDe: (fila: T) => string): T[] {
  return filas.filter((f) => unidadEnAlcance(unidadDe(f), alcance));
}

export type PorcionDeMovimiento = { unidadNegocio: string; importeCentavos: number };

export type MovimientoConPorciones = {
  importeCentavos: number;
  unidadNegocio: string;
  // Prorrateo (MovimientoBancarioDesglose). Vacío = no está prorrateado.
  porciones: readonly PorcionDeMovimiento[];
};

// Importe (en centavos, con signo) de un movimiento SOLO en lo que toca al alcance:
//  - prorrateado: la suma de las porciones cuya unidad es del alcance (el importe del padre no cuenta);
//  - sin prorrateo: su importe si su unidad es del alcance.
// null = nada del movimiento es del alcance (no cuenta ni en importes ni en conteos).
export function importeDelAlcance(movimiento: MovimientoConPorciones, alcance: Alcance): number | null {
  if (movimiento.porciones.length > 0) {
    const propias = movimiento.porciones.filter((p) => unidadEnAlcance(p.unidadNegocio, alcance));
    return propias.length === 0 ? null : propias.reduce((suma, p) => suma + p.importeCentavos, 0);
  }
  return unidadEnAlcance(movimiento.unidadNegocio, alcance) ? movimiento.importeCentavos : null;
}

// Cantidad de movimientos que tocan al alcance (uno prorrateado cuenta una vez si alguna porción es del alcance).
export function contarMovimientosDelAlcance(movimientos: readonly MovimientoConPorciones[], alcance: Alcance): number {
  return movimientos.filter((m) => importeDelAlcance(m, alcance) !== null).length;
}

export function sumarImportesDelAlcance(movimientos: readonly MovimientoConPorciones[], alcance: Alcance): number {
  return movimientos.reduce((suma, m) => suma + (importeDelAlcance(m, alcance) ?? 0), 0);
}

// ---- Totales y porcentajes -------------------------------------------------------------------------------------

declare const marcaTotal: unique symbol;

// Total que sale SOLO de empresas del alcance. Es el único denominador que acepta porcentajeDelAlcance.
export type TotalDelAlcance = Readonly<{ centavos: number; rotulo: string }> & { readonly [marcaTotal]: true };

// «Total del holding» solo cuando el alcance ES el holding (ADMIN); para el resto, «Total de tus empresas». Sin números:
// un rótulo nunca dice cuántas empresas tiene el alcance.
export function rotuloDeTotal(alcance: Alcance): string {
  return alcance.esHolding ? "Total del holding" : "Total de tus empresas";
}

// Suma lo que cada empresa del alcance aportó (clave = id de empresa). Las claves que no son del alcance se IGNORAN, aunque
// vengan en los datos: el total nunca incluye otra empresa.
export function totalDelAlcance(porEmpresa: ReadonlyMap<string, number>, alcance: Alcance): TotalDelAlcance {
  let centavos = 0;
  for (const e of alcance.empresas) centavos += porEmpresa.get(e.id) ?? 0;
  return Object.freeze({ centavos, rotulo: rotuloDeTotal(alcance) }) as unknown as TotalDelAlcance;
}

// Porcentaje de `parteCentavos` sobre un total del alcance (por ejemplo 12,5 = 12,5 %). null si el total es 0: no se divide.
export function porcentajeDelAlcance(parteCentavos: number, total: TotalDelAlcance): number | null {
  if (total.centavos === 0) return null;
  return (parteCentavos / total.centavos) * 100;
}

// De un neto por unidad de negocio (clave = unidad), lo que le toca a cada EMPRESA del alcance. Las unidades que no son
// del alcance se ignoran. Una empresa del alcance sin movimientos aparece con 0.
export function desglosePorEmpresa(
  porUnidad: ReadonlyMap<string, number>,
  alcance: Alcance
): { empresaId: string; nombre: string; centavos: number }[] {
  const normalizado = new Map<string, number>();
  for (const [unidad, centavos] of porUnidad) {
    const u = normalizarUnidad(unidad);
    normalizado.set(u, (normalizado.get(u) ?? 0) + centavos);
  }
  return alcance.empresas.map((e) => ({
    empresaId: e.id,
    nombre: e.nombre,
    centavos: e.unidades.reduce((suma, u) => suma + (normalizado.get(u) ?? 0), 0),
  }));
}
