import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLASIFICACIONES_POR_EMPRESA } from "@/lib/config";
import { construirIndiceDeEmpresa, sugerir } from "@/lib/clasificacionHistorial";
import {
  CONFIG_EXTRACTO_EMPRESA,
  aplicarSugerenciasAFilas,
  configDeEmpresa,
  textoSubidaExtractoEmpresa,
  unidadesConCargaPropia,
  datosParaCrear,
  type FilaACargar,
} from "@/lib/extractos/cargaEmpresa";
import { equivalenciaEtiquetaPeru, normalizarEtiqueta } from "@/lib/extractos/etiquetasPeru";
import { agregarHistorialPeru, type FilaLibroPeru } from "@/lib/extractos/historialPeru";

// Sugerencias de clasificación por historial de UNA empresa (hoy solo Havanna Perú). Datos inventados: no se copian datos reales.

const LISTA = CLASIFICACIONES_POR_EMPRESA["havanna-peru"];

function fila(concepto: string, importeCentavos: number, extra: Partial<FilaACargar> = {}): FilaACargar {
  return {
    numeroFila: 1,
    fecha: new Date(Date.UTC(2026, 9, 1)),
    nroReferencia: "0000000001",
    causal: null,
    concepto,
    importeCentavos,
    saldoCentavos: null,
    bancoYCuenta: "BBVA PERÚ SOLES",
    moneda: "PEN",
    clasificacion: "SIN CLASIFICAR",
    clasificacion2: null,
    unidadNegocio: "HAVANNA PERU",
    detalle: null,
    detalle2: null,
    sugeridaPorSistema: false,
    chequeIvaAmbiguo: false,
    unidadSugeridaPorSistema: false,
    clave: "k",
    ...extra,
  };
}

// ---- Configuración ------------------------------------------------------------------------------

test("config: las tres empresas con carga propia usan sugerencias por historial; solo Plate Silver tiene regla de ingresos", () => {
  for (const slug of ["havanna-peru", "bradenton", "plate-silver"]) assert.equal(configDeEmpresa(slug)!.sugerenciasPorHistorial, true, slug);
  assert.equal(configDeEmpresa("havanna-peru")!.ingresoPorDefecto, undefined);
  assert.equal(configDeEmpresa("bradenton")!.ingresoPorDefecto, undefined);
  assert.equal(configDeEmpresa("plate-silver")!.ingresoPorDefecto, "COBRANZA DE CLIENTE");
});

test("las unidades de Perú, Bradenton y Plate Silver quedan fuera del índice global", () => {
  assert.deepEqual([...unidadesConCargaPropia()].sort(), ["BRADENTON", "HAVANNA PERU", "PLATE SILVER"]);
  assert.equal(unidadesConCargaPropia().length, Object.keys(CONFIG_EXTRACTO_EMPRESA).length);
});

test("texto de subida: las tres explican las sugerencias; ninguna dice ya que todo entra sin clasificar", () => {
  for (const slug of ["havanna-peru", "bradenton", "plate-silver"]) {
    const t = textoSubidaExtractoEmpresa(slug, 1024 * 1024, 100);
    assert.match(t, /el sistema les propone la clasificación/, slug);
    assert.doesNotMatch(t, /Todo entra sin clasificar/, slug);
  }
  assert.match(textoSubidaExtractoEmpresa("plate-silver", 1024 * 1024, 100), /ingresos sin coincidencia/);
});

// ---- Índice de la empresa -----------------------------------------------------------------------

test("índice de empresa: solo valores de la lista de la empresa; SIN CLASIFICAR y lo ajeno no cuentan", () => {
  const indice = construirIndiceDeEmpresa(
    [
      { concepto: "ITF", signo: -1, clasificacion: "COMISIONES BANCARIAS", veces: 5 },
      { concepto: "ITF", signo: -1, clasificacion: "SIN CLASIFICAR", veces: 50 },
      { concepto: "ITF", signo: -1, clasificacion: "COM Y GTOS BRIOS", veces: 50 }, // valor de otra empresa
      { concepto: "OTRO", signo: -1, clasificacion: "PROV Y SERV", veces: 9 }, // valor ajeno a la lista
    ],
    LISTA
  );
  assert.equal(sugerir("ITF", -1, indice)?.clasificacion, "COMISIONES BANCARIAS");
  assert.equal(sugerir("OTRO", -1, indice), null);
  assert.equal(indice.size, 1);
});

test("índice de empresa: movimientos y arranque se suman; el signo distingue; sin historial no sugiere nada (sin respaldo global)", () => {
  const indice = construirIndiceDeEmpresa(
    [
      { concepto: "PAGO CLIENTE", signo: 1, clasificacion: "COBRANZAS CLIENTES", veces: 2 },
      { concepto: "PAGO CLIENTE", signo: 1, clasificacion: "COBRANZAS CLIENTES", veces: 1 }, // otro grupo de la misma clave (movimientos + arranque)
    ],
    LISTA
  );
  assert.equal(sugerir("pago cliente", 100, indice)?.apariciones, 3);
  assert.equal(sugerir("pago cliente", -100, indice), null);
  assert.equal(construirIndiceDeEmpresa([], LISTA).size, 0);
  assert.equal(sugerir("ITF", -1, construirIndiceDeEmpresa([], LISTA)), null);
});

// ---- Aplicar a las filas de la carga ------------------------------------------------------------

test("aplicarSugerenciasAFilas: sugiere con historial suficiente, marca sugerida, no toca la unidad ni la clave", () => {
  const indice = construirIndiceDeEmpresa([{ concepto: "ITF", signo: -1, clasificacion: "COMISIONES BANCARIAS", veces: 10 }], LISTA);
  const entrada = [fila("ITF", -5), fila("CONCEPTO NUEVO", -100), fila("ITF", 5)];
  const { filas, sugeridas } = aplicarSugerenciasAFilas(entrada, indice);
  assert.equal(sugeridas, 1);
  assert.equal(filas[0].clasificacion, "COMISIONES BANCARIAS");
  assert.equal(filas[0].sugeridaPorSistema, true);
  assert.equal(filas[0].unidadNegocio, "HAVANNA PERU");
  assert.equal(filas[0].unidadSugeridaPorSistema, false);
  assert.equal(filas[0].clave, "k");
  // sin historial → queda como entró; el mismo texto con signo opuesto es otra cosa
  assert.equal(filas[1].clasificacion, "SIN CLASIFICAR");
  assert.equal(filas[1].sugeridaPorSistema, false);
  assert.equal(filas[2].clasificacion, "SIN CLASIFICAR");
  // no muta la entrada
  assert.equal(entrada[0].clasificacion, "SIN CLASIFICAR");
});

test("aplicarSugerenciasAFilas: no pisa una fila que ya trae otra clasificación", () => {
  const indice = construirIndiceDeEmpresa([{ concepto: "ITF", signo: -1, clasificacion: "COMISIONES BANCARIAS", veces: 10 }], LISTA);
  const { filas, sugeridas } = aplicarSugerenciasAFilas([fila("ITF", -5, { clasificacion: "IMPUESTOS" })], indice);
  assert.equal(sugeridas, 0);
  assert.equal(filas[0].clasificacion, "IMPUESTOS");
});

test("datosParaCrear lleva la clasificación y la marca sugerida de la fila", () => {
  const indice = construirIndiceDeEmpresa([{ concepto: "ITF", signo: -1, clasificacion: "COMISIONES BANCARIAS", veces: 10 }], LISTA);
  const [f] = aplicarSugerenciasAFilas([fila("ITF", -5)], indice).filas;
  const d = datosParaCrear(f, "eje-1");
  assert.equal(d.clasificacion, "COMISIONES BANCARIAS");
  assert.equal(d.sugeridaPorSistema, true);
  assert.equal(d.unidadSugeridaPorSistema, false);
});

// ---- Equivalencias de etiquetas -----------------------------------------------------------------

test("etiquetas de Perú: las variantes del libro se llevan a la lista; lo dudoso no se inventa", () => {
  assert.equal(equivalenciaEtiquetaPeru("COBRANZA CLIENTES "), "COBRANZAS CLIENTES");
  assert.equal(equivalenciaEtiquetaPeru("COBRANZAS CLIENTES"), "COBRANZAS CLIENTES");
  assert.equal(equivalenciaEtiquetaPeru("COMISIONES BCRIAS"), "COMISIONES BANCARIAS");
  assert.equal(equivalenciaEtiquetaPeru("PROVEED Y SERV"), "PROVEEDORES Y SERVICIOS");
  assert.equal(equivalenciaEtiquetaPeru("proveedores y servicio"), "PROVEEDORES Y SERVICIOS");
  assert.equal(equivalenciaEtiquetaPeru("SOLES A USD"), "SOLES A DOLARES");
  assert.equal(equivalenciaEtiquetaPeru("PRESTAMO"), "PRESTAMOS");
  assert.equal(equivalenciaEtiquetaPeru("TARJETA DE CREDITO"), "TARJETA");
  assert.equal(equivalenciaEtiquetaPeru("IMPORTACION HAVANNA"), "IMPORTACION");
  assert.equal(equivalenciaEtiquetaPeru("sueldos"), "SUELDOS");
  // sin equivalencia segura
  assert.equal(equivalenciaEtiquetaPeru("REGALIAS"), null);
  assert.equal(equivalenciaEtiquetaPeru("DOLARES A SOLES"), null);
  assert.equal(equivalenciaEtiquetaPeru("GRATIFICACION"), null);
  assert.equal(equivalenciaEtiquetaPeru(""), null);
  // el destino de cada alias tiene que existir en la lista (si alguien lo borra de la lista, el alias deja de mapear)
  assert.equal(equivalenciaEtiquetaPeru("PRESTAMO", ["COBRANZAS CLIENTES"]), null);
  assert.equal(normalizarEtiqueta("  Préstamos  "), "PRESTAMOS");
});

// ---- Historial de arranque ----------------------------------------------------------------------

function libro(concepto: string, importe: number, etiqueta: string, extra: Partial<FilaLibroPeru> = {}): FilaLibroPeru {
  return { fecha: "2026-09-01", nroDoc: "0000000001", concepto, importe, etiqueta, ...extra };
}

test("historial de arranque: agrupa por concepto normalizado + signo + clasificación y cuenta una sola vez lo repetido entre libros", () => {
  const r = agregarHistorialPeru([
    libro("ITF 1234567", -0.05, "COMISIONES BCRIAS", { nroDoc: "1" }),
    libro("ITF 7654321", -0.1, "COMISIONES BANCARIAS", { nroDoc: "2" }),
    libro("ITF 7654321", -0.1, "COMISIONES BANCARIAS", { nroDoc: "2" }), // el mismo movimiento en el otro libro
    libro("PAGO", 100, "COBRANZA CLIENTES", { nroDoc: "3" }),
    libro("REGALIA", -5, "REGALIAS", { nroDoc: "4" }),
    libro("SIN ETIQUETA", -5, "", { nroDoc: "5" }),
  ]);
  assert.equal(r.leidas, 6);
  assert.equal(r.repetidas, 1);
  assert.equal(r.sinEtiqueta, 1);
  assert.deepEqual(r.sinEquivalencia, { REGALIAS: 1 });
  assert.equal(r.usadas, 3);
  assert.deepEqual(r.grupos.find((g) => g.concepto === "ITF"), { concepto: "ITF", signo: -1, clasificacion: "COMISIONES BANCARIAS", veces: 2 });
  assert.deepEqual(r.grupos.find((g) => g.concepto === "PAGO"), { concepto: "PAGO", signo: 1, clasificacion: "COBRANZAS CLIENTES", veces: 1 });
});

test("historial de arranque: un concepto que queda vacío al normalizar (solo números) no entra", () => {
  const r = agregarHistorialPeru([libro("123456789", -1, "SUELDOS")]);
  assert.equal(r.conceptoVacio, 1);
  assert.equal(r.grupos.length, 0);
});

// ---- Cableado (la acción y la base) -------------------------------------------------------------

test("la acción de empresa aplica el motor solo si la empresa lo pide, con SU índice, dentro de la transacción y antes de escribir", () => {
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  assert.match(src, /config\.sugerenciasPorHistorial/);
  assert.match(src, /cargarIndiceDeEmpresa\(tx,/);
  assert.match(src, /aplicarSugerenciasAFilas\(/);
  assert.ok(src.indexOf("aplicarSugerenciasAFilas(") < src.indexOf("createMany"), "las sugerencias se aplican antes de escribir");
  assert.match(src, /data: nuevas\.map\(/);
});

test("el índice global ya no lo arma actions.ts y deja afuera las unidades con carga propia; el de empresa filtra por unidad y por lista", () => {
  const acc = readFileSync("app/ejecucion/actions.ts", "utf8");
  assert.doesNotMatch(acc, /async function cargarIndiceDeHistorial/);
  assert.match(acc, /cargarIndiceGlobal\(\)/);
  const db = readFileSync("lib/clasificacionHistorialDb.ts", "utf8");
  assert.doesNotMatch(db, /^s*"use server"/);
  assert.match(db, /"unidadNegocio" <> ALL\(\$\{propias\}::text\[\]\)/);
  assert.match(db, /"unidadNegocio" = \$\{unidad\}/);
  assert.match(db, /clasificacion = ANY\(\$\{lista\}::text\[\]\)/);
  assert.match(db, /clasificacionesPropiasDeEmpresa\(slug\)/);
  // El índice de empresa no cae en el global.
  const deEmpresa = db.slice(db.indexOf("export async function cargarIndiceDeEmpresa"));
  assert.doesNotMatch(deEmpresa, /cargarIndiceGlobal/);
});
