// Sin imports de servidor (solo lib/texto, puro): este módulo lo usan también
// TablaMovimientos y PanelDesgloseMovimiento, que son "use client".
import { normalizarTexto } from "@/lib/texto";

// Lista CERRADA de unidades de negocio (decisión 2026-10-06, confirmada por
// Leticia) — la ofrecen el <select> de la unidad de cada fila y el panel de
// prorrateo, y la valida el server (actualizarMovimiento /
// guardarDesgloseMovimiento). Es el nombre exacto que se guarda.
// - EXPENSAS: unidad y empresa aparte, con presupuesto propio (decisión 2026-10-17;
//   también existe como clasificación). El reparto entre empresas es manual, con
//   prorrateo por movimiento. Si la empresa "Expensas" todavía no tiene la unidad
//   asignada (/admin/unidades-negocio), el Reporte la muestra en "No asignado".
// - BRADENTON (agregada 2026-10-07): unidad propia de la empresa Bradenton.
// Qué unidad pertenece a qué empresa NO vive acá: es Empresa.unidadesNegocio,
// editable en /admin/unidades-negocio.
// - HAVANNA PERU y PLATE SILVER (agregadas 2026-11-09, pedido de Leti/Kike): unidades
//   propias de las empresas Havanna Perú y Plate Silver (sin tilde, como las demás).
//   Se asignan a su empresa en /admin/unidades-negocio. Sus Reportes siguen tipeados a
//   mano; la unidad solo habilita la pantalla de Unidades y el desplegable de Ejecución.
// - JPS (retirada 2026-11-09): no existe como negocio. La empresa JPS está inactiva y la
//   clasificación "JPS" es otra cosa y se conserva. Una fila vieja con unidad JPS no se
//   rompe: el <select> la muestra como opción extra (ver opcionesUnidad).
// - HANDYWAY (agregada 2026-10-13, retirada 2026-10-17): Kike confirmó que es la
//   misma unidad que HWC. La razón social HANDYWAY mapea a HWC; una fila vieja con
//   HANDYWAY no se rompe (el <select> la muestra como opción extra).
// - Fuera a propósito: CREAR y Tucson (razones sociales), las razones sociales
//   que entraban por la columna EMPRESA (QUINTEROS, WHEELER, GONZALEZ, SIERRA,
//   ESTEVEZ), Gold Seguridad, Cielos, "SIN ASIGNAR" (es la marca de vacío),
//   "SPP " con espacio y TEST2. Una fila vieja con uno de esos valores no se
//   rompe: el <select> lo muestra como opción extra (ver opcionesUnidad).
// Las unidades de UNIDAD_POR_CUENTA (más abajo) tienen que estar todas acá.
export const UNIDADES_NEGOCIO = [
  "AVIANOR",
  "BRADENTON",
  "BRILLANTE",
  "EXPENSAS",
  "FREDY",
  "HAVANNA",
  "HAVANNA PERU",
  "HWC",
  "LOGISTICA",
  "MANTENOR",
  "PLATE SILVER",
  "RADIO",
  "SPP",
] as const;

export function esUnidadDeLaLista(valor: string): boolean {
  return (UNIDADES_NEGOCIO as readonly string[]).includes(valor);
}

// Opciones para un <select> de unidad: la lista cerrada + los valores viejos
// fuera de lista que ya tiene el registro (ej. "CREAR", "SIN ASIGNAR"), para no
// romperlo ni cambiarlo en silencio — mismo criterio que el <select> de
// clasificación en TablaMovimientos. Los extras van primero, tal cual.
export function opcionesUnidad(valoresActuales: string[]): string[] {
  const extras = Array.from(
    new Set(valoresActuales.filter((v) => v !== "" && !esUnidadDeLaLista(v)))
  );
  return [...extras, ...UNIDADES_NEGOCIO];
}

// Mismo criterio de normalización que verificarContinuidadSaldo (ejecucion/actions.ts)
// y normalizarClasificacion (lib/clasificaciones.ts): tolera mayúsculas, tildes y
// espacios de más — "Frances 891", "FRANCÉS 891" y "FRANCES  891 " son la misma cuenta.
export function normalizarCuenta(bancoYCuenta: string): string {
  return normalizarTexto(bancoYCuenta);
}

// "Unidad madre" de cada cuenta bancaria, confirmada con el archivo madre de julio
// 2026 (16.521 movimientos): esta unidad acierta en el 96,5% de los movimientos
// (sin contar Panini). Solo cuentas numeradas — son únicas en todo el holding.
// EFECTIVO / CHEQUE / DÓLAR quedan afuera a propósito: se repiten entre empresas,
// así que no tienen una unidad madre posible.
//
// Coincidencia EXACTA de la clave normalizada, no "contiene" (a diferencia de
// REGLAS_CLASIFICACION_AUTOMATICA): con substring, "MACRO 037" matchearía dentro de
// "MACRO 8037". Cada cuenta nueva es un caso confirmado, no una adivinanza — una
// grafía distinta de una cuenta ya listada (ej. "MACRO 37" sin el cero) se agrega
// como clave más, no con lógica difusa. Los valores son el nombre exacto que ya
// existe en la base: "SPP" siempre sin espacio final (hay filas viejas "SPP "
// anteriores al .trim() de subirExtracto, no repetir esa variante acá).
export const UNIDAD_POR_CUENTA: Record<string, string> = {
  "MACRO 037": "BRILLANTE",
  "MACRO 8037": "BRILLANTE",
  "BNA 497": "BRILLANTE",
  "BSE 042": "BRILLANTE",
  "MACRO 182": "BRILLANTE",
  "FRANCES 603": "BRILLANTE",
  "GALICIA 336": "BRILLANTE",
  // Lista vigente de Flavia (2026-10-16).
  "MACRO 546": "BRILLANTE",
  "MACRO 450": "BRILLANTE",

  "MACRO 325": "RADIO",
  "MACRO 924": "RADIO",
  "MACRO 278": "RADIO",
  "MACRO 689": "RADIO",
  "MACRO 931": "RADIO",
  "MACRO 216": "RADIO",
  "MACRO 715": "RADIO",
  "MACRO 906": "RADIO",

  "MACRO 565": "HAVANNA",
  "GALICIA 548": "HAVANNA",
  "GALICIA 388": "HAVANNA",
  "MACRO 597": "HAVANNA",

  "FRANCES 891": "LOGISTICA",
  "FRANCES 907": "LOGISTICA",
  "MACRO 777": "LOGISTICA",
  // Excepción de la razón social LI (→ BRILLANTE): esta cuenta es de SPP
  // (Conexión), tabla oficial de Kike 2026-10-13. La cuenta gana sobre la razón
  // social (ver subirExtracto).
  "GALICIA 455": "SPP",

  "BSE 560": "SPP",
  "MACRO 281": "SPP",
  "GALICIA 285": "SPP",
  "FRANCES 825": "SPP",
  "MACRO 599": "SPP",
  "MACRO 575": "SPP",
  // Flavia la ubica en Conexión (LI); antes figuraba como BRILLANTE.
  "MACRO 247": "SPP",

  // HWC: en el madre de Kike figuran con EMPRESA = HWC (2026-10-15). HWC y HANDYWAY son la misma unidad (Kike, 2026-10-17).
  "BNA 241": "HWC",
  "SANT 099": "HWC",
  // Cuentas de los madres HWC y Fredy (31.07); Kike confirmó que no mezclan unidades (2026-10-15).
  "FRANCES 525": "HWC",
  "MACRO 833": "HWC",
  "MACRO 918": "HWC",
  "GALICIA 249": "FREDY",
  "MACRO 160": "FREDY",
  "MACRO 154": "FREDY",
  "MACRO 432": "FREDY",
  "MACRO 789": "FREDY",
  "MACRO 669": "FREDY",
  "MACRO 672": "FREDY",
  "MACRO 870": "FREDY",
  "MACRO 831": "FREDY",

  "GALICIA 731": "MANTENOR",
  "MACRO 623": "MANTENOR",
  "MACRO 794": "MANTENOR",
  "MACRO 571": "MANTENOR",
};

// Único punto de uso: subirExtracto (ejecucion/actions.ts), solo cuando el archivo
// no trae unidad (o trae "SIN ASIGNAR") — nunca pisa una unidad explícita. Devuelve
// null si la cuenta no está en el mapa (el llamador cae a "SIN ASIGNAR", igual que
// siempre).
export function proponerUnidadPorCuenta(bancoYCuenta: string): string | null {
  return UNIDAD_POR_CUENTA[normalizarCuenta(bancoYCuenta)] ?? null;
}

// Valor de una celda de unidad → el nombre canónico de UNIDADES_NEGOCIO si es
// una unidad válida (comparación sin mayúsculas/tildes/espacios: "SPP " → "SPP",
// "havanna" → "HAVANNA"), o null si no lo es.
export function unidadDeLaLista(valor: string): string | null {
  const clave = normalizarTexto(valor);
  return (UNIDADES_NEGOCIO as readonly string[]).find((u) => u === clave) ?? null;
}

// Razón social → unidad madre (decisión 2026-10-07, confirmado por Kike; tabla
// oficial actualizada 2026-10-13: TUCSON→RADIO, CREAR→MANTENOR, LI→BRILLANTE,
// HANDYWAY→HWC desde 2026-10-17). La
// columna EMPRESA de los extractos trae la RAZÓN SOCIAL, no la unidad — y en
// algunos archivos la misma razón social aparece en "UNIDAD DE NEG" (error de
// etiqueta: QUINTEROS, SIERRA, … son apellidos/razones sociales de Fredy). Mismo
// criterio que UNIDAD_POR_CUENTA: coincidencia EXACTA del texto normalizado, solo
// casos confirmados. Las razones sociales MIXTAS (LI RATIO, SPP RATIO, CIELOS —
// Kike no las incluyó en la tabla) quedan AFUERA a propósito: no tienen
// una unidad madre, van a "SIN ASIGNAR" para revisión manual.
const UNIDAD_POR_RAZON_SOCIAL: Record<string, string> = {
  "QUINTEROS": "FREDY",
  "SIERRA": "FREDY",
  "WHEELER": "FREDY",
  "GONZALEZ": "FREDY",
  "ESTEVEZ": "FREDY",
  "FREDY": "FREDY",
  "INFO": "RADIO",
  "INFO SAT": "RADIO",
  "RADIO": "RADIO",
  "TUCSON": "RADIO",
  "CREAR": "MANTENOR",
  "LI": "BRILLANTE",
  "HANDYWAY": "HWC",
  "PANINI": "HAVANNA",
  "GOLD SEGURIDAD": "BRILLANTE",
  "WEB MASTER": "LOGISTICA",
  "FID ADM 2": "EXPENSAS",
  "SPP RATIO": "SPP",
  "SPP": "SPP",
  "HWC": "HWC",
};

// Único punto de uso: subirExtracto. null si la razón social no está en el mapa
// (incluidas las mixtas).
export function proponerUnidadPorRazonSocial(razonSocial: string): string | null {
  return UNIDAD_POR_RAZON_SOCIAL[normalizarTexto(razonSocial)] ?? null;
}
