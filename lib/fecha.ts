// "07/10" en hora de Argentina — para los textos de trazabilidad ("Cerrada por X
// el dd/mm"). Las fechas se guardan en UTC: sin timeZone explícito, un cierre a
// las 22:00 de Buenos Aires se mostraría como el día siguiente. Se arma con
// formatToParts + padStart porque el ICU de Node devuelve "7/10" para es-AR aun
// pidiendo day: "2-digit".
export function formatearDiaMes(fechaIso: string): string {
  const partes = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric",
    month: "numeric",
  }).formatToParts(new Date(fechaIso));
  const parte = (tipo: string) => (partes.find((p) => p.type === tipo)?.value ?? "").padStart(2, "0");
  return `${parte("day")}/${parte("month")}`;
}

// "Cerrada por Leticia Araoz el 07/10" / "Cerrada el 07/10" (registros viejos,
// anteriores a que se guardara quién).
export function textoTrazabilidad(accion: string, fechaIso: string, por: string | null): string {
  return `${accion}${por ? ` por ${por}` : ""} el ${formatearDiaMes(fechaIso)}`;
}

const ZONA_ARGENTINA = "America/Argentina/Buenos_Aires";

// Partes de una fecha vistas en hora de Argentina (UTC-3, sin horario de verano). Las fechas viajan en UTC y el servidor
// (Render) corre en UTC: sin timeZone explícito, una descarga a las 23:40 de Buenos Aires saldría como el día siguiente.
// hourCycle "h23" evita el "24:05" que algunos ICU devuelven a medianoche con hour12: false.
function partesEnArgentina(fecha: Date) {
  const partes = new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA_ARGENTINA,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return {
    dia: valor("weekday"),
    dd: valor("day").padStart(2, "0"),
    mm: valor("month").padStart(2, "0"),
    aaaa: valor("year"),
    hh: valor("hour").padStart(2, "0"),
    min: valor("minute").padStart(2, "0"),
  };
}

// "Descargado el martes 17/11/2026 11:40" — día y hora de Argentina (cabecera del Excel del Reporte). Se arma con
// formatToParts porque el formato nativo de es-AR mete comas ("martes, 17/11/2026, 11:40").
export function formatearDescarga(ahora: Date = new Date()): string {
  const p = partesEnArgentina(ahora);
  return `Descargado el ${p.dia} ${p.dd}/${p.mm}/${p.aaaa} ${p.hh}:${p.min}`;
}

// "2026-11-17": el día de Argentina, para el nombre del archivo.
export function fechaIsoEnArgentina(ahora: Date = new Date()): string {
  const p = partesEnArgentina(ahora);
  return `${p.aaaa}-${p.mm}-${p.dd}`;
}
