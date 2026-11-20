import type { Indicador } from "@/lib/dashboard/calidad";

// Reglas PURAS de presentación del dashboard (rediseño visual). Sin Prisma ni next/*. No calculan datos del negocio: solo
// llevan un porcentaje que ya calculó el motor a una posición dentro de una barra.

export type GeometriaDeBarra = Readonly<{
  // Ancho del relleno, 0 a 100 (el avance, recortado: una barra nunca se sale de su pista).
  relleno: number;
  // Posición de la marca del ritmo del mes, 0 a 100; null = no hay ritmo (sin datos del mes: no hay marca).
  marca: number | null;
  // El avance pasó del 100 %: la barra queda llena y se avisa con texto (no solo con el color).
  excede: boolean;
  // Falta el dato: pista vacía y «—».
  sinDato: boolean;
}>;

const entre = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function geometriaDeBarra(avance: number | null, ritmo: number | null): GeometriaDeBarra {
  const valido = avance !== null && Number.isFinite(avance);
  return Object.freeze({
    relleno: valido ? entre(avance as number, 0, 100) : 0,
    marca: ritmo !== null && Number.isFinite(ritmo) ? entre(ritmo, 0, 100) : null,
    excede: valido && (avance as number) > 100,
    sinDato: !valido,
  });
}

// Indicadores de calidad con algún movimiento (los únicos que se destacan; el resto queda sobrio).
export function indicadoresConValor(indicadores: readonly Indicador[]): Indicador[] {
  return indicadores.filter((i) => i.total > 0);
}
