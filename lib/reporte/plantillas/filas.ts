import type {
  Bloque,
  CodigosPendientes,
  FilaCapital,
  FilaDisponible,
  FilaLinea,
  FilaTitulo,
  FilaTotal,
  FuentePresupuesto,
  FuenteReal,
  ReglaCapital,
  Sentido,
} from "@/lib/reporte/motor";

// Atajos para escribir las plantillas fila por fila, en el mismo orden que la
// planilla de Macchi.

export const clasif = (...clasificaciones: string[]): FuenteReal => ({ tipo: "clasificaciones", clasificaciones });
// Una clasificación que va en dos filas según el sentido del importe (Préstamo MS).
export const clasifSentido = (sentido: Sentido, ...clasificaciones: string[]): FuenteReal => ({
  tipo: "clasificaciones",
  clasificaciones,
  sentido,
});
// Como clasif, pero desde `desde` ("AAAA-MM") resta el Real manual de otras filas (Brillante: Gold y MSNT).
export const clasifNeteando = (desde: string, filas: string[], ...clasificaciones: string[]): FuenteReal => ({
  tipo: "clasificaciones",
  clasificaciones,
  restarManuales: { desde, filas },
});
export const cat = (...categorias: string[]): FuentePresupuesto => ({ tipo: "categorias", categorias });
export const SIN_REAL: FuenteReal = { tipo: "ninguna" };
export const SIN_PRESUPUESTO: FuentePresupuesto = { tipo: "ninguna" };
// Valor tipeado a mano (pantalla /reporte/carga).
export const REAL_MANUAL: FuenteReal = { tipo: "manual" };
export const PRESUPUESTO_MANUAL: FuentePresupuesto = { tipo: "manual" };
// R = P (el `=+P` de la planilla).
export const REAL_IGUAL_PRESUPUESTO: FuenteReal = { tipo: "igualPresupuesto" };
// P = Disponible del mes.
export const PRESUPUESTO_DISPONIBLE: FuentePresupuesto = { tipo: "disponible" };
// P = menos el valor (Real) de un componente de Disponibilidades del mismo mes.
export const espejoDe = (fila: string): FuentePresupuesto => ({
  tipo: "espejo",
  fila,
  columna: "real",
  mes: "actual",
  factor: -1,
});

type Extra = Pick<FilaLinea, "pendiente" | "parcial" | "nota">;

export function titulo(clave: string, bloque: Bloque, texto: string): FilaTitulo {
  return { clave, bloque, tipo: "titulo", texto };
}

export function total(
  clave: string,
  bloque: Bloque,
  texto: string,
  suma: string[],
  extra: Partial<Pick<FilaTotal, "resta" | "requiere" | "soloConPresupuesto" | "rol" | "visibleGerente">> = {}
): FilaTotal {
  return { clave, bloque, tipo: "total", texto, suma, ...extra };
}

export function ingreso(
  clave: string,
  texto: string,
  real: FuenteReal,
  presupuesto: FuentePresupuesto,
  extra: Extra = {}
): FilaLinea {
  return { clave, bloque: "INGRESOS", tipo: "linea", texto, signo: 1, real, presupuesto, ...extra };
}

export function egreso(
  clave: string,
  texto: string,
  real: FuenteReal,
  presupuesto: FuentePresupuesto,
  extra: Extra = {}
): FilaLinea {
  return { clave, bloque: "EGRESOS", tipo: "linea", texto, signo: -1, real, presupuesto, ...extra };
}

// Bloque de abajo (entre TOTAL EGRESOS OPERATIVOS y TOTAL EGRESOS): sin título
// en la planilla, todas son salidas de caja.
export function abajo(
  clave: string,
  texto: string,
  real: FuenteReal,
  presupuesto: FuentePresupuesto,
  extra: Extra = {}
): FilaLinea {
  return { clave, bloque: "ABAJO", tipo: "linea", texto, signo: -1, real, presupuesto, ...extra };
}

// Componente de DISPONIBILIDADES: un solo valor tipeado por mes, que se muestra
// igual en P y en R. `arrastre`: "cuadre" suma el cierre del mes anterior;
// "ajuste" se suma o resta aparte (plan 2b §1).
export function disp(
  clave: string,
  texto: string,
  arrastre: "cuadre" | "ajuste",
  extra: Pick<FilaLinea, "pendiente" | "nota" | "excluidaDelTotal"> = {}
): FilaLinea {
  return {
    clave,
    bloque: "DISPONIBILIDADES",
    tipo: "linea",
    texto,
    signo: 1,
    real: REAL_MANUAL,
    presupuesto: { tipo: "igualReal" },
    arrastre,
    ...extra,
  };
}

export function capital(
  clave: string,
  texto: string,
  regla: ReglaCapital | "manual",
  extra: { pendiente?: CodigosPendientes; nota?: string } = {}
): FilaCapital {
  return { clave, bloque: "CIERRE", tipo: "capital", texto, regla, ...extra };
}

export function disponible(
  clave: string,
  texto: string,
  base: string,
  resta: string,
  extra: { suma?: string[]; pendiente?: CodigosPendientes; nota?: string } = {}
): FilaDisponible {
  return { clave, bloque: "CIERRE", tipo: "disponible", texto, base, resta, ...extra };
}
