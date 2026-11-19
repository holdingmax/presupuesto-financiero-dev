import type { Alcance } from "@/lib/dashboard/alcance";
import { claveEquivalencia } from "@/lib/reporte/motor";
import { domingoDeSemana, lunesDeSemana } from "@/lib/dashboard/semana";

// CONTROLES APARTE del Dashboard consolidado (Entrega 1). Módulo PURO (sin Prisma ni next/*).
//
// Un control NO es un bloque de números del dashboard: no se suma a ningún total, no entra en ningún porcentaje ni en la
// comparación con la semana anterior, y solo lo ve quien corresponde. Para quien no corresponde no existe: ni importe, ni
// cantidad, ni aviso (la función de consulta devuelve null, sin siquiera consultar).

// ---- Depósitos de cheques de terceros (DEP CH 3°) --------------------------------------------------------------
//
// DEP CH 3° NO es una cobranza (decisión del negocio): un depósito de cheques de terceros es movimiento de tesorería, y su
// contrapartida está en otra cuenta. Hoy el Reporte ya lo deja afuera de TODA fila (ninguna plantilla lo lee: ver
// depositosDeCheques.reporte.test.ts) y Ejecución solo controla que su neto por lote dé cero (CHEQUEOS_SUMA_CERO,
// lib/agregadosEjecucion.ts). El dashboard lo muestra únicamente a ADMIN, como control aparte de la semana.

export const CLASIFICACION_DEPOSITO_DE_CHEQUES = "DEP CH 3°";

// Texto del control, tal como lo pidió el negocio.
export const ROTULO_CONTROL_DEPOSITOS = "Depósitos de cheques pendientes de registro";

// Misma equivalencia de clasificaciones que usa el Reporte (sin mayúsculas, tildes ni espacios de más).
export function esDepositoDeCheques(clasificacion: string): boolean {
  return claveEquivalencia(clasificacion) === claveEquivalencia(CLASIFICACION_DEPOSITO_DE_CHEQUES);
}

// Cualquier armado de totales del dashboard (cobranzas, egresos, neto por unidad…) tiene que pasar sus filas por acá: los
// depósitos de cheques no se suman a nada.
export function sinDepositosDeCheques<T>(filas: readonly T[], clasificacionDe: (fila: T) => string): T[] {
  return filas.filter((f) => !esDepositoDeCheques(clasificacionDe(f)));
}

// Quién ve el control: SOLO ADMIN. `esHolding` lo asigna únicamente resolverAlcance, y solo al rol ADMIN: no lo da ningún rol
// más (FINANZAS, GERENTE, VIEWER) ni la casilla «ve bloques reservados» del VIEWER, ni tener las 12 empresas asignadas.
export function puedeVerControlDepositos(alcance: Alcance): boolean {
  return alcance.esHolding;
}

export type FilaControlDepositos = {
  moneda: string;
  // Neto con signo de banco (ingresos − egresos) de la semana, en centavos.
  netoCentavos: number;
  movimientos: number;
  // Cuántos de esos movimientos están en lotes todavía abiertos.
  enLotesAbiertos: number;
};

export type ControlDepositosDeCheques = Readonly<{
  rotulo: typeof ROTULO_CONTROL_DEPOSITOS;
  lunes: string;
  domingo: string;
  // Una fila por moneda: nunca se mezclan monedas. Sin movimientos en la semana: lista vacía. NO hay ningún total.
  porMoneda: readonly FilaControlDepositos[];
}>;

export function armarControlDepositos(fecha: string, filas: readonly FilaControlDepositos[]): ControlDepositosDeCheques {
  const porMoneda = [...filas]
    .map((f) => {
      if (!Number.isInteger(f.netoCentavos)) throw new Error("El neto tiene que estar en centavos enteros.");
      if (f.movimientos < 0 || f.enLotesAbiertos < 0 || f.enLotesAbiertos > f.movimientos) throw new Error("Cantidades inválidas.");
      return Object.freeze({ moneda: f.moneda, netoCentavos: f.netoCentavos, movimientos: f.movimientos, enLotesAbiertos: f.enLotesAbiertos });
    })
    .sort((a, b) => a.moneda.localeCompare(b.moneda));
  return Object.freeze({
    rotulo: ROTULO_CONTROL_DEPOSITOS,
    lunes: lunesDeSemana(fecha),
    domingo: domingoDeSemana(fecha),
    porMoneda: Object.freeze(porMoneda),
  });
}
