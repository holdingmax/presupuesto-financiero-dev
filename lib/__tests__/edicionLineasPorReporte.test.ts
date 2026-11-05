import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPRESAS_CON_CARGA_EN_REPORTE, PERIODO_EN_CARGA_GERENTE } from "@/lib/config";
import {
  MENSAJE_CARGA_SOLO_EN_REPORTE,
  motivoEdicionLineasBloqueadaPorReporte,
  ocultaPestanaPresupuesto,
} from "@/lib/navegacionEmpresa";
import { plantillaDeEmpresa } from "@/lib/reporte/plantillas";

test("gerente rechazado en una empresa con carga en el Reporte (config real)", () => {
  for (const slug of EMPRESAS_CON_CARGA_EN_REPORTE) {
    assert.equal(motivoEdicionLineasBloqueadaPorReporte(false, slug), MENSAJE_CARGA_SOLO_EN_REPORTE, slug);
  }
});

test("gerente permitido en Expensas y Gold Seguridad (siguen con Presupuesto)", () => {
  for (const slug of ["expensas", "gold-seguridad"]) {
    assert.equal(motivoEdicionLineasBloqueadaPorReporte(false, slug), null, slug);
  }
});

test("ADMIN y FINANZAS nunca se bloquean, tampoco en empresas con carga en el Reporte", () => {
  for (const slug of [...EMPRESAS_CON_CARGA_EN_REPORTE, "expensas"]) {
    assert.equal(motivoEdicionLineasBloqueadaPorReporte(true, slug), null, slug);
  }
});

test("el bloqueo usa la misma regla que oculta la pestaña (sin plantilla no bloquea)", () => {
  const siempre = () => true;
  assert.equal(
    motivoEdicionLineasBloqueadaPorReporte(false, "x", (admin, slug) => ocultaPestanaPresupuesto(admin, slug, siempre, () => false, true)),
    null
  );
  assert.equal(
    motivoEdicionLineasBloqueadaPorReporte(false, "x", (admin, slug) => ocultaPestanaPresupuesto(admin, slug, siempre, () => true, true)),
    MENSAJE_CARGA_SOLO_EN_REPORTE
  );
});

test("havanna-peru tiene plantilla y está en la lista de carga en el Reporte", () => {
  assert.ok(plantillaDeEmpresa("havanna-peru"));
  assert.ok(EMPRESAS_CON_CARGA_EN_REPORTE.includes("havanna-peru"));
  assert.equal(ocultaPestanaPresupuesto(false, "havanna-peru"), true);
  assert.equal(ocultaPestanaPresupuesto(true, "havanna-peru"), true);
});

test("estados intactos: la puerta está solo en autorizarEdicionLinea; las acciones de estado no la usan", () => {
  const actions = readFileSync(new URL("../../app/[empresa]/[periodo]/presupuesto/actions.ts", import.meta.url), "utf8");
  const cuerpo = (nombre: string) => {
    const ini = actions.indexOf(`export async function ${nombre}(`);
    assert.ok(ini >= 0, nombre);
    const sig = actions.indexOf("\nexport async function ", ini + 10);
    return actions.slice(ini, sig === -1 ? undefined : sig);
  };
  for (const n of ["agregarLinea", "editarLinea", "eliminarLinea", "guardarDesglose", "eliminarDesglose", "subirLineasMasivo"]) {
    assert.match(cuerpo(n), /autorizarEdicionLinea\(usuario, empresa\.id, presupuesto, empresaSlug\)/, n);
  }
  for (const n of ["enviarARevision", "marcarRevisionCompletada", "pedirCambios", "confirmarVersionFinal"]) {
    assert.doesNotMatch(cuerpo(n), /autorizarEdicionLinea|motivoEdicionLineasBloqueadaPorReporte/, n);
  }
  const acceso = readFileSync(new URL("../presupuestoAcceso.ts", import.meta.url), "utf8");
  assert.doesNotMatch(acceso.slice(acceso.indexOf("export async function resolverEmpresaYPresupuesto"), acceso.indexOf("export type ResultadoAutorizacion")), /motivoEdicion/);
});

test("PERIODO_EN_CARGA_GERENTE sigue en 2026-11", () => {
  assert.equal(PERIODO_EN_CARGA_GERENTE, "2026-11");
});
