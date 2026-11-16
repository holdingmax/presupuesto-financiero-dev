import { claveEquivalencia, clasificacionesDePlantilla, espejoUnidadDePlantilla, type Plantilla } from "@/lib/reporte/motor";
import { PLANTILLA_AVIANOR, UNIDAD_AVIANOR } from "@/lib/reporte/plantillas/avianor";
import { normalizarTexto } from "@/lib/texto";

// Aviso del Reporte de Avianor y Conexión (espejo Avianor-Conexión): un movimiento de la unidad AVIANOR cuya clasificación
// no figura en ninguna fila de Avianor no suma a Avianor NI a Conexión (Conexión lee las mismas clasificaciones que Avianor),
// así que sin este aviso desaparece de los dos sin que nadie se entere. Solo lectura: no cambia ningún total.
// Parte pura (la consulta está en lib/reporte.ts, calcularPorClasificacionDeUnidades). «SIN CLASIFICAR» no se avisa acá:
// ya tiene su propio bloque en el Reporte.

export type FilaPorClasificacion = {
  estado: "ABIERTA" | "CERRADA";
  moneda: string;
  clasificacion: string;
  movimientos: number;
  centavos: number;
};

export type SinFilaEspejo = FilaPorClasificacion;

// Clasificaciones que SÍ tienen fila: las mismas con las que se calcula el espejo (clasificacionesDePlantilla de Avianor).
export function clasificacionesConFila(plantillaAvianor: Plantilla): Set<string> {
  return new Set(clasificacionesDePlantilla(plantillaAvianor).map(claveEquivalencia));
}

export function sinFilaDeAvianor(
  filas: readonly FilaPorClasificacion[],
  conFila: ReadonlySet<string>
): SinFilaEspejo[] {
  return filas
    .filter((f) => normalizarTexto(f.clasificacion) !== "SIN CLASIFICAR" && !conFila.has(claveEquivalencia(f.clasificacion)))
    .sort(
      (a, b) =>
        // Primero las semanas cerradas (ya no se pueden corregir), después las abiertas.
        Number(a.estado === "ABIERTA") - Number(b.estado === "ABIERTA") ||
        a.moneda.localeCompare(b.moneda) ||
        a.clasificacion.localeCompare(b.clasificacion)
    );
}

// Unidades que se vigilan en el Reporte de esta plantilla: las de Avianor en su propio Reporte y las del espejo en el de Conexión
// (la plantilla que tiene espejoUnidad). null = esta plantilla no muestra el aviso.
export function unidadesDelAvisoEspejo(plantilla: Plantilla): string[] | null {
  if (plantilla === PLANTILLA_AVIANOR) return [UNIDAD_AVIANOR];
  return espejoUnidadDePlantilla(plantilla)?.unidades ?? null;
}

export const TEXTO_SIN_FILA_ESPEJO =
  "Movimientos de la unidad AVIANOR con una clasificación que no figura en ninguna fila de Avianor: no suman al Reporte de Avianor ni a «Gastos Avion a recuperar» de Conexión.";
