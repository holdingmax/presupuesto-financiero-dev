import type { Rol } from "@prisma/client";
import { CLASIFICACIONES_POR_EMPRESA } from "@/lib/config";
import { normalizarClasificacion } from "@/lib/clasificacionesOcultas";

// Clasificar los movimientos de UNA empresa desde la pestaña "Ejecución financiera" de esa empresa (decisión de negocio:
// Romina —Bradenton y Plate Silver— y Nadina —Havanna Perú— clasifican lo suyo). Reglas PURAS (sin Prisma ni next/*) para
// poder probarlas; la parte con base de datos vive en lib/clasificarPorEmpresaDb.ts.
//
// QUÉ SE PERMITE, y solo esto: cambiar la clasificación, cambiar la unidad DENTRO de las unidades de la empresa, ignorar o
// des-ignorar, y confirmar sugerencias. NO se permite: cerrar la semana, eliminar, prorratear, subir extractos genéricos,
// ni tocar importe, fecha, concepto, cuenta o moneda. Todo con movimientos de las unidades de la empresa y semana ABIERTA.
//
// QUIÉN: un GERENTE con la casilla («Puede cargar Real de esta empresa», UsuarioEmpresa.puedeOperarEjecucion) EN ESA empresa.
// ADMIN y FINANZAS NO pasan por acá a propósito: siguen operando por Ejecución global como siempre (FINANZAS sin
// «Opera Ejecución» no clasifica hoy, y este camino no se lo da).

export type AccesoParaClasificar = { puedeOperarEjecucion: boolean } | null | undefined;

export function puedeClasificarEnEmpresa(usuario: { rol: Rol }, acceso: AccesoParaClasificar): boolean {
  return usuario.rol === "GERENTE" && acceso != null && acceso.puedeOperarEjecucion === true;
}

export const ERROR_SIN_PERMISO_DE_CLASIFICAR =
  "Solo un gerente con permiso de cargar el Real de esta empresa puede clasificar sus movimientos desde acá.";
export const ERROR_SEMANA_CERRADA = "Esta semana ya está cerrada, no se puede editar.";
export const ERROR_MOVIMIENTO_NO_ENCONTRADO = "No encontré ese movimiento en esta semana.";
export const ERROR_MOVIMIENTO_NO_ES_DE_LA_EMPRESA = "Ese movimiento no es de una unidad de esta empresa.";
export const ERROR_MOVIMIENTO_PRORRATEADO = "Un movimiento prorrateado no se edita desde acá: lo hace Finanzas en Ejecución global.";
export const ERROR_CAMBIO_CONCURRENTE = "El movimiento cambió o la semana se cerró mientras editabas. Recargá la página.";

// Campos que se pueden escribir. Cualquier otra clave del pedido se rechaza (no se ignora en silencio).
export const CAMPOS_EDITABLES_POR_EMPRESA = ["clasificacion", "unidadNegocio", "ignorado"] as const;

export type EdicionEmpresa = { clasificacion?: string; unidadNegocio?: string; ignorado?: boolean };

export type MovimientoParaEditar = {
  unidadNegocio: string;
  clasificacion: string;
  // Cantidad de porciones de prorrateo; > 0 = prorrateado.
  cantidadDesglose: number;
};

export type EntradaValidacion = {
  datos: unknown;
  movimiento: MovimientoParaEditar;
  // Unidades de la empresa (Empresa.unidadesNegocio).
  unidadesEmpresa: readonly string[];
  // Estado de la semana del movimiento.
  estadoSemana: string;
  // Lista de clasificaciones válidas (la misma que ofrece Ejecución global).
  clasificacionesValidas: readonly string[];
  // Clasificaciones que ESTE usuario no ve (config.ts, ya normalizadas): ni las elige ni toca filas que las tengan.
  ocultasNormalizadas: readonly string[];
};

export type ResultadoValidacion =
  | {
      ok: true;
      // Lo que se escribe en el movimiento. Misma regla que actualizarMovimiento de Ejecución global: tocar la
      // clasificación confirma la sugerida; cambiar de verdad la unidad confirma la unidad sugerida.
      data: { clasificacion?: string; unidadNegocio?: string; ignorado?: boolean; sugeridaPorSistema?: false; unidadSugeridaPorSistema?: false };
    }
  | { ok: false; error: string };

export function validarEdicionEmpresa(e: EntradaValidacion): ResultadoValidacion {
  if (e.estadoSemana === "CERRADA") return { ok: false, error: ERROR_SEMANA_CERRADA };
  if (!e.unidadesEmpresa.includes(e.movimiento.unidadNegocio)) {
    return { ok: false, error: ERROR_MOVIMIENTO_NO_ES_DE_LA_EMPRESA };
  }
  if (e.movimiento.cantidadDesglose > 0) return { ok: false, error: ERROR_MOVIMIENTO_PRORRATEADO };
  const ocultas = new Set(e.ocultasNormalizadas);
  if (ocultas.has(normalizarClasificacion(e.movimiento.clasificacion))) {
    return { ok: false, error: ERROR_MOVIMIENTO_NO_ES_DE_LA_EMPRESA };
  }

  const datos = e.datos;
  if (datos === null || typeof datos !== "object" || Array.isArray(datos)) {
    return { ok: false, error: "No hay nada para cambiar." };
  }
  const permitidos = new Set<string>(CAMPOS_EDITABLES_POR_EMPRESA);
  for (const clave of Object.keys(datos)) {
    if (!permitidos.has(clave)) return { ok: false, error: `No se puede cambiar "${clave}" desde acá.` };
  }
  const d = datos as Record<string, unknown>;
  const data: { clasificacion?: string; unidadNegocio?: string; ignorado?: boolean; sugeridaPorSistema?: false; unidadSugeridaPorSistema?: false } = {};

  if (d.clasificacion !== undefined) {
    if (typeof d.clasificacion !== "string" || d.clasificacion.trim() === "") {
      return { ok: false, error: "La clasificación no puede estar vacía." };
    }
    const c = d.clasificacion;
    if (!e.clasificacionesValidas.includes(c)) return { ok: false, error: `"${c}" no es una clasificación de la lista.` };
    if (ocultas.has(normalizarClasificacion(c))) return { ok: false, error: `"${c}" no es una clasificación de la lista.` };
    data.clasificacion = c;
    data.sugeridaPorSistema = false;
  }

  if (d.unidadNegocio !== undefined) {
    if (typeof d.unidadNegocio !== "string") return { ok: false, error: "La unidad de negocio no es válida." };
    const u = d.unidadNegocio;
    if (u !== e.movimiento.unidadNegocio) {
      // Solo entre las unidades de la empresa: nunca una de otra.
      if (!e.unidadesEmpresa.includes(u)) return { ok: false, error: `"${u}" no es una unidad de esta empresa.` };
      data.unidadNegocio = u;
      data.unidadSugeridaPorSistema = false;
    }
  }

  if (d.ignorado !== undefined) {
    if (typeof d.ignorado !== "boolean") return { ok: false, error: "El valor de ignorado no es válido." };
    data.ignorado = d.ignorado;
  }

  // Nada que escribir (p. ej. se eligió la misma unidad que ya tenía): no es un cambio.
  if (Object.keys(data).length === 0) return { ok: false, error: "No hay nada para cambiar." };
  return { ok: true, data };
}

// Lista propia de clasificaciones de la empresa (lib/config.ts: CLASIFICACIONES_POR_EMPRESA), o null si la empresa no tiene una y
// sigue con la lista general. Devuelve una copia, en el orden configurado, sin «SIN CLASIFICAR» (la agrega quien arma el desplegable).
export function clasificacionesPropiasDeEmpresa(
  slugEmpresa: string,
  mapa: Readonly<Record<string, readonly string[]>> = CLASIFICACIONES_POR_EMPRESA
): string[] | null {
  return Object.prototype.hasOwnProperty.call(mapa, slugEmpresa) ? [...mapa[slugEmpresa]] : null;
}

export type TipoSugerencia = "clasificacion" | "unidad";

export function esTipoSugerencia(valor: unknown): valor is TipoSugerencia {
  return valor === "clasificacion" || valor === "unidad";
}
