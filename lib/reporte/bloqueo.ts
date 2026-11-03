import type { Bloque } from "@/lib/reporte/motor";
import { leerCuenta } from "@/lib/importes";
import { formatearImporte } from "@/app/ejecucion/formato";

// Regla de bloqueo de los valores manuales del Reporte (lo cerrado no se modifica para
// atrás), docs/reporte_etapa2b_plan.md §10. Pura, sin Prisma. Sin desbloqueo por ADMIN:
// la corrección se carga en el período siguiente.

export type EstadoSemanas = { abiertas: number; cerradas: number };

// "AAAA-MM" de hoy en hora de Argentina.
export function periodoActual(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(ahora);
  const valor = (t: string) => partes.find((p) => p.type === t)!.value;
  return `${valor("year")}-${valor("month")}`;
}

// Mes cerrado: ya pasó y la empresa no tiene ninguna semana ABIERTA. Es el criterio de
// las filas con R = P (espejos, reservas) y del bloqueo del R manual de flujo.
export function esMesCerrado(periodo: string, actual: string, semanas: EstadoSemanas): boolean {
  return periodo < actual && semanas.abiertas === 0;
}

export type EntradaBloqueo = {
  periodo: string;
  actual: string;
  columna: "PRESUPUESTADO" | "REAL";
  bloque: Bloque;
  // El PresupuestoMensual de la empresa y el mes está VALIDADO (sin presupuesto = false).
  presupuestoValidado: boolean;
  semanas: EstadoSemanas;
};

// null = editable; si no, el motivo para mostrar.
export function motivoBloqueo(e: EntradaBloqueo): string | null {
  if (e.columna === "PRESUPUESTADO") {
    return e.presupuestoValidado ? "El presupuesto del mes está validado." : null;
  }
  const pasado = e.periodo < e.actual;
  if (e.bloque === "DISPONIBILIDADES") {
    return pasado && e.semanas.cerradas >= 1 ? "El mes ya pasó y tiene semanas cerradas." : null;
  }
  return pasado && e.semanas.abiertas === 0 ? "El mes ya pasó y no tiene semanas abiertas." : null;
}

// Un período bloqueado admite la PRIMERA carga (crear un valor que no existe); lo que no admite
// es modificar ni borrar un valor ya cargado. `motivo` es el de motivoBloqueo. null = permitido.
export function motivoRechazoCambio(motivo: string | null, existia: boolean): string | null {
  return motivo !== null && existia ? motivo : null;
}

export const AVISO_UNA_VEZ = "Período cerrado: solo se puede cargar una vez";

// "1.234,56" o una cuenta como las SM de Macchi: "321.235,44+17.755,22-1.000". Devuelve el
// resultado en centavos y, si era una cuenta, el texto tal cual se tipeó (para `nota`). Las reglas
// viven en lib/importes.ts (leerCuenta, que además da el mensaje de por qué no se entendió).
export function parsearCuenta(texto: string): { centavos: number; nota: string | null } | null {
  const r = leerCuenta(texto);
  return r.ok ? { centavos: r.centavos, nota: r.nota } : null;
}

// Centavos → "1.234,56" (coma decimal, puntos de miles); con "-" si es negativo.
export function formatearCentavos(centavos: number): string {
  const pesos = (Math.abs(centavos) / 100).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return centavos < 0 ? `-${pesos}` : pesos;
}

// Centavos → "1.234" (pesos enteros, redondeado solo para MOSTRAR; lo guardado conserva los centavos). Con "-" si es
// negativo, salvo que redondee a cero.
export function formatearPesos(centavos: number): string {
  const pesos = formatearImporte(Math.abs(centavos) / 100);
  return centavos < 0 && pesos !== "0" ? `-${pesos}` : pesos;
}

// Filas de Ingresos que reflejan un componente de Disponibilidades en el mes de pago:
// la pantalla de carga ofrece "usar −reserva de Disponibilidades" (no se guarda sola).
export const SUGERENCIA_ESPEJO: Record<string, string> = {
  "cx.reservaAguinaldo": "cx.dReservaAguinaldo",
  "br.reservaSac": "br.dReservaAguinaldo",
  "br.reservaIvaAvianor": "br.dReservaIvaAvianor",
  "fr.reservaAguinaldo": "fr.dReservaAguinaldo",
  "fr.reservaCapitalTrabajo": "fr.dReservaCapitalTrabajo",
  "hv.reservaAguinaldo": "hv.dReservaAguinaldo",
  "ra.reservaAguinaldo": "ra.dReservaAguinaldo",
  "hw.reservaSac": "hw.dPrevisionSac",
};
