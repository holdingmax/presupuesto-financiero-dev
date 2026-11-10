import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ERROR_PERIODO_NO_HABILITADO,
  avisoPeriodoSoloLectura,
  errorPeriodoNoHabilitado,
} from "@/lib/periodosHabilitados";

// Tanda 1 de permisos del Real: período habilitado en las dos acciones de escritura y cartel del mes pasado.

const leer = (ruta: string) =>
  readFileSync(new URL(`../../app/[empresa]/[periodo]/reporte/${ruta}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

// ---- Período habilitado en el servidor --------------------------------------------------------------------------------

test("errorPeriodoNoHabilitado: 2026-05 y otros fuera de la lista se rechazan; octubre y noviembre pasan", () => {
  for (const p of ["2026-05", "2026-09", "2026-12", "2027-01", "2026-1", " 2026-11", ""]) {
    assert.equal(errorPeriodoNoHabilitado(p), ERROR_PERIODO_NO_HABILITADO, p);
  }
  for (const p of ["2026-10", "2026-11"]) assert.equal(errorPeriodoNoHabilitado(p), null, p);
  // Con otra lista (como lo usa el resto del módulo).
  assert.equal(errorPeriodoNoHabilitado("2026-05", ["2026-05"]), null);
});

test("las dos acciones de escritura rechazan el período no habilitado antes de leer empresa, permisos o base", () => {
  for (const [archivo, primeraAccion] of [
    ["carga/actions.ts", "export async function guardarValoresManuales"],
    ["actionsTipeo.ts", "export async function guardarTipeoDelReporte"],
  ] as const) {
    const f = leer(archivo);
    const cuerpo = f.slice(f.indexOf(primeraAccion));
    const formato = cuerpo.indexOf("FORMATO_PERIODO.test(periodo)");
    const habilitado = cuerpo.indexOf("errorPeriodoNoHabilitado(periodo)");
    const empresa = cuerpo.indexOf("resolverEmpresaPorSlug(");
    const permiso = cuerpo.indexOf("requireCargaRealEmpresa(");
    assert.ok(formato > 0 && habilitado > formato, `${archivo}: la guarda va después del formato`);
    assert.ok(empresa > habilitado && permiso > habilitado, `${archivo}: y antes de empresa y permiso`);
    // Y devuelve el error, no sigue.
    assert.match(cuerpo, /if \(noHabilitado\) return \{ ok: false, error: noHabilitado \};/, archivo);
  }
});

test("la guarda de período vale para todos los roles: no depende del rol ni del permiso", () => {
  // La función no recibe usuario: ADMIN, FINANZAS y gerente con tilde reciben el mismo resultado.
  assert.equal(errorPeriodoNoHabilitado.length <= 2, true);
  for (const f of ["carga/actions.ts", "actionsTipeo.ts"]) {
    const src = leer(f);
    assert.ok(!/esAdminOFinanzas\([^)]*\)[^\n]*errorPeriodoNoHabilitado/.test(src), f);
  }
});

// ---- Cartel ---------------------------------------------------------------------------------------------------------

const ACTUAL = "Solo se puede cargar el mes en curso (Noviembre 2026). Este mes está en solo lectura.";
const CON_REAL =
  "Solo se puede cargar el Presupuestado del mes en curso (Noviembre 2026). En este mes podés cargar el Real de las celdas habilitadas.";

test("cartel: gerente sin celdas de Real (sin tilde) en octubre: el texto de siempre", () => {
  assert.equal(avisoPeriodoSoloLectura("2026-10", false), ACTUAL);
  assert.equal(avisoPeriodoSoloLectura("2026-10", false, undefined, false), ACTUAL);
});

test("cartel: gerente con tilde y Real cargable en octubre: el texto nuevo", () => {
  assert.equal(avisoPeriodoSoloLectura("2026-10", false, undefined, true), CON_REAL);
  assert.equal(
    avisoPeriodoSoloLectura("2026-10", false, "2026-12", true),
    CON_REAL.replace("Noviembre 2026", "Diciembre 2026")
  );
});

test("cartel: ADMIN/FINANZAS y el mes en curso no tienen cartel, con o sin Real cargable", () => {
  for (const real of [true, false]) {
    assert.equal(avisoPeriodoSoloLectura("2026-10", true, undefined, real), null);
    assert.equal(avisoPeriodoSoloLectura("2026-11", false, undefined, real), null);
  }
});

test("cartel: que haya cartel no depende de conRealCargable (la carga del Presupuestado sigue igual)", () => {
  for (const p of ["2026-08", "2026-10", "2026-11", "2026-12"]) {
    for (const admin of [true, false]) {
      assert.equal(
        avisoPeriodoSoloLectura(p, admin, undefined, true) === null,
        avisoPeriodoSoloLectura(p, admin) === null,
        `${p} admin=${admin}`
      );
    }
  }
});

test("pantalla: el cartel con Real cargable solo se arma con tipeo, y la atenuación del mes no lo contradice", () => {
  const page = leer("page.tsx");
  assert.match(page, /avisoSoloLectura !== null && !edicion\.historial && tipeo !== null/);
  assert.match(page, /avisoPeriodoSoloLectura\(periodo, esAdminOFinanzas\(usuario\), undefined, true\)/);
  assert.match(page, /avisoSoloLectura=\{avisoParaPantalla\}/);
  // La carga del Presupuestado sigue decidiéndose con el cartel original.
  assert.match(page, /avisoSoloLectura === null &&\n\s+cargaEnReporteActiva/);
  const tabla = leer("ReportePlantilla.tsx");
  assert.match(tabla, /\(avisoSoloLectura !== null && !hayRealCargable\)/);
  assert.match(tabla, /hayRealCargable = \(tipeo\?\.celdas\.length \?\? 0\) > 0/);
});
