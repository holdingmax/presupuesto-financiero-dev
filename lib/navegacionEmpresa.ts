import {
  OCULTAR_PRESUPUESTO_TAMBIEN_PARA_ADMIN_Y_FINANZAS,
  PERIODO_EN_CARGA_GERENTE,
  PERIODO_POR_DEFECTO,
} from "@/lib/config";
import { cargaEnReporteActiva } from "@/lib/estadoPresupuesto";
import { plantillaDeEmpresa } from "@/lib/reporte/plantillas";

// Navegación por rol (Etapa 4): cuándo el gerente carga desde el Reporte en vez de Presupuesto.
// Puras (sin Prisma ni next/*) para poder probarlas; las usan el layout de [empresa]/[periodo],
// la página de Presupuesto y "Mis empresas".

// La pestaña Presupuesto se oculta SOLO si la carga desde el Reporte está activa para la empresa
// (lib/config.ts) y la empresa tiene Reporte por plantilla (sin él no hay dónde cargar). Nunca por rol
// solamente: Expensas y las demás sin plantilla siguen cargando en Presupuesto. Rige para todos los roles
// mientras OCULTAR_PRESUPUESTO_TAMBIEN_PARA_ADMIN_Y_FINANZAS esté en true; en false, ADMIN y FINANZAS
// conservan la pestaña (solo se oculta para el gerente). Los parámetros por defecto son los de
// producción; se pasan otros para probar.
export function ocultaPestanaPresupuesto(
  esAdminOFinanzas: boolean,
  empresaSlug: string,
  cargaActiva: (slug: string) => boolean = cargaEnReporteActiva,
  tienePlantilla: (slug: string) => boolean = (slug) => plantillaDeEmpresa(slug) !== null,
  ocultarTambienParaAdmin: boolean = OCULTAR_PRESUPUESTO_TAMBIEN_PARA_ADMIN_Y_FINANZAS
): boolean {
  if (esAdminOFinanzas && !ocultarTambienParaAdmin) return false;
  return cargaActiva(empresaSlug) && tienePlantilla(empresaSlug);
}

// Mensaje cuando un gerente intenta escribir líneas en Presupuesto de una empresa que carga en el Reporte.
export const MENSAJE_CARGA_SOLO_EN_REPORTE =
  "Esta empresa carga su presupuesto desde el Reporte. Usá la pantalla Reporte.";

// Puerta de servidor de las acciones que ESCRIBEN líneas de Presupuesto (agregar, editar, borrar, desglose, importar
// Excel): si la pestaña está oculta para el gerente de esa empresa, la acción lo rechaza aunque la llame directo.
// ADMIN y FINANZAS nunca se bloquean acá (conservan una vía de ajuste). Devuelve el motivo o null. No aplica a las
// acciones de estado (enviar a revisión, validar, pedir cambios), que el Reporte usa.
export function motivoEdicionLineasBloqueadaPorReporte(
  esAdminOFinanzas: boolean,
  empresaSlug: string,
  oculta: (admin: boolean, slug: string) => boolean = ocultaPestanaPresupuesto
): string | null {
  if (esAdminOFinanzas) return null;
  return oculta(false, empresaSlug) ? MENSAJE_CARGA_SOLO_EN_REPORTE : null;
}

// Último período (AAAA-MM) con al menos una semana CERRADA de Ejecución, sin pasarse del mes actual. Las semanas
// son del holding, no de la empresa: el resultado es el mismo para todas. Recibe los períodos que tienen
// alguna semana cerrada (sin orden ni repetidos, pueden venir con cualquier cosa) y devuelve `fallback` si
// ninguno sirve. Pura; la consulta está en lib/ultimoPeriodoCargado.ts.
export function elegirUltimoPeriodoCargado(
  periodosConCierre: readonly string[],
  actual: string,
  fallback: string = PERIODO_POR_DEFECTO
): string {
  let elegido: string | null = null;
  for (const periodo of periodosConCierre) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo) || periodo > actual) continue;
    if (elegido === null || periodo > elegido) elegido = periodo;
  }
  return elegido ?? fallback;
}

// A dónde lleva el link de una empresa en "Mis empresas". ADMIN y FINANZAS entran al Reporte del último mes
// cargado (`periodoAdmin`, por defecto PERIODO_POR_DEFECTO) en toda empresa con Reporte por plantilla (la pestaña
// Presupuesto sigue visible donde no está oculta); sin plantilla (Expensas, Gold, Cielos, Tucson) van a
// Presupuesto del período por defecto, siempre. El gerente va al mes en curso de carga: al Reporte si la pestaña
// está oculta y a Presupuesto si no.
export function enlaceDeEmpresa(
  esAdminOFinanzas: boolean,
  empresaSlug: string,
  oculta: boolean = ocultaPestanaPresupuesto(esAdminOFinanzas, empresaSlug),
  tienePlantilla: (slug: string) => boolean = (slug) => plantillaDeEmpresa(slug) !== null,
  periodoAdmin: string = PERIODO_POR_DEFECTO
): string {
  if (esAdminOFinanzas) {
    if (oculta || tienePlantilla(empresaSlug)) return `/${empresaSlug}/${periodoAdmin}/reporte`;
    return `/${empresaSlug}/${PERIODO_POR_DEFECTO}/presupuesto`;
  }
  return `/${empresaSlug}/${PERIODO_EN_CARGA_GERENTE}/${oculta ? "reporte" : "presupuesto"}`;
}
