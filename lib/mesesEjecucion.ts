import { CLASIFICACION_SIN_CLASIFICAR } from "@/lib/filtroClasificacionEmpresa";

// Selector de mes de la pestaña Ejecución de UNA empresa y regla de entrada. Parte pura (sin base): la
// consulta vive en app/[empresa]/[periodo]/ejecucion/datos.ts y solo lee semanas que YA existen — nada de
// acá crea una semana. Un mes aparece solo si tiene movimientos (sin ignorados) de la empresa.

export type SemanaDeMes = { id: string; periodo: string; numeroSemana: number; estado: string };
export type FilaConteo = { ejecucionId: string; clasificacion: string; cantidad: number };

export type MesConMovimientos = {
  periodo: string;
  total: number;
  sinClasificar: number;
  // Semana a la que lleva el mes: la abierta más reciente si hay; si no, la última.
  numeroSemana: number;
};

// La semana abierta (la de número más alto, si hubiera más de una) o, sin abiertas, la última.
export function semanaParaVer(semanas: { numeroSemana: number; estado: string }[]): number | null {
  if (semanas.length === 0) return null;
  const abiertas = semanas.filter((s) => s.estado !== "CERRADA");
  const candidatas = abiertas.length > 0 ? abiertas : semanas;
  return Math.max(...candidatas.map((s) => s.numeroSemana));
}

// Un mes por período, del más nuevo al más viejo. `filas` son los conteos por semana y clasificación de lo
// que es de la empresa; `ocultas` son los valores exactos de clasificación que el usuario no ve (no cuentan).
export function resumirMeses(semanas: SemanaDeMes[], filas: FilaConteo[], ocultas: string[] = []): MesConMovimientos[] {
  const periodoDe = new Map(semanas.map((s) => [s.id, s.periodo]));
  const ocultasSet = new Set(ocultas);
  const acumulado = new Map<string, { total: number; sinClasificar: number }>();
  for (const f of filas) {
    const periodo = periodoDe.get(f.ejecucionId);
    if (!periodo || ocultasSet.has(f.clasificacion) || f.cantidad <= 0) continue;
    const a = acumulado.get(periodo) ?? { total: 0, sinClasificar: 0 };
    a.total += f.cantidad;
    if (f.clasificacion === CLASIFICACION_SIN_CLASIFICAR) a.sinClasificar += f.cantidad;
    acumulado.set(periodo, a);
  }
  return Array.from(acumulado.entries())
    .map(([periodo, a]) => ({
      periodo,
      ...a,
      numeroSemana: semanaParaVer(semanas.filter((s) => s.periodo === periodo))!,
    }))
    .sort((a, b) => (a.periodo < b.periodo ? 1 : a.periodo > b.periodo ? -1 : 0));
}

// Regla de entrada: el mes de la URL manda si tiene movimientos (null = no cambiar nada). Si está vacío,
// el más reciente con movimientos sin clasificar; si no hay ninguno, el más reciente con movimientos.
// null también si la empresa no tiene movimientos en ningún mes.
export function elegirMesDeEntrada(meses: MesConMovimientos[], periodoUrl: string): MesConMovimientos | null {
  if (meses.some((m) => m.periodo === periodoUrl && m.total > 0)) return null;
  const conMovimientos = meses.filter((m) => m.total > 0);
  const masReciente = (lista: MesConMovimientos[]) =>
    lista.reduce<MesConMovimientos | null>((mejor, m) => (mejor === null || m.periodo > mejor.periodo ? m : mejor), null);
  return masReciente(conMovimientos.filter((m) => m.sinClasificar > 0)) ?? masReciente(conMovimientos);
}

// Opciones del selector. Si el mes de la URL no tiene movimientos (por ejemplo noviembre, vacío) se agrega
// igual, marcado, para que el selector muestre dónde está parado. Siempre links a una semana ya existente.
export type OpcionMes = { periodo: string; href: string; vacio: boolean };
export function opcionesDeMes(
  empresa: string,
  meses: MesConMovimientos[],
  periodoActual: string,
  hrefConFiltro: (base: string) => string
): OpcionMes[] {
  const opciones: OpcionMes[] = meses.map((m) => ({
    periodo: m.periodo,
    href: hrefConFiltro(`/${empresa}/${m.periodo}/ejecucion/${m.numeroSemana}`),
    vacio: false,
  }));
  if (!opciones.some((o) => o.periodo === periodoActual)) {
    opciones.push({ periodo: periodoActual, href: hrefConFiltro(`/${empresa}/${periodoActual}/ejecucion`), vacio: true });
    opciones.sort((a, b) => (a.periodo < b.periodo ? 1 : a.periodo > b.periodo ? -1 : 0));
  }
  return opciones;
}
