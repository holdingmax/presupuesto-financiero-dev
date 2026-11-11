import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPRESAS_CON_CARGA_EN_REPORTE, EMPRESAS_CON_TIPEO_DIRECTO, EMPRESAS_SIN_LINK_CARGA_EN_REPORTE } from "@/lib/config";
import { edicionDelReporte, linkCargaVisible } from "@/lib/reporte/vistaReporte";

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

test("botón «Cargar valores del mes»: en Bradenton, Plate Silver y Havanna Perú solo ADMIN y FINANZAS", () => {
  assert.deepEqual([...EMPRESAS_SIN_LINK_CARGA_EN_REPORTE], ["bradenton", "plate-silver", "havanna-peru"]);
  for (const slug of EMPRESAS_SIN_LINK_CARGA_EN_REPORTE) {
    assert.equal(linkCargaVisible(slug, true, true), true, `${slug}: ADMIN/FINANZAS lo ven`);
    assert.equal(linkCargaVisible(slug, true, false), false, `${slug}: ni el gerente con permiso de cargar`);
    assert.equal(linkCargaVisible(slug, false, false), false, `${slug}: ni el gerente sin permiso`);
    assert.equal(linkCargaVisible(slug, false, true), false, `${slug}: sin linkCarga (histórico) no hay botón para nadie`);
  }
});

test("botón «Cargar valores del mes»: las demás empresas quedan idénticas (lo que decide edicionDelReporte)", () => {
  for (const slug of ["brillante", "havanna", "hwc", "radio", "avianor", "mantenor", "fredy-publicidad", "conexion-logistica", "expensas"]) {
    assert.equal(linkCargaVisible(slug, true, true), true, slug);
    assert.equal(linkCargaVisible(slug, true, false), true, `${slug}: gerente con permiso`);
    assert.equal(linkCargaVisible(slug, false, false), false, slug);
  }
});

test("botón «Cargar valores del mes»: por rol, en las tres y en otra, en todos los modos", () => {
  const base = { periodo: "2026-10", marca: undefined } as unknown as Parameters<typeof edicionDelReporte>[0];
  const admin = edicionDelReporte({ ...base, esAdminOFinanzas: true });
  const gerenteConPermiso = edicionDelReporte({ ...base, esAdminOFinanzas: false, puedeCargarReal: true });
  const gerenteSinPermiso = edicionDelReporte({ ...base, esAdminOFinanzas: false, puedeCargarReal: false });
  for (const slug of EMPRESAS_SIN_LINK_CARGA_EN_REPORTE) {
    assert.equal(linkCargaVisible(slug, admin.linkCarga, true), true, `${slug}: ADMIN/FINANZAS`);
    assert.equal(linkCargaVisible(slug, gerenteConPermiso.linkCarga, false), false, `${slug}: gerente con permiso`);
    assert.equal(linkCargaVisible(slug, gerenteSinPermiso.linkCarga, false), false, `${slug}: gerente sin permiso`);
  }
  // edicionDelReporte no cambia: en otra empresa el link sigue como siempre.
  assert.deepEqual(
    [
      linkCargaVisible("brillante", admin.linkCarga, true),
      linkCargaVisible("brillante", gerenteConPermiso.linkCarga, false),
      linkCargaVisible("brillante", gerenteSinPermiso.linkCarga, false),
    ],
    [true, true, false]
  );
  // Vista histórica del mes en curso: solo lectura para todos, tampoco ADMIN ve el botón.
  const historial = edicionDelReporte({ ...base, periodo: "2026-11", marca: "anteriores", esAdminOFinanzas: true });
  assert.equal(historial.historial, true);
  for (const slug of EMPRESAS_SIN_LINK_CARGA_EN_REPORTE) assert.equal(linkCargaVisible(slug, historial.linkCarga, true), false, slug);
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
  assert.match(page, /mostrarLinkCarga=\{linkCargaVisible\(empresaSlug, edicion\.linkCarga, esAdminOFinanzas\(usuario\)\)\}/);
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
