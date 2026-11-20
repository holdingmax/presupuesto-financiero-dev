import type { Alcance } from "@/lib/dashboard/alcance";
import { rotuloDeTotal } from "@/lib/dashboard/sinDeduccion";
import { EMPRESAS_EN_DOLARES } from "@/lib/config";
import { MONEDA_PREDETERMINADA } from "@/lib/conteoMovimientos";
import type { Reporte } from "@/lib/reporte/motor";

// AVANCE DEL MES contra el presupuesto, por empresa del alcance (Entrega 2, bloque A). Módulo PURO (sin Prisma ni next/*).
//
// Decisiones (todas del negocio, ver el plan de la Entrega 2):
//  - Las celdas salen SIEMPRE de armarReporteDePlantilla (el mismo cálculo que la pantalla y el Excel del Reporte): acá no
//    hay otra forma de calcular. Este archivo solo ELIGE qué filas del Reporte se muestran (por `rol`, nunca por el texto,
//    porque cada plantilla las rotula distinto) y arma los totales.
//  - Se muestran dos filas por empresa: Ingresos (rol totalIngresos) y Egresos operativos (rol totalEgresosOperativos).
//    NUNCA «TOTAL EGRESOS» (rol totalEgresos, el bloque de abajo): incluye el espejo «Gastos Avion a recuperar» de Conexión,
//    que ya está en Avianor, y dividendos e inversiones. Tampoco Disponibilidades ni Cierre.
//  - Los INGRESOS no se suman entre empresas (incluyen reservas, IVA interempresa y préstamos): solo por empresa. Por eso este
//    archivo no tiene ninguna función que los agregue.
//  - Las monedas no se mezclan: el total es por moneda y solo de egresos operativos.
//  - Sin ranking, sin «% del holding», sin cantidad de empresas.

// ---- Moneda de cada empresa ------------------------------------------------------------------------------------

const EMPRESAS_EN_SOLES: readonly string[] = ["havanna-peru"];

// Moneda en la que está cargado el Reporte de la empresa (por slug): dólares, soles o pesos.
export function monedaDeEmpresa(slug: string): string {
  if (EMPRESAS_EN_DOLARES.includes(slug)) return "USD";
  if (EMPRESAS_EN_SOLES.includes(slug)) return "PEN";
  return MONEDA_PREDETERMINADA;
}

// Empresas cuyo Real es 100 % tipeado a mano (no hay extracto que lo calcule): sin lo tipeado, el Real es null.
export const EMPRESAS_CON_REAL_MANUAL: readonly string[] = ["bradenton", "plate-silver", "havanna-peru"];

// ---- Ritmo del mes ---------------------------------------------------------------------------------------------

export function diasDelMes(periodo: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) throw new Error(`Período inválido (se espera AAAA-MM): "${periodo}"`);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) throw new Error(`Período inválido (se espera AAAA-MM): "${periodo}"`);
  return new Date(Date.UTC(Number(m[1]), mes, 0)).getUTCDate();
}

export type RitmoDelMes = Readonly<{
  diasConDatos: number;
  diasDelMes: number;
  // Porcentaje (43,3 = 43,3 %). Es SOLO informativo: no hay umbrales ni juicios («atrasado») en esta entrega.
  porcentaje: number;
}>;

// Ritmo = día del mes hasta el que hay datos (el corte) sobre los días del mes. El corte es la última fecha con movimientos en
// lotes CERRADOS de esa empresa, dentro del período (NO la fecha de hoy: si hoy es 20 y los datos llegan al 13, el ritmo es
// 13/30). Un corte en el último día del mes da 100 %. null = no hay datos del mes.
export function ritmoDelMes(periodo: string, corte: string | null): RitmoDelMes | null {
  if (corte === null) return null;
  const dias = diasDelMes(periodo);
  if (corte.slice(0, 7) !== periodo) return null;
  const dia = Number(corte.slice(8, 10));
  if (!Number.isInteger(dia) || dia < 1 || dia > dias) throw new Error(`Corte inválido: "${corte}"`);
  return Object.freeze({ diasConDatos: dia, diasDelMes: dias, porcentaje: (dia / dias) * 100 });
}

// Corte de UNA empresa: la última fecha entre las de sus unidades. `ultimaPorUnidad` ya viene filtrada al alcance por la
// consulta; las unidades que no son de la empresa se ignoran.
export function corteDeEmpresa(
  unidadesDeLaEmpresa: readonly string[],
  ultimaPorUnidad: ReadonlyMap<string, string>
): string | null {
  let corte: string | null = null;
  for (const unidad of unidadesDeLaEmpresa) {
    const ultima = ultimaPorUnidad.get(unidad);
    if (ultima !== undefined && (corte === null || ultima > corte)) corte = ultima;
  }
  return corte;
}

// ---- Estado del presupuesto ------------------------------------------------------------------------------------

export type EstadoDePresupuesto = "sinPresupuesto" | "sinLineas" | "sinValidar" | "validado";

export type PresupuestoLeido = { estado: "ABIERTO" | "EN_REVISION" | "VALIDADO"; lineas: number };

// Se calcula igual con el presupuesto sin validar, pero con el cartel «presupuesto sin validar» (decisión del negocio).
export function estadoDePresupuesto(presupuesto: PresupuestoLeido | null | undefined): EstadoDePresupuesto {
  if (!presupuesto) return "sinPresupuesto";
  if (presupuesto.lineas === 0) return "sinLineas";
  return presupuesto.estado === "VALIDADO" ? "validado" : "sinValidar";
}

export const CARTEL_DE_ESTADO: Readonly<Record<EstadoDePresupuesto, string | null>> = {
  sinPresupuesto: "sin presupuesto",
  sinLineas: "presupuesto sin líneas",
  sinValidar: "presupuesto sin validar",
  validado: null,
};

// ---- Lo que se toma del Reporte --------------------------------------------------------------------------------

export type CeldaDeAvance = Readonly<{
  // Centavos de la moneda de la empresa. null = falta el dato (no es cero).
  presupuestado: number | null;
  real: number | null;
  // Porcentaje del motor (98,5 = 98,5 %); null si falta P o R, o si P es 0.
  avance: number | null;
  presupuestoIncompleto: boolean;
  realIncompleto: boolean;
}>;

export type AvanceDelReporte = Readonly<{ ingresos: CeldaDeAvance | null; egresosOperativos: CeldaDeAvance | null }>;

// Roles del Reporte que se muestran. «totalEgresos» NO está y no puede estar (lo controla un test).
export const ROL_INGRESOS = "totalIngresos" as const;
export const ROL_EGRESOS_OPERATIVOS = "totalEgresosOperativos" as const;

function celdaDeRol(reporte: Reporte, rol: typeof ROL_INGRESOS | typeof ROL_EGRESOS_OPERATIVOS): CeldaDeAvance | null {
  const fila = reporte.filas.find((f) => f.fila.tipo === "total" && f.fila.rol === rol);
  if (!fila) return null;
  const celda = fila.celdas[reporte.periodos.length - 1];
  if (!celda) return null;
  return Object.freeze({
    presupuestado: celda.presupuestado,
    real: celda.real,
    avance: celda.avance,
    presupuestoIncompleto: celda.presupuestoIncompleto,
    realIncompleto: celda.realIncompleto,
  });
}

// Celdas del ÚLTIMO mes del Reporte (el período pedido). Las dos filas se buscan por rol.
export function extraerAvance(reporte: Reporte): AvanceDelReporte {
  return Object.freeze({ ingresos: celdaDeRol(reporte, ROL_INGRESOS), egresosOperativos: celdaDeRol(reporte, ROL_EGRESOS_OPERATIVOS) });
}

// ---- Fila de la pantalla (una por empresa) ---------------------------------------------------------------------

export type FilaDeAvance = Readonly<{
  empresaId: string;
  nombre: string;
  slug: string;
  moneda: string;
  // Sin plantilla de Reporte (Expensas): no hay presupuesto ni avance; queda fuera de todo total.
  sinReporte: boolean;
  estadoPresupuesto: EstadoDePresupuesto | null;
  cartelPresupuesto: string | null;
  // Alguna de las filas que suman tiene partes manuales o parciales (marca del motor).
  incluyePartesManualesOParciales: boolean;
  // Empresa con Real 100 % tipeado a mano y todavía sin valor.
  realManualPendiente: boolean;
  corte: string | null;
  ritmo: RitmoDelMes | null;
  ingresos: CeldaDeAvance | null;
  egresosOperativos: CeldaDeAvance | null;
}>;

export type EmpresaParaAvance = { id: string; nombre: string; slug: string };

export function filaSinReporte(empresa: EmpresaParaAvance): FilaDeAvance {
  return Object.freeze({
    empresaId: empresa.id,
    nombre: empresa.nombre,
    slug: empresa.slug,
    moneda: monedaDeEmpresa(empresa.slug),
    sinReporte: true,
    estadoPresupuesto: null,
    cartelPresupuesto: null,
    incluyePartesManualesOParciales: false,
    realManualPendiente: false,
    corte: null,
    ritmo: null,
    ingresos: null,
    egresosOperativos: null,
  });
}

export function armarFilaDeAvance(
  empresa: EmpresaParaAvance,
  periodo: string,
  datos: { reporte: Reporte; presupuesto: PresupuestoLeido | null | undefined; corte: string | null }
): FilaDeAvance {
  const { ingresos, egresosOperativos } = extraerAvance(datos.reporte);
  const i = datos.reporte.periodos.length - 1;
  // El motor marca sinPresupuesto cuando no hay presupuesto del mes: manda sobre lo leído (un mes sin presupuesto nunca es «validado»).
  const estado: EstadoDePresupuesto = datos.reporte.sinPresupuesto[i] === true ? "sinPresupuesto" : estadoDePresupuesto(datos.presupuesto);
  const celdas = [ingresos, egresosOperativos];
  return Object.freeze({
    empresaId: empresa.id,
    nombre: empresa.nombre,
    slug: empresa.slug,
    moneda: monedaDeEmpresa(empresa.slug),
    sinReporte: false,
    estadoPresupuesto: estado,
    cartelPresupuesto: CARTEL_DE_ESTADO[estado],
    incluyePartesManualesOParciales: celdas.some((c) => c !== null && c.realIncompleto),
    realManualPendiente: EMPRESAS_CON_REAL_MANUAL.includes(empresa.slug) && celdas.some((c) => c !== null && c.real === null),
    corte: datos.corte,
    ritmo: ritmoDelMes(periodo, datos.corte),
    ingresos,
    egresosOperativos,
  });
}

// Orden alfabético (sin ranking): el mismo para todos los usuarios.
export function ordenarFilas<T extends { nombre: string }>(filas: readonly T[]): T[] {
  return [...filas].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

// ---- Total por moneda (solo egresos operativos) ----------------------------------------------------------------

export type TotalDeAvance = Readonly<{
  moneda: string;
  // «Total del holding» solo para ADMIN; para el resto «Total de tus empresas».
  rotulo: string;
  presupuestado: number | null;
  real: number | null;
  avance: number | null;
}>;

// Total de EGRESOS OPERATIVOS por moneda, solo con filas del alcance. Reglas:
//  - Las filas sin Reporte (Expensas) y las sin la celda no cuentan.
//  - Una moneda con una sola empresa no lleva total (sería repetir su fila).
//  - Si a alguna empresa de esa moneda le falta el presupuestado o el real, el total es null: nunca una suma parcial
//    presentada como completa.
//  - No existe total de ingresos.
export function totalesDeEgresosOperativos(filas: readonly FilaDeAvance[], alcance: Alcance): TotalDeAvance[] {
  const idsDelAlcance = new Set(alcance.empresas.map((e) => e.id));
  const porMoneda = new Map<string, CeldaDeAvance[]>();
  for (const f of filas) {
    if (!idsDelAlcance.has(f.empresaId) || f.sinReporte || f.egresosOperativos === null) continue;
    const lista = porMoneda.get(f.moneda) ?? [];
    lista.push(f.egresosOperativos);
    porMoneda.set(f.moneda, lista);
  }
  const rotulo = rotuloDeTotal(alcance);
  const totales: TotalDeAvance[] = [];
  for (const [moneda, celdas] of porMoneda) {
    if (celdas.length < 2) continue;
    const completo = celdas.every((c) => c.presupuestado !== null && c.real !== null);
    const presupuestado = completo ? celdas.reduce((s, c) => s + (c.presupuestado as number), 0) : null;
    const real = completo ? celdas.reduce((s, c) => s + (c.real as number), 0) : null;
    const avance = presupuestado !== null && real !== null && presupuestado !== 0 ? (real / presupuestado) * 100 : null;
    totales.push(Object.freeze({ moneda, rotulo, presupuestado, real, avance }));
  }
  return totales.sort((a, b) => (a.moneda === MONEDA_PREDETERMINADA ? -1 : b.moneda === MONEDA_PREDETERMINADA ? 1 : a.moneda.localeCompare(b.moneda)));
}

// ---- Concurrencia ----------------------------------------------------------------------------------------------

// El pool de Prisma es de 5 conexiones y cada Reporte usa varias consultas: como máximo 2 empresas a la vez.
export const MAXIMA_CONCURRENCIA = 2;

// Corre `tarea` sobre cada elemento con a lo sumo `maximo` en paralelo (nunca más de MAXIMA_CONCURRENCIA), conservando el
// orden de los resultados. Si una tarea falla, no arranca ninguna nueva y se propaga el primer error.
export async function conConcurrencia<T, R>(
  elementos: readonly T[],
  maximo: number,
  tarea: (elemento: T, posicion: number) => Promise<R>
): Promise<R[]> {
  const limite = Math.max(1, Math.min(Math.floor(maximo) || 1, MAXIMA_CONCURRENCIA));
  const resultados = new Array<R>(elementos.length);
  let siguiente = 0;
  let fallo = false;
  const trabajador = async () => {
    while (!fallo && siguiente < elementos.length) {
      const i = siguiente++;
      try {
        resultados[i] = await tarea(elementos[i], i);
      } catch (e) {
        fallo = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, elementos.length) }, trabajador));
  return resultados;
}
