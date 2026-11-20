import { PERIODOS_HABILITADOS } from "@/lib/config";
import { armarSemanasProvisorias, type SemanasProvisorias } from "@/lib/dashboard/calidad";
import { ritmoDelMes, type RitmoDelMes } from "@/lib/dashboard/avance";
import { datosAl, ultimaFechaDeDatos, type FilaDeLote } from "@/lib/dashboard/semana";
import { nombreLegibleDePeriodo } from "@/lib/periodosHabilitados";

// Encabezado y selector de mes de la pantalla del dashboard (Entrega 3). Módulo PURO: solo compone lo que ya calculan
// semana.ts, avance.ts y calidad.ts.

// Mes que se muestra: el de la URL si es un período habilitado; si no (falta, repetido, inválido o no habilitado), el último
// habilitado. Ningún rol, ADMIN incluido, ve otros meses.
export function periodoDelDashboard(
  valor: string | string[] | undefined,
  habilitados: readonly string[] = PERIODOS_HABILITADOS
): string {
  const ultimo = habilitados[habilitados.length - 1];
  if (typeof valor !== "string") return ultimo;
  return habilitados.includes(valor) ? valor : ultimo;
}

export type OpcionDeMes = Readonly<{ periodo: string; nombre: string; actual: boolean }>;

export function opcionesDeMes(actual: string, habilitados: readonly string[] = PERIODOS_HABILITADOS): OpcionDeMes[] {
  return habilitados.map((periodo) => Object.freeze({ periodo, nombre: nombreLegibleDePeriodo(periodo), actual: periodo === actual }));
}

export type EncabezadoDeAvance = Readonly<{
  periodo: string;
  nombreDelMes: string;
  // «dd/mm» del último dato en lotes cerrados del alcance; null si no hay.
  datosAl: string | null;
  // Días con datos sobre días del mes (informativo); null si no hay datos del mes.
  ritmo: RitmoDelMes | null;
  semanasProvisorias: SemanasProvisorias;
}>;

export function armarEncabezadoDeAvance(periodo: string, semanas: readonly FilaDeLote[]): EncabezadoDeAvance {
  const delMes = semanas.filter((f) => f.periodo === periodo);
  return Object.freeze({
    periodo,
    nombreDelMes: nombreLegibleDePeriodo(periodo),
    datosAl: datosAl(delMes),
    ritmo: ritmoDelMes(periodo, ultimaFechaDeDatos(delMes)),
    semanasProvisorias: armarSemanasProvisorias(semanas, periodo),
  });
}

// Fecha de la que se muestra el control semanal de depósitos (solo ADMIN): la del último dato del mes, con lotes abiertos
// incluidos. null si no hay movimientos en el mes.
export function fechaDelControl(periodo: string, semanas: readonly FilaDeLote[]): string | null {
  return ultimaFechaDeDatos(semanas.filter((f) => f.periodo === periodo), { soloCerradas: false });
}
