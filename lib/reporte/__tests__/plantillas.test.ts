import { test } from "node:test";
import assert from "node:assert/strict";
import { validarPlantilla } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG, plantillaDeEmpresa } from "@/lib/reporte/plantillas";
import { TEXTOS_MACCHI } from "./fixtures/textosMacchi";

// Estructura de las plantillas (las 7 de Macchi y Avianor) (docs/reporte_etapa2a_plan.md §5.2):
// claves únicas, categorías existentes en Presupuesto, ninguna clasificación ni
// categoría en dos filas, totales que apuntan a claves existentes y pendientes
// del catálogo (validarPlantilla), y textos iguales a los de la planilla.

test("hay plantilla para las 7 empresas de formato completo, para Avianor, Havanna Perú, Plate Silver y Bradenton", () => {
  assert.deepEqual(Object.keys(PLANTILLAS_POR_SLUG).sort(), [
    "avianor",
    "bradenton",
    "brillante",
    "conexion-logistica",
    "conexion-logistica-spp",
    "fredy-publicidad",
    "havanna",
    "havanna-peru",
    "hwc",
    "mantenor",
    "plate-silver",
    "radio",
  ]);
});

test("el slug de testing de Conexión usa la misma plantilla", () => {
  assert.equal(plantillaDeEmpresa("conexion-logistica-spp"), PLANTILLAS_POR_SLUG["conexion-logistica"]);
});

test("havanna-peru tiene plantilla propia, distinta de la de Havanna", () => {
  assert.ok(plantillaDeEmpresa("havanna-peru"));
  assert.notEqual(plantillaDeEmpresa("havanna-peru"), PLANTILLAS_POR_SLUG["havanna"]);
});

test("no hay match por prefijo: un slug que solo empieza como otro no devuelve plantilla", () => {
  assert.equal(plantillaDeEmpresa("havanna-peru-x"), null);
  assert.equal(plantillaDeEmpresa("hwc-cargo"), null);
});

for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
  if (!(slug in TEXTOS_MACCHI)) continue; // alias de otra base: misma plantilla ya cubierta
  test(`${slug}: estructura válida`, () => {
    assert.deepEqual(validarPlantilla(plantilla), []);
  });

  test(`${slug}: los textos coinciden con la planilla de Macchi, en el mismo orden`, () => {
    // Desviación aceptada: las filas de Mantenor RESERVA SAC y las cuatro de cobranza (Otros Clientes, MSM) no están en la
    // planilla de agosto (fixture sin tocar); vienen del PF de octubre.
    // Havanna: «CHEQUES EN CARTERA» se agregó en nov-2026 y no está en la planilla de agosto (fixture sin tocar).
    const desviaciones = new Set(
      slug === "mantenor"
        ? ["RESERVA SAC", "Otros Clientes Jujuy", "Otros Clientes Tucuman", "MSM COLUMNAS", "MSM PINTURA VIAL"]
        : slug === "havanna"
          ? ["CHEQUES EN CARTERA"]
          : []
    );
    assert.deepEqual(
      plantilla.filas.map((f) => f.texto).filter((t) => !desviaciones.has(t)),
      TEXTOS_MACCHI[slug]
    );
  });
}
