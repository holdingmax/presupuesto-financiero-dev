import type { FilaDeAvance, RitmoDelMes } from "@/lib/dashboard/avance";
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

// ---- Etiquetas de estado de una empresa ------------------------------------------------------------------------------

// Categoría de color de una etiqueta: es una CLASIFICACIÓN del tipo de estado, no un veredicto (nada de bien/mal):
//  - ambar: falta un dato o una validación (presupuesto sin validar / sin presupuesto / sin líneas, Real manual pendiente);
//  - celeste: el número incluye partes manuales o parciales;
//  - gris: la empresa no tiene Reporte por plantilla.
// El texto de la etiqueta siempre dice el estado: el color es un apoyo, no el portador.
export type CategoriaDeEtiqueta = "ambar" | "celeste" | "gris";
export type EtiquetaDeEstado = Readonly<{ texto: string; categoria: CategoriaDeEtiqueta }>;

export function etiquetasDeFila(fila: FilaDeAvance): EtiquetaDeEstado[] {
  const etiquetas: EtiquetaDeEstado[] = [];
  if (fila.sinReporte) etiquetas.push({ texto: "sin Reporte por plantilla", categoria: "gris" });
  if (fila.cartelPresupuesto) etiquetas.push({ texto: fila.cartelPresupuesto, categoria: "ambar" });
  if (fila.incluyePartesManualesOParciales) etiquetas.push({ texto: "incluye partes manuales o parciales", categoria: "celeste" });
  if (fila.realManualPendiente) etiquetas.push({ texto: "Real manual pendiente", categoria: "ambar" });
  return etiquetas;
}

// La leyenda de la marca del ritmo se muestra UNA vez, en el resumen. En la tarjeta de una empresa solo si el ritmo de esa
// empresa difiere del general (por ejemplo, una empresa con datos hasta el 12 cuando el resto llega al 13). Sin ritmo general
// conocido, se muestra (no se puede afirmar que sea igual).
export function mostrarRitmoPropio(ritmoDeLaEmpresa: RitmoDelMes | null, ritmoGeneral: RitmoDelMes | null | undefined): boolean {
  if (ritmoDeLaEmpresa === null) return false;
  if (ritmoGeneral === null || ritmoGeneral === undefined) return true;
  return ritmoDeLaEmpresa.diasConDatos !== ritmoGeneral.diasConDatos || ritmoDeLaEmpresa.diasDelMes !== ritmoGeneral.diasDelMes;
}
