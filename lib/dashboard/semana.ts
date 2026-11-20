// Reglas PURAS de "semana" del Dashboard consolidado (Entrega 1). Sin Prisma ni next/*.
//
// Las semanas de Ejecución son LOTES DE CARGA, no semanas del calendario (una semana de Ejecución puede traer movimientos de
// todo un mes), así que el dashboard cuenta semanas calendario, de lunes a domingo, según MovimientoBancario.fecha.
// Las fechas son texto "AAAA-MM-DD" (los movimientos se guardan como medianoche UTC): todo el cálculo es en UTC, sin husos.

const DIA_MS = 86_400_000;
const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

function aUtc(fecha: string): number {
  const m = FORMATO_FECHA.exec(fecha);
  if (!m) throw new Error(`Fecha inválida (se espera AAAA-MM-DD): "${fecha}"`);
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(anio, mes - 1, dia);
  const d = new Date(t);
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw new Error(`Fecha inexistente: "${fecha}"`);
  }
  return t;
}

function aIso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

// Rango [desde, hasta) del mes "AAAA-MM": desde = primer día, hasta = primer día del mes siguiente.
export function rangoDeMes(periodo: string): { desde: string; hasta: string } {
  const m = FORMATO_PERIODO.exec(periodo);
  const mes = m ? Number(periodo.slice(5, 7)) : 0;
  if (!m || mes < 1 || mes > 12) throw new Error(`Período inválido (se espera AAAA-MM): "${periodo}"`);
  const anio = Number(periodo.slice(0, 4));
  return { desde: `${periodo}-01`, hasta: aIso(Date.UTC(anio, mes, 1)) };
}

export function esFechaIso(valor: string): boolean {
  try {
    aUtc(valor);
    return true;
  } catch {
    return false;
  }
}

// Lunes de la semana (lunes a domingo) a la que pertenece la fecha. Un lunes devuelve el mismo día; un domingo, el lunes
// anterior (6 días atrás).
export function lunesDeSemana(fecha: string): string {
  const t = aUtc(fecha);
  const diaDeLaSemana = new Date(t).getUTCDay(); // 0 = domingo
  return aIso(t - ((diaDeLaSemana + 6) % 7) * DIA_MS);
}

export function domingoDeSemana(fecha: string): string {
  return aIso(aUtc(lunesDeSemana(fecha)) + 6 * DIA_MS);
}

export function semanaAnterior(fecha: string): string {
  return aIso(aUtc(lunesDeSemana(fecha)) - 7 * DIA_MS);
}

export function semanaSiguiente(fecha: string): string {
  return aIso(aUtc(lunesDeSemana(fecha)) + 7 * DIA_MS);
}

// Los lunes de las `cantidad` semanas que terminan en la de `fecha` (la más vieja primero).
export function ultimasSemanas(fecha: string, cantidad: number): string[] {
  if (!Number.isInteger(cantidad) || cantidad < 1) throw new Error("La cantidad de semanas tiene que ser un entero positivo.");
  const ultimo = aUtc(lunesDeSemana(fecha));
  return Array.from({ length: cantidad }, (_, i) => aIso(ultimo - (cantidad - 1 - i) * 7 * DIA_MS));
}

export type ParteDeSemana = {
  // "AAAA-MM": el mes (y por lo tanto el período de Reporte y de Presupuesto) al que pertenece esa parte.
  periodo: string;
  desde: string;
  hasta: string;
  dias: number;
};

// Una semana que cruza de mes se PARTE por mes para el avance contra el presupuesto: cada parte va al Reporte de su mes.
// Una semana dentro de un solo mes devuelve una sola parte.
export function partesPorMes(fecha: string): ParteDeSemana[] {
  const lunes = aUtc(lunesDeSemana(fecha));
  const partes: ParteDeSemana[] = [];
  for (let i = 0; i < 7; i++) {
    const dia = aIso(lunes + i * DIA_MS);
    const periodo = dia.slice(0, 7);
    const ultima = partes[partes.length - 1];
    if (ultima && ultima.periodo === periodo) {
      ultima.hasta = dia;
      ultima.dias += 1;
    } else {
      partes.push({ periodo, desde: dia, hasta: dia, dias: 1 });
    }
  }
  return partes;
}

export function cruzaDeMes(fecha: string): boolean {
  return partesPorMes(fecha).length > 1;
}

// ---- Semana completa o provisoria ------------------------------------------------------------------------------

// Una fila por (semana, mes, estado del lote) con la cantidad de movimientos del ALCANCE (los que no son del alcance nunca
// llegan acá: los filtra la consulta, ver consultas.ts) y la última fecha entre ellos.
export type FilaDeLote = {
  lunes: string;
  periodo: string;
  estado: "ABIERTA" | "CERRADA";
  movimientos: number;
  ultimaFecha: string;
};

export type EstadoDeSemana = {
  // completa: hay movimientos y todos están en lotes CERRADOS.
  // provisoria: hay al menos un movimiento en un lote ABIERTO.
  // sinDatos: no hay ningún movimiento (ni completa ni provisoria: no hay nada que mostrar).
  tipo: "completa" | "provisoria" | "sinDatos";
  // Movimientos en lotes cerrados: son los que cuenta el Reporte.
  movimientosIncluidos: number;
  // Movimientos en lotes abiertos: todavía NO están en el Reporte ("afuera" de los números).
  movimientosAfuera: number;
};

function estadoDeFilas(filas: readonly FilaDeLote[]): EstadoDeSemana {
  let incluidos = 0;
  let afuera = 0;
  for (const f of filas) {
    if (!Number.isFinite(f.movimientos) || f.movimientos < 0) throw new Error("Cantidad de movimientos inválida.");
    if (f.estado === "CERRADA") incluidos += f.movimientos;
    else afuera += f.movimientos;
  }
  const tipo = incluidos + afuera === 0 ? "sinDatos" : afuera === 0 ? "completa" : "provisoria";
  return { tipo, movimientosIncluidos: incluidos, movimientosAfuera: afuera };
}

// Estado de la semana entera (todos los lotes que tienen movimientos de esa semana, de cualquier mes).
export function estadoDeSemana(filas: readonly FilaDeLote[], fecha: string): EstadoDeSemana {
  const lunes = lunesDeSemana(fecha);
  return estadoDeFilas(filas.filter((f) => f.lunes === lunes));
}

// Estado de UNA parte de la semana (el mes que la semana comparte con otro): sirve para el avance de ese mes.
export function estadoDeParte(filas: readonly FilaDeLote[], fecha: string, periodo: string): EstadoDeSemana {
  if (!FORMATO_PERIODO.test(periodo)) throw new Error(`Período inválido (se espera AAAA-MM): "${periodo}"`);
  const lunes = lunesDeSemana(fecha);
  return estadoDeFilas(filas.filter((f) => f.lunes === lunes && f.periodo === periodo));
}

// ---- "Datos al dd/mm" ------------------------------------------------------------------------------------------

// Última fecha con movimientos DEL ALCANCE. Por defecto solo cuenta los lotes cerrados, que son los que alimentan los
// números del Reporte; con soloCerradas=false incluye también los abiertos. null si no hay ninguno.
export function ultimaFechaDeDatos(
  filas: readonly FilaDeLote[],
  opciones: { soloCerradas?: boolean } = {}
): string | null {
  const soloCerradas = opciones.soloCerradas ?? true;
  let ultima: string | null = null;
  for (const f of filas) {
    if (soloCerradas && f.estado !== "CERRADA") continue;
    if (f.movimientos <= 0) continue;
    aUtc(f.ultimaFecha); // valida el formato
    if (ultima === null || f.ultimaFecha > ultima) ultima = f.ultimaFecha;
  }
  return ultima;
}

// "2026-11-13" -> "13/11".
export function formatoDdMm(fecha: string): string {
  aUtc(fecha);
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
}

// El texto de «datos al dd/mm», o null si el alcance no tiene datos.
export function datosAl(filas: readonly FilaDeLote[], opciones: { soloCerradas?: boolean } = {}): string | null {
  const ultima = ultimaFechaDeDatos(filas, opciones);
  return ultima === null ? null : formatoDdMm(ultima);
}
