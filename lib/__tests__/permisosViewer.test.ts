import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rol } from "@prisma/client";
import {
  AVISO_REPORTE_SOLO_LECTURA,
  MENSAJE_SIN_ACCESO_A_PANTALLA,
  PERMISOS_FORZADOS_VIEWER,
  SoloLecturaError,
  esViewer,
  requireEscritura,
  verBloquesReservadosSiNoEsViewer,
} from "@/lib/permisosViewer";
import {
  puedeCargarMadreEjecucion,
  puedeCerrarEjecucion,
  puedeOperarEjecucionGlobal,
  veBloquesReservadosDelReporte,
  veSubidaDeEjecucion,
  veTodoEjecucion,
} from "@/lib/permisosEjecucion";
import { puedeCargarRealConAcceso } from "@/lib/permisosReal";
import { puedeClasificarEnEmpresa } from "@/lib/clasificarPorEmpresa";
import { puedeConfirmarComoGerente, puedeConfirmarEnNombreDelGerente } from "@/lib/confirmacionFinal";
import { enlaceDeEmpresaViewer } from "@/lib/navegacionViewer";
import { PERIODO_EN_CARGA_GERENTE } from "@/lib/config";

// Rol VIEWER: las reglas puras con TODOS los roles y TODAS las casillas. Regla de fondo: un VIEWER nunca escribe,
// tenga las casillas que tenga en la base.

const ROLES: Rol[] = ["ADMIN", "GERENTE", "FINANZAS", "VIEWER"];
const BOOLS = [false, true];
const leer = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

test("esViewer: solo el rol VIEWER", () => {
  for (const rol of ROLES) assert.equal(esViewer({ rol }), rol === "VIEWER", rol);
});

test("requireEscritura: tira SoloLecturaError a un VIEWER y deja pasar (devolviendo el mismo usuario) a los demás", () => {
  for (const rol of ROLES) {
    const usuario = { rol, operaEjecucion: true };
    if (rol === "VIEWER") {
      assert.throws(() => requireEscritura(usuario), SoloLecturaError);
    } else {
      assert.equal(requireEscritura(usuario), usuario, rol);
    }
  }
});

test("puedeOperarEjecucionGlobal: VIEWER nunca, aunque tenga operaEjecucion; el resto como siempre", () => {
  for (const rol of ROLES) {
    for (const operaEjecucion of BOOLS) {
      const esperado = rol === "VIEWER" ? false : rol === "ADMIN" || operaEjecucion;
      assert.equal(puedeOperarEjecucionGlobal({ rol, operaEjecucion }), esperado, `${rol} opera=${operaEjecucion}`);
    }
  }
});

test("ver y operar Ejecución global / subida: VIEWER nunca, con cualquier casilla", () => {
  for (const operaEjecucion of BOOLS) {
    const v = { rol: "VIEWER" as Rol, operaEjecucion };
    assert.equal(veTodoEjecucion(v), false);
    assert.equal(veSubidaDeEjecucion(v), false);
    assert.equal(puedeCerrarEjecucion(v), false);
    assert.equal(puedeCargarMadreEjecucion(v), false);
    assert.equal(veBloquesReservadosDelReporte(v), false);
  }
});

test("los demás roles NO cambian (ADMIN, FINANZAS y GERENTE como antes)", () => {
  for (const operaEjecucion of BOOLS) {
    assert.equal(veTodoEjecucion({ rol: "ADMIN", operaEjecucion }), true);
    assert.equal(veTodoEjecucion({ rol: "FINANZAS", operaEjecucion }), true);
    assert.equal(veTodoEjecucion({ rol: "GERENTE", operaEjecucion }), operaEjecucion);
    assert.equal(puedeCerrarEjecucion({ rol: "FINANZAS" }), true);
    assert.equal(puedeCerrarEjecucion({ rol: "GERENTE" }), false);
  }
});

test("cargar el Real de una empresa: VIEWER nunca, con o sin la casilla por empresa", () => {
  for (const rol of ROLES) {
    for (const acceso of [null, undefined, { puedeOperarEjecucion: false }, { puedeOperarEjecucion: true }]) {
      const esperado =
        rol === "VIEWER" ? false : rol === "ADMIN" || rol === "FINANZAS" || (rol === "GERENTE" && acceso?.puedeOperarEjecucion === true);
      assert.equal(puedeCargarRealConAcceso({ rol }, acceso), esperado, `${rol} ${JSON.stringify(acceso)}`);
    }
  }
});

test("clasificar movimientos de la empresa: VIEWER nunca, con la casilla por empresa tildada o no", () => {
  for (const rol of ROLES) {
    for (const puedeOperarEjecucion of BOOLS) {
      const esperado = rol === "GERENTE" && puedeOperarEjecucion;
      assert.equal(puedeClasificarEnEmpresa({ rol }, { puedeOperarEjecucion }), esperado, `${rol} ${puedeOperarEjecucion}`);
    }
  }
});

test("confirmar el presupuesto (gerente / en nombre del gerente): VIEWER nunca, sea o no revisor", () => {
  for (const esRevisor of BOOLS) {
    assert.equal(puedeConfirmarComoGerente("VIEWER"), false);
    assert.equal(puedeConfirmarEnNombreDelGerente("VIEWER", esRevisor), false);
  }
});

test("Excel del Reporte: el VIEWER nunca recibe los bloques reservados; el resto como siempre", () => {
  for (const rol of ROLES) {
    for (const veBloques of BOOLS) {
      const esperado = rol === "VIEWER" ? false : veBloques;
      assert.equal(verBloquesReservadosSiNoEsViewer({ rol }, veBloques), esperado, `${rol} ${veBloques}`);
    }
  }
});

test("la descarga del Reporte y la pantalla arman el Reporte del VIEWER con sinBloquesReservados (gana sobre los interruptores)", () => {
  assert.match(leer("app/[empresa]/[periodo]/reporte/excel/route.ts"), /sinBloquesReservados: esViewer\(usuario\)/);
  assert.match(leer("app/[empresa]/[periodo]/reporte/page.tsx"), /sinBloquesReservados: soloLectura/);
  // y en armarReporteDePlantilla gana sobre verBloquesReservados y los interruptores
  assert.match(leer("lib/reporte/armarReporteDePlantilla.ts"), /e\.sinBloquesReservados \? false : accesoReservadosDelReporte/);
});

test("PERMISOS_FORZADOS_VIEWER: las tres casillas de escritura en false", () => {
  assert.deepEqual({ ...PERMISOS_FORZADOS_VIEWER }, {
    operaEjecucion: false,
    puedeOperarEjecucion: false,
    puedeRevisarPresupuesto: false,
  });
});

test("/admin/usuarios: el servidor fuerza en false las casillas del VIEWER, sin mirar el formulario", () => {
  const acciones = leer("app/admin/usuarios/actions.ts");
  assert.match(acciones, /"VIEWER"\]/); // rol válido
  // leerPermisos devuelve las casillas por empresa en false para VIEWER ANTES de leer el formulario.
  const leerPermisos = acciones.slice(acciones.indexOf("function leerPermisos"), acciones.indexOf("export type ResultadoCrear"));
  assert.ok(leerPermisos.indexOf("esViewer({ rol })") < leerPermisos.indexOf("formData.get"));
  assert.match(leerPermisos, /PERMISOS_FORZADOS_VIEWER\.puedeOperarEjecucion/);
  assert.match(leerPermisos, /PERMISOS_FORZADOS_VIEWER\.puedeRevisarPresupuesto/);
  // alta y edición usan leerPermisos con el rol, y operaEjecucion global se fuerza en la edición y en el alta.
  assert.equal((acciones.match(/leerPermisos\(formData, datos\.rol\)/g) ?? []).length, 2);
  assert.match(acciones, /esViewer\(\{ rol: datos\.rol \}\)\s*\n\s*\? \{ operaEjecucion: PERMISOS_FORZADOS_VIEWER\.operaEjecucion \}/);
  assert.match(acciones, /\.\.\.\(esViewer\(\{ rol: datos\.rol \}\) \? \{ operaEjecucion: PERMISOS_FORZADOS_VIEWER\.operaEjecucion \} : \{\}\)/);
});

test("/admin/usuarios: la opción VIEWER está en las dos listas (alta y edición)", () => {
  for (const rel of ["app/admin/usuarios/nuevo/NuevoUsuarioForm.tsx", "app/admin/usuarios/[id]/EditarUsuarioForm.tsx"]) {
    assert.match(leer(rel), /<option value="VIEWER">/, rel);
  }
});

test("Mis empresas: el VIEWER va siempre al Reporte (nunca a Presupuesto)", () => {
  assert.equal(enlaceDeEmpresaViewer("brillante"), `/brillante/${PERIODO_EN_CARGA_GERENTE}/reporte`);
  assert.equal(enlaceDeEmpresaViewer("expensas", "2026-10"), "/expensas/2026-10/reporte");
});

test("pantallas: Presupuesto, carga, extracto, Ejecución global y /admin muestran el mensaje a un VIEWER", () => {
  assert.equal(MENSAJE_SIN_ACCESO_A_PANTALLA, "No tenés acceso a esta pantalla.");
  assert.match(AVISO_REPORTE_SOLO_LECTURA, /solo lectura/);
  assert.match(leer("app/[empresa]/[periodo]/presupuesto/page.tsx"), /esViewer\(usuarioActual\)\) return <AvisoSinAccesoPantalla/);
  assert.match(leer("app/[empresa]/[periodo]/reporte/carga/page.tsx"), /esViewer\(await requireUsuarioAlDia\(\)\)\) return <Aviso texto=\{MENSAJE_SIN_ACCESO_A_PANTALLA\}/);
  assert.match(leer("app/[empresa]/[periodo]/reporte/extracto/page.tsx"), /esViewer\(await requireUsuarioAlDia\(\)\)\) return <Aviso texto=\{MENSAJE_SIN_ACCESO_A_PANTALLA\}/);
  assert.match(leer("app/ejecucion/[periodo]/layout.tsx"), /esViewer\(usuario\)\) return <AvisoSinAccesoPantalla/);
  assert.match(leer("app/admin/layout.tsx"), /esViewer\(usuario\)\) return <AvisoSinAccesoPantalla/);
  assert.match(leer("app/admin/usuarios/layout.tsx"), /esViewer\(usuario\)\) return <AvisoSinAccesoPantalla/);
  assert.match(leer("components/AvisoSinAccesoPantalla.tsx"), /MENSAJE_SIN_ACCESO_A_PANTALLA/);
});

test("Excel de Ejecución: 403 al VIEWER en las rutas de la empresa y ocultar el botón; la global ya lo rechaza por veTodoEjecucion", () => {
  for (const rel of [
    "app/[empresa]/[periodo]/ejecucion/[numeroSemana]/excel/route.ts",
    "app/[empresa]/[periodo]/ejecucion/mes/excel/route.ts",
  ]) {
    assert.match(leer(rel), /if \(esViewer\(usuario\)\) return new Response\("Sin acceso\.", \{ status: 403 \}\)/, rel);
  }
  assert.match(leer("app/ejecucion/[periodo]/[numeroSemana]/excel/route.ts"), /requireVerEjecucionGlobal\(\)/);
  assert.match(leer("app/[empresa]/[periodo]/ejecucion/[numeroSemana]/page.tsx"), /!datos\.esViewer && \(/);
  assert.match(leer("app/[empresa]/[periodo]/ejecucion/mes/page.tsx"), /!datos\.esViewer && \(/);
});

test("obtenerNumeroSemanaAbierta: no crea semanas si quien llama es VIEWER", () => {
  const f = leer("app/ejecucion/actions.ts");
  const cuerpo = f.slice(f.indexOf("export async function obtenerNumeroSemanaAbierta"), f.indexOf("export async function listarSemanasDelPeriodo"));
  assert.match(cuerpo, /if \(!esViewer\(usuario\) && puedeOperarEjecucionGlobal\(usuario\)\)/);
  assert.ok(cuerpo.indexOf("esViewer(usuario)") < cuerpo.indexOf("obtenerOCrearEjecucionAbierta"));
});

test("Reporte de una empresa sin plantilla: el VIEWER no crea el presupuesto del mes al mirarlo", () => {
  const p = leer("app/[empresa]/[periodo]/reporte/page.tsx");
  const i = p.indexOf("const presupuestoId =");
  assert.match(p.slice(i, i + 600), /esViewer\(usuario\)\s*\n\s*\?[\s\S]*findUnique/);
});

test("Reporte de plantilla para el VIEWER: sin flujo, sin carga, sin tipeo, sin link de carga, con aviso de solo lectura", () => {
  const p = leer("app/[empresa]/[periodo]/reporte/page.tsx");
  assert.match(p, /const flujo: EstadoFlujo \| null = !soloLectura && edicion\.flujo/);
  assert.match(p, /const avisoParaPantalla = soloLectura\s*\n\s*\? AVISO_REPORTE_SOLO_LECTURA/);
  // tipeo / filas extra / link a la carga dependen de esAdminOFinanzas o puedeCargarReal, que son false para un VIEWER
  // (probado arriba con las reglas puras); el flujo (y con él la carga del Presupuestado) queda en null.
});
