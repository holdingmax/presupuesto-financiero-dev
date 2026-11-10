import { EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE } from "@/lib/config";
import { camposManuales, type Bloque, type CampoManual, type Plantilla } from "@/lib/reporte/motor";

// Ingresos, Egresos y Abajo: los bloques de flujo. Cierre es reservado y nunca se carga acá.
const BLOQUES_DE_FLUJO: readonly Bloque[] = ["INGRESOS", "EGRESOS", "ABAJO"];

// Campos de Real que puede cargar un GERENTE con permiso de cargar el Real de su empresa (lib/permisosReal.ts) desde
// /reporte/carga: solo la columna REAL (el Presupuestado sigue por su flujo) y solo de los bloques que el gerente ve
// según la config de la empresa: Ingresos, Egresos y Abajo siempre; Disponibilidades solo si la empresa las ve;
// Cierre nunca. Es independiente del tipeo directo: /reporte/carga no depende de él.
export function camposRealDelGerente(
  plantilla: Plantilla,
  empresaSlug: string,
  disponibilidades: readonly string[] = EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE
): CampoManual[] {
  const conDisponibilidades = disponibilidades.includes(empresaSlug);
  return camposManuales(plantilla).filter(
    (c) =>
      c.columna === "REAL" &&
      (c.bloque === "DISPONIBILIDADES" ? conDisponibilidades : BLOQUES_DE_FLUJO.includes(c.bloque))
  );
}

