import { leerImporte } from "@/lib/importes";
import {
  CIEN_POR_CIENTO,
  formatearCentavos,
  formatearPorcentaje,
  parsearPorcentaje,
  repartirPorPorcentajes,
} from "@/lib/prorrateo";

// Cálculo puro de la calculadora de reparto de Expensas (/admin/reparto-expensas). Sin Prisma, sin plantillas y
// sin next/*: lo usa también el cliente para la vista previa, y el servidor lo repite sobre el TEXTO que llega
// (nunca confía en montos calculados por el navegador).

export type ResultadoReparto =
  | {
      ok: true;
      totalCentavos: number;
      // Centésimas de punto, una por entrada y en el mismo orden (vacío = 0).
      porcentajes: number[];
      // Centavos por entrada, en el mismo orden: suman EXACTO totalCentavos.
      montos: number[];
    }
  | { ok: false; error: string };

// Total del mes tipeado en formato argentino ("1.500.000,50"): positivo, hasta 2 decimales.
export function leerTotalExpensas(texto: string): { ok: true; centavos: number } | { ok: false; error: string } {
  if (texto.trim() === "") return { ok: false, error: "Cargá el total de Expensas del mes." };
  const lectura = leerImporte(texto);
  if (!lectura.ok) return { ok: false, error: `Total: ${lectura.error}` };
  if (lectura.centavos <= 0) return { ok: false, error: "El total de Expensas tiene que ser mayor a 0." };
  return { ok: true, centavos: lectura.centavos };
}

// Reparte el total entre las empresas según su porcentaje (método del mayor resto, lib/prorrateo.ts). Un
// porcentaje vacío vale 0. Los porcentajes tienen que sumar EXACTAMENTE 100: si no, no hay reparto.
export function calcularReparto(totalTexto: string, porcentajesTexto: readonly string[]): ResultadoReparto {
  const total = leerTotalExpensas(totalTexto);
  if (!total.ok) return total;

  const porcentajes: number[] = [];
  for (const texto of porcentajesTexto) {
    if (texto.trim() === "") {
      porcentajes.push(0);
      continue;
    }
    const p = parsearPorcentaje(texto);
    if (p === null) {
      return { ok: false, error: `"${texto.trim()}" no es un porcentaje válido (hasta 2 decimales, entre 0 y 100).` };
    }
    porcentajes.push(p);
  }

  const suma = porcentajes.reduce((a, p) => a + p, 0);
  if (suma !== CIEN_POR_CIENTO) {
    const dif = Math.abs(CIEN_POR_CIENTO - suma);
    return {
      ok: false,
      error: `Los porcentajes suman ${formatearPorcentaje(suma)}%: ${suma < CIEN_POR_CIENTO ? "faltan" : "sobran"} ${formatearPorcentaje(dif)}% para llegar a 100%.`,
    };
  }

  return { ok: true, totalCentavos: total.centavos, porcentajes, montos: repartirPorPorcentajes(total.centavos, porcentajes) };
}

// "Reparto de Expensas: 12,50% de $1.000.000,00" — la `nota` del valor guardado.
export function notaDeReparto(porcentaje: number, totalCentavos: number): string {
  return `Reparto de Expensas: ${formatearPorcentaje(porcentaje)}% de $${formatearCentavos(totalCentavos)}`;
}
