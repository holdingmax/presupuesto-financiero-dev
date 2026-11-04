// Scroll inicial de «Columnas juntas»: con varios meses el contenedor del Reporte scrollea en horizontal y tiene que
// abrir corrido hasta el final (el último mes, el de la URL), con la columna Concepto fija a la izquierda. Puras (sin
// DOM ni React) para poder probarlas; las usa app/[empresa]/[periodo]/reporte/ScrollAlFinal.tsx.

// Identifica "esta pantalla": cambia al cambiar de mes o de vista. El scroll se aplica una vez por clave, así que un
// router.refresh (p. ej. tras guardar tipeo), que no cambia ni el mes ni la vista, no mueve lo que el usuario scrolleó.
export function claveDeScrollInicial(periodo: string, vista: string): string {
  return `${periodo}|${vista}`;
}

// ¿Hay que llevar el scroll al final? Solo con más de un mes (con uno no hay contenedor que scrollee) y solo si esta
// clave todavía no se aplicó.
export function corresponderScrollAlFinal(cantidadMeses: number, clave: string, claveAplicada: string | null): boolean {
  return cantidadMeses > 1 && clave !== claveAplicada;
}
