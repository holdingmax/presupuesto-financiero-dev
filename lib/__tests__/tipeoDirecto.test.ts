import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EMPRESAS_CON_TIPEO_DIRECTO,
  EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE,
} from "@/lib/config";
import { camposManuales } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import {
  armarVistaTipeo,
  camposTipeables,
  motivoRechazoTipeo,
  tipeoDirectoActivo,
  type InterruptoresTipeo,
} from "@/lib/reporte/tipeoDirecto";
import { CENTINELA, mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";

// Tipeo directo del Real manual en el Reporte (lib/reporte/tipeoDirecto.ts). Sin base ni sesión: todo lo
// que decide qué se edita, qué viaja a la pantalla y qué rechaza el servidor es puro.

const SLUGS = Object.keys(PLANTILLAS_POR_SLUG);
const BRILLANTE = PLANTILLAS_POR_SLUG["brillante"];
const VACIO: InterruptoresTipeo = { tipeo: [], disponibilidades: EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE };
const SOLO_FLUJO: InterruptoresTipeo = { tipeo: ["brillante"], disponibilidades: [] };
const CON_DISP: InterruptoresTipeo = { tipeo: ["brillante"], disponibilidades: ["brillante"] };

// Real manual de TODAS las filas manuales de Brillante: las de bloques reservados con el centinela.
function valoresDeBrillante(): Map<string, number> {
  return mesesDePrueba(BRILLANTE)[1].manuales!.real;
}

const CERRADO = { abiertas: 0, cerradas: 4 };
const ABIERTO = { abiertas: 1, cerradas: 0 };

// ---- Configuración -------------------------------------------------------------------------------

// Empresas con tipeo directo hoy: Brillante y la Tanda 1 (solo flujo). Fijada a propósito: activar otra empresa
// tiene que obligar a tocar este test.
const CON_TIPEO_HOY = ["brillante", "fredy-publicidad", "hwc", "avianor", "mantenor", "radio"];

test("config: el interruptor es Brillante + Tanda 1, sin repetidos y con plantilla", () => {
  assert.ok(EMPRESAS_CON_TIPEO_DIRECTO.includes("brillante"));
  assert.deepEqual([...EMPRESAS_CON_TIPEO_DIRECTO], CON_TIPEO_HOY);
  assert.equal(new Set(EMPRESAS_CON_TIPEO_DIRECTO).size, EMPRESAS_CON_TIPEO_DIRECTO.length);
  for (const slug of EMPRESAS_CON_TIPEO_DIRECTO) assert.ok(Object.hasOwn(PLANTILLAS_POR_SLUG, slug), slug);
});

test("subconjunto: toda empresa con celdas editables de Disponibilidades está en EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE", () => {
  const conCeldasDeDisp = SLUGS.filter((slug) =>
    camposTipeables(PLANTILLAS_POR_SLUG[slug], slug).some((c) => c.bloque === "DISPONIBILIDADES")
  );
  assert.ok(conCeldasDeDisp.length > 0, "con la configuración actual alguna empresa tiene que tenerlas");
  for (const slug of conCeldasDeDisp) {
    assert.ok(EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes(slug), `${slug} edita Disponibilidades sin verlas`);
  }
});

test("subconjunto: aunque el interruptor de tipeo esté prendido en TODAS, Disponibilidades solo se edita donde se ve", () => {
  const todas: InterruptoresTipeo = { tipeo: SLUGS, disponibilidades: EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE };
  for (const slug of SLUGS) {
    const conDisp = camposTipeables(PLANTILLAS_POR_SLUG[slug], slug, todas).some((c) => c.bloque === "DISPONIBILIDADES");
    assert.equal(conDisp, EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes(slug), slug);
  }
});

// ---- Qué se puede tipear -------------------------------------------------------------------------

test("Brillante: 11 de Disponibilidades + 5 de flujo, todas de la columna REAL y ninguna de Cierre", () => {
  const campos = camposTipeables(BRILLANTE, "brillante");
  assert.equal(campos.filter((c) => c.bloque === "DISPONIBILIDADES").length, 11);
  assert.deepEqual(
    campos.filter((c) => c.bloque !== "DISPONIBILIDADES").map((c) => c.clave),
    ["br.otrasOperacionesJujuy", "br.resultadoFci", "br.otroMsnt", "br.traspasoSaldoInicial", "br.recuperoGastos"]
  );
  assert.ok(campos.every((c) => c.columna === "REAL" && c.bloque !== "CIERRE"));
  // Ninguna fila "Sin Real" ni de Presupuestado manual entra.
  const claves = new Set(campos.map((c) => c.clave));
  assert.equal(claves.has("br.expensas"), false);
  assert.equal(claves.has("br.cobranzaChequeDiferido"), false);
});

test("sin Disponibilidades visibles, solo las 5 de flujo; sin interruptor, ninguna", () => {
  assert.equal(camposTipeables(BRILLANTE, "brillante", SOLO_FLUJO).length, 5);
  assert.equal(camposTipeables(BRILLANTE, "brillante", VACIO).length, 0);
  assert.equal(tipeoDirectoActivo("brillante", VACIO), false);
});

test("las empresas fuera del interruptor no tienen celdas editables", () => {
  const fuera = SLUGS.filter((s) => !EMPRESAS_CON_TIPEO_DIRECTO.includes(s));
  assert.ok(fuera.includes("havanna") && fuera.includes("conexion-logistica"), "sanidad: el recorrido no está vacío");
  for (const slug of fuera) {
    assert.deepEqual(camposTipeables(PLANTILLAS_POR_SLUG[slug], slug), [], slug);
  }
});

// ---- Vista que viaja a la pantalla ---------------------------------------------------------------

function vista(interruptores: InterruptoresTipeo, over: Partial<Parameters<typeof armarVistaTipeo>[0]> = {}) {
  return armarVistaTipeo({
    empresaSlug: "brillante",
    plantilla: BRILLANTE,
    esAdminOFinanzas: true,
    periodo: "2026-10",
    actual: "2026-10",
    semanas: ABIERTO,
    valoresReales: new Map(),
    interruptores,
    ...over,
  });
}

test("mes en curso: las 16 celdas son editables, sin aviso de una sola vez", () => {
  const v = vista(CON_DISP);
  assert.ok(v);
  assert.equal(v.celdas.length, 16);
  assert.ok(v.celdas.every((c) => c.importeInicial === "" && !c.avisoUnaVez));
});

test("el valor guardado viaja en formato argentino y la huella cambia con él", () => {
  const sinValor = vista(CON_DISP)!;
  const conValor = vista(CON_DISP, { valoresReales: new Map([["br.resultadoFci", 63534345]]) })!;
  assert.equal(conValor.celdas.find((c) => c.clave === "br.resultadoFci")!.importeInicial, "635.343,45");
  assert.notEqual(sinValor.huella, conValor.huella);
});

test("período cerrado: carga única — lo cargado queda afuera, lo vacío se puede cargar una vez", () => {
  const cargado = new Map([["br.resultadoFci", 100], ["br.dBancoFci", 200]]);
  const v = vista(CON_DISP, { periodo: "2026-09", semanas: CERRADO, valoresReales: cargado })!;
  const claves = v.celdas.map((c) => c.clave);
  assert.equal(claves.includes("br.resultadoFci"), false);
  assert.equal(claves.includes("br.dBancoFci"), false);
  assert.equal(v.celdas.length, 14);
  assert.ok(v.celdas.every((c) => c.avisoUnaVez && c.importeInicial === ""));
});

test("período cerrado con todo cargado: no queda ninguna celda editable (sin override de admin)", () => {
  const todo = new Map(camposTipeables(BRILLANTE, "brillante", CON_DISP).map((c) => [c.clave, 1]));
  assert.equal(vista(CON_DISP, { periodo: "2026-09", semanas: CERRADO, valoresReales: todo }), null);
});

test("mismas reglas de bloqueo de siempre: con semanas abiertas el flujo se edita, Disponibilidades no si ya hay cerradas", () => {
  const todo = new Map(camposTipeables(BRILLANTE, "brillante", CON_DISP).map((c) => [c.clave, 1]));
  const v = vista(CON_DISP, { periodo: "2026-09", semanas: { abiertas: 1, cerradas: 2 }, valoresReales: todo })!;
  assert.deepEqual(v.celdas.map((c) => c.clave), ["br.otrasOperacionesJujuy", "br.resultadoFci", "br.otroMsnt", "br.traspasoSaldoInicial", "br.recuperoGastos"]);
  assert.ok(v.celdas.every((c) => !c.avisoUnaVez));
});

test("sin Disponibilidades visibles la vista no lleva ninguna de ese bloque", () => {
  const v = vista(SOLO_FLUJO)!;
  assert.deepEqual(v.celdas.map((c) => c.clave), ["br.otrasOperacionesJujuy", "br.resultadoFci", "br.otroMsnt", "br.traspasoSaldoInicial", "br.recuperoGastos"]);
});

test("interruptor vacío: nadie recibe celdas, tampoco ADMIN (el Reporte queda como siempre)", () => {
  for (const slug of SLUGS) {
    for (const esAdminOFinanzas of [true, false]) {
      const v = armarVistaTipeo({
        empresaSlug: slug,
        plantilla: PLANTILLAS_POR_SLUG[slug],
        esAdminOFinanzas,
        periodo: "2026-10",
        actual: "2026-10",
        semanas: ABIERTO,
        valoresReales: mesesDePrueba(PLANTILLAS_POR_SLUG[slug])[1].manuales!.real,
        interruptores: VACIO,
      });
      assert.equal(v, null, `${slug} admin=${esAdminOFinanzas}`);
    }
  }
});

// ---- El gerente no recibe nada -------------------------------------------------------------------

test("gerente: ni celdas, ni claves, ni valores — con el centinela de Disponibilidades en los datos", () => {
  const datos = valoresDeBrillante();
  // Sanidad: el centinela está en los datos y a ADMIN SÍ le llegaría (si no, la prueba no detectaría una fuga).
  assert.ok([...datos.values()].some((v) => v >= CENTINELA));
  const admin = vista(CON_DISP, { valoresReales: datos });
  assert.match(JSON.stringify(admin), /70\.000\.000\.000,/);

  // Gerente, con el interruptor prendido en Brillante, con Disponibilidades visibles, en mes abierto y en cerrado.
  for (const semanas of [ABIERTO, CERRADO]) {
    for (const interruptores of [CON_DISP, SOLO_FLUJO, undefined]) {
      const v = vista(interruptores as InterruptoresTipeo, { esAdminOFinanzas: false, valoresReales: datos, semanas });
      assert.equal(v, null);
      const json = JSON.stringify(v);
      assert.equal(json, "null");
      assert.equal(/7000000000\d{3}|70\.000\.000\.000|br\.d[A-Z]/.test(json), false);
    }
  }
});

test("gerente: ninguna plantilla le arma vista, con la configuración real", () => {
  for (const slug of SLUGS) {
    const v = armarVistaTipeo({
      empresaSlug: slug,
      plantilla: PLANTILLAS_POR_SLUG[slug],
      esAdminOFinanzas: false,
      periodo: "2026-10",
      actual: "2026-10",
      semanas: ABIERTO,
      valoresReales: mesesDePrueba(PLANTILLAS_POR_SLUG[slug])[1].manuales!.real,
    });
    assert.equal(v, null, slug);
  }
});

// ---- Rechazo del servidor ------------------------------------------------------------------------

const ENTRADA = { filaClave: "br.resultadoFci", columna: "REAL" as const, texto: "1.000,00" };
const base = { empresaSlug: "brillante", plantilla: BRILLANTE, esAdminOFinanzas: true, interruptores: CON_DISP };

test("servidor: el gerente es rechazado, aunque mande una clave válida", () => {
  assert.match(motivoRechazoTipeo({ ...base, esAdminOFinanzas: false, entradas: [ENTRADA] })!, /ADMIN y FINANZAS/);
  const disp = { filaClave: "br.dBancoFci", columna: "REAL" as const, texto: "7000000000000" };
  assert.ok(motivoRechazoTipeo({ ...base, esAdminOFinanzas: false, entradas: [disp] }));
});

test("servidor: ADMIN y FINANZAS pasan con una celda tipeable", () => {
  assert.equal(motivoRechazoTipeo({ ...base, entradas: [ENTRADA] }), null);
  assert.equal(motivoRechazoTipeo({ ...base, entradas: [{ ...ENTRADA, filaClave: "br.dBancoFci" }] }), null);
});

test("servidor: empresa fuera del interruptor, columna P, clave ajena o de Cierre se rechazan", () => {
  assert.ok(motivoRechazoTipeo({ ...base, interruptores: VACIO, entradas: [ENTRADA] }));
  assert.ok(motivoRechazoTipeo({ ...base, empresaSlug: "havanna", plantilla: PLANTILLAS_POR_SLUG["havanna"], entradas: [ENTRADA] }));
  assert.ok(motivoRechazoTipeo({ ...base, entradas: [{ ...ENTRADA, columna: "PRESUPUESTADO" }] }));
  assert.ok(motivoRechazoTipeo({ ...base, entradas: [{ ...ENTRADA, filaClave: "br.sueldos" }] }), "fila calculada");
  assert.ok(motivoRechazoTipeo({ ...base, entradas: [{ ...ENTRADA, filaClave: "br.expensas" }] }), "fila sin Real");
  assert.ok(motivoRechazoTipeo({ ...base, entradas: [{ ...ENTRADA, filaClave: "br.capital" }] }), "Cierre");
  assert.ok(motivoRechazoTipeo({ ...base, entradas: [{ ...ENTRADA, filaClave: "no.existe" }] }));
});

test("servidor: Disponibilidades se rechaza si la empresa no las ve", () => {
  const disp = { ...ENTRADA, filaClave: "br.dBancoFci" };
  assert.ok(motivoRechazoTipeo({ ...base, interruptores: SOLO_FLUJO, entradas: [disp] }));
  assert.equal(motivoRechazoTipeo({ ...base, interruptores: SOLO_FLUJO, entradas: [ENTRADA] }), null);
});

test("servidor: una sola entrada inválida frena todo el lote", () => {
  assert.ok(motivoRechazoTipeo({ ...base, entradas: [ENTRADA, { ...ENTRADA, filaClave: "br.sueldos" }] }));
});

// La acción de servidor no se puede ejecutar sin sesión: se comprueba que exige ADMIN/FINANZAS ANTES de
// cualquier otra cosa y que el guardado es el de siempre (guardarValoresManuales, sin tocar).
test("acción del tipeo: pide requireAdminOFinanzas primero y delega en guardarValoresManuales", () => {
  const fuente = readFileSync(new URL("../../app/[empresa]/[periodo]/reporte/actionsTipeo.ts", import.meta.url), "utf-8");
  const exige = fuente.indexOf("await requireAdminOFinanzas()");
  const guarda = fuente.indexOf("return guardarValoresManuales(");
  assert.ok(exige > 0 && guarda > exige);
  assert.ok(fuente.indexOf("motivoRechazoTipeo(") > exige && fuente.indexOf("motivoRechazoTipeo(") < guarda);
});

test("/reporte/carga no depende del tipeo directo (queda como estaba)", () => {
  for (const archivo of ["carga/page.tsx", "carga/actions.ts", "carga/CargaValoresManuales.tsx"]) {
    const fuente = readFileSync(new URL(`../../app/[empresa]/[periodo]/reporte/${archivo}`, import.meta.url), "utf-8");
    assert.equal(/tipeoDirecto|TipeoDirecto|EMPRESAS_CON_TIPEO/.test(fuente), false, archivo);
  }
});

// La pantalla de carga sigue ofreciendo los mismos campos manuales que antes.
test("camposManuales: Brillante tiene 16 campos de Real (11 de Disponibilidades y 5 de flujo)", () => {
  const campos = camposManuales(BRILLANTE);
  assert.equal(campos.filter((c) => c.columna === "REAL").length, 16);
});
