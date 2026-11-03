import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OCULTAR_PRESUPUESTO_TAMBIEN_PARA_ADMIN_Y_FINANZAS,
  PERIODO_EN_CARGA_GERENTE,
  PERIODO_POR_DEFECTO,
} from "@/lib/config";
import { elegirUltimoPeriodoCargado, enlaceDeEmpresa, ocultaPestanaPresupuesto } from "@/lib/navegacionEmpresa";

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

test("enlaceDeEmpresa: ADMIN y FINANZAS van al Reporte en toda empresa con plantilla y a Presupuesto en las que no la tienen", () => {
  assert.equal(enlaceDeEmpresa(true, "havanna"), `/havanna/${PERIODO_POR_DEFECTO}/reporte`);
  assert.equal(enlaceDeEmpresa(true, "avianor"), `/avianor/${PERIODO_POR_DEFECTO}/reporte`);
  assert.equal(enlaceDeEmpresa(true, "havanna-peru"), `/havanna-peru/${PERIODO_POR_DEFECTO}/reporte`);
  for (const slug of ["expensas", "gold-seguridad", "cielos", "tucson"]) {
    assert.equal(enlaceDeEmpresa(true, slug), `/${slug}/${PERIODO_POR_DEFECTO}/presupuesto`, slug);
  }
});

test("enlaceDeEmpresa: el gerente de Avianor y de las empresas sin plantilla sigue yendo a Presupuesto", () => {
  assert.equal(enlaceDeEmpresa(false, "avianor"), `/avianor/${PERIODO_EN_CARGA_GERENTE}/presupuesto`);
  assert.equal(enlaceDeEmpresa(false, "expensas"), `/expensas/${PERIODO_EN_CARGA_GERENTE}/presupuesto`);
});

test("enlaceDeEmpresa, interruptor APAGADO: ADMIN y FINANZAS van al Reporte con plantilla (Avianor) y a Presupuesto sin ella", () => {
  const oculta = (admin: boolean, slug: string) => ocultaPestanaPresupuesto(admin, slug, undefined, undefined, false);
  assert.equal(enlaceDeEmpresa(true, "havanna", oculta(true, "havanna")), `/havanna/${PERIODO_POR_DEFECTO}/reporte`);
  assert.equal(enlaceDeEmpresa(true, "avianor", oculta(true, "avianor")), `/avianor/${PERIODO_POR_DEFECTO}/reporte`);
  assert.equal(enlaceDeEmpresa(true, "expensas", oculta(true, "expensas")), `/expensas/${PERIODO_POR_DEFECTO}/presupuesto`);
  // El gerente no cambia con el interruptor.
  assert.equal(enlaceDeEmpresa(false, "havanna", oculta(false, "havanna")), `/havanna/${PERIODO_EN_CARGA_GERENTE}/reporte`);
});

test("enlaceDeEmpresa: el gerente va al mes en curso, al Reporte si carga ahí y a Presupuesto si no", () => {
  assert.equal(enlaceDeEmpresa(false, "havanna"), `/havanna/${PERIODO_EN_CARGA_GERENTE}/reporte`);
  assert.equal(enlaceDeEmpresa(false, "expensas"), `/expensas/${PERIODO_EN_CARGA_GERENTE}/presupuesto`);
  assert.equal(enlaceDeEmpresa(false, "avianor"), `/avianor/${PERIODO_EN_CARGA_GERENTE}/presupuesto`);
});

test("enlaceDeEmpresa: ADMIN y FINANZAS van al período pasado (periodoAdmin) en las empresas con plantilla", () => {
  assert.equal(enlaceDeEmpresa(true, "havanna", undefined, undefined, "2026-10"), "/havanna/2026-10/reporte");
  assert.equal(enlaceDeEmpresa(true, "avianor", undefined, undefined, "2026-10"), "/avianor/2026-10/reporte");
  assert.equal(enlaceDeEmpresa(true, "plate-silver", undefined, undefined, "2026-10"), "/plate-silver/2026-10/reporte");
});

test("enlaceDeEmpresa: sin plantilla (Expensas, Gold, Cielos, Tucson) ADMIN y FINANZAS siguen con el período por defecto", () => {
  for (const slug of ["expensas", "gold-seguridad", "cielos", "tucson"]) {
    assert.equal(enlaceDeEmpresa(true, slug, undefined, undefined, "2026-10"), `/${slug}/${PERIODO_POR_DEFECTO}/presupuesto`, slug);
  }
});

test("enlaceDeEmpresa: el gerente ignora periodoAdmin", () => {
  assert.equal(enlaceDeEmpresa(false, "havanna", undefined, undefined, "2026-10"), `/havanna/${PERIODO_EN_CARGA_GERENTE}/reporte`);
  assert.equal(enlaceDeEmpresa(false, "expensas", undefined, undefined, "2026-10"), `/expensas/${PERIODO_EN_CARGA_GERENTE}/presupuesto`);
});

test("elegirUltimoPeriodoCargado: elige el máximo menor o igual al mes actual, sin importar el orden ni los repetidos", () => {
  assert.equal(elegirUltimoPeriodoCargado(["2026-09", "2026-10", "2026-09"], "2026-11"), "2026-10");
  assert.equal(elegirUltimoPeriodoCargado(["2026-10", "2026-09"], "2026-11"), "2026-10");
  assert.equal(elegirUltimoPeriodoCargado(["2026-09", "2026-11"], "2026-11"), "2026-11");
});

test("elegirUltimoPeriodoCargado: ignora los meses futuros y los textos que no son AAAA-MM", () => {
  assert.equal(elegirUltimoPeriodoCargado(["2026-09", "2026-12", "2027-01"], "2026-11"), "2026-09");
  assert.equal(elegirUltimoPeriodoCargado(["2026-9", "2026-13", "basura", ""], "2026-11"), PERIODO_POR_DEFECTO);
  // Comparación entre años.
  assert.equal(elegirUltimoPeriodoCargado(["2025-12", "2026-01"], "2026-02"), "2026-01");
});

test("elegirUltimoPeriodoCargado: sin ningún cierre usa el respaldo (por defecto PERIODO_POR_DEFECTO)", () => {
  assert.equal(elegirUltimoPeriodoCargado([], "2026-11"), PERIODO_POR_DEFECTO);
  assert.equal(elegirUltimoPeriodoCargado([], "2026-11", "2026-08"), "2026-08");
  assert.equal(elegirUltimoPeriodoCargado(["2026-12"], "2026-11", "2026-08"), "2026-08");
});
