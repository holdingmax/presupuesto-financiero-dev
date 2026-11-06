import type { Prisma } from "@prisma/client";
import { filtroDeUnidades } from "@/lib/ejecucionVista";
import { nombreParaMostrar } from "@/lib/clasificaciones";

// Filtro por clasificación de la pestaña "Ejecución financiera" de UNA empresa (la ve el gerente).
// Parte pura (sin base): la URL es la única fuente y el mismo valor alimenta la lista, el total, la
// paginación, los links de semana y el Excel. Se aplica en la consulta, junto con
// filtroDeUnidades (AND), así que un valor de otra empresa solo devuelve cero filas.
//
// "Sin clasificar" es una clasificación más ("SIN CLASIFICAR"): elegir una clasificación REEMPLAZA
// al viejo ?filtro=sin_clasificar (si vienen los dos, gana la clasificación).

export const CLASIFICACION_SIN_CLASIFICAR = "SIN CLASIFICAR";
const MAX_CLASIFICACION = 100;

type ParametrosClasificacion = {
  clasificacion?: string | string[];
  filtro?: string | string[];
};

function primero(valor: string | string[] | undefined): string | undefined {
  const v = Array.isArray(valor) ? valor[0] : valor;
  const limpio = v?.trim();
  return limpio ? limpio : undefined;
}

export function leerClasificacion(params: ParametrosClasificacion): string | undefined {
  const elegida = primero(params.clasificacion)?.slice(0, MAX_CLASIFICACION).trim();
  if (elegida) return elegida;
  return primero(params.filtro) === "sin_clasificar" ? CLASIFICACION_SIN_CLASIFICAR : undefined;
}

// Querystring SIN "?" ("" si no hay filtro). `pagina` se agrega solo si es > 1.
export function queryClasificacion(clasificacion: string | undefined, pagina?: number): string {
  const p = new URLSearchParams();
  if (clasificacion) p.set("clasificacion", clasificacion);
  if (pagina !== undefined && pagina > 1) p.set("pagina", String(pagina));
  return p.toString();
}

// Ruta + filtro: la usan los links de semana y el del Excel para no perder el filtro.
export function hrefConFiltro(base: string, clasificacion: string | undefined): string {
  const q = queryClasificacion(clasificacion);
  return q ? `${base}?${q}` : base;
}

// Where de la lista, el total y el Excel: la semana, las unidades de la empresa y, si hay, la
// clasificación — todo por AND (claves distintas del mismo objeto). `ocultas` son los valores EXACTOS
// guardados que este usuario no puede ver (lib/clasificacionesOcultas.ts): se excluyen siempre, también
// cuando la URL pide uno de ellos (queda en cero filas).
export function whereMovimientosDeEmpresa(
  ejecucionId: string,
  unidades: string[],
  clasificacion: string | undefined,
  ocultas: string[] = []
): Prisma.MovimientoBancarioWhereInput {
  return {
    ejecucionId,
    ...filtroDeUnidades(unidades),
    ...(clasificacion ? { clasificacion } : {}),
    ...(ocultas.length > 0 ? { NOT: { clasificacion: { in: ocultas } } } : {}),
  };
}

export type OpcionClasificacion = { valor: string; etiqueta: string };

// Opciones del desplegable: SOLO las clasificaciones que salieron de la consulta de esa empresa y esa
// semana (sin repetir ni vacías), con el nombre para mostrar y el valor técnico para filtrar.
export function opcionesDeClasificacion(clasificacionesDeLaEmpresa: string[]): OpcionClasificacion[] {
  return Array.from(new Set(clasificacionesDeLaEmpresa.filter((c) => c.trim() !== "")))
    .map((valor) => ({ valor, etiqueta: nombreParaMostrar(valor) }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
}
