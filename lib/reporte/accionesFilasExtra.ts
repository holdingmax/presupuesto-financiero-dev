import { EMPRESAS_CON_FILAS_EXTRA, EMPRESAS_CON_FILAS_EXTRA_GERENTE, EMPRESAS_CON_TIPEO_DIRECTO } from "@/lib/config";
import { ERROR_SIN_PERMISO_DE_CARGAR_REAL } from "@/lib/permisosReal";
import type { Plantilla } from "@/lib/reporte/motor";
import { motivoBloqueo, type EstadoSemanas } from "@/lib/reporte/bloqueo";
import {
  admiteFilasExtra,
  BLOQUES_EXTRA,
  validarNombreFila,
  type BloqueExtra,
} from "@/lib/reporte/filasExtra";

// Reglas de las acciones de crear y borrar filas extra (reporte/actionsFilasExtra.ts) y lo que le llega a la
// pantalla. Puras: sin Prisma ni next/*, para poder probarlas. Las acciones consultan la base y le pasan lo que
// leyeron; las decisiones se toman acá.

export type InterruptoresFilasExtra = {
  filasExtra: readonly string[];
  tipeo: readonly string[];
  // Empresas donde, además de ADMIN y FINANZAS, un gerente con la casilla de ESA empresa agrega y borra filas.
  filasExtraGerente?: readonly string[];
};

const DE_CONFIG: InterruptoresFilasExtra = {
  filasExtra: EMPRESAS_CON_FILAS_EXTRA,
  tipeo: EMPRESAS_CON_TIPEO_DIRECTO,
  filasExtraGerente: EMPRESAS_CON_FILAS_EXTRA_GERENTE,
};

const FORMATO_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;

export const ERROR_NO_HABILITADO = "Agregar filas no está habilitado para esta empresa.";
export const ERROR_SOLO_ADMIN = "Solo ADMIN y FINANZAS pueden agregar o borrar filas.";

// Quién puede agregar y borrar filas: ADMIN y FINANZAS siempre; un GERENTE solo en las empresas de EMPRESAS_CON_FILAS_EXTRA_GERENTE y
// solo con la casilla de ESA empresa (`puedeCargarReal`, lib/permisosReal.ts; sin definir = no la tiene). null = puede; si no, el motivo.
// El estado del Presupuesto NO cuenta (el gerente puede aunque esté En revisión); el mes bloqueado sí, aparte.
export function motivoSinPermisoFilasExtra(a: {
  empresaSlug: string;
  esAdminOFinanzas: boolean;
  puedeCargarReal?: boolean;
  interruptores?: InterruptoresFilasExtra;
}): string | null {
  if (a.esAdminOFinanzas) return null;
  const enGerente = (a.interruptores ?? DE_CONFIG).filasExtraGerente ?? [];
  if (!enGerente.includes(a.empresaSlug)) return ERROR_SOLO_ADMIN;
  return a.puedeCargarReal === true ? null : ERROR_SIN_PERMISO_DE_CARGAR_REAL;
}

// Interruptor de la empresa, tipeo directo (las filas se tipean con él) y plantilla con los totales marcados.
export function filasExtraActivas(
  empresaSlug: string,
  plantillaEstatica: Plantilla,
  interruptores: InterruptoresFilasExtra = DE_CONFIG
): boolean {
  return (
    interruptores.filasExtra.includes(empresaSlug) &&
    interruptores.tipeo.includes(empresaSlug) &&
    admiteFilasExtra(plantillaEstatica)
  );
}

// Se puede agregar una fila a este bloque en este mes mientras el flujo del mes no esté bloqueado (mismo
// criterio que el Real manual de flujo: un mes que ya pasó y no tiene semanas abiertas no admite altas).
// null = se puede; si no, el motivo.
export function motivoBloqueoAltaFilaExtra(
  bloque: BloqueExtra,
  periodo: string,
  actual: string,
  semanas: EstadoSemanas
): string | null {
  return motivoBloqueo({ periodo, actual, columna: "REAL", bloque, presupuestoValidado: false, semanas });
}

export type CreacionValida = { ok: true; bloque: BloqueExtra; nombre: string; nombreClave: string } | { ok: false; error: string };

export function validarCreacionFilaExtra(a: {
  empresaSlug: string;
  // La plantilla ESTÁTICA de la empresa.
  plantilla: Plantilla;
  esAdminOFinanzas: boolean;
  // Puede cargar el Real de ESTA empresa (gerente con la casilla). Sin definir = no.
  puedeCargarReal?: boolean;
  bloque: unknown;
  nombre: unknown;
  // Todas las filas extra de la empresa (también las que ya no se ven).
  extras: readonly { nombre: string }[];
  periodo: string;
  actual: string;
  semanas: EstadoSemanas;
  interruptores?: InterruptoresFilasExtra;
}): CreacionValida {
  const sinPermiso = motivoSinPermisoFilasExtra(a);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  if (!filasExtraActivas(a.empresaSlug, a.plantilla, a.interruptores)) return { ok: false, error: ERROR_NO_HABILITADO };
  const bloque = BLOQUES_EXTRA.find((b) => b === a.bloque);
  if (!bloque) return { ok: false, error: "Bloque inválido." };
  if (!FORMATO_PERIODO.test(a.periodo)) return { ok: false, error: "Período inválido." };
  const bloqueo = motivoBloqueoAltaFilaExtra(bloque, a.periodo, a.actual, a.semanas);
  if (bloqueo) return { ok: false, error: `No se pueden agregar filas en este mes: ${bloqueo}` };
  const nombre = validarNombreFila(a.nombre, a.plantilla, a.extras);
  if (!nombre.ok) return nombre;
  return { ok: true, bloque, nombre: nombre.nombre, nombreClave: nombre.nombreClave };
}

export const ERROR_FILA_CON_VALORES = "La fila tiene valores cargados: no se puede borrar.";

// El conteo de valores se hace DENTRO de la misma transacción que el borrado (reporte/actionsFilasExtra.ts).
export function decidirBorradoFilaExtra(a: {
  empresaSlug: string;
  plantilla: Plantilla;
  esAdminOFinanzas: boolean;
  puedeCargarReal?: boolean;
  existe: boolean;
  // Valores de ValorManualReporte (cualquier mes y columna) con la clave de la fila.
  cantidadDeValores: number;
  interruptores?: InterruptoresFilasExtra;
}): { ok: true } | { ok: false; error: string } {
  const sinPermiso = motivoSinPermisoFilasExtra(a);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  if (!filasExtraActivas(a.empresaSlug, a.plantilla, a.interruptores)) return { ok: false, error: ERROR_NO_HABILITADO };
  if (!a.existe) return { ok: false, error: "No encontré esa fila." };
  if (a.cantidadDeValores > 0) return { ok: false, error: ERROR_FILA_CON_VALORES };
  return { ok: true };
}

// Lo que recibe la pantalla: en qué bloques se muestra «Agregar una fila» y qué filas extra se pueden borrar.
export type VistaFilasExtra = { bloques: BloqueExtra[]; borrables: string[] };

// null = ni botones ni borrado. Lo recibe ADMIN/FINANZAS y, solo en las empresas de EMPRESAS_CON_FILAS_EXTRA_GERENTE, un gerente con
// la casilla de esa empresa; cualquier otro recibe null SIEMPRE, con el interruptor que sea.
export function armarVistaFilasExtra(a: {
  empresaSlug: string;
  plantillaEstatica: Plantilla;
  // La del Reporte, con las filas extra del mes.
  plantillaReporte: Plantilla;
  esAdminOFinanzas: boolean;
  puedeCargarReal?: boolean;
  periodo: string;
  actual: string;
  semanas: EstadoSemanas;
  // Claves «extra.<id>» que tienen algún valor cargado, en cualquier mes.
  clavesConValores: ReadonlySet<string>;
  interruptores?: InterruptoresFilasExtra;
}): VistaFilasExtra | null {
  if (motivoSinPermisoFilasExtra(a) !== null) return null;
  if (!filasExtraActivas(a.empresaSlug, a.plantillaEstatica, a.interruptores)) return null;
  const bloques = BLOQUES_EXTRA.filter((b) => motivoBloqueoAltaFilaExtra(b, a.periodo, a.actual, a.semanas) === null);
  const borrables = a.plantillaReporte.filas
    .filter((f) => f.tipo === "linea" && f.extra === true && !a.clavesConValores.has(f.clave))
    .map((f) => f.clave);
  return { bloques: [...bloques], borrables };
}
