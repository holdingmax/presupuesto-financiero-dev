import { PERIODO_EN_CARGA_GERENTE } from "@/lib/config";

// "Mis empresas" para un VIEWER: siempre al Reporte (nunca a Presupuesto, que no es para él), del mes en curso de
// carga, que es un período habilitado. Pura (solo lee la constante de lib/config.ts) para poder probarla.
export function enlaceDeEmpresaViewer(empresaSlug: string, periodo: string = PERIODO_EN_CARGA_GERENTE): string {
  return `/${empresaSlug}/${periodo}/reporte`;
}
