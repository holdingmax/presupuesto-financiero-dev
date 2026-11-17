import { esPeriodoHabilitado } from "@/lib/periodosHabilitados";
import { fechaIsoEnArgentina } from "@/lib/fecha";
import {
  armarVistaTipeo,
  disponibilidadesComoSaldo,
  tipeoDirectoActivo,
  type EntradaVistaTipeo,
} from "@/lib/reporte/tipeoDirecto";
import { resolverVista, vistaEfectiva, type MarcaModo, type VistaReporte } from "@/lib/reporte/vistaReporte";

// Reglas puras (sin Prisma ni next/*) de la ruta reporte/excel/route.ts, para poder probarlas.

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

export type RechazoDescarga = { status: 400 | 403 | 404; mensaje: string };

// Primer chequeo, antes de buscar nada: un período que no es AAAA-MM.
export function rechazoPorPeriodo(periodo: string): RechazoDescarga | null {
  return FORMATO_PERIODO.test(periodo) ? null : { status: 400, mensaje: "Período inválido." };
}

// Segundo, ya con acceso a la empresa: las empresas sin plantilla siguen con el Reporte de la Fase 1 (sin Excel), y un
// período fuera de PERIODOS_HABILITADOS no lo abre nadie (mismo criterio que la pantalla).
export function rechazoPorEmpresa(e: {
  tienePlantilla: boolean;
  periodo: string;
  habilitados?: readonly string[];
}): RechazoDescarga | null {
  if (!e.tienePlantilla) return { status: 404, mensaje: "Esta empresa no tiene Reporte para descargar." };
  if (!esPeriodoHabilitado(e.periodo, e.habilitados)) {
    return { status: 403, mensaje: "El reporte de este mes todavía no está habilitado." };
  }
  return null;
}

// ?vista= y ?modo= como los resuelve la pantalla (un valor repetido llega como lista y vuelve al valor por defecto).
export function leerParametro(params: URLSearchParams, clave: string): string | string[] | undefined {
  const valores = params.getAll(clave);
  return valores.length === 0 ? undefined : valores.length === 1 ? valores[0] : valores;
}

export function vistaDeDescarga(
  vista: string | string[] | undefined,
  modo: MarcaModo,
  periodo: string,
  esAdminOFinanzas: boolean
): VistaReporte {
  return vistaEfectiva(resolverVista(vista, esAdminOFinanzas), periodo, undefined, modo);
}

// reporte-brillante-2026-11-2026-11-17.xlsx (la fecha es el día de Argentina de la descarga).
export function nombreArchivoReporte(empresaSlug: string, periodo: string, ahora: Date): string {
  return `reporte-${empresaSlug.replace(/[^\w-]/g, "")}-${periodo}-${fechaIsoEnArgentina(ahora)}.xlsx`;
}

// ¿Disponibilidades sale como «Saldo»? Exactamente la decisión de la pantalla: el tipeo solo existe si la edición lo
// permite (edicionDelReporte.tipeo) y la empresa tiene el interruptor; y solo cuenta su bandera `disponibilidades`.
export function dispComoSaldoDelReporte(e: {
  sinBloquesReservados: boolean;
  edicionTipeo: boolean;
  empresaSlug: string;
  // Lo que armarVistaTipeo recibe en la pantalla (reporte/page.tsx); se ignora si no hay tipeo.
  entradaTipeo: () => Omit<EntradaVistaTipeo, "empresaSlug">;
}): boolean {
  const tipeo =
    e.edicionTipeo && tipeoDirectoActivo(e.empresaSlug)
      ? armarVistaTipeo({ empresaSlug: e.empresaSlug, ...e.entradaTipeo() })
      : null;
  return disponibilidadesComoSaldo(e.sinBloquesReservados, tipeo);
}
