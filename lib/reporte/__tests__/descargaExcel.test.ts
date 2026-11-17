import { test } from "node:test";
import assert from "node:assert/strict";
import { veBloquesReservadosDelReporte } from "@/lib/permisosEjecucion";
import { PLANTILLAS_POR_SLUG, plantillaDeEmpresa } from "@/lib/reporte/plantillas";
import { armarReporte } from "@/lib/reporte/motor";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { cantidadDeMeses, edicionDelReporte, enlaceDeExcel } from "@/lib/reporte/vistaReporte";
import {
  dispComoSaldoDelReporte,
  leerParametro,
  nombreArchivoReporte,
  rechazoPorEmpresa,
  rechazoPorPeriodo,
  vistaDeDescarga,
} from "@/lib/reporte/descargaExcel";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";

// ---- Respuestas de la ruta ---------------------------------------------------------------------------

test("período inválido: 400; uno bien formado pasa", () => {
  for (const malo of ["", "2026", "2026-1", "26-11", "2026-11-01", "2026-11x", "abcd-ef", "../../etc"]) {
    assert.deepEqual(rechazoPorPeriodo(malo), { status: 400, mensaje: "Período inválido." }, malo);
  }
  assert.equal(rechazoPorPeriodo("2026-11"), null);
});

test("empresa sin plantilla (Fase 1): 404, aunque el período sea válido y esté habilitado", () => {
  assert.equal(plantillaDeEmpresa("expensas"), null);
  assert.equal(plantillaDeEmpresa("no-existe"), null);
  const r = rechazoPorEmpresa({ tienePlantilla: false, periodo: "2026-11" });
  assert.equal(r?.status, 404);
});

test("período bien formado pero no habilitado: 403 (ni ADMIN ni FINANZAS lo abren, como la pantalla)", () => {
  assert.equal(rechazoPorEmpresa({ tienePlantilla: true, periodo: "2026-08" })?.status, 403);
  assert.equal(rechazoPorEmpresa({ tienePlantilla: true, periodo: "2026-12" })?.status, 403);
  assert.equal(rechazoPorEmpresa({ tienePlantilla: true, periodo: "2026-11" }), null);
  assert.equal(rechazoPorEmpresa({ tienePlantilla: true, periodo: "2026-10" }), null);
});

test("todas las empresas con plantilla pasan el chequeo de empresa", () => {
  for (const slug of Object.keys(PLANTILLAS_POR_SLUG)) {
    assert.equal(rechazoPorEmpresa({ tienePlantilla: plantillaDeEmpresa(slug) !== null, periodo: "2026-11" }), null, slug);
  }
});

// ---- Vista: lo que se descarga es lo que se mira ------------------------------------------------------

test("leerParametro: ausente, uno y repetido", () => {
  assert.equal(leerParametro(new URLSearchParams(""), "vista"), undefined);
  assert.equal(leerParametro(new URLSearchParams("vista=todo"), "vista"), "todo");
  assert.deepEqual(leerParametro(new URLSearchParams("vista=todo&vista=actual"), "vista"), ["todo", "actual"]);
});

test("vistaDeDescarga: mismo resultado que la pantalla, para cualquier rol", () => {
  for (const adminOFinanzas of [true, false]) {
    // Mes en curso: nunca columnas juntas, aunque la URL lo pida.
    assert.equal(vistaDeDescarga("todo", undefined, "2026-11", adminOFinanzas), "actual");
    // Mes en curso visto como histórico («Todos los meses»): columnas juntas si se pide.
    assert.equal(vistaDeDescarga("todo", "anteriores", "2026-11", adminOFinanzas), "todo");
    assert.equal(vistaDeDescarga(undefined, "anteriores", "2026-11", adminOFinanzas), "actual");
    // Un mes anterior: la vista pedida.
    assert.equal(vistaDeDescarga("todo", undefined, "2026-10", adminOFinanzas), "todo");
    assert.equal(vistaDeDescarga("actual", undefined, "2026-10", adminOFinanzas), "actual");
    // Valores raros o repetidos vuelven al valor por defecto.
    assert.equal(vistaDeDescarga(["todo", "todo"], undefined, "2026-10", adminOFinanzas), "actual");
    assert.equal(vistaDeDescarga("TODO", undefined, "2026-10", adminOFinanzas), "actual");
  }
});

test("columnas juntas: octubre y noviembre (2 meses) para todos los roles; ningún rol ve meses ocultos", () => {
  for (const adminOFinanzas of [true, false]) {
    assert.equal(cantidadDeMeses("todo", "2026-11", adminOFinanzas), 2);
    assert.equal(cantidadDeMeses("actual", "2026-11", adminOFinanzas), 1);
  }
});

test("enlaceDeExcel: lleva la vista y, solo en el mes en curso como histórico, la marca", () => {
  assert.equal(enlaceDeExcel("brillante", "2026-11", "actual", undefined), "/brillante/2026-11/reporte/excel?vista=actual");
  assert.equal(
    enlaceDeExcel("brillante", "2026-11", "todo", "anteriores"),
    "/brillante/2026-11/reporte/excel?vista=todo&modo=anteriores"
  );
  assert.equal(enlaceDeExcel("brillante", "2026-10", "todo", "anteriores"), "/brillante/2026-10/reporte/excel?vista=todo");
  assert.equal(enlaceDeExcel("brillante", "2026-11", "todo", "otra-cosa"), "/brillante/2026-11/reporte/excel?vista=todo");
});

test("nombre del archivo: sin caracteres raros y con el día de Argentina", () => {
  const ahora = new Date("2026-11-18T02:40:00Z");
  assert.equal(nombreArchivoReporte("brillante", "2026-11", ahora), "reporte-brillante-2026-11-2026-11-17.xlsx");
  assert.equal(nombreArchivoReporte('a"b/c d', "2026-11", ahora), "reporte-abcd-2026-11-2026-11-17.xlsx");
});

// ---- Roles: qué bloques llegan y cuándo Disponibilidades es «Saldo» ---------------------------------

const ABIERTO = { abiertas: 1, cerradas: 0 };
const ROLES = [
  { nombre: "ADMIN", rol: "ADMIN", puedeCargarReal: true },
  { nombre: "FINANZAS", rol: "FINANZAS", puedeCargarReal: true },
  { nombre: "GERENTE con permiso de tipeo", rol: "GERENTE", puedeCargarReal: true },
  { nombre: "GERENTE sin permiso de tipeo", rol: "GERENTE", puedeCargarReal: false },
] as const;

function escenarioDeRol(slug: string, r: (typeof ROLES)[number], periodo = "2026-11", marca?: string) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const adminOFinanzas = r.rol !== "GERENTE";
  const acceso = accesoReservadosDelReporte(veBloquesReservadosDelReporte({ rol: r.rol }), slug);
  const reporte = armarReporte(plantilla, mesesDePrueba(plantilla), 1, { verBloquesReservados: acceso });
  const edicion = edicionDelReporte({ periodo, marca, esAdminOFinanzas: adminOFinanzas, puedeCargarReal: r.puedeCargarReal });
  const dispComoSaldo = dispComoSaldoDelReporte({
    sinBloquesReservados: reporte.sinBloquesReservados,
    edicionTipeo: edicion.tipeo,
    empresaSlug: slug,
    entradaTipeo: () => ({
      plantilla,
      esAdminOFinanzas: adminOFinanzas,
      puedeCargarReal: r.puedeCargarReal,
      periodo,
      actual: periodo,
      semanas: ABIERTO,
      valoresReales: new Map(),
    }),
  });
  return { reporte, dispComoSaldo, acceso };
}

test("ADMIN y FINANZAS: ven todo y Disponibilidades nunca es «Saldo»", () => {
  for (const r of ROLES.filter((x) => x.rol !== "GERENTE")) {
    const e = escenarioDeRol("brillante", r);
    assert.equal(e.acceso, true, r.nombre);
    assert.equal(e.reporte.sinBloquesReservados, false, r.nombre);
    assert.equal(e.dispComoSaldo, false, r.nombre);
  }
});

test("GERENTE sin permiso de tipeo (empresa con Disponibilidades prendidas): Disponibilidades como «Saldo»", () => {
  const e = escenarioDeRol("brillante", ROLES[3]);
  assert.equal(e.reporte.sinBloquesReservados, true);
  assert.equal(e.dispComoSaldo, true);
  assert.ok(e.reporte.filas.some((f) => f.fila.bloque === "DISPONIBILIDADES"));
});

test("GERENTE con permiso de tipeo: ve Disponibilidades como un ADMIN (no «Saldo»), aunque el Reporte se armó sin acceso total", () => {
  const e = escenarioDeRol("brillante", ROLES[2]);
  assert.equal(e.reporte.sinBloquesReservados, true);
  assert.equal(e.dispComoSaldo, false);
});

test("GERENTE con permiso en el mes en curso visto como histórico (solo lectura): vuelve a «Saldo», como la pantalla", () => {
  const e = escenarioDeRol("brillante", ROLES[2], "2026-11", "anteriores");
  assert.equal(e.dispComoSaldo, true);
});

test("GERENTE con permiso en una empresa sin tipeo directo: «Saldo» (y no se arma el tipeo)", () => {
  const r = dispComoSaldoDelReporte({
    sinBloquesReservados: true,
    edicionTipeo: true,
    empresaSlug: "empresa-sin-tipeo",
    entradaTipeo: () => {
      throw new Error("no debe armar el tipeo");
    },
  });
  assert.equal(r, true);
});
