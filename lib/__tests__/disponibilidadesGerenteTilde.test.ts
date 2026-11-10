import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE,
  EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE,
} from "@/lib/config";
import { camposRealDelGerente } from "@/lib/reporte/camposRealGerente";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { armarReporte, type FilaReporte } from "@/lib/reporte/motor";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { armarVistaTipeo, camposTipeables, disponibilidadesComoSaldo, motivoRechazoTipeo } from "@/lib/reporte/tipeoDirecto";

// Segunda tanda: el gerente con permiso de cargar el Real ve y carga Disponibilidades como un ADMIN (columna P y la R con
// el input), no como el «Saldo» de solo lectura. Havanna Perú pasa a ver su (única) fila de Disponibilidades.

const ABIERTO = { abiertas: 1, cerradas: 0 };
const CERRADO = { abiertas: 0, cerradas: 4 };

function vista(slug: string, over: Partial<Parameters<typeof armarVistaTipeo>[0]> = {}) {
  return armarVistaTipeo({
    empresaSlug: slug,
    plantilla: PLANTILLAS_POR_SLUG[slug],
    esAdminOFinanzas: false,
    puedeCargarReal: true,
    periodo: "2026-11",
    actual: "2026-11",
    semanas: ABIERTO,
    valoresReales: new Map(),
    ...over,
  });
}
const claveDisp = (slug: string) =>
  PLANTILLAS_POR_SLUG[slug].filas.filter((f) => f.tipo === "linea" && f.bloque === "DISPONIBILIDADES").map((f) => f.clave);

// ---- Gerente con permiso ----------------------------------------------------------------------------------------------

test("gerente con tilde en Plate Silver y Bradenton: recibe el input de cada fila de Disponibilidades, y el bloque no es «Saldo»", () => {
  for (const slug of ["plate-silver", "bradenton"]) {
    const v = vista(slug);
    assert.ok(v, slug);
    const ids = new Set(v.celdas.map((c) => c.id));
    const filas = claveDisp(slug);
    assert.ok(filas.length >= 2, `${slug}: sanidad`);
    for (const clave of filas) assert.ok(ids.has(`${clave}|REAL`), `${slug} ${clave}`);
    assert.equal(v.disponibilidades, true, slug);
    assert.equal(disponibilidadesComoSaldo(true, v), false, `${slug}: se ve como ADMIN (P y R)`);
  }
});

test("gerente SIN tilde: ni celdas ni vista, y Disponibilidades sigue como «Saldo» de solo lectura", () => {
  for (const slug of ["plate-silver", "bradenton", "havanna-peru"]) {
    const v = vista(slug, { puedeCargarReal: false });
    assert.equal(v, null, slug);
    assert.equal(disponibilidadesComoSaldo(true, v), true, slug);
  }
});

test("el servidor acepta el Real de Disponibilidades del gerente con tilde y lo rechaza sin tilde", () => {
  const entrada = [{ filaClave: claveDisp("plate-silver")[0], columna: "REAL" as const, texto: "100" }];
  const base = { empresaSlug: "plate-silver", plantilla: PLANTILLAS_POR_SLUG["plate-silver"], esAdminOFinanzas: false, entradas: entrada };
  assert.equal(motivoRechazoTipeo({ ...base, puedeCargarReal: true }), null);
  assert.notEqual(motivoRechazoTipeo({ ...base, puedeCargarReal: false }), null);
});

test("el bloque no cambia de formato a mitad de camino: en un mes cerrado con valores cargados sigue siendo el de ADMIN", () => {
  const claves = claveDisp("plate-silver");
  // Todas las filas de Disponibilidades ya tienen valor en un mes cerrado: ninguna celda editable de ese bloque...
  const v = vista("plate-silver", {
    periodo: "2026-10",
    actual: "2026-11",
    semanas: CERRADO,
    valoresReales: new Map(claves.map((c) => [c, 100])),
  });
  assert.ok(v);
  assert.ok(!v.celdas.some((c) => claves.includes(c.clave)), "bloqueo de octubre intacto: lo cargado no se ofrece");
  // ...pero el bloque se sigue dibujando con P y R, no se vuelve «Saldo».
  assert.equal(v.disponibilidades, true);
});

// ---- ADMIN / FINANZAS -------------------------------------------------------------------------------------------------

test("ADMIN y FINANZAS: mismas celdas de siempre (con Presupuestado), y para ellos el Reporte nunca fue «Saldo»", () => {
  const v = vista("plate-silver", { esAdminOFinanzas: true, puedeCargarReal: undefined });
  assert.ok(v);
  const ids = v.celdas.map((c) => c.id);
  for (const clave of claveDisp("plate-silver")) assert.ok(ids.includes(`${clave}|REAL`), clave);
  // Sin acceso reducido (sinBloquesReservados = false) el bloque no es «Saldo», tenga o no tipeo.
  assert.equal(disponibilidadesComoSaldo(false, v), false);
  assert.equal(disponibilidadesComoSaldo(false, null), false);
});

// ---- Empresas que no ven Disponibilidades -----------------------------------------------------------------------------

test("empresa que no ve Disponibilidades: sin celdas de ese bloque y el formato no cambia", () => {
  const fuera = ["conexion-logistica-spp"].filter((s) => PLANTILLAS_POR_SLUG[s]);
  assert.ok(fuera.length > 0, "sanidad");
  for (const slug of fuera) {
    assert.ok(!EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes(slug), slug);
    const v = vista(slug);
    assert.ok(v, slug);
    assert.equal(v.disponibilidades, false, slug);
    assert.ok(!v.celdas.some((c) => claveDisp(slug).includes(c.clave)), slug);
    assert.equal(disponibilidadesComoSaldo(true, v), true, slug);
  }
  // Con una empresa que sí las ve pero apagadas por el interruptor pasado a mano, lo mismo.
  const v = vista("plate-silver", { interruptores: { tipeo: ["plate-silver"], disponibilidades: [] } });
  assert.ok(v);
  assert.equal(v.disponibilidades, false);
});

test("disponibilidadesComoSaldo: tabla completa", () => {
  assert.equal(disponibilidadesComoSaldo(true, null), true);
  assert.equal(disponibilidadesComoSaldo(true, { disponibilidades: false }), true);
  assert.equal(disponibilidadesComoSaldo(true, { disponibilidades: true }), false);
  assert.equal(disponibilidadesComoSaldo(false, { disponibilidades: false }), false);
});

// ---- Havanna Perú -----------------------------------------------------------------------------------------------------

test("Havanna Perú: ve Disponibilidades (su única fila, EFECTIVO DISPONIBLE) pero NO Cierre", () => {
  assert.ok(EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes("havanna-peru"));
  assert.ok(!EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE.includes("havanna-peru"));
  assert.deepEqual(claveDisp("havanna-peru"), ["hp.dEfectivo"]);
  assert.deepEqual(accesoReservadosDelReporte(false, "havanna-peru"), { disponibilidades: true, cierre: false });
});

test("Havanna Perú: el gerente con tilde carga hp.dEfectivo desde el Reporte y desde /reporte/carga; sin Presupuestado", () => {
  const plantilla = PLANTILLAS_POR_SLUG["havanna-peru"];
  assert.ok(camposTipeables(plantilla, "havanna-peru").some((c) => c.clave === "hp.dEfectivo" && c.columna === "REAL"));
  assert.ok(camposRealDelGerente(plantilla, "havanna-peru").some((c) => c.clave === "hp.dEfectivo"));
  const v = vista("havanna-peru");
  assert.ok(v && v.disponibilidades && v.celdas.some((c) => c.id === "hp.dEfectivo|REAL"));
  assert.ok(v.celdas.every((c) => c.columna === "REAL"));
  // Cierre (Disponible antes de gastos, Posición, Capital, Excedente) no abre celdas.
  assert.ok(!v.celdas.some((c) => c.clave === "hp.capital" || c.clave === "hp.saldo" || c.clave === "hp.excedente"));
});

test("Havanna Perú: el bloqueo de octubre de Disponibilidades rige igual (mes pasado con semanas cerradas)", () => {
  const v = vista("havanna-peru", {
    periodo: "2026-10",
    actual: "2026-11",
    semanas: CERRADO,
    valoresReales: new Map([["hp.dEfectivo", 5000]]),
  });
  assert.ok(v);
  assert.ok(!v.celdas.some((c) => c.id === "hp.dEfectivo|REAL"));
  const vacio = vista("havanna-peru", { periodo: "2026-10", actual: "2026-11", semanas: CERRADO });
  assert.ok(vacio?.celdas.some((c) => c.id === "hp.dEfectivo|REAL" && c.avisoUnaVez));
});

// ---- Pantalla ---------------------------------------------------------------------------------------------------------

test("pantalla: el «Saldo» se decide con disponibilidadesComoSaldo (permiso de tipear), no solo con sinBloquesReservados", () => {
  const f = readFileSync(new URL("../../app/[empresa]/[periodo]/reporte/ReportePlantilla.tsx", import.meta.url), "utf-8").replace(/\r\n/g, "\n");
  assert.match(f, /const dispComoSaldo = disponibilidadesComoSaldo\(reporte\.sinBloquesReservados, tipeo\);/);
  assert.match(f, /soloSaldo=\{dispComoSaldo\}/);
  assert.match(f, /dispComoSaldo=\{dispComoSaldo\}/);
  assert.ok(!/soloSaldo=\{reporte\.sinBloquesReservados\}/.test(f));
  // El resto de la decisión (título «Saldo», total y celdas) sigue colgando de ese mismo flag.
  assert.match(f, /const enSaldo = soloSaldo && fila\.bloque === "DISPONIBILIDADES";/);
});

// ---- Render real de FilaTabla (como el gerente con y sin permiso) ---------------------------------------------------------

// El componente importa next/font y el tipeo usa next/navigation, que no corren fuera de Next: se reemplazan solo en este proceso.
const req = createRequire(import.meta.url);
function reemplazar(modulo: string, exports: Record<string, unknown>) {
  const ruta = req.resolve(modulo);
  req.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports } as unknown as NodeJS.Module;
}
reemplazar("next/font/google", { Poppins: () => ({ variable: "", className: "" }) });
reemplazar("next/navigation", { useRouter: () => ({ refresh() {}, push() {} }) });

async function dibujar(slug: string, fila: FilaReporte, opciones: { soloSaldo: boolean; conTipeo: boolean }): Promise<string> {
  const { FilaTabla } = await import("@/app/[empresa]/[periodo]/reporte/ReportePlantilla");
  const { ProveedorTipeo } = await import("@/app/[empresa]/[periodo]/reporte/TipeoDirecto");
  const v = vista(slug)!;
  const tabla = createElement(
    "table",
    null,
    createElement(
      "tbody",
      null,
      createElement(FilaTabla, {
        filaReporte: fila,
        meses: 1,
        verPendientes: false,
        verControl: false,
        carga: null,
        idsEditables: new Set<string>(),
        idsTipeables: new Set<string>(opciones.conTipeo ? v.celdas.map((c) => c.id) : []),
        borrable: false,
        empresaSlug: slug,
        periodo: "2026-11",
        soloLecturaPorMes: [false],
        soloSaldo: opciones.soloSaldo,
      })
    )
  );
  return renderToStaticMarkup(
    createElement(ProveedorTipeo, { empresaSlug: slug, periodo: "2026-11", celdas: v.celdas, huella: v.huella, children: tabla })
  );
}

function filaDe(slug: string, clave: string): FilaReporte {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const r = armarReporte(plantilla, mesesDePrueba(plantilla), 1, { verBloquesReservados: accesoReservadosDelReporte(false, slug) });
  return r.filas.find((f) => f.fila.clave === clave)!;
}

test("render: gerente con tilde en Plate Silver ve la fila de Disponibilidades con P y con el input en R (no «Saldo»)", async () => {
  const clave = claveDisp("plate-silver")[0];
  const f = filaDe("plate-silver", clave);
  const html = await dibujar("plate-silver", f, { soloSaldo: disponibilidadesComoSaldo(true, vista("plate-silver")), conTipeo: true });
  assert.match(html, /<input[^>]*aria-label="Real: /);
  const celdas = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert.ok(celdas[1].replace(/<[^>]+>/g, "").trim() !== "", "P con el valor, como lo ve un ADMIN");
  assert.ok(!celdas[1].includes("<input"), "el input va en R, no en P");
  assert.ok(celdas[2].includes("<input"));
});

test("render: el título del bloque no dice «Saldo» cuando el gerente tipea, y sí cuando no", async () => {
  const titulo = filaDe("plate-silver", PLANTILLAS_POR_SLUG["plate-silver"].filas.find((f) => f.tipo === "titulo" && f.bloque === "DISPONIBILIDADES")!.clave);
  const conTilde = await dibujar("plate-silver", titulo, { soloSaldo: disponibilidadesComoSaldo(true, vista("plate-silver")), conTipeo: true });
  const sinTilde = await dibujar("plate-silver", titulo, { soloSaldo: disponibilidadesComoSaldo(true, null), conTipeo: false });
  assert.ok(!conTilde.includes("Saldo"));
  assert.ok(sinTilde.includes("Saldo"));
});

test("render: sin tilde la fila sigue siendo el saldo de solo lectura, sin input", async () => {
  const f = filaDe("plate-silver", claveDisp("plate-silver")[0]);
  const html = await dibujar("plate-silver", f, { soloSaldo: disponibilidadesComoSaldo(true, null), conTipeo: false });
  assert.ok(!html.includes("<input"));
});
