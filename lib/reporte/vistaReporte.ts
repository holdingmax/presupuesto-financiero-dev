import { EMPRESAS_SIN_LINK_CARGA_EN_REPORTE, PERIODOS_HABILITADOS, PERIODO_EN_CARGA_GERENTE, PERIODO_INICIO_HISTORIAL } from "@/lib/config";
import { periodosHasta } from "@/lib/reporte/motor";
import { nombreLegibleDePeriodo } from "@/lib/periodosHabilitados";

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

// Cuántos meses se muestran (el último es el de la URL). En "todo" se corta en el primer mes anterior que no esté
// habilitado (gerente) o que sea previo al inicio del historial (PERIODO_INICIO_HISTORIAL: también ADMIN y
// FINANZAS), así nadie ve meses ocultos como agosto o septiembre 2026.
export function cantidadDeMeses(
  vista: VistaReporte,
  periodo: string,
  esAdminOFinanzas: boolean,
  habilitados: readonly string[] = PERIODOS_HABILITADOS,
  inicio: string = PERIODO_INICIO_HISTORIAL
): number {
  if (vista === "actual") return 1;
  const meses = periodosHasta(periodo, MESES_EN_TODO);
  const visible = (m: string) => m >= inicio && (esAdminOFinanzas || habilitados.includes(m));
  let cantidad = 0;
  for (let i = meses.length - 1; i >= 0 && visible(meses[i]); i--) cantidad++;
  return Math.max(1, cantidad);
}

// Marca de la URL (?modo=anteriores) con la que el mes en curso se ve desde «Todos los meses», en solo lectura.
// Solo vale para el mes en curso de carga (PERIODO_EN_CARGA_GERENTE): en cualquier otro período se ignora, y
// cualquier valor que no sea exactamente «anteriores» (repetido, con mayúsculas, vacío) también.
export const PARAMETRO_MODO = "modo";
export const MARCA_ANTERIORES = "anteriores";
export type MarcaModo = string | string[] | undefined;

export function esHistorialDelMesEnCurso(
  periodo: string,
  marca: MarcaModo,
  enCarga: string = PERIODO_EN_CARGA_GERENTE
): boolean {
  return periodo === enCarga && marca === MARCA_ANTERIORES;
}

// Modo de navegación del Reporte. Sale del período de la URL: el mes en curso de carga (o uno posterior) es
// «en-curso»; cualquiera anterior, «anteriores». Única excepción: el mes en curso con la marca válida
// (esHistorialDelMesEnCurso) es «anteriores». Comparación de texto AAAA-MM (la página ya valida el formato).
// No guarda estado ni toca permisos.
export type ModoPeriodo = "en-curso" | "anteriores";

export function modoDePeriodo(
  periodo: string,
  enCarga: string = PERIODO_EN_CARGA_GERENTE,
  marca?: MarcaModo
): ModoPeriodo {
  return periodo < enCarga || esHistorialDelMesEnCurso(periodo, marca, enCarga) ? "anteriores" : "en-curso";
}

// En «Mes en curso» no hay columnas juntas: un ?vista=todo se ignora y se muestra solo ese mes.
export function vistaEfectiva(
  vista: VistaReporte,
  periodo: string,
  enCarga: string = PERIODO_EN_CARGA_GERENTE,
  marca?: MarcaModo
): VistaReporte {
  return modoDePeriodo(periodo, enCarga, marca) === "en-curso" ? "actual" : vista;
}

// Qué trae la pantalla del Reporte para quien la mira. En la vista histórica del mes en curso NADIE edita ni
// opera el flujo (ni gerente, ni FINANZAS, ni ADMIN): es solo lectura. Fuera de ella cada pieza queda como
// siempre; la página además le suma sus condiciones de siempre (interruptores de empresa, estado del
// presupuesto, rol). El servidor no cambia: esto solo decide qué se arma y se muestra.
export type EdicionDelReporte = {
  historial: boolean;
  flujo: boolean;
  carga: boolean;
  tipeo: boolean;
  filasExtra: boolean;
  linkCarga: boolean;
};

export function edicionDelReporte(args: {
  periodo: string;
  marca: MarcaModo;
  esAdminOFinanzas: boolean;
  // Puede cargar el Real de ESTA empresa (lib/permisosReal.ts): habilita el tipeo y el link «Cargar valores del
  // mes». Sin definir = esAdminOFinanzas. Las filas extra siguen solo para ADMIN y FINANZAS.
  puedeCargarReal?: boolean;
  enCarga?: string;
}): EdicionDelReporte {
  const puedeCargarReal = args.puedeCargarReal ?? args.esAdminOFinanzas;
  const historial = esHistorialDelMesEnCurso(args.periodo, args.marca, args.enCarga);
  return {
    historial,
    flujo: !historial,
    carga: !historial,
    tipeo: !historial && puedeCargarReal,
    filasExtra: !historial && args.esAdminOFinanzas,
    linkCarga: !historial && puedeCargarReal,
  };
}

// ¿Se muestra el botón «Cargar valores del mes»? Lo que decide edicionDelReporte (linkCarga) salvo en las empresas de
// EMPRESAS_SIN_LINK_CARGA_EN_REPORTE, donde nunca (ningún rol). Solo el botón: la ruta /reporte/carga no se bloquea.
export function linkCargaVisible(
  empresaSlug: string,
  linkCarga: boolean,
  sinLink: readonly string[] = EMPRESAS_SIN_LINK_CARGA_EN_REPORTE
): boolean {
  return linkCarga && !sinLink.includes(empresaSlug);
}

// Cartel de la vista histórica del mes en curso.
export function avisoMesEnCursoEnHistorial(enCarga: string = PERIODO_EN_CARGA_GERENTE): string {
  return `Estás viendo el mes en curso (${nombreLegibleDePeriodo(enCarga)}) desde «Todos los meses»: solo lectura. Para cargar, usá «Mes en curso».`;
}

function indiceDeMes(periodo: string): number {
  const [anio, mes] = periodo.split("-").map(Number);
  return anio * 12 + (mes - 1);
}

// Meses de «Todos los meses»: desde `inicio` hasta el mes en curso INCLUSIVE, en orden (el en curso va último y se
// ve en solo lectura). Vacía si el inicio no es anterior al mes en curso: sin ningún mes previo no hay historial.
export function mesesAnteriores(
  inicio: string = PERIODO_INICIO_HISTORIAL,
  enCarga: string = PERIODO_EN_CARGA_GERENTE
): string[] {
  const previos = indiceDeMes(enCarga) - indiceDeMes(inicio);
  if (previos <= 0) return [];
  return periodosHasta(enCarga, previos + 1);
}

// Parte de la consulta que suma el botón de un mes de «Todos los meses»: solo el del mes en curso lleva la marca.
export function consultaDeBotonDeMes(periodo: string, enCarga: string = PERIODO_EN_CARGA_GERENTE): string {
  return periodo === enCarga ? `${PARAMETRO_MODO}=${MARCA_ANTERIORES}` : "";
}

// Links «Un mes | Columnas juntas»: conservan la marca cuando se está viendo el mes en curso como histórico.
export function enlaceDeVista(
  empresaSlug: string,
  periodo: string,
  vista: VistaReporte,
  marca: MarcaModo,
  enCarga: string = PERIODO_EN_CARGA_GERENTE
): string {
  const extra = esHistorialDelMesEnCurso(periodo, marca, enCarga) ? `&${consultaDeBotonDeMes(periodo, enCarga)}` : "";
  return `/${empresaSlug}/${periodo}/reporte?vista=${vista}${extra}`;
}

export type EnlaceModo = { modo: ModoPeriodo; texto: string; href: string; activo: boolean };

// Los dos links del interruptor. «Mes en curso» va al período en curso sin parámetros; «Todos los meses», al mes
// en curso CON la marca (?modo=anteriores: solo lectura), desde donde el gerente elige si va hacia atrás (sin link si
// no hay ningún mes previo). `activo` sale del modo del período que se está viendo (con su marca, si la hay).
export function enlacesDeModo(
  empresaSlug: string,
  periodo: string,
  enCarga: string = PERIODO_EN_CARGA_GERENTE,
  inicio: string = PERIODO_INICIO_HISTORIAL,
  marca?: MarcaModo
): EnlaceModo[] {
  const modo = modoDePeriodo(periodo, enCarga, marca);
  const previos = mesesAnteriores(inicio, enCarga).filter((m) => m < enCarga);
  const enlaces: EnlaceModo[] = [
    { modo: "en-curso", texto: "Mes en curso", href: `/${empresaSlug}/${enCarga}/reporte`, activo: modo === "en-curso" },
  ];
  if (previos.length > 0) {
    enlaces.push({
      modo: "anteriores",
      texto: "Todos los meses",
      href: `/${empresaSlug}/${enCarga}/reporte?${consultaDeBotonDeMes(enCarga, enCarga)}`,
      activo: modo === "anteriores",
    });
  }
  return enlaces;
}
