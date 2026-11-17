// Columna "Detalle" de la tabla de movimientos de Ejecución (solo la pestaña de la empresa).
// Parte pura, sin React: texto a mostrar y cantidad de columnas (para el colSpan del panel de prorrateo).

// Texto de la celda: sin dato (null/undefined/espacios) queda vacío — nunca "null" ni guiones.
export function textoDetalle(detalle: string | null | undefined): string {
  return typeof detalle === "string" ? detalle.trim() : "";
}

// Cantidad de columnas de la tabla según las opciones. Base: Fecha, Banco y cuenta, Concepto, Importe,
// Clasificación, Unidad y Prorrateo (7) + la de acciones si no es solo lectura.
export function totalColumnasTabla(o: {
  soloLectura: boolean;
  mostrarSaldo: boolean;
  mostrarSemana: boolean;
  mostrarDetalle: boolean;
}): number {
  return (o.soloLectura ? 7 : 8) + (o.mostrarSaldo ? 1 : 0) + (o.mostrarSemana ? 1 : 0) + (o.mostrarDetalle ? 1 : 0);
}

// Interruptor único de las 3 pantallas de la empresa (semana, "Todo el mes" y la editable del gerente).
// Hoy lo ve quien ya ve Concepto. Para ocultarlo (p. ej. a gerentes) es este valor — ojo: oculta la
// columna, pero `detalle` igual viaja en el payload (mapearMovimiento); si hiciera falta que no viaje,
// hay que cortarlo ahí también.
export const MOSTRAR_DETALLE_EMPRESA = true;
