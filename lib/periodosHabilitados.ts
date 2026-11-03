import { PERIODOS_HABILITADOS, PERIODO_EN_CARGA_GERENTE } from "@/lib/config";
import { nombreDePeriodo } from "@/lib/ejecucionSemanas";

// Períodos de Presupuesto habilitados para quien no es ADMIN ni FINANZAS. Puras (sin Prisma
// ni next/*) para poder probarlas; las usan presupuesto/page.tsx, resolverEmpresaYPresupuesto
// (actions.ts) y el selector de mes. Reciben la lista como parámetro (por defecto, la de
// lib/config.ts) para probarlas con otra.

export function esPeriodoHabilitado(periodo: string, habilitados: readonly string[] = PERIODOS_HABILITADOS): boolean {
  return habilitados.includes(periodo);
}

// ADMIN y FINANZAS abren cualquier período; el resto, solo los habilitados.
export function puedeVerPeriodo(
  periodo: string,
  esAdminOFinanzas: boolean,
  habilitados: readonly string[] = PERIODOS_HABILITADOS
): boolean {
  return esAdminOFinanzas || esPeriodoHabilitado(periodo, habilitados);
}

// Quién puede EDITAR el presupuesto de un período: ADMIN y FINANZAS, cualquiera; el resto (el
// gerente, también si revisa), solo el período en curso de carga (PERIODO_EN_CARGA_GERENTE). Es una
// puerta ADICIONAL: el estado del presupuesto (en revisión, validado) se sigue controlando aparte.
// Comparación exacta de texto: "2026-9" o " 2026-11" no valen.
export function puedeEditarPeriodoComoGerente(
  periodo: string,
  esAdminOFinanzas: boolean,
  enCarga: string = PERIODO_EN_CARGA_GERENTE
): boolean {
  return esAdminOFinanzas || periodo === enCarga;
}

// "2026-11" → "Noviembre 2026". Un texto que no es AAAA-MM se devuelve tal cual.
export function nombreLegibleDePeriodo(periodo: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return periodo;
  const nombre = nombreDePeriodo(periodo);
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)}`;
}

// Mensaje cuando un gerente intenta editar un período que no es el de carga (lo devuelve el servidor).
export function mensajePeriodoSoloLectura(enCarga: string = PERIODO_EN_CARGA_GERENTE): string {
  return `Solo se puede cargar el mes en curso (${nombreLegibleDePeriodo(enCarga)}). Los demás meses se ven en solo lectura.`;
}

// Cartel de las pantallas (Presupuesto y Reporte): null = el período es editable para este usuario;
// un texto = solo lectura. Un único valor hace de flag y de mensaje, y sale de la misma regla que
// usa el servidor (puedeEditarPeriodoComoGerente), así que no pueden divergir.
export function avisoPeriodoSoloLectura(
  periodo: string,
  esAdminOFinanzas: boolean,
  enCarga: string = PERIODO_EN_CARGA_GERENTE
): string | null {
  if (puedeEditarPeriodoComoGerente(periodo, esAdminOFinanzas, enCarga)) return null;
  return `Solo se puede cargar el mes en curso (${nombreLegibleDePeriodo(enCarga)}). Este mes está en solo lectura.`;
}

// Lo lanza resolverEmpresaYPresupuesto; presupuesto/page.tsx lo atrapa y muestra el aviso.
export class PeriodoNoHabilitadoError extends Error {
  constructor(public readonly periodo: string) {
    super(`El período ${periodo} no está habilitado.`);
    this.name = "PeriodoNoHabilitadoError";
  }
}

export type EnlacePeriodo = { periodo: string; href: string; activo: boolean };

// Links del selector de mes, en el orden de la lista. `activo` marca el período que se está
// viendo (ninguno, si es uno fuera de la lista que abrió un ADMIN o FINANZAS).
export function enlacesDePeriodos(
  empresaSlug: string,
  periodoActual: string,
  habilitados: readonly string[] = PERIODOS_HABILITADOS,
  // Pantalla a la que lleva cada link: Presupuesto (por defecto) o el Reporte.
  segmento: "presupuesto" | "reporte" = "presupuesto",
  // Vista del Reporte ("actual" | "todo"): se conserva al cambiar de mes. Sin ella, el link queda igual que siempre.
  vista?: string,
  // Parámetro extra por período (p. ej. «modo=anteriores» solo en el mes en curso); "" o sin definir = ninguno.
  consultaExtra?: (periodo: string) => string
): EnlacePeriodo[] {
  return habilitados.map((periodo) => {
    const consulta = [vista ? `vista=${vista}` : "", consultaExtra?.(periodo) ?? ""].filter(Boolean).join("&");
    return {
      periodo,
      href: `/${empresaSlug}/${periodo}/${segmento}${consulta ? `?${consulta}` : ""}`,
      activo: periodo === periodoActual,
    };
  });
}
