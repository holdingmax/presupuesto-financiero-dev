import { EMPRESAS_CON_EXTRACTO_POR_EMPRESA } from "@/lib/config";
import type { ControlPieMoneda } from "./havannaPeru";

// Reglas PURAS de la pantalla de subida del extracto de una empresa (app/[empresa]/[periodo]/reporte/extracto).
// La pantalla solo las usa; el servidor vuelve a validar todo en subirExtractoEmpresa.

// La pantalla (y su link) existen solo para una empresa de la lista de config Y un usuario que puede cargar el Real
// de ESA empresa (requireCargaRealEmpresa: ADMIN, FINANZAS, o gerente con la tilde de esa empresa).
export function puedeVerSubidaExtractoEmpresa(empresaSlug: string, puedeCargarReal: boolean): boolean {
  return puedeCargarReal && EMPRESAS_CON_EXTRACTO_POR_EMPRESA.includes(empresaSlug);
}

// «Confirmar» solo con algo para cargar y sin ningún pie que no cuadre. (El servidor ya no devuelve vista previa
// si el lector marcó errores; esto es el cinturón de la pantalla.)
export function puedeConfirmarVistaPrevia(vista: { nuevas: number; control: readonly ControlPieMoneda[] }): boolean {
  return vista.nuevas > 0 && vista.control.every((c) => c.estado !== "no_cuadra");
}

export type SemanaDelPeriodo = { numeroSemana: number; estado: string };

// Semanas donde se puede cargar (abiertas) y cuál viene elegida: la última abierta. [] = no hay dónde cargar.
export function semanasParaCargar(semanas: readonly SemanaDelPeriodo[]): { abiertas: number[]; porDefecto: number | null } {
  const abiertas = semanas.filter((s) => s.estado === "ABIERTA").map((s) => s.numeroSemana).sort((a, b) => a - b);
  return { abiertas, porDefecto: abiertas.length > 0 ? abiertas[abiertas.length - 1] : null };
}

export const NOMBRE_ESTADO_PIE: Record<ControlPieMoneda["estado"], string> = {
  cuadra: "Cuadra",
  no_cuadra: "No cuadra",
  sin_pie: "Sin pie para controlar",
};
