import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLASIFICACIONES_OCULTAS_PARA_GERENTE, EMPRESAS_CON_CARGA_EN_REPORTE } from "@/lib/config";
import {
  clasificacionesOcultasParaUsuario,
  normalizarClasificacion,
  valoresGuardadosOcultos,
} from "@/lib/clasificacionesOcultas";
import { opcionesDeClasificacion, whereMovimientosDeEmpresa } from "@/lib/filtroClasificacionEmpresa";
import { slugDeEmpresa } from "@/lib/slug";

// Clasificaciones que el gerente de Conexión Logística no ve en el detalle de «Ejecución financiera»
// (AVION, MS, PRESTAMO MS). Lo puro se prueba con datos en memoria; el where, contra un intérprete mínimo
// (mismas claves que arma el código); las rutas que hablan con la base, leyendo su fuente (no se toca la base).

const raiz = process.cwd();
const leerFuente = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");
const FUENTE_DATOS = leerFuente("app", "[empresa]", "[periodo]", "ejecucion", "datos.ts");
const FUENTE_EXCEL = leerFuente("app", "[empresa]", "[periodo]", "ejecucion", "[numeroSemana]", "excel", "route.ts");
const FUENTE_PAGINA = leerFuente("app", "[empresa]", "[periodo]", "ejecucion", "[numeroSemana]", "page.tsx");
const FUENTE_VISTA = leerFuente("lib", "ejecucionVista.ts");
const FUENTE_DB = leerFuente("lib", "ocultasGerenteDb.ts");

const GERENTE = { rol: "GERENTE", operaEjecucion: false };
const OPERADOR = { rol: "GERENTE", operaEjecucion: true };
const FINANZAS = { rol: "FINANZAS", operaEjecucion: false };
const ADMIN = { rol: "ADMIN", operaEjecucion: false };
const OCULTAS_CONEXION = ["AVION", "MS", "PRESTAMO MS"];

// ---------- Config y regla de quién ve ----------

test("config: Conexión (los dos slugs) oculta AVION, MS y PRESTAMO MS; nadie más está en el mapa", () => {
  assert.deepEqual(Object.keys(CLASIFICACIONES_OCULTAS_PARA_GERENTE).sort(), ["conexion-logistica", "conexion-logistica-spp"]);
  for (const slug of Object.keys(CLASIFICACIONES_OCULTAS_PARA_GERENTE)) {
    assert.deepEqual([...CLASIFICACIONES_OCULTAS_PARA_GERENTE[slug]], OCULTAS_CONEXION);
  }
});

test("config: el slug real de «Conexión Logística» es el del mapa, y está entre las empresas del Reporte", () => {
  assert.equal(slugDeEmpresa("Conexión Logística"), "conexion-logistica");
  for (const slug of Object.keys(CLASIFICACIONES_OCULTAS_PARA_GERENTE)) {
    assert.ok(EMPRESAS_CON_CARGA_EN_REPORTE.includes(slug), slug);
  }
});

test("GERENTE de Conexión: se le ocultan las tres clasificaciones (los dos slugs)", () => {
  assert.deepEqual(clasificacionesOcultasParaUsuario("conexion-logistica", GERENTE), OCULTAS_CONEXION);
  assert.deepEqual(clasificacionesOcultasParaUsuario("conexion-logistica-spp", GERENTE), OCULTAS_CONEXION);
});

test("ADMIN, FINANZAS y el operador (rol GERENTE con operaEjecucion) ven todo", () => {
  for (const u of [ADMIN, FINANZAS, OPERADOR]) {
    assert.deepEqual(clasificacionesOcultasParaUsuario("conexion-logistica", u), []);
  }
});

test("otras empresas sin cambios: Mantenor, Fredy, Brillante y cualquier slug fuera del mapa no ocultan nada", () => {
  for (const slug of ["mantenor", "fredy-publicidad", "brillante", "havanna", "radio", "", "__proto__", "toString"]) {
    assert.deepEqual(clasificacionesOcultasParaUsuario(slug, GERENTE), [], slug);
  }
});

test("la función acepta otro mapa (la config es la única fuente) y normaliza y deduplica", () => {
  const mapa = { demo: [" avion ", "AVIÓN", "ms", ""] };
  assert.deepEqual(clasificacionesOcultasParaUsuario("demo", GERENTE, mapa), ["AVION", "MS"]);
  assert.deepEqual(clasificacionesOcultasParaUsuario("otra", GERENTE, mapa), []);
});

// ---------- Comparación sin mayúsculas ni espacios ----------

test("normalizarClasificacion: sin mayúsculas, tildes ni espacios de más", () => {
  assert.equal(normalizarClasificacion("  prestamo   ms "), "PRESTAMO MS");
  assert.equal(normalizarClasificacion("Préstamo MS"), "PRESTAMO MS");
});

test("valoresGuardadosOcultos: encuentra las variantes guardadas con otra capitalización o espacios", () => {
  const guardadas = ["AVION", "ms ", "Prestamo Ms", "PROV Y SERV", "MSX", "MS PLUS", "SUELDOS"];
  assert.deepEqual(valoresGuardadosOcultos(guardadas, OCULTAS_CONEXION), ["AVION", "ms ", "Prestamo Ms"]);
  assert.deepEqual(valoresGuardadosOcultos(guardadas, []), []);
});

// ---------- where, lista, cantidad, Total, desplegable y URL manual ----------

type Fila = {
  id: string;
  ejecucionId: string;
  clasificacion: string;
  unidadNegocio: string;
  desglose: { unidadNegocio: string; importe: number }[];
  importe: number;
};
const UNIDADES = ["LOGISTICA", "SPP"];
const f = (id: string, clasificacion: string, unidadNegocio: string, importe: number, extra: Partial<Fila> = {}): Fila => ({
  id,
  ejecucionId: "sem-3",
  clasificacion,
  unidadNegocio,
  desglose: [],
  importe,
  ...extra,
});
const FILAS: Fila[] = [
  f("1", "PROV Y SERV", "LOGISTICA", -100),
  f("2", "AVION", "LOGISTICA", -1000),
  f("3", "MS", "SPP", -2000),
  f("4", "PRESTAMO MS", "LOGISTICA", 5000),
  f("5", "ms ", "SPP", -7), // variante guardada con otra capitalización y un espacio
  f("6", "SUELDOS", "SPP", -50),
  // Prorrateado con una porción de la empresa y clasificación oculta.
  f("7", "AVION", "OTRA", -300, {
    desglose: [
      { unidadNegocio: "LOGISTICA", importe: -120 },
      { unidadNegocio: "OTRA", importe: -180 },
    ],
  }),
  f("8", "AVION", "OTRA", -9), // de otra empresa: nunca entra
];

function evaluar(where: Record<string, unknown>, fila: Fila): boolean {
  return Object.entries(where).every(([clave, valor]) => {
    switch (clave) {
      case "ejecucionId":
        return fila.ejecucionId === valor;
      case "clasificacion":
        if (typeof valor === "object" && valor !== null) return (valor as { in: string[] }).in.includes(fila.clasificacion);
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
      case "NOT":
        return !evaluar(valor as Record<string, unknown>, fila);
      default:
        throw new Error(`clave de where no soportada en el test: ${clave}`);
    }
  });
}
// Mismo cálculo que el SQL de sumarImporteDeUnidades: porciones propias si hay desglose, si no el importe.
const importePropio = (fila: Fila) =>
  fila.desglose.length > 0
    ? fila.desglose.filter((d) => UNIDADES.includes(d.unidadNegocio)).reduce((a, d) => a + d.importe, 0)
    : fila.importe;

function vistaDe(usuario: { rol: string; operaEjecucion: boolean }, clasificacion?: string) {
  const guardadas = FILAS.map((x) => x.clasificacion);
  const ocultas = valoresGuardadosOcultos(guardadas, clasificacionesOcultasParaUsuario("conexion-logistica", usuario));
  const where = whereMovimientosDeEmpresa("sem-3", UNIDADES, clasificacion, ocultas) as Record<string, unknown>;
  const filas = FILAS.filter((x) => evaluar(where, x));
  const sinFiltro = whereMovimientosDeEmpresa("sem-3", UNIDADES, undefined, ocultas) as Record<string, unknown>;
  return {
    ids: filas.map((x) => x.id),
    cantidad: filas.length,
    total: filas.reduce((a, x) => a + importePropio(x), 0),
    opciones: opcionesDeClasificacion(FILAS.filter((x) => evaluar(sinFiltro, x)).map((x) => x.clasificacion)).map((o) => o.valor),
  };
}

test("GERENTE: la lista no trae AVION, MS ni PRESTAMO MS (ni su variante «ms »), prorrateados incluidos", () => {
  assert.deepEqual(vistaDe(GERENTE).ids, ["1", "6"]);
});

test("GERENTE: la cantidad y el Total salen solo de lo visible (el Total cierra con las filas)", () => {
  const v = vistaDe(GERENTE);
  assert.equal(v.cantidad, 2);
  assert.equal(v.total, -150);
});

test("GERENTE: el desplegable de Clasificación no ofrece los valores ocultos", () => {
  assert.deepEqual(vistaDe(GERENTE).opciones, ["PROV Y SERV", "SUELDOS"]);
});

test("GERENTE: pedir una clasificación oculta por URL manual devuelve cero filas y Total cero", () => {
  for (const url of ["AVION", "MS", "PRESTAMO MS", "ms "]) {
    const v = vistaDe(GERENTE, url);
    assert.deepEqual(v.ids, [], url);
    assert.equal(v.cantidad, 0);
    assert.equal(v.total, 0);
  }
  // Una visible sigue funcionando por URL.
  assert.deepEqual(vistaDe(GERENTE, "SUELDOS").ids, ["6"]);
});

test("ADMIN, FINANZAS y operador ven todo: lista, cantidad, Total, opciones y URL manual", () => {
  for (const u of [ADMIN, FINANZAS, OPERADOR]) {
    const v = vistaDe(u);
    assert.deepEqual(v.ids, ["1", "2", "3", "4", "5", "6", "7"]);
    assert.equal(v.cantidad, 7);
    assert.equal(v.total, -100 - 1000 - 2000 + 5000 - 7 - 50 - 120);
    assert.ok(v.opciones.includes("AVION") && v.opciones.includes("MS") && v.opciones.includes("PRESTAMO MS"));
    assert.deepEqual(vistaDe(u, "AVION").ids, ["2", "7"]);
  }
});

test("el where sin ocultas es el de siempre (otras empresas no cambian)", () => {
  assert.deepEqual(whereMovimientosDeEmpresa("sem-3", UNIDADES, undefined), whereMovimientosDeEmpresa("sem-3", UNIDADES, undefined, []));
  assert.equal("NOT" in whereMovimientosDeEmpresa("sem-3", UNIDADES, "X", []), false);
  const mantenor = valoresGuardadosOcultos(["PRESTAMO MS"], clasificacionesOcultasParaUsuario("mantenor", GERENTE));
  assert.deepEqual(mantenor, []);
});

// ---------- Rutas: pantalla, SQL del Total y Excel usan la misma lista ----------

test("datos.ts: calcula las ocultas del usuario y las pasa al where, al Total (SQL) y al desplegable", () => {
  assert.match(FUENTE_DATOS, /obtenerValoresOcultos\(ejecucion\.id, slugDeEmpresa\(empresa\.nombre\), usuario\)/);
  assert.match(FUENTE_DATOS, /whereMovimientosDeEmpresa\(ejecucion\.id, unidades, clasificacion, ocultas\)/);
  assert.match(FUENTE_DATOS, /sumarImporteDeUnidades\(ejecucion\.id, unidades, clasificacion, ocultas\)/);
  assert.match(FUENTE_DATOS, /whereMovimientosDeEmpresa\(ejecucion\.id, unidades, undefined, ocultas\)/);
});

test("el SQL del Total excluye las ocultas en sus DOS ramas (no prorrateados y porciones)", () => {
  assert.match(FUENTE_VISTA, /AND NOT \(mb\.clasificacion = ANY\(\$\{ocultas\}::text\[\]\)\)/);
  assert.equal((FUENTE_VISTA.match(/\$\{sinOcultas\}/g) ?? []).length, 2);
});

test("Excel: usa el usuario de requireAccesoEmpresa y las mismas ocultas que la pantalla", () => {
  assert.match(FUENTE_EXCEL, /usuario = await requireAccesoEmpresa\(empresa\.id\)/);
  assert.match(FUENTE_EXCEL, /obtenerValoresOcultos\(ejecucion\.id, slugDeEmpresa\(empresa\.nombre\), usuario\)/);
  assert.match(FUENTE_EXCEL, /whereMovimientosDeEmpresa\(ejecucion\.id, unidades, clasificacion, ocultas\)/);
});

test("el servidor resuelve las ocultas en la base solo si hay algo configurado para el usuario", () => {
  assert.match(FUENTE_DB, /clasificacionesOcultasParaUsuario\(slugEmpresa, usuario\)/);
  assert.match(FUENTE_DB, /if \(ocultas\.length === 0\) return \[\]/);
});

test("la pantalla avisa «No incluye movimientos reservados» solo si hay algo oculto para ese usuario", () => {
  assert.match(FUENTE_PAGINA, /datos\.hayReservados && \(/);
  assert.match(FUENTE_PAGINA, /No incluye movimientos reservados/);
  assert.match(FUENTE_DATOS, /hayReservados: cantidadOcultos > 0/);
  // Solo cuenta si hay ocultas configuradas: sin ellas ni consulta.
  assert.match(FUENTE_DATOS, /ocultas\.length === 0 \|\| unidades\.length === 0/);
});

test("el Reporte, el saldo y los chequeos NO pasan por este filtro (siguen con todos los movimientos)", () => {
  for (const archivo of [["lib", "reporte.ts"], ["lib", "cierreEjecucionDb.ts"], ["lib", "ordenSaldo.ts"], ["app", "ejecucion", "actions.ts"]]) {
    const fuente = leerFuente(...archivo);
    assert.equal(/clasificacionesOcultas|ocultasGerenteDb|valoresOcultos/.test(fuente), false, archivo.join("/"));
  }
});
