import { test } from "node:test";
import assert from "node:assert/strict";
import { PERIODOS_HABILITADOS, PERIODO_EN_CARGA_GERENTE, PERIODO_INICIO_HISTORIAL } from "@/lib/config";
import {
  avisoMesEnCursoEnHistorial,
  cantidadDeMeses,
  consultaDeBotonDeMes,
  edicionDelReporte,
  enlaceDeVista,
  enlacesDeModo,
  esHistorialDelMesEnCurso,
  mesesAnteriores,
  modoDePeriodo,
  resolverVista,
  vistaEfectiva,
  vistaPorDefecto,
} from "@/lib/reporte/vistaReporte";
import { enlacesDePeriodos } from "@/lib/periodosHabilitados";

test("config: PERIODOS_HABILITADOS no cambió y el inicio del historial es anterior al mes en curso", () => {
  assert.deepEqual([...PERIODOS_HABILITADOS], ["2026-09", "2026-10", "2026-11"]);
  assert.equal(PERIODO_INICIO_HISTORIAL, "2026-09");
  assert.ok(PERIODO_INICIO_HISTORIAL < PERIODO_EN_CARGA_GERENTE);
  assert.match(PERIODO_INICIO_HISTORIAL, /^\d{4}-(0[1-9]|1[0-2])$/);
});

test("modoDePeriodo: el mes en curso y los posteriores son «en-curso»; los anteriores, «anteriores»", () => {
  assert.equal(modoDePeriodo("2026-11", "2026-11"), "en-curso");
  assert.equal(modoDePeriodo("2026-12", "2026-11"), "en-curso");
  assert.equal(modoDePeriodo("2027-01", "2026-11"), "en-curso");
  assert.equal(modoDePeriodo("2026-10", "2026-11"), "anteriores");
  assert.equal(modoDePeriodo("2026-09", "2026-11"), "anteriores");
  assert.equal(modoDePeriodo("2025-12", "2026-01"), "anteriores");
  assert.equal(modoDePeriodo(PERIODO_EN_CARGA_GERENTE), "en-curso"); // usa PERIODO_EN_CARGA_GERENTE
});

test("mesesAnteriores: desde el inicio hasta el mes en curso INCLUSIVE, en orden", () => {
  assert.deepEqual(mesesAnteriores("2026-09", "2026-11"), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(mesesAnteriores("2026-07", "2026-11"), ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(mesesAnteriores("2026-10", "2026-11"), ["2026-10", "2026-11"]);
});

test("mesesAnteriores: con la rotación del mes en curso la lista crece y cruza de año", () => {
  assert.deepEqual(mesesAnteriores("2026-09", "2026-12"), ["2026-09", "2026-10", "2026-11", "2026-12"]);
  assert.deepEqual(mesesAnteriores("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
});

test("mesesAnteriores: vacía si el inicio no es anterior al mes en curso (sin ningún mes previo no hay historial)", () => {
  assert.deepEqual(mesesAnteriores("2026-11", "2026-11"), []);
  assert.deepEqual(mesesAnteriores("2026-12", "2026-11"), []);
});

test("mesesAnteriores: con la config real termina en el mes en curso y los demás son anteriores", () => {
  const meses = mesesAnteriores();
  assert.deepEqual(meses, ["2026-09", "2026-10", "2026-11"]);
  assert.equal(meses[meses.length - 1], PERIODO_EN_CARGA_GERENTE);
  for (const m of meses.slice(0, -1)) assert.equal(modoDePeriodo(m), "anteriores", m);
  // Sin la marca, el mes en curso sigue siendo «en-curso» aunque esté en la lista.
  assert.equal(modoDePeriodo(PERIODO_EN_CARGA_GERENTE), "en-curso");
});

test("vistaPorDefecto: un solo mes para todos los roles", () => {
  assert.equal(vistaPorDefecto(true), "actual");
  assert.equal(vistaPorDefecto(false), "actual");
});

test("vistaEfectiva: en el mes en curso (o posterior) «todo» se ignora; en anteriores se respeta", () => {
  assert.equal(vistaEfectiva("todo", "2026-11", "2026-11"), "actual");
  assert.equal(vistaEfectiva("todo", "2026-12", "2026-11"), "actual");
  assert.equal(vistaEfectiva("actual", "2026-11", "2026-11"), "actual");
  assert.equal(vistaEfectiva("todo", "2026-10", "2026-11"), "todo");
  assert.equal(vistaEfectiva("actual", "2026-10", "2026-11"), "actual");
});

test("links viejos: ?vista=actual y ?vista=todo siguen siendo valores válidos", () => {
  assert.equal(resolverVista("actual", true), "actual");
  assert.equal(resolverVista("todo", false), "todo");
});

test("enlacesDeModo: «Mes en curso» va al período en curso sin parámetros; «Todos los meses», al mes en curso con la marca", () => {
  const e = enlacesDeModo("brillante", "2026-11", "2026-11", "2026-09");
  assert.deepEqual(
    e.map((x) => [x.texto, x.href]),
    [
      ["Mes en curso", "/brillante/2026-11/reporte"],
      ["Todos los meses", "/brillante/2026-11/reporte?modo=anteriores"],
    ]
  );
});

test("enlacesDeModo: marca el modo que se está viendo, deducido del período", () => {
  const activo = (periodo: string) =>
    enlacesDeModo("hwc", periodo, "2026-11", "2026-09").filter((x) => x.activo).map((x) => x.modo);
  assert.deepEqual(activo("2026-11"), ["en-curso"]);
  assert.deepEqual(activo("2026-12"), ["en-curso"]);
  assert.deepEqual(activo("2026-10"), ["anteriores"]);
  assert.deepEqual(activo("2026-09"), ["anteriores"]);
});

test("enlacesDeModo: «Todos los meses» aterriza en el mes en curso (noviembre) con la marca, se mire el período que se mire; «Mes en curso» nunca lleva marca", () => {
  for (const periodo of ["2026-09", "2026-10", "2026-11"]) {
    const e = enlacesDeModo("brillante", periodo, "2026-11", "2026-09");
    assert.equal(e.find((x) => x.modo === "anteriores")!.href, "/brillante/2026-11/reporte?modo=anteriores", periodo);
    assert.equal(e.find((x) => x.modo === "en-curso")!.href, "/brillante/2026-11/reporte", periodo);
  }
  // Con la rotación a diciembre aterriza en diciembre, con la marca de diciembre.
  const r = enlacesDeModo("brillante", "2026-12", "2026-12", "2026-09");
  assert.equal(r.find((x) => x.modo === "anteriores")!.href, "/brillante/2026-12/reporte?modo=anteriores");
});

test("enlacesDeModo: el texto del botón es «Todos los meses» y «Meses anteriores» ya no aparece", () => {
  const e = enlacesDeModo("brillante", "2026-11", "2026-11", "2026-09");
  assert.deepEqual(e.map((x) => x.texto), ["Mes en curso", "Todos los meses"]);
  assert.ok(e.every((x) => !x.texto.includes("Meses anteriores")));
});

test("la marca va solo cuando el href apunta al mes en curso: ningún link a otro mes la lleva", () => {
  const meses = mesesAnteriores("2026-09", "2026-11");
  for (const href of enlacesDePeriodos("hwc", "2026-10", meses, "reporte", undefined, (p) => consultaDeBotonDeMes(p, "2026-11")).map((x) => x.href)) {
    assert.equal(href.includes("modo=anteriores"), href.includes("/2026-11/"), href);
  }
});

test("«Todos los meses» → noviembre en solo lectura: modo «anteriores», sin piezas editables y «Un mes» por defecto, para todos los roles", () => {
  const href = enlacesDeModo("brillante", "2026-10", "2026-11", "2026-09").find((x) => x.modo === "anteriores")!.href;
  const url = new URL(href, "http://x");
  const [, , periodo] = url.pathname.split("/");
  const marca = url.searchParams.get("modo") ?? undefined;
  assert.equal(periodo, "2026-11");
  assert.equal(modoDePeriodo(periodo, "2026-11", marca), "anteriores");
  assert.equal(vistaEfectiva(resolverVista(url.searchParams.get("vista") ?? undefined, false), periodo, "2026-11", marca), "actual");
  for (const esAdminOFinanzas of [false, true]) {
    assert.deepEqual(
      edicionDelReporte({ periodo, marca, esAdminOFinanzas, enCarga: "2026-11" }),
      { historial: true, flujo: false, carga: false, tipeo: false, filasExtra: false, linkCarga: false },
      `admin/finanzas=${esAdminOFinanzas}`
    );
  }
  // Desde ahí «Columnas juntas» conserva la marca y el gerente ve los tres meses.
  assert.equal(enlaceDeVista("brillante", periodo, "todo", marca, "2026-11"), "/brillante/2026-11/reporte?vista=todo&modo=anteriores");
  assert.equal(vistaEfectiva("todo", periodo, "2026-11", marca), "todo");
  assert.equal(cantidadDeMeses("todo", "2026-11", false, PERIODOS_HABILITADOS), 3);
});

test("«Mes en curso»: sin parámetros, inactivo con la marca y activo sin ella", () => {
  const sinMarca = enlacesDeModo("hwc", "2026-11", "2026-11", "2026-09");
  const conMarca = enlacesDeModo("hwc", "2026-11", "2026-11", "2026-09", "anteriores");
  assert.equal(sinMarca.find((x) => x.modo === "en-curso")!.href, "/hwc/2026-11/reporte");
  assert.equal(conMarca.find((x) => x.modo === "en-curso")!.href, "/hwc/2026-11/reporte");
  assert.equal(sinMarca.find((x) => x.modo === "en-curso")!.activo, true);
  assert.equal(conMarca.find((x) => x.modo === "en-curso")!.activo, false);
  assert.equal(conMarca.find((x) => x.modo === "anteriores")!.activo, true);
});

test("enlacesDeModo: con la marca válida en el mes en curso, «Todos los meses» queda activo y «Mes en curso» no", () => {
  const e = enlacesDeModo("hwc", "2026-11", "2026-11", "2026-09", "anteriores");
  assert.deepEqual(e.filter((x) => x.activo).map((x) => x.modo), ["anteriores"]);
  assert.equal(e.find((x) => x.modo === "en-curso")!.href, "/hwc/2026-11/reporte");
});

test("enlacesDeModo: la marca se ignora en otro período (no cambia el modo deducido)", () => {
  const activo = (periodo: string, marca: string) =>
    enlacesDeModo("hwc", periodo, "2026-11", "2026-09", marca).filter((x) => x.activo).map((x) => x.modo);
  assert.deepEqual(activo("2026-12", "anteriores"), ["en-curso"]);
  assert.deepEqual(activo("2026-10", "anteriores"), ["anteriores"]);
});

test("enlacesDeModo: sin meses anteriores solo queda «Mes en curso»", () => {
  const e = enlacesDeModo("hwc", "2026-11", "2026-11", "2026-11");
  assert.deepEqual(e.map((x) => x.modo), ["en-curso"]);
});

test("botones de mes: salen de mesesAnteriores, conservan la vista y marcan el mes visto", () => {
  const enlaces = enlacesDePeriodos("brillante", "2026-10", mesesAnteriores("2026-07", "2026-11"), "reporte", "todo");
  assert.deepEqual(
    enlaces.map((x) => x.href),
    [
      "/brillante/2026-07/reporte?vista=todo",
      "/brillante/2026-08/reporte?vista=todo",
      "/brillante/2026-09/reporte?vista=todo",
      "/brillante/2026-10/reporte?vista=todo",
      "/brillante/2026-11/reporte?vista=todo", // sin consultaExtra no lleva marca
    ]
  );
  assert.deepEqual(enlaces.filter((x) => x.activo).map((x) => x.periodo), ["2026-10"]);
});

test("cantidadDeMeses con el historial: el gerente en «todo» nunca pasa de los meses disponibles", () => {
  const meses = mesesAnteriores();
  meses.forEach((m, i) => {
    assert.equal(cantidadDeMeses("todo", m, false, PERIODOS_HABILITADOS), Math.min(3, i + 1), m);
    assert.equal(cantidadDeMeses("actual", m, false, PERIODOS_HABILITADOS), 1, m);
  });
});

// --- Mes en curso visto desde «Todos los meses» (?modo=anteriores) ---

test("marca ?modo=anteriores: válida solo en el mes en curso y solo con el valor exacto", () => {
  assert.equal(esHistorialDelMesEnCurso("2026-11", "anteriores", "2026-11"), true);
  assert.equal(esHistorialDelMesEnCurso(PERIODO_EN_CARGA_GERENTE, "anteriores"), true); // usa la config
  for (const marca of [undefined, "", "Anteriores", "ANTERIORES", "en-curso", " anteriores", "anteriores "]) {
    assert.equal(esHistorialDelMesEnCurso("2026-11", marca, "2026-11"), false, JSON.stringify(marca));
  }
  assert.equal(esHistorialDelMesEnCurso("2026-11", ["anteriores"], "2026-11"), false);
  assert.equal(esHistorialDelMesEnCurso("2026-11", ["anteriores", "anteriores"], "2026-11"), false);
});

test("marca ?modo=anteriores: en cualquier otro período se ignora", () => {
  for (const p of ["2026-09", "2026-10", "2026-12", "2027-01", "2026-08", "2026-1", " 2026-11", "2026-11-01", ""]) {
    assert.equal(esHistorialDelMesEnCurso(p, "anteriores", "2026-11"), false, JSON.stringify(p));
  }
});

test("modoDePeriodo y vistaEfectiva con la marca: el mes en curso pasa a «anteriores» y admite «todo»; otros períodos no cambian", () => {
  assert.equal(modoDePeriodo("2026-11", "2026-11", "anteriores"), "anteriores");
  assert.equal(modoDePeriodo("2026-11", "2026-11", undefined), "en-curso");
  assert.equal(modoDePeriodo("2026-11", "2026-11", "basura"), "en-curso");
  assert.equal(modoDePeriodo("2026-12", "2026-11", "anteriores"), "en-curso");
  assert.equal(modoDePeriodo("2026-10", "2026-11", "anteriores"), "anteriores");
  assert.equal(modoDePeriodo("2026-10", "2026-11"), "anteriores");
  assert.equal(vistaEfectiva("todo", "2026-11", "2026-11", "anteriores"), "todo");
  assert.equal(vistaEfectiva("actual", "2026-11", "2026-11", "anteriores"), "actual");
  assert.equal(vistaEfectiva("todo", "2026-11", "2026-11"), "actual"); // «Mes en curso» no cambia
  assert.equal(vistaEfectiva("todo", "2026-12", "2026-11", "anteriores"), "actual"); // marca ignorada
});

test("botones de mes: solo el del mes en curso lleva la marca; septiembre y octubre quedan como hoy", () => {
  assert.equal(consultaDeBotonDeMes("2026-09", "2026-11"), "");
  assert.equal(consultaDeBotonDeMes("2026-10", "2026-11"), "");
  assert.equal(consultaDeBotonDeMes("2026-11", "2026-11"), "modo=anteriores");
  const meses = mesesAnteriores("2026-09", "2026-11");
  const extra = (p: string) => consultaDeBotonDeMes(p, "2026-11");
  assert.deepEqual(
    enlacesDePeriodos("brillante", "2026-10", meses, "reporte", undefined, extra).map((x) => x.href),
    ["/brillante/2026-09/reporte", "/brillante/2026-10/reporte", "/brillante/2026-11/reporte?modo=anteriores"]
  );
  assert.deepEqual(
    enlacesDePeriodos("brillante", "2026-10", meses, "reporte", "todo", extra).map((x) => x.href),
    [
      "/brillante/2026-09/reporte?vista=todo",
      "/brillante/2026-10/reporte?vista=todo",
      "/brillante/2026-11/reporte?vista=todo&modo=anteriores",
    ]
  );
});

test("«Un mes | Columnas juntas»: conservan la marca solo en la vista histórica del mes en curso", () => {
  assert.equal(enlaceDeVista("hwc", "2026-11", "todo", "anteriores", "2026-11"), "/hwc/2026-11/reporte?vista=todo&modo=anteriores");
  assert.equal(enlaceDeVista("hwc", "2026-11", "actual", "anteriores", "2026-11"), "/hwc/2026-11/reporte?vista=actual&modo=anteriores");
  assert.equal(enlaceDeVista("hwc", "2026-10", "todo", "anteriores", "2026-11"), "/hwc/2026-10/reporte?vista=todo");
  assert.equal(enlaceDeVista("hwc", "2026-10", "todo", undefined, "2026-11"), "/hwc/2026-10/reporte?vista=todo");
  assert.equal(enlaceDeVista("hwc", "2026-12", "todo", "anteriores", "2026-11"), "/hwc/2026-12/reporte?vista=todo");
});

test("vista histórica del mes en curso: ningún rol (gerente, FINANZAS, ADMIN) recibe celdas de edición, flujo ni link de carga", () => {
  // esAdminOFinanzas es lo único que distingue los roles (FINANZAS y ADMIN comparten la rama).
  for (const esAdminOFinanzas of [false, true]) {
    assert.deepEqual(
      edicionDelReporte({ periodo: "2026-11", marca: "anteriores", esAdminOFinanzas, enCarga: "2026-11" }),
      { historial: true, flujo: false, carga: false, tipeo: false, filasExtra: false, linkCarga: false },
      `admin/finanzas=${esAdminOFinanzas}`
    );
  }
});

test("«Mes en curso» (sin marca) no cambia: el gerente carga y opera el flujo; ADMIN y FINANZAS además tipean, agregan filas y ven el link", () => {
  assert.deepEqual(edicionDelReporte({ periodo: "2026-11", marca: undefined, esAdminOFinanzas: false, enCarga: "2026-11" }), {
    historial: false, flujo: true, carga: true, tipeo: false, filasExtra: false, linkCarga: false,
  });
  assert.deepEqual(edicionDelReporte({ periodo: "2026-11", marca: undefined, esAdminOFinanzas: true, enCarga: "2026-11" }), {
    historial: false, flujo: true, carga: true, tipeo: true, filasExtra: true, linkCarga: true,
  });
});

test("septiembre y octubre quedan como hoy, con o sin marca: la marca no activa la vista histórica fuera del mes en curso", () => {
  for (const periodo of ["2026-09", "2026-10", "2026-12"]) {
    for (const esAdminOFinanzas of [false, true]) {
      assert.deepEqual(
        edicionDelReporte({ periodo, marca: "anteriores", esAdminOFinanzas, enCarga: "2026-11" }),
        edicionDelReporte({ periodo, marca: undefined, esAdminOFinanzas, enCarga: "2026-11" }),
        `${periodo} admin/finanzas=${esAdminOFinanzas}`
      );
      assert.equal(edicionDelReporte({ periodo, marca: "anteriores", esAdminOFinanzas, enCarga: "2026-11" }).historial, false);
    }
  }
});

test("cartel de la vista histórica: nombra el mes en curso y dice que es solo lectura", () => {
  assert.equal(
    avisoMesEnCursoEnHistorial("2026-11"),
    "Estás viendo el mes en curso (Noviembre 2026) desde «Todos los meses»: solo lectura. Para cargar, usá «Mes en curso»."
  );
  assert.match(avisoMesEnCursoEnHistorial("2026-12"), /Diciembre 2026/);
});

test("rotación a 2026-12: la lista da septiembre, octubre, noviembre y diciembre; noviembre pasa a ser un mes previo sin marca", () => {
  assert.deepEqual(mesesAnteriores("2026-09", "2026-12"), ["2026-09", "2026-10", "2026-11", "2026-12"]);
  assert.equal(consultaDeBotonDeMes("2026-11", "2026-12"), "");
  assert.equal(consultaDeBotonDeMes("2026-12", "2026-12"), "modo=anteriores");
  assert.equal(modoDePeriodo("2026-11", "2026-12"), "anteriores");
  // La marca de noviembre deja de valer cuando el en curso es diciembre.
  assert.equal(esHistorialDelMesEnCurso("2026-11", "anteriores", "2026-12"), false);
  assert.equal(esHistorialDelMesEnCurso("2026-12", "anteriores", "2026-12"), true);
});
