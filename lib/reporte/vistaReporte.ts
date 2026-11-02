import { PERIODOS_HABILITADOS, PERIODO_EN_CARGA_GERENTE, PERIODO_INICIO_HISTORIAL } from "@/lib/config";
import { periodosHasta } from "@/lib/reporte/motor";

// Vista del Reporte por plantilla (Etapa 5 B): cuántos meses se muestran lado a lado. Solo decide
// columnas: no cambia permisos ni qué se puede editar (eso lo siguen decidiendo avisoPeriodoSoloLectura
// y el servidor). Puras (sin Prisma ni next/*) para poder probarlas.
//
// "actual" = solo el mes de la URL (el que elige el selector de mes). "todo" = los MESES_EN_TODO meses
// que terminan en el de la URL.

export type VistaReporte = "actual" | "todo";

export const MESES_EN_TODO = 3;

export const VISTAS: readonly VistaReporte[] = ["actual", "todo"];

// Valor por defecto: un solo mes, para todos los roles (ADMIN y FINANZAS ya no arrancan en «todo»). El parámetro
// se conserva por compatibilidad con los llamadores.
export function vistaPorDefecto(_esAdminOFinanzas: boolean): VistaReporte {
  return "actual";
}

// El parámetro ?vista= de la URL. Cualquier valor que no sea exactamente "actual" o "todo" (repetido,
// con mayúsculas, vacío) vuelve al valor por defecto.
export function resolverVista(
  valor: string | string[] | undefined,
  esAdminOFinanzas: boolean
): VistaReporte {
  if (valor === "actual" || valor === "todo") return valor;
  return vistaPorDefecto(esAdminOFinanzas);
}

// Cuántos meses se muestran (el último es el de la URL). En "todo", el gerente queda limitado a los
// períodos habilitados: se corta en el primer mes anterior que no lo esté. ADMIN y FINANZAS no tienen tope.
export function cantidadDeMeses(
  vista: VistaReporte,
  periodo: string,
  esAdminOFinanzas: boolean,
  habilitados: readonly string[] = PERIODOS_HABILITADOS
): number {
  if (vista === "actual") return 1;
  if (esAdminOFinanzas) return MESES_EN_TODO;
  const meses = periodosHasta(periodo, MESES_EN_TODO);
  let cantidad = 0;
  for (let i = meses.length - 1; i >= 0 && habilitados.includes(meses[i]); i--) cantidad++;
  return Math.max(1, cantidad);
}

// Modo de navegación del Reporte, deducido siempre del período de la URL: el mes en curso de carga (o uno
// posterior) es «en-curso»; cualquiera anterior, «anteriores». Comparación de texto AAAA-MM (la página ya
// valida el formato). No guarda estado ni toca permisos.
export type ModoPeriodo = "en-curso" | "anteriores";

export function modoDePeriodo(periodo: string, enCarga: string = PERIODO_EN_CARGA_GERENTE): ModoPeriodo {
  return periodo < enCarga ? "anteriores" : "en-curso";
}

// En «Mes en curso» no hay columnas juntas: un ?vista=todo se ignora y se muestra solo ese mes.
export function vistaEfectiva(
  vista: VistaReporte,
  periodo: string,
  enCarga: string = PERIODO_EN_CARGA_GERENTE
): VistaReporte {
  return modoDePeriodo(periodo, enCarga) === "en-curso" ? "actual" : vista;
}

function indiceDeMes(periodo: string): number {
  const [anio, mes] = periodo.split("-").map(Number);
  return anio * 12 + (mes - 1);
}

// Meses de «Meses anteriores»: desde `inicio` hasta el mes previo al en curso (sin incluirlo), en orden.
// Vacía si el inicio no es anterior al mes en curso.
export function mesesAnteriores(
  inicio: string = PERIODO_INICIO_HISTORIAL,
  enCarga: string = PERIODO_EN_CARGA_GERENTE
): string[] {
  const cantidad = indiceDeMes(enCarga) - indiceDeMes(inicio);
  if (cantidad <= 0) return [];
  return periodosHasta(periodosHasta(enCarga, 2)[0], cantidad);
}

export type EnlaceModo = { modo: ModoPeriodo; texto: string; href: string; activo: boolean };

// Los dos links del interruptor. «Mes en curso» va al período en curso sin parámetros; «Meses anteriores», al
// último mes previo (sin link si no hay ninguno). `activo` sale del modo del período que se está viendo.
export function enlacesDeModo(
  empresaSlug: string,
  periodo: string,
  enCarga: string = PERIODO_EN_CARGA_GERENTE,
  inicio: string = PERIODO_INICIO_HISTORIAL
): EnlaceModo[] {
  const modo = modoDePeriodo(periodo, enCarga);
  const anteriores = mesesAnteriores(inicio, enCarga);
  const enlaces: EnlaceModo[] = [
    { modo: "en-curso", texto: "Mes en curso", href: `/${empresaSlug}/${enCarga}/reporte`, activo: modo === "en-curso" },
  ];
  if (anteriores.length > 0) {
    enlaces.push({
      modo: "anteriores",
      texto: "Meses anteriores",
      href: `/${empresaSlug}/${anteriores[anteriores.length - 1]}/reporte`,
      activo: modo === "anteriores",
    });
  }
  return enlaces;
}
