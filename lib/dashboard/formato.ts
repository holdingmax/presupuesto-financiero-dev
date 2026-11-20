import { prefijoMoneda } from "@/lib/moneda";

// Formato de los números del dashboard (Entrega 3). Módulo PURO. Mismo estilo que el Reporte: pesos enteros con separador de
// miles es-AR, «-» delante si es negativo, porcentajes enteros con «%».

const NO_HAY = "—";

function pesosEnteros(centavos: number): string {
  return (Math.abs(centavos) / 100).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

// Importe en centavos de la moneda de la empresa: «$1.234», «US$ 1.234», «S/ 1.234». null = falta el dato: «—», nunca 0.
export function importeDeAvance(centavos: number | null, moneda: string): string {
  if (centavos === null) return NO_HAY;
  const texto = `${prefijoMoneda(moneda)}${pesosEnteros(centavos)}`;
  return centavos < 0 ? `-${texto}` : texto;
}

// Porcentaje del motor (98,5 → «99%»), como en el Reporte. null → «—».
export function porcentajeDeAvance(avance: number | null): string {
  if (avance === null) return NO_HAY;
  return `${avance.toLocaleString("es-AR", { maximumFractionDigits: 0 })}%`;
}

// Cantidad de movimientos con separador de miles.
export function cantidad(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

// «2026-11-13» → «13/11».
export function ddMm(fecha: string): string {
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
}

// Monto en millones para las tarjetas («$2.189 M», «$67,5 M», «US$ 0,4 M»): desde un millón se abrevia (sin decimales desde 100 M,
// con uno por debajo); por debajo de un millón se muestra entero. El número exacto va aparte (importeDeAvance, en el title).
// Siempre con separador de miles, también en 4 cifras. null = falta el dato: «—», nunca 0.
export function importeEnMillones(centavos: number | null, moneda: string): string {
  if (centavos === null) return NO_HAY;
  const unidades = Math.abs(centavos) / 100;
  const texto =
    unidades >= 1_000_000
      ? `${(unidades / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: unidades >= 100_000_000 ? 0 : 1, useGrouping: "always" })} M`
      : unidades.toLocaleString("es-AR", { maximumFractionDigits: 0, useGrouping: "always" });
  const completo = `${prefijoMoneda(moneda)}${texto}`;
  return centavos < 0 ? `-${completo}` : completo;
}
