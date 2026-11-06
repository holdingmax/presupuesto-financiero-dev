// Conexión Logística: «Préstamo MS» (cx.prestamoMs) se movió de EGRESOS OPERATIVOS al bloque de abajo, entre «Gastos Jet Parts
// Solutions a recuperar» y «Gastos MS». Cambio pedido por Kike el 6/11/2026.
//
// Las fixtures de Macchi (textosMacchi.ts, agosto2026.ts) quedan como están: reflejan el Excel, donde la fila 48 sigue estando
// antes de TOTAL EGRESOS OPERATIVOS. Este es el ÚNICO lugar donde se traduce ese orden, y solo para esta fila: pone cx.prestamoMs
// en la posición que tiene en el Excel para poder compararla. El valor de agosto sigue coincidiendo con el Excel (la fila está
// vacía allí); los totales (OPERATIVOS incluido: la fila vale 0) se siguen comparando al centavo.
const SLUGS_CONEXION = ["conexion-logistica", "conexion-logistica-spp"];

export function enOrdenDelExcelDeMacchi<T>(slug: string, items: T[], claveDe: (item: T) => string): T[] {
  if (!SLUGS_CONEXION.includes(slug)) return items;
  const sin = items.filter((x) => claveDe(x) !== "cx.prestamoMs");
  const fila = items.find((x) => claveDe(x) === "cx.prestamoMs");
  const i = sin.findIndex((x) => claveDe(x) === "cx.totalEgresosOperativos");
  if (!fila || i < 0) return items;
  return [...sin.slice(0, i), fila, ...sin.slice(i)];
}
