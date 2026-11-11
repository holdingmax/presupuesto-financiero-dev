import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { puedeCargarRealConAcceso } from "@/lib/permisosReal";
import { monedaDeCuentaBbvaPeru } from "@/lib/extractos/bancosCuenta";
import { validarCuenta } from "@/lib/cuentasBancarias";
import type { ControlPieMoneda } from "@/lib/extractos/havannaPeru";
import {
  puedeConfirmarVistaPrevia,
  puedeVerSubidaExtractoEmpresa,
  semanasParaCargar,
} from "@/lib/extractos/pantallaExtractoEmpresa";

const ctl = (estado: ControlPieMoneda["estado"], moneda: "PEN" | "USD" = "PEN"): ControlPieMoneda => ({
  moneda,
  inicialCentavos: 0,
  movimientosCentavos: 0,
  finalCentavos: 0,
  diferenciaCentavos: estado === "no_cuadra" ? 5 : 0,
  estado,
});

// ---- Quién ve la pantalla A ------------------------------------------------------------------------

test("A: se ve en Havanna Perú para ADMIN, FINANZAS y el gerente CON tilde", () => {
  for (const acceso of [
    puedeCargarRealConAcceso({ rol: "ADMIN" }, null),
    puedeCargarRealConAcceso({ rol: "FINANZAS" }, null),
    puedeCargarRealConAcceso({ rol: "GERENTE" }, { puedeOperarEjecucion: true }),
  ]) {
    assert.equal(puedeVerSubidaExtractoEmpresa("havanna-peru", acceso), true);
  }
});

test("A: NO se ve para el gerente sin tilde ni para quien no tiene fila en esa empresa", () => {
  assert.equal(puedeVerSubidaExtractoEmpresa("havanna-peru", puedeCargarRealConAcceso({ rol: "GERENTE" }, { puedeOperarEjecucion: false })), false);
  assert.equal(puedeVerSubidaExtractoEmpresa("havanna-peru", puedeCargarRealConAcceso({ rol: "GERENTE" }, null)), false);
});

test("A: NO se ve en ninguna otra empresa, ni siquiera para ADMIN", () => {
  for (const slug of ["havanna", "brillante", "avianor", "hwc", "radio", "expensas"]) {
    assert.equal(puedeVerSubidaExtractoEmpresa(slug, true), false, slug);
  }
});

test("A: la página exige requireCargaRealEmpresa y la lista de config antes de mostrar nada", () => {
  const src = readFileSync("app/[empresa]/[periodo]/reporte/extracto/page.tsx", "utf8");
  const permiso = src.indexOf("await requireCargaRealEmpresa(empresa.id)");
  assert.ok(permiso > 0);
  assert.ok(src.indexOf("puedeVerSubidaExtractoEmpresa(slug, permitido)") > permiso);
  assert.ok(src.indexOf("prisma.ejecucionSemanal.findMany") > src.indexOf("puedeVerSubidaExtractoEmpresa(slug, permitido)"));
  assert.ok(src.includes("errorPeriodoNoHabilitado(periodo)"));
});

test("A: el link «Subir extracto» del Reporte usa la misma regla y por defecto está apagado", () => {
  const page = readFileSync("app/[empresa]/[periodo]/reporte/page.tsx", "utf8");
  assert.ok(page.includes("mostrarLinkExtracto={puedeVerSubidaExtractoEmpresa(empresaSlug, puedeCargarReal)"));
  const plantilla = readFileSync("app/[empresa]/[periodo]/reporte/ReportePlantilla.tsx", "utf8");
  assert.ok(plantilla.includes("mostrarLinkExtracto = false"));
});

test("A: no está en la Ejecución global (la gente de Perú no la ve) y esa pantalla no cambió", () => {
  const panel = readFileSync("app/ejecucion/PanelImputacion.tsx", "utf8");
  assert.ok(!/subirExtractoEmpresa|SubidaExtractoEmpresa/.test(panel));
  assert.ok(!readFileSync("app/ejecucion/actions.ts", "utf8").includes("subirExtractoEmpresa"));
});

// ---- Confirmar ---------------------------------------------------------------------------------------

test("A: Confirmar solo con movimientos nuevos y el pie cuadrando (o sin pie, que es un aviso)", () => {
  assert.equal(puedeConfirmarVistaPrevia({ nuevas: 3, control: [ctl("cuadra"), ctl("cuadra", "USD")] }), true);
  assert.equal(puedeConfirmarVistaPrevia({ nuevas: 3, control: [ctl("sin_pie")] }), true);
  assert.equal(puedeConfirmarVistaPrevia({ nuevas: 3, control: [ctl("cuadra"), ctl("no_cuadra", "USD")] }), false);
  assert.equal(puedeConfirmarVistaPrevia({ nuevas: 0, control: [ctl("cuadra")] }), false);
});

test("A: ante un error la pantalla muestra el mensaje y NO arma ningún botón de confirmar", () => {
  const src = readFileSync("app/[empresa]/[periodo]/reporte/extracto/SubidaExtractoEmpresa.tsx", "utf8");
  // Solo hay un botón de confirmar y cuelga de la vista previa; el bloque de error no lo tiene.
  const bloqueError = src.slice(src.indexOf("{error && ("), src.indexOf("{candidatas && ("));
  assert.ok(!/Confirmar|confirmarVistaPrevia|enviar\(/.test(bloqueError));
  assert.equal((src.match(/Confirmar y cargar/g) ?? []).length, 1);
  assert.ok(src.includes("disabled={ocupado || !puedeConfirmarVistaPrevia(vista)}"));
  assert.ok(src.includes("enviar(vista.pestana, true)"));
  assert.ok(src.includes("subirExtractoEmpresa(empresaId, periodo, semana, fd"));
});

// ---- Semana ------------------------------------------------------------------------------------------

test("A: solo se puede cargar en semanas abiertas; viene elegida la última abierta", () => {
  assert.deepEqual(
    semanasParaCargar([
      { numeroSemana: 1, estado: "CERRADA" },
      { numeroSemana: 2, estado: "ABIERTA" },
      { numeroSemana: 3, estado: "ABIERTA" },
    ]),
    { abiertas: [2, 3], porDefecto: 3 }
  );
  assert.deepEqual(semanasParaCargar([{ numeroSemana: 1, estado: "CERRADA" }]), { abiertas: [], porDefecto: null });
  assert.deepEqual(semanasParaCargar([]), { abiertas: [], porDefecto: null });
});

// ---- Cuentas de Perú creadas desde la pantalla de cuentas --------------------------------------------

test("cuentas: la pantalla de cuentas fija la moneda de BBVA Perú por el nombre (si no, quedaría ARS y la carga la rechazaría)", () => {
  assert.equal(monedaDeCuentaBbvaPeru("BBVA PERÚ SOLES"), "PEN");
  assert.equal(monedaDeCuentaBbvaPeru("bbva peru usd"), "USD");
  assert.equal(monedaDeCuentaBbvaPeru("MACRO 599"), null);
  const soles = validarCuenta({ nombre: "BBVA PERÚ SOLES", banco: "BBVA_PERU", terminacion: "" }, []);
  assert.ok(soles.ok && soles.cuenta.moneda === "PEN");
  const usd = validarCuenta({ nombre: "BBVA PERÚ USD", banco: "BBVA_PERU", terminacion: "" }, []);
  assert.ok(usd.ok && usd.cuenta.moneda === "USD");
  // Los bancos de siempre no traen moneda: queda el default de la base.
  const macro = validarCuenta({ nombre: "MACRO 599", banco: "MACRO", terminacion: "599" }, []);
  assert.ok(macro.ok && macro.cuenta.moneda === undefined);
  const acciones = readFileSync("app/admin/cuentas-bancarias/actions.ts", "utf8");
  assert.equal((acciones.match(/r\.cuenta\.moneda \? \{ moneda: r\.cuenta\.moneda \}/g) ?? []).length, 2, "crear y editar");
});

// ---- Pantalla B: tipo de cambio ----------------------------------------------------------------------

test("B: la pantalla del tipo de cambio es solo ADMIN/FINANZAS y la carga usa la acción protegida", () => {
  const page = readFileSync("app/admin/tipo-cambio/page.tsx", "utf8");
  assert.ok(page.indexOf("await requireAdminOFinanzas()") > 0);
  assert.ok(page.indexOf("await requireAdminOFinanzas()") < page.indexOf("prisma.tipoCambio.findMany"));
  const form = readFileSync("app/admin/tipo-cambio/TipoCambioForm.tsx", "utf8");
  assert.ok(form.includes('guardarTipoCambio(periodo.trim(), "USD", valor)'));
  assert.ok(form.includes("cargadoPor") && form.includes("cuando"), "muestra quién y cuándo");
  const layout = readFileSync("app/admin/layout.tsx", "utf8");
  assert.ok(layout.includes("esAdminOFinanzas(usuario)"), "el layout de /admin ya corta al resto");
  const inicio = readFileSync("app/page.tsx", "utf8");
  const ancla = inicio.indexOf('href="/admin/tipo-cambio"');
  assert.ok(ancla > inicio.indexOf("esAdminOFinanzas(usuario) && ("), "el acceso está dentro del bloque de ADMIN/FINANZAS");
});
