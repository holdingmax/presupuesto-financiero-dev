import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPRESAS_CON_CARGA_EN_REPORTE, EMPRESAS_EN_DOLARES } from "@/lib/config";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { cargaEnReporteActiva, mostrarFlujoEnReporte, puedeEditarPresupuestoAhora } from "@/lib/estadoPresupuesto";

test("puedeEditarPresupuestoAhora: ABIERTO edita cualquiera con acceso, sea o no revisor", () => {
  assert.equal(puedeEditarPresupuestoAhora("ABIERTO", false), true);
  assert.equal(puedeEditarPresupuestoAhora("ABIERTO", true), true);
});

test("puedeEditarPresupuestoAhora: EN_REVISION edita solo el revisor", () => {
  assert.equal(puedeEditarPresupuestoAhora("EN_REVISION", true), true);
  assert.equal(puedeEditarPresupuestoAhora("EN_REVISION", false), false);
});

test("puedeEditarPresupuestoAhora: VALIDADO no lo edita nadie, ni el revisor", () => {
  assert.equal(puedeEditarPresupuestoAhora("VALIDADO", true), false);
  assert.equal(puedeEditarPresupuestoAhora("VALIDADO", false), false);
});

test("cargaEnReporteActiva (lista real de config): true para cada slug que está en la lista, false para uno que no", () => {
  // No depende de qué empresas estén prendidas: cada slug de la lista da true y uno inventado, false.
  for (const slug of EMPRESAS_CON_CARGA_EN_REPORTE) {
    assert.equal(cargaEnReporteActiva(slug), true, slug);
  }
  assert.equal(cargaEnReporteActiva("empresa-inventada-fuera-de-la-lista"), false);
});

test("cargaEnReporteActiva: apagado con la lista vacía y para cualquier empresa que no esté en la lista", () => {
  assert.equal(cargaEnReporteActiva("brillante", []), false);
  assert.equal(cargaEnReporteActiva("hwc", ["brillante"]), false);
});

test("cargaEnReporteActiva: prende solo la empresa de la lista, con el slug exacto", () => {
  const activas = ["brillante", "conexion-logistica"];
  assert.equal(cargaEnReporteActiva("brillante", activas), true);
  assert.equal(cargaEnReporteActiva("conexion-logistica", activas), true);
  assert.equal(cargaEnReporteActiva("conexion", activas), false);
  assert.equal(cargaEnReporteActiva("Brillante", activas), false);
});

const base = { esAdminOFinanzas: false, esRevisor: false, cargaActiva: false, periodoHabilitado: true };

test("mostrarFlujoEnReporte: ADMIN y FINANZAS lo ven siempre, también en un período no habilitado", () => {
  assert.equal(mostrarFlujoEnReporte({ ...base, esAdminOFinanzas: true }), true);
  assert.equal(mostrarFlujoEnReporte({ ...base, esAdminOFinanzas: true, periodoHabilitado: false }), true);
});

test("mostrarFlujoEnReporte: el gerente común no lo ve con el interruptor apagado", () => {
  assert.equal(mostrarFlujoEnReporte(base), false);
});

test("mostrarFlujoEnReporte: el gerente lo ve solo con el interruptor prendido y período habilitado", () => {
  assert.equal(mostrarFlujoEnReporte({ ...base, cargaActiva: true }), true);
  assert.equal(mostrarFlujoEnReporte({ ...base, cargaActiva: true, periodoHabilitado: false }), false);
});

test("mostrarFlujoEnReporte: el revisor lo ve aunque el interruptor esté apagado, pero no fuera de los períodos habilitados", () => {
  assert.equal(mostrarFlujoEnReporte({ ...base, esRevisor: true }), true);
  assert.equal(mostrarFlujoEnReporte({ ...base, esRevisor: true, periodoHabilitado: false }), false);
});

test("config: cada slug de EMPRESAS_CON_CARGA_EN_REPORTE tiene plantilla de Reporte y no hay repetidos", () => {
  assert.equal(new Set(EMPRESAS_CON_CARGA_EN_REPORTE).size, EMPRESAS_CON_CARGA_EN_REPORTE.length);
  for (const slug of EMPRESAS_CON_CARGA_EN_REPORTE) {
    assert.ok(Object.hasOwn(PLANTILLAS_POR_SLUG, slug), `${slug} no tiene plantilla`);
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${slug} no es un slug`);
  }
});

test("config: tandas de la Etapa 4 (Avianor y Expensas quedan fuera a propósito)", () => {
  assert.deepEqual(
    [...EMPRESAS_CON_CARGA_EN_REPORTE].sort(),
    [
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
    ]
  );
  assert.equal(EMPRESAS_CON_CARGA_EN_REPORTE.includes("avianor"), false);
  assert.equal(EMPRESAS_CON_CARGA_EN_REPORTE.includes("expensas"), false);
});

test("config: EMPRESAS_EN_DOLARES son exactamente Bradenton y Plate Silver, y las dos cargan en el Reporte", () => {
  assert.deepEqual([...EMPRESAS_EN_DOLARES].sort(), ["bradenton", "plate-silver"]);
  for (const slug of EMPRESAS_EN_DOLARES) assert.ok(EMPRESAS_CON_CARGA_EN_REPORTE.includes(slug), slug);
});
