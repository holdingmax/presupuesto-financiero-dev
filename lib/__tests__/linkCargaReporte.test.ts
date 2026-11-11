import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPRESAS_CON_CARGA_EN_REPORTE, EMPRESAS_CON_TIPEO_DIRECTO, EMPRESAS_SIN_LINK_CARGA_EN_REPORTE } from "@/lib/config";
import { edicionDelReporte, linkCargaVisible } from "@/lib/reporte/vistaReporte";

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

test("botón «Cargar valores del mes»: oculto en Bradenton, Plate Silver y Havanna Perú aunque el rol pueda cargar", () => {
  assert.deepEqual([...EMPRESAS_SIN_LINK_CARGA_EN_REPORTE], ["bradenton", "plate-silver", "havanna-peru"]);
  for (const slug of EMPRESAS_SIN_LINK_CARGA_EN_REPORTE) {
    assert.equal(linkCargaVisible(slug, true), false, `${slug}: ni con permiso de cargar`);
    assert.equal(linkCargaVisible(slug, false), false, slug);
  }
});

test("botón «Cargar valores del mes»: las demás empresas quedan idénticas (lo que decide edicionDelReporte)", () => {
  for (const slug of ["brillante", "havanna", "hwc", "radio", "avianor", "mantenor", "fredy-publicidad", "conexion-logistica", "expensas"]) {
    assert.equal(linkCargaVisible(slug, true), true, slug);
    assert.equal(linkCargaVisible(slug, false), false, slug);
  }
});

test("botón «Cargar valores del mes»: ADMIN, FINANZAS y gerente con permiso, en las tres y en otra, en todos los modos", () => {
  const base = { periodo: "2026-10", marca: undefined } as unknown as Parameters<typeof edicionDelReporte>[0];
  const roles = [
    edicionDelReporte({ ...base, esAdminOFinanzas: true }),
    edicionDelReporte({ ...base, esAdminOFinanzas: false, puedeCargarReal: true }),
    edicionDelReporte({ ...base, esAdminOFinanzas: false, puedeCargarReal: false }),
  ];
  for (const e of roles) {
    for (const slug of EMPRESAS_SIN_LINK_CARGA_EN_REPORTE) assert.equal(linkCargaVisible(slug, e.linkCarga), false, slug);
  }
  // edicionDelReporte no cambia: en otra empresa el link sigue como siempre.
  assert.deepEqual(roles.map((e) => linkCargaVisible("brillante", e.linkCarga)), [true, true, false]);
});

test("la lista solo tiene empresas con Reporte por plantilla y tipeo directo, y sin repetidos", () => {
  assert.equal(new Set(EMPRESAS_SIN_LINK_CARGA_EN_REPORTE).size, EMPRESAS_SIN_LINK_CARGA_EN_REPORTE.length);
  for (const slug of EMPRESAS_SIN_LINK_CARGA_EN_REPORTE) {
    assert.ok(EMPRESAS_CON_CARGA_EN_REPORTE.includes(slug), `${slug} carga el Presupuestado desde el Reporte`);
    assert.ok(EMPRESAS_CON_TIPEO_DIRECTO.includes(slug), `${slug} tipea el Real directo en el Reporte`);
  }
});

test("solo se oculta el botón: la página del Reporte usa linkCargaVisible, y los otros botones y la ruta /reporte/carga no se tocan", () => {
  const page = leer("../../app/[empresa]/[periodo]/reporte/page.tsx");
  assert.match(page, /mostrarLinkCarga=\{linkCargaVisible\(empresaSlug, edicion\.linkCarga\)\}/);
  assert.match(page, /mostrarLinkExtracto=\{puedeVerSubidaExtractoEmpresa\(empresaSlug, puedeCargarReal\) && esPeriodoHabilitado\(periodo\)\}/);
  const plantilla = leer("../../app/[empresa]/[periodo]/reporte/ReportePlantilla.tsx");
  assert.match(plantilla, /\{carga && <BarraGuardarPresupuesto \/>\}/);
  assert.match(plantilla, /\{tipeo && <BarraGuardarTipeo \/>\}/);
  assert.match(plantilla, /Subir extracto/);
  // La ruta sigue abierta por URL: su página no consulta la lista (Capital de trabajo de Bradenton y Havanna Perú).
  const carga = leer("../../app/[empresa]/[periodo]/reporte/carga/page.tsx");
  assert.ok(!/EMPRESAS_SIN_LINK_CARGA_EN_REPORTE|linkCargaVisible/.test(carga));
  assert.match(carga, /requireCargaRealEmpresa/);
});
