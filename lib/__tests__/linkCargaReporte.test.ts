import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPRESAS_CON_CARGA_EN_REPORTE, EMPRESAS_CON_TIPEO_DIRECTO, EMPRESAS_SIN_LINK_CARGA_EN_REPORTE } from "@/lib/config";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { edicionDelReporte, linkCargaVisible } from "@/lib/reporte/vistaReporte";

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

const TODAS = [
  "bradenton",
  "plate-silver",
  "havanna-peru",
  "avianor",
  "brillante",
  "conexion-logistica",
  "conexion-logistica-spp",
  "fredy-publicidad",
  "havanna",
  "hwc",
  "mantenor",
  "radio",
];

test("botón «Cargar valores del mes»: oculto en TODAS las empresas con Reporte por plantilla, aunque el rol pueda cargar", () => {
  assert.deepEqual([...EMPRESAS_SIN_LINK_CARGA_EN_REPORTE].sort(), [...TODAS].sort());
  for (const slug of EMPRESAS_SIN_LINK_CARGA_EN_REPORTE) {
    assert.equal(linkCargaVisible(slug, true), false, `${slug}: ni con permiso de cargar`);
    assert.equal(linkCargaVisible(slug, false), false, slug);
  }
});

test("botón «Cargar valores del mes»: cada empresa con plantilla de Reporte (con todos sus slugs) está en la lista", () => {
  // Si se suma una plantilla nueva hay que decidir acá si muestra el botón: este test obliga a mirarlo.
  for (const slug of Object.keys(PLANTILLAS_POR_SLUG)) {
    assert.ok(EMPRESAS_SIN_LINK_CARGA_EN_REPORTE.includes(slug), `${slug} sigue mostrando el botón`);
    assert.equal(linkCargaVisible(slug, true), false, slug);
  }
});

test("botón «Cargar valores del mes»: la función no cambia; una empresa fuera de la lista (sin Reporte por plantilla) sigue como decide edicionDelReporte", () => {
  for (const slug of ["expensas", "gold-seguridad", "jps"]) {
    assert.equal(slug in PLANTILLAS_POR_SLUG, false, slug);
    assert.equal(linkCargaVisible(slug, true), true, slug);
    assert.equal(linkCargaVisible(slug, false), false, slug);
  }
});

test("botón «Cargar valores del mes»: ADMIN, FINANZAS y gerente con permiso, en todas las empresas con plantilla, en todos los modos", () => {
  const base = { periodo: "2026-10", marca: undefined } as unknown as Parameters<typeof edicionDelReporte>[0];
  const roles = [
    edicionDelReporte({ ...base, esAdminOFinanzas: true }),
    edicionDelReporte({ ...base, esAdminOFinanzas: false, puedeCargarReal: true }),
    edicionDelReporte({ ...base, esAdminOFinanzas: false, puedeCargarReal: false }),
  ];
  for (const e of roles) {
    for (const slug of EMPRESAS_SIN_LINK_CARGA_EN_REPORTE) assert.equal(linkCargaVisible(slug, e.linkCarga), false, slug);
  }
  // edicionDelReporte no cambia (sigue diciendo que ADMIN, FINANZAS y el gerente con permiso podrían cargar), pero ya no hay
  // empresa con plantilla en la que el botón se vea, ni siquiera en las que antes lo mostraban.
  assert.deepEqual(roles.map((e) => e.linkCarga), [true, true, false]);
  for (const slug of ["brillante", "avianor", "conexion-logistica", "hwc"]) {
    assert.deepEqual(roles.map((e) => linkCargaVisible(slug, e.linkCarga)), [false, false, false], slug);
  }
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
