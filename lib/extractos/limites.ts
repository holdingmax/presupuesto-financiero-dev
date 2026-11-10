// Frenos de la subida de extractos por la web (Ejecución global). Funciones puras, sin base de
// datos ni ExcelJS: se evalúan en el servidor ANTES de leer el archivo (tamaño) y apenas se
// lee (filas). Causa: la subida de la madre real (16.521 filas, 1,28 MB) superó los 512 MB de
// memoria que tenía Render y tiró el servicio; hoy el servicio es Standard (2 GB).
//
// Dos juegos de topes, los mismos para todos los roles (ADMIN incluido):
//   - Extracto de un banco: los 6 extractos reales de Flavia tienen entre 6 y 25 filas y entre 1 KB
//     y 42 KB, así que 1 MB / 1.000 filas dan un margen de decenas de veces.
//   - Archivo madre (opción "Archivo madre" del selector, solo ADMIN y FINANZAS, incluido el
//     histórico completo): 20.000 filas / 2 MB. Medido 2026-10-29 (solo lectura, sin base): leer la
//     madre cuesta unos 13,5 KB de RSS por fila (16.521 filas: pico 335 MB) y el servidor ya parte
//     de ~202 MB; con 2 GB entra holgado. Si el servicio vuelve a tener menos memoria, se cambia acá.
// El script prisma/scripts/cargar-madre-historial.ts sigue existiendo (usa lib/extractos/madre.ts).
//
// ÚNICO LUGAR donde se cambian los topes.

export const MAX_BYTES_EXTRACTO = 1024 * 1024; // 1 MB
export const MAX_FILAS_EXTRACTO = 1000;

export const MAX_BYTES_MADRE = 2 * 1024 * 1024; // 2 MB
export const MAX_FILAS_MADRE = 20000;

export const MENSAJE_MADRE_DIVIDIR = "Dividilo por período y subilo en partes.";

export type ResultadoLimite = { ok: true } | { ok: false; error: string };

const OK: ResultadoLimite = { ok: true };

function formatearTamano(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2).replace(".", ",")} MB`;
}

function formatearFilas(n: number): string {
  return n.toLocaleString("es-AR");
}

// Qué decirle a quien subió una madre por el camino del extracto de un banco.
export function mensajeUsarOpcionMadre(): string {
  return `Si es un archivo madre, elegí la opción «Archivo madre» del selector (hasta ${formatearFilas(MAX_FILAS_MADRE)} filas y ${formatearTamano(MAX_BYTES_MADRE)}; solo ADMIN y FINANZAS).`;
}

// Antes de leer el archivo.
export function verificarTamanoArchivo(bytes: number): ResultadoLimite {
  if (bytes <= MAX_BYTES_EXTRACTO) return OK;
  return {
    ok: false,
    error: `El archivo pesa ${formatearTamano(bytes)} y un extracto de banco no pasa de ${formatearTamano(MAX_BYTES_EXTRACTO)}. ${mensajeUsarOpcionMadre()}`,
  };
}

// Sin cuenta elegida: puede ser una madre subida por el camino equivocado.
export function verificarCuentaElegida(cuentaElegida: string): ResultadoLimite {
  if (cuentaElegida.trim() !== "") return OK;
  return { ok: false, error: `Elegí la cuenta del extracto antes de subir el archivo. ${mensajeUsarOpcionMadre()}` };
}

// Después de leer: cantidad de filas del extracto de banco.
export function verificarCantidadFilas(filas: number): ResultadoLimite {
  if (filas <= MAX_FILAS_EXTRACTO) return OK;
  return {
    ok: false,
    error: `El extracto tiene ${formatearFilas(filas)} filas y el máximo por la web es ${formatearFilas(MAX_FILAS_EXTRACTO)}. Dividilo en períodos más cortos.`,
  };
}

// Archivo madre, antes de leerlo.
export function verificarTamanoMadre(bytes: number): ResultadoLimite {
  if (bytes <= MAX_BYTES_MADRE) return OK;
  return {
    ok: false,
    error: `El archivo madre pesa ${formatearTamano(bytes)} y por la web el máximo es ${formatearTamano(MAX_BYTES_MADRE)}. ${MENSAJE_MADRE_DIVIDIR}`,
  };
}

// Archivo madre, después de leerlo.
export function verificarCantidadFilasMadre(filas: number): ResultadoLimite {
  if (filas <= MAX_FILAS_MADRE) return OK;
  return {
    ok: false,
    error: `El archivo madre tiene ${formatearFilas(filas)} filas y por la web el máximo es ${formatearFilas(MAX_FILAS_MADRE)}. ${MENSAJE_MADRE_DIVIDIR}`,
  };
}

// --- Extracto crudo de Havanna Perú (Etapa 2) ----------------------------------------------
// Camino propio (lib/extractos/havannaPeru*.ts): el archivo es un libro "PF" completo con ~40
// pestañas (el real de noviembre 2026 pesa ~2,1 MB) y la pestaña del mes trae ~1.400 filas.
// Topes PROPIOS: no tocan los de arriba (extracto de banco / madre).
export const MAX_BYTES_HAVANNA_PERU = 4 * 1024 * 1024; // 4 MB
export const MAX_FILAS_HAVANNA_PERU = 3000; // filas de movimientos de UN mes

export function verificarTamanoHavannaPeru(bytes: number): ResultadoLimite {
  if (bytes <= MAX_BYTES_HAVANNA_PERU) return OK;
  return {
    ok: false,
    error: `El archivo pesa ${formatearTamano(bytes)} y por este camino el máximo es ${formatearTamano(MAX_BYTES_HAVANNA_PERU)}.`,
  };
}

export function verificarCantidadFilasHavannaPeru(filas: number): ResultadoLimite {
  if (filas <= MAX_FILAS_HAVANNA_PERU) return OK;
  return {
    ok: false,
    error: `La pestaña tiene ${formatearFilas(filas)} movimientos y por este camino el máximo es ${formatearFilas(MAX_FILAS_HAVANNA_PERU)} por mes. Revisá que sea la pestaña de un solo mes.`,
  };
}
