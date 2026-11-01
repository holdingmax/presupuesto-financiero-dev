import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OCULTAR_PRESUPUESTO_TAMBIEN_PARA_ADMIN_Y_FINANZAS,
  PERIODO_EN_CARGA_GERENTE,
  PERIODO_POR_DEFECTO,
} from "@/lib/config";
import { enlaceDeEmpresa, ocultaPestanaPresupuesto } from "@/lib/navegacionEmpresa";

const si = () => true;
const no = () => false;

test("config: el interruptor de ocultar Presupuesto también para ADMIN y FINANZAS está encendido", () => {
  assert.equal(OCULTAR_PRESUPUESTO_TAMBIEN_PARA_ADMIN_Y_FINANZAS, true);
});

test("ocultaPestanaPresupuesto, interruptor ENCENDIDO: todos los roles la pierden solo con carga activa Y plantilla", () => {
  for (const admin of [true, false]) {
    assert.equal(ocultaPestanaPresupuesto(admin, "havanna", si, si, true), true, `admin=${admin}`);
    assert.equal(ocultaPestanaPresupuesto(admin, "havanna", si, no, true), false, `admin=${admin}`);
    assert.equal(ocultaPestanaPresupuesto(admin, "havanna", no, si, true), false, `admin=${admin}`);
    assert.equal(ocultaPestanaPresupuesto(admin, "havanna", no, no, true), false, `admin=${admin}`);
  }
});

test("ocultaPestanaPresupuesto, interruptor APAGADO: comportamiento anterior (ADMIN y FINANZAS nunca la pierden; el gerente, solo con carga activa Y plantilla)", () => {
  assert.equal(ocultaPestanaPresupuesto(true, "havanna", si, si, false), false);
  assert.equal(ocultaPestanaPresupuesto(false, "havanna", si, si, false), true);
  assert.equal(ocultaPestanaPresupuesto(false, "havanna", si, no, false), false);
  assert.equal(ocultaPestanaPresupuesto(false, "havanna", no, si, false), false);
  assert.equal(ocultaPestanaPresupuesto(false, "havanna", no, no, false), false);
});

test("ocultaPestanaPresupuesto (config real): se oculta en las empresas activas y NUNCA en las que no tienen carga o plantilla", () => {
  for (const slug of ["brillante", "havanna", "radio", "fredy-publicidad", "hwc", "mantenor", "conexion-logistica", "conexion-logistica-spp", "bradenton", "plate-silver"]) {
    assert.equal(ocultaPestanaPresupuesto(false, slug), true, slug);
    assert.equal(ocultaPestanaPresupuesto(true, slug), true, slug);
    // Con el interruptor apagado, ADMIN y FINANZAS la conservan.
    assert.equal(ocultaPestanaPresupuesto(true, slug, undefined, undefined, false), false, slug);
    assert.equal(ocultaPestanaPresupuesto(false, slug, undefined, undefined, false), true, slug);
  }
  // Sin plantilla (Expensas, Gold Seguridad) o en una tanda posterior: conservan Presupuesto.
  for (const slug of ["expensas", "gold-seguridad", "cielos", "tucson", "avianor", "havanna-peru", "inventada"]) {
    for (const admin of [true, false]) {
      assert.equal(ocultaPestanaPresupuesto(admin, slug), false, `${slug} admin=${admin}`);
      assert.equal(ocultaPestanaPresupuesto(admin, slug, undefined, undefined, true), false, `${slug} admin=${admin} (encendido)`);
    }
  }
});

test("enlaceDeEmpresa: ADMIN y FINANZAS van al Reporte donde la pestaña está oculta y a Presupuesto en las demás", () => {
  assert.equal(enlaceDeEmpresa(true, "havanna"), `/havanna/${PERIODO_POR_DEFECTO}/reporte`);
  assert.equal(enlaceDeEmpresa(true, "expensas"), `/expensas/${PERIODO_POR_DEFECTO}/presupuesto`);
  assert.equal(enlaceDeEmpresa(true, "avianor"), `/avianor/${PERIODO_POR_DEFECTO}/presupuesto`);
});

test("enlaceDeEmpresa, interruptor APAGADO: ADMIN y FINANZAS conservan el link de siempre (a Presupuesto)", () => {
  const oculta = (admin: boolean, slug: string) => ocultaPestanaPresupuesto(admin, slug, undefined, undefined, false);
  assert.equal(enlaceDeEmpresa(true, "havanna", oculta(true, "havanna")), `/havanna/${PERIODO_POR_DEFECTO}/presupuesto`);
  assert.equal(enlaceDeEmpresa(true, "expensas", oculta(true, "expensas")), `/expensas/${PERIODO_POR_DEFECTO}/presupuesto`);
  // El gerente no cambia con el interruptor.
  assert.equal(enlaceDeEmpresa(false, "havanna", oculta(false, "havanna")), `/havanna/${PERIODO_EN_CARGA_GERENTE}/reporte`);
});

test("enlaceDeEmpresa: el gerente va al mes en curso, al Reporte si carga ahí y a Presupuesto si no", () => {
  assert.equal(enlaceDeEmpresa(false, "havanna"), `/havanna/${PERIODO_EN_CARGA_GERENTE}/reporte`);
  assert.equal(enlaceDeEmpresa(false, "expensas"), `/expensas/${PERIODO_EN_CARGA_GERENTE}/presupuesto`);
  assert.equal(enlaceDeEmpresa(false, "avianor"), `/avianor/${PERIODO_EN_CARGA_GERENTE}/presupuesto`);
});
