import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { construirExcelMovimientos } from "@/lib/ejecucionExcel";
import { filtroDeUnidades, mapearMovimiento } from "@/lib/ejecucionVista";
import {
  CLASIFICACION_SIN_CLASIFICAR,
  hrefConFiltro,
  leerClasificacion,
  opcionesDeClasificacion,
  queryClasificacion,
  whereMovimientosDeEmpresa,
} from "@/lib/filtroClasificacionEmpresa";

// Filtro por clasificación de la pestaña "Ejecución financiera" del gerente. La parte pura se prueba
// con datos en memoria; el armado de la consulta se prueba contra un intérprete mínimo del `where`
// (las mismas claves que arma el código). Las rutas que hablan con la base se verifican leyendo su
// fuente: acá no se toca la base ni se levanta el server.

const raiz = process.cwd();
const leerFuente = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");
const FUENTE_DATOS = leerFuente("app", "[empresa]", "[periodo]", "ejecucion", "datos.ts");
const FUENTE_PAGINA = leerFuente("app", "[empresa]", "[periodo]", "ejecucion", "[numeroSemana]", "page.tsx");
const FUENTE_EXCEL = leerFuente("app", "[empresa]", "[periodo]", "ejecucion", "[numeroSemana]", "excel", "route.ts");

// ---------- Datos: dos empresas en la MISMA semana ----------

type Fila = {
  id: string;
  ejecucionId: string;
  clasificacion: string;
  unidadNegocio: string;
  desglose: { unidadNegocio: string; importe: number }[];
  concepto: string;
  importe: number;
};

const UNIDADES_A = ["SPP", "RADIO"]; // empresa del gerente
const UNIDADES_B = ["JPS", "AVIANOR"]; // otra empresa
const SEMANA = "sem-1";

const f = (id: string, clasificacion: string, unidadNegocio: string, extra: Partial<Fila> = {}): Fila => ({
  id,
  ejecucionId: SEMANA,
  clasificacion,
  unidadNegocio,
  desglose: [],
  concepto: `concepto ${id}`,
  importe: -100,
  ...extra,
});

const FILAS: Fila[] = [
  f("a1", "PROV Y SERV", "SPP"),
  f("a2", "PROV Y SERV", "RADIO"),
  f("a3", "IMP Y PREVISIONALES", "SPP"),
  f("a4", "SUELDOS", "RADIO"),
  f("a5", CLASIFICACION_SIN_CLASIFICAR, "SPP"),
  // De la empresa B:
  f("b1", "PROV Y SERV", "JPS"),
  f("b2", "COM Y GTOS BRIOS", "AVIANOR"),
  f("b3", "FCI", "JPS"),
  // Prorrateado con una porción de A: la unidad propia es de B, igual aparece en A.
  f("p1", "PROV Y SERV", "JPS", { desglose: [{ unidadNegocio: "SPP", importe: -40 }, { unidadNegocio: "JPS", importe: -60 }] }),
  // Prorrateado SOLO entre unidades de B: no es de A.
  f("p2", "SAC", "JPS", { desglose: [{ unidadNegocio: "JPS", importe: -50 }, { unidadNegocio: "AVIANOR", importe: -50 }] }),
  // Otra semana, misma empresa: no entra.
  f("s2", "PROV Y SERV", "SPP", { ejecucionId: "sem-2" }),
];

// Intérprete mínimo del `where` que arma el código: ejecucionId, clasificacion, OR, y la forma de
// filtroDeUnidades (desglose none/some + unidadNegocio in). Cualquier clave desconocida rompe el
// test (así un where nuevo no pasa sin que se lo evalúe).
function evaluar(where: Record<string, unknown>, fila: Fila): boolean {
  return Object.entries(where).every(([clave, valor]) => {
    switch (clave) {
      case "ejecucionId":
        return fila.ejecucionId === valor;
      case "clasificacion":
        return fila.clasificacion === valor;
      case "unidadNegocio":
        return (valor as { in: string[] }).in.includes(fila.unidadNegocio);
      case "desglose": {
        const d = valor as { none?: object; some?: { unidadNegocio: { in: string[] } } };
        if (d.none) return fila.desglose.length === 0;
        if (d.some) return fila.desglose.some((x) => d.some!.unidadNegocio.in.includes(x.unidadNegocio));
        throw new Error("desglose desconocido");
      }
      case "OR":
        return (valor as Record<string, unknown>[]).some((w) => evaluar(w, fila));
      default:
        throw new Error(`clave de where no soportada en el test: ${clave}`);
    }
  });
}

const consultar = (unidades: string[], clasificacion?: string) =>
  FILAS.filter((fila) => evaluar(whereMovimientosDeEmpresa(SEMANA, unidades, clasificacion) as Record<string, unknown>, fila)).map(
    (fila) => fila.id
  );

// ---------- Lectura del parámetro ----------

test("leerClasificacion: toma el valor de la URL, recortado", () => {
  assert.equal(leerClasificacion({ clasificacion: "PROV Y SERV" }), "PROV Y SERV");
  assert.equal(leerClasificacion({ clasificacion: "  IMP Y PREVISIONALES  " }), "IMP Y PREVISIONALES");
  assert.equal(leerClasificacion({ clasificacion: ["SUELDOS", "OTROS"] }), "SUELDOS");
});

test("leerClasificacion: sin valor, vacío o solo espacios no hay filtro", () => {
  assert.equal(leerClasificacion({}), undefined);
  assert.equal(leerClasificacion({ clasificacion: "" }), undefined);
  assert.equal(leerClasificacion({ clasificacion: "   " }), undefined);
  assert.equal(leerClasificacion({ filtro: "otra_cosa" }), undefined);
});

test("leerClasificacion: el valor se acota a 100 caracteres", () => {
  assert.equal(leerClasificacion({ clasificacion: "X".repeat(500) })?.length, 100);
});

test("REEMPLAZO: el viejo ?filtro=sin_clasificar equivale a la clasificación SIN CLASIFICAR", () => {
  assert.equal(leerClasificacion({ filtro: "sin_clasificar" }), CLASIFICACION_SIN_CLASIFICAR);
  assert.equal(CLASIFICACION_SIN_CLASIFICAR, "SIN CLASIFICAR");
});

test("REEMPLAZO: si vienen las dos cosas, gana la clasificación elegida (no se combinan)", () => {
  const elegida = leerClasificacion({ filtro: "sin_clasificar", clasificacion: "PROV Y SERV" });
  assert.equal(elegida, "PROV Y SERV");
  // Y la consulta resultante trae PROV Y SERV de la empresa, no las sin clasificar ni la intersección.
  assert.deepEqual(consultar(UNIDADES_A, elegida), ["a1", "a2", "p1"]);
  assert.equal(consultar(UNIDADES_A, elegida).includes("a5"), false);
});

// ---------- Query y links ----------

test("queryClasificacion: codifica el valor y agrega la página solo si es > 1", () => {
  assert.equal(queryClasificacion(undefined), "");
  assert.equal(queryClasificacion("PROV Y SERV"), "clasificacion=PROV+Y+SERV");
  assert.equal(queryClasificacion("DEP CH 3°"), "clasificacion=DEP+CH+3%C2%B0");
  assert.equal(queryClasificacion("SAC", 1), "clasificacion=SAC");
  assert.equal(queryClasificacion("SAC", 3), "clasificacion=SAC&pagina=3");
  assert.equal(queryClasificacion(undefined, 2), "pagina=2");
});

test("el valor codificado vuelve igual al leerlo (ida y vuelta por la URL)", () => {
  for (const c of ["PROV Y SERV", "DEP CH 3°", "A&B=C", "CAFÉ"]) {
    const params = new URLSearchParams(queryClasificacion(c));
    assert.equal(leerClasificacion({ clasificacion: params.get("clasificacion") ?? undefined }), c);
  }
});

test("PERSISTENCIA entre semanas: cada link de semana lleva el mismo filtro", () => {
  const ruta = (n: number) => `/gold/2026-10/ejecucion/${n}`;
  for (const n of [1, 2, 3, 4]) {
    assert.equal(hrefConFiltro(ruta(n), "PROV Y SERV"), `${ruta(n)}?clasificacion=PROV+Y+SERV`);
  }
  // Sin filtro, el link queda limpio.
  assert.equal(hrefConFiltro(ruta(2), undefined), ruta(2));
  // La página usa esa función para los links "Semana N" y para el Excel, y la paginación lleva el query.
  assert.match(FUENTE_PAGINA, /href=\{hrefConFiltro\(`\/\$\{empresa\}\/\$\{periodo\}\/ejecucion\/\$\{s\.numeroSemana\}`, clasificacion\)\}/);
  assert.equal((FUENTE_PAGINA.match(/query=\{queryFiltro\}/g) ?? []).length, 2);
  assert.equal(/filtro=\{filtro\}/.test(FUENTE_PAGINA), false);
});

// ---------- Consulta ----------

test("where: semana + unidades de la empresa (AND) + clasificación, y sin clasificación no la agrega", () => {
  assert.deepEqual(whereMovimientosDeEmpresa("e1", UNIDADES_A, "PROV Y SERV"), {
    ejecucionId: "e1",
    ...filtroDeUnidades(UNIDADES_A),
    clasificacion: "PROV Y SERV",
  });
  assert.deepEqual(whereMovimientosDeEmpresa("e1", UNIDADES_A, undefined), {
    ejecucionId: "e1",
    ...filtroDeUnidades(UNIDADES_A),
  });
  assert.equal("clasificacion" in whereMovimientosDeEmpresa("e1", UNIDADES_A, undefined), false);
  // La clasificación NO pisa ni reemplaza el recorte por unidades: sigue ahí el mismo OR.
  const w = whereMovimientosDeEmpresa("e1", UNIDADES_A, "SUELDOS") as { OR: unknown };
  assert.deepEqual(w.OR, filtroDeUnidades(UNIDADES_A).OR);
});

test("FILTRO APLICADO: solo vuelven los movimientos de esa clasificación, de esa empresa y semana", () => {
  assert.deepEqual(consultar(UNIDADES_A, "PROV Y SERV"), ["a1", "a2", "p1"]);
  assert.deepEqual(consultar(UNIDADES_A, "IMP Y PREVISIONALES"), ["a3"]);
  assert.deepEqual(consultar(UNIDADES_A, "SUELDOS"), ["a4"]);
  assert.deepEqual(consultar(UNIDADES_A, CLASIFICACION_SIN_CLASIFICAR), ["a5"]);
  // Sin filtro: todo lo de la empresa en la semana (incluida la porción de A del prorrateado).
  assert.deepEqual(consultar(UNIDADES_A), ["a1", "a2", "a3", "a4", "a5", "p1"]);
});

test("VALOR AJENO: una clasificación que solo existe en otra empresa devuelve cero filas", () => {
  // COM Y GTOS BRIOS, FCI y SAC existen en la semana, pero solo en filas de la empresa B.
  assert.deepEqual(consultar(UNIDADES_A, "COM Y GTOS BRIOS"), []);
  assert.deepEqual(consultar(UNIDADES_A, "FCI"), []);
  assert.deepEqual(consultar(UNIDADES_A, "SAC"), []);
  // Inventada o con otra grafía: también cero.
  assert.deepEqual(consultar(UNIDADES_A, "NO EXISTE"), []);
  assert.deepEqual(consultar(UNIDADES_A, "prov y serv"), []);
  // El mismo valor, visto desde B, sí trae lo suyo: el recorte es por empresa, no por valor.
  assert.deepEqual(consultar(UNIDADES_B, "FCI"), ["b3"]);
});

test("AISLAMIENTO: el gerente de una empresa no ve datos de otra, con ni sin filtro", () => {
  const clasificaciones = [undefined, "PROV Y SERV", "COM Y GTOS BRIOS", "FCI", "SAC", "SUELDOS", CLASIFICACION_SIN_CLASIFICAR];
  const idsDeB = new Set(["b1", "b2", "b3", "p2"]);
  const idsDeA = new Set(["a1", "a2", "a3", "a4", "a5"]);
  for (const c of clasificaciones) {
    const deA = consultar(UNIDADES_A, c);
    const deB = consultar(UNIDADES_B, c);
    assert.equal(deA.some((id) => idsDeB.has(id)), false, `A ve filas de B con filtro ${c}`);
    assert.equal(deB.some((id) => idsDeA.has(id)), false, `B ve filas de A con filtro ${c}`);
    assert.equal(deA.includes("s2"), false, "otra semana no entra");
    assert.equal(deA.includes("p2"), false, "prorrateado solo entre unidades de B no es de A");
  }
});

test("prorrateado con una porción propia: aparece y solo se ve la porción y el importe de la empresa", () => {
  assert.ok(consultar(UNIDADES_A, "PROV Y SERV").includes("p1"));
  const p1 = FILAS.find((x) => x.id === "p1")!;
  const visto = mapearMovimiento(
    {
      id: p1.id,
      fecha: new Date("2026-10-05T00:00:00Z"),
      concepto: p1.concepto,
      importe: "-100.00",
      bancoYCuenta: "MACRO 599",
      clasificacion: p1.clasificacion,
      unidadNegocio: p1.unidadNegocio,
      detalle: null,
      ignorado: false,
      sugeridaPorSistema: false,
      chequeIvaAmbiguo: false,
      unidadSugeridaPorSistema: false,
      desglose: p1.desglose.map((d, i) => ({ id: `d${i}`, ...d })),
    },
    UNIDADES_A
  );
  assert.equal(visto.importe, -40);
  assert.deepEqual(visto.desglose.map((d) => d.unidadNegocio), ["SPP"]);
  assert.equal(JSON.stringify(visto).includes("JPS"), false);
});

// ---------- Opciones del desplegable ----------

test("OPCIONES: salen solo de las clasificaciones de la empresa en la semana, nunca de la lista global", () => {
  // Lo que devolvería la consulta de opciones (groupBy con el where de la empresa y la semana).
  const delaEmpresa = FILAS.filter((x) =>
    evaluar(whereMovimientosDeEmpresa(SEMANA, UNIDADES_A, undefined) as Record<string, unknown>, x)
  ).map((x) => x.clasificacion);
  const opciones = opcionesDeClasificacion(delaEmpresa);
  assert.deepEqual(opciones.map((o) => o.valor).sort(), ["IMP Y PREVISIONALES", "PROV Y SERV", "SIN CLASIFICAR", "SUELDOS"]);
  // Nada de lo exclusivo de la empresa B (ni de la lista global de sugeridas).
  for (const ajena of ["COM Y GTOS BRIOS", "FCI", "SAC"]) {
    assert.equal(opciones.some((o) => o.valor === ajena), false, `aparece ${ajena}`);
  }
});

test("OPCIONES: etiqueta bonita para mostrar, valor técnico para filtrar, sin repetidos, ordenadas", () => {
  const opciones = opcionesDeClasificacion(["PROV Y SERV", "IMP Y PREVISIONALES", "PROV Y SERV", "SUELDOS", "", "  "]);
  assert.deepEqual(opciones, [
    { valor: "IMP Y PREVISIONALES", etiqueta: "Impuestos" },
    { valor: "PROV Y SERV", etiqueta: "Proveedores" },
    { valor: "SUELDOS", etiqueta: "SUELDOS" },
  ]);
  assert.deepEqual(opcionesDeClasificacion([]), []);
});

test("el desplegable guarda el valor técnico y muestra el nombre; la página usa las opciones de la empresa", () => {
  assert.match(FUENTE_PAGINA, /<option key=\{c\.valor\} value=\{c\.valor\}>\s*\{c\.etiqueta\}/);
  assert.match(FUENTE_PAGINA, /datos\.clasificacionesDisponibles\.map/);
  assert.match(FUENTE_PAGINA, /name="clasificacion"/);
});

// ---------- Cableado (fuente) ----------

test("datos.ts: filtra por servidor con el where compartido, y no usa la lista global ni BarraFiltros", () => {
  assert.match(FUENTE_DATOS, /whereMovimientosDeEmpresa\(ejecucion\.id, unidades, clasificacion\)/);
  assert.match(FUENTE_DATOS, /sumarImporteDeUnidades\(ejecucion\.id, unidades, clasificacion\)/);
  // Las opciones salen de la consulta de la empresa y la semana, sin el filtro elegido.
  assert.match(FUENTE_DATOS, /groupBy\(\{\s*by: \["clasificacion"\],\s*where: whereMovimientosDeEmpresa\(ejecucion\.id, unidades, undefined\)/);
  for (const fuente of [FUENTE_DATOS, FUENTE_PAGINA, FUENTE_EXCEL]) {
    assert.equal(/calcularClasificacionesDisponibles/.test(fuente), false);
    assert.equal(/BarraFiltros/.test(fuente), false);
    assert.equal(/soloSinClasificar/.test(fuente), false);
  }
  // Sigue sin pedir saldo.
  assert.equal(/verSaldo/.test(FUENTE_DATOS), false);
  // El acceso a la empresa se resuelve antes de cualquier consulta.
  assert.ok(FUENTE_DATOS.indexOf("requireAccesoEmpresa(empresa.id)") < FUENTE_DATOS.indexOf("prisma.movimientoBancario"));
});

test("el total en SQL filtra por clasificación con un parámetro (nunca texto interpolado) y en las dos ramas", () => {
  const fuente = leerFuente("lib", "ejecucionVista.ts");
  const inicio = fuente.indexOf("export async function sumarImporteDeUnidades");
  const cuerpo = fuente.slice(inicio);
  assert.match(cuerpo, /clasificacion \? Prisma\.sql`AND mb\.clasificacion = \$\{clasificacion\}` : Prisma\.empty/);
  assert.equal((cuerpo.match(/\$\{porClasificacion\}/g) ?? []).length, 2);
  assert.equal(/SIN CLASIFICAR/.test(cuerpo), false);
  assert.equal(/soloSinClasificar/.test(cuerpo), false);
});

// ---------- Excel ----------

test("EXCEL: el route lee el mismo filtro y usa el mismo where que la pantalla", () => {
  assert.match(FUENTE_EXCEL, /leerClasificacion\(\{/);
  assert.match(FUENTE_EXCEL, /searchParams\.get\("clasificacion"\)/);
  assert.match(FUENTE_EXCEL, /where: whereMovimientosDeEmpresa\(ejecucion\.id, unidades, clasificacion\)/);
  assert.equal(/\.\.\.filtroDeUnidades/.test(FUENTE_EXCEL), false);
  // El acceso a la empresa se chequea antes de consultar.
  assert.ok(FUENTE_EXCEL.indexOf("requireAccesoEmpresa(empresa.id)") < FUENTE_EXCEL.indexOf("prisma.movimientoBancario"));
  // El archivo filtrado se distingue por el nombre.
  assert.match(FUENTE_EXCEL, /clasificacion \? "-filtrado" : ""/);
});

test("EXCEL: el botón y la leyenda dicen que se descarga lo filtrado", () => {
  assert.match(FUENTE_PAGINA, /href=\{hrefConFiltro\(`\/\$\{empresa\}\/\$\{periodo\}\/ejecucion\/\$\{datos\.numeroSemana\}\/excel`, clasificacion\)\}/);
  assert.match(FUENTE_PAGINA, /"Descargar Excel \(filtrado\)" : "Descargar Excel"/);
  assert.match(FUENTE_PAGINA, /el Excel descarga solo lo filtrado/);
});

test("EXCEL filtrado: el archivo trae solo las filas de la clasificación y de la empresa", async () => {
  const filasFiltradas = FILAS.filter((x) =>
    evaluar(whereMovimientosDeEmpresa(SEMANA, UNIDADES_A, "PROV Y SERV") as Record<string, unknown>, x)
  );
  const movs = filasFiltradas.map((x) =>
    mapearMovimiento(
      {
        id: x.id,
        fecha: new Date("2026-10-05T00:00:00Z"),
        concepto: x.concepto,
        importe: x.importe.toFixed(2),
        bancoYCuenta: "MACRO 599",
        clasificacion: x.clasificacion,
        unidadNegocio: x.unidadNegocio,
        detalle: null,
        ignorado: false,
        sugeridaPorSistema: false,
        chequeIvaAmbiguo: false,
        unidadSugeridaPorSistema: false,
        desglose: x.desglose.map((d, i) => ({ id: `d${i}`, ...d })),
      },
      UNIDADES_A
    )
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await construirExcelMovimientos(movs, false)) as unknown as ArrayBuffer);
  const hoja = wb.worksheets[0];
  const conceptos: string[] = [];
  const clasificaciones: string[] = [];
  hoja.eachRow((fila, n) => {
    if (n === 1) return;
    conceptos.push(String(fila.getCell(3).value));
    clasificaciones.push(String(fila.getCell(5).value));
  });
  assert.deepEqual(conceptos, ["concepto a1", "concepto a2", "concepto p1"]);
  assert.deepEqual(clasificaciones, ["PROV Y SERV", "PROV Y SERV", "PROV Y SERV"]);
  // Sin datos de la otra empresa (ni su unidad, ni la porción ajena del prorrateado).
  const todo = JSON.stringify(movs);
  assert.equal(todo.includes("JPS"), false);
  assert.equal(todo.includes("b1"), false);
  assert.equal(hoja.rowCount, 4);
});
