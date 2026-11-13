import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLASIFICACIONES_POR_EMPRESA } from "@/lib/config";
import {
  UMBRALES_INICIALES,
  calcularSugerenciasParaMovimientos,
  construirIndiceDeEmpresa,
  sugerir,
  sugerirConRegla,
} from "@/lib/clasificacionHistorial";
import { aplicarSugerenciasAFilas, configDeEmpresa, type FilaACargar } from "@/lib/extractos/cargaEmpresa";
import { equivalenciaBradenton } from "@/lib/extractos/etiquetasBradenton";
import { equivalenciaEtiquetaPlateSilver } from "@/lib/extractos/etiquetasPlateSilver";
import { agregarHistorial, type FilaLibro } from "@/lib/extractos/historialEmpresa";

// Fase 2: Bradenton y Plate Silver con sugerencias por historial, regla de respaldo de Plate Silver, sembrado generalizado y aplicar
// sugerencias a lo ya cargado. Datos inventados: no se copian datos reales.

const LISTA_B = CLASIFICACIONES_POR_EMPRESA["bradenton"];
const LISTA_S = CLASIFICACIONES_POR_EMPRESA["plate-silver"];

// ---- Equivalencias aprobadas: Bradenton ----------------------------------------------------------

test("Bradenton: las etiquetas aprobadas van a su valor de la lista", () => {
  const casos: [string, string][] = [
    ["REBATE", "REBATE"],
    ["REBATE COMBUSTIBLE", "REBATE"],
    ["SUELDOS", "SUELDOS"],
    ["LOTTERY", "LOTTERY"],
    ["SALE TAX", "TAX"],
    ["FOOD TRUCK", "COBRO FOOD TRUCK"],
    ["VENTA ICE", "VENTA ICE MACHINE-TC"],
    ["DEPOSITO ICE MACHINE", "VENTA ICE MACHINE-TC"],
    ["GASTOS BANCARIOS", "COM Y GTOS BRIOS"],
    ["COMISIONES Y GASTOS BANCARIOS", "COM Y GTOS BRIOS"],
    ["DEPOSITO", "DEP EFECTIVO"],
    ["CORPORATE", "EXPENSAS"],
    ["TELEFONO", "SERVICIOS"],
    ["SEGURO", "SERVICIOS"],
    ["AGUA", "SERVICIOS"],
    ["ENERGIA ELECTRICA", "SERVICIOS"],
    ["ALARMA", "SERVICIOS"],
    ["INTERNET", "SERVICIOS"],
    ["ELISTAR", "SERVICIOS"],
    ["REPARACION Y MANTENIMIENTO", "MANTENIMIENTO Y REPARACIONES"],
    ["ADMINISTRATION FEE", "HONORARIOS + ABONOS MENSUALES"],
    ["MOVILIDAD Y VIATICOS", "HONORARIOS + ABONOS MENSUALES"],
    ["PROVEEDORES", "COMPRA MERCS C-STORE"],
    ["NAC", "OTROS"],
    ["  Deposito  ", "DEP EFECTIVO"],
  ];
  for (const [etiqueta, esperado] of casos) assert.equal(equivalenciaBradenton(etiqueta, "DEBIT_CARD"), esperado, etiqueta);
});

test("Bradenton: EFT RCV-#### (número variable) es COBRANZAS", () => {
  assert.equal(equivalenciaBradenton("EFT RCV-23174", "ACH_DEBIT"), "COBRANZAS");
  assert.equal(equivalenciaBradenton("EFT RCV-24071", "ACH_CREDIT"), "COBRANZAS");
  assert.equal(equivalenciaBradenton("EFT RCV-", "ACH_CREDIT"), null);
});

test("Bradenton: todo cheque pagado (Type = CHECK_PAID) es CHEQ EMITIDOS, sea cual sea su etiqueta", () => {
  for (const etiqueta of ["PROVEEDORES", "ADMINISTRATION FEE", "REPARACION Y MANTENIMIENTO", "ALGO NUEVO"]) {
    assert.equal(equivalenciaBradenton(etiqueta, "CHECK_PAID"), "CHEQ EMITIDOS (DEBITADOS)", etiqueta);
  }
  // Sin el tipo, la etiqueta manda.
  assert.equal(equivalenciaBradenton("PROVEEDORES"), "COMPRA MERCS C-STORE");
});

test("Bradenton: lo que no tiene equivalencia no se inventa; y todo destino existe en la lista de la empresa", () => {
  assert.equal(equivalenciaBradenton("ETIQUETA RARA", "DEBIT_CARD"), null);
  assert.equal(equivalenciaBradenton("", "DEBIT_CARD"), null);
  // Si alguien borra un valor de la lista, la equivalencia deja de mapear a él.
  assert.equal(equivalenciaBradenton("DEPOSITO", "DEPOSIT", ["REBATE"]), null);
  for (const e of ["REBATE", "DEPOSITO", "ADMINISTRATION FEE", "PROVEEDORES", "NAC", "CORPORATE", "ELISTAR", "EFT RCV-1"]) {
    const d = equivalenciaBradenton(e, "ACH_CREDIT");
    assert.ok(d !== null && LISTA_B.includes(d), e);
  }
});

// ---- Equivalencias aprobadas: Plate Silver -------------------------------------------------------

test("Plate Silver: las etiquetas aprobadas van a su valor de la lista", () => {
  const casos: [string, string][] = [
    ["COBRANZA DE CLIENTE", "COBRANZA DE CLIENTE"],
    ["TRANSFERENCIA ENTRE CUENTAS", "TRANSFERENCIA ENTRE CUENTAS"],
    ["COMISION BANCARIA", "COMISION BANCARIA"],
    ["COMISION", "COMISION BANCARIA"],
    ["SUELDOS", "SUELDO"],
    ["AGUINALDOS", "AGUINALDO"],
    ["DIVIDENDOS", "DIVIDENDOS"],
    ["OTRO REPOSICION DE FONDO FIJO", "REPOSICION FONDO FIJO"],
    ["OTRO REPOSICION DE FONDOS FIJOS", "REPOSICION FONDO FIJO"],
    ["OTROS (PERCEPCION UI)", "IMPUESTO PERCEPCION IVA (UI)"],
    ["OTRO (PERCEPCION UI)", "IMPUESTO PERCEPCION IVA (UI)"],
  ];
  for (const [etiqueta, esperado] of casos) assert.equal(equivalenciaEtiquetaPlateSilver(etiqueta), esperado, etiqueta);
});

test("Plate Silver: «OTROS (PERCEPCION UI)» NO es el OTROS de la lista", () => {
  assert.notEqual(equivalenciaEtiquetaPlateSilver("OTROS (PERCEPCION UI)"), "OTROS");
});

test("Plate Silver: PROVEEDORES e IMPUESTOS quedan SIN sugerir (decisión de Romina); un número no es una etiqueta", () => {
  assert.equal(equivalenciaEtiquetaPlateSilver("PROVEEDORES"), null);
  assert.equal(equivalenciaEtiquetaPlateSilver("proveedores "), null);
  assert.equal(equivalenciaEtiquetaPlateSilver("IMPUESTOS"), null);
  assert.equal(equivalenciaEtiquetaPlateSilver("26876.954532563686"), null);
  assert.equal(equivalenciaEtiquetaPlateSilver(""), null);
  for (const e of ["SUELDOS", "COMISION", "OTRO (PERCEPCION UI)"]) {
    const d = equivalenciaEtiquetaPlateSilver(e);
    assert.ok(d !== null && LISTA_S.includes(d), e);
  }
});

// ---- Agregador genérico --------------------------------------------------------------------------

function libro(origen: string, concepto: string, importe: number, etiqueta: string, extra: Partial<FilaLibro> = {}): FilaLibro {
  return { origen, fecha: "2026-10-01", nroDoc: "", concepto, importe, etiqueta, ...extra };
}
const igualB = (f: { etiqueta: string; tipo?: string }) => equivalenciaBradenton(f.etiqueta, f.tipo);

test("agregador (entre-origenes): lo repetido DENTRO de un libro se cuenta; lo que ya estaba en un libro anterior no", () => {
  const r = agregarHistorial(
    [
      libro("A", "DEPOSIT ID NUMBER", 100, "DEPOSITO"),
      libro("A", "DEPOSIT ID NUMBER", 100, "DEPOSITO"), // dos depósitos legítimos idénticos del mismo libro
      libro("B", "DEPOSIT ID NUMBER", 100, "DEPOSITO"), // el mismo movimiento arrastrado al libro siguiente
      libro("B", "DEPOSIT ID NUMBER", 100, "DEPOSITO"),
      libro("B", "OTRO", 50, "REBATE", { fecha: "2026-10-02" }),
    ],
    igualB,
    { dedup: "entre-origenes" }
  );
  assert.equal(r.leidas, 5);
  assert.equal(r.repetidas, 2);
  assert.equal(r.usadas, 3);
  assert.equal(r.grupos.find((g) => g.concepto === "DEPOSIT ID NUMBER")?.veces, 2);
});

test("agregador (global): lo repetido en cualquier lugar se cuenta una sola vez (Perú)", () => {
  const r = agregarHistorial(
    [libro("", "ITF", -1, "SUELDOS", { nroDoc: "1" }), libro("", "ITF", -1, "SUELDOS", { nroDoc: "1" })],
    (f) => (f.etiqueta === "SUELDOS" ? "SUELDOS" : null),
    { dedup: "global" }
  );
  assert.equal(r.repetidas, 1);
  assert.equal(r.usadas, 1);
});

test("agregador: usa el tipo del movimiento (cheques de Bradenton) y cuenta lo que no mapea", () => {
  const r = agregarHistorial(
    [
      libro("A", "CHECK 1780 Midtown", -500, "PROVEEDORES", { tipo: "CHECK_PAID" }),
      libro("A", "ORIG CO NAME:AIRGAS", -300, "PROVEEDORES", { tipo: "ACH_DEBIT" }),
      libro("A", "ALGO", -1, "NO EXISTE", { tipo: "DEBIT_CARD" }),
    ],
    igualB,
    { dedup: "entre-origenes" }
  );
  assert.deepEqual(r.grupos.map((g) => g.clasificacion).sort(), ["CHEQ EMITIDOS (DEBITADOS)", "COMPRA MERCS C-STORE"]);
  assert.deepEqual(r.sinEquivalencia, { "NO EXISTE": 1 });
});

// ---- Regla de respaldo ---------------------------------------------------------------------------

const REGLA = "COBRANZA DE CLIENTE";

test("regla de respaldo: el historial manda; sin coincidencia, un INGRESO recibe la regla; un egreso no", () => {
  const indice = construirIndiceDeEmpresa([{ concepto: "TRF PAGO PROVEEDORES", signo: 1, clasificacion: "TRANSFERENCIA ENTRE CUENTAS", veces: 5 }], LISTA_S);
  assert.deepEqual(sugerirConRegla("TRF PAGO PROVEEDORES", 100, indice, REGLA), { clasificacion: "TRANSFERENCIA ENTRE CUENTAS", origen: "historial" });
  assert.deepEqual(sugerirConRegla("PAGADOR NUEVO SA", 100, indice, REGLA), { clasificacion: REGLA, origen: "regla" });
  assert.equal(sugerirConRegla("PAGADOR NUEVO SA", -100, indice, REGLA), null);
  assert.equal(sugerirConRegla("PAGADOR NUEVO SA", 0, indice, REGLA), null);
  // Sin regla declarada (Perú, Bradenton) no hay respaldo.
  assert.equal(sugerirConRegla("PAGADOR NUEVO SA", 100, indice), null);
  assert.equal(sugerirConRegla("PAGADOR NUEVO SA", 100, indice, null), null);
});

test("la regla de Plate Silver apunta a un valor de SU lista", () => {
  assert.ok(LISTA_S.includes(configDeEmpresa("plate-silver")!.ingresoPorDefecto!));
});

function fila(concepto: string, importeCentavos: number): FilaACargar {
  return {
    numeroFila: 1,
    fecha: new Date(Date.UTC(2026, 9, 1)),
    nroReferencia: "",
    causal: null,
    concepto,
    importeCentavos,
    saldoCentavos: null,
    bancoYCuenta: "BROU USD",
    moneda: "USD",
    clasificacion: "SIN CLASIFICAR",
    clasificacion2: null,
    unidadNegocio: "PLATE SILVER",
    detalle: null,
    detalle2: null,
    sugeridaPorSistema: false,
    chequeIvaAmbiguo: false,
    unidadSugeridaPorSistema: false,
    clave: "k",
  };
}

test("al cargar: cuenta por separado lo que sugiere el historial y lo que sugiere la regla, y todo queda marcado sugerido", () => {
  const indice = construirIndiceDeEmpresa([{ concepto: "COMISION", signo: -1, clasificacion: "COMISION BANCARIA", veces: 9 }], LISTA_S);
  const r = aplicarSugerenciasAFilas([fila("COMISION", -50), fila("PAGADOR NUEVO", 10000), fila("PAGO RARO", -10000)], indice, REGLA);
  assert.equal(r.porHistorial, 1);
  assert.equal(r.porRegla, 1);
  assert.equal(r.sugeridas, 2);
  assert.deepEqual(r.filas.map((f) => [f.clasificacion, f.sugeridaPorSistema]), [
    ["COMISION BANCARIA", true],
    [REGLA, true],
    ["SIN CLASIFICAR", false],
  ]);
});

// ---- Aplicar a lo ya cargado (cálculo) -----------------------------------------------------------

test("aplicar a existentes (cálculo): una sugerencia por movimiento que la tenga; el resto queda afuera", () => {
  const indice = construirIndiceDeEmpresa([{ concepto: "COMISION", signo: -1, clasificacion: "COMISION BANCARIA", veces: 9 }], LISTA_S);
  const { sugerencias, sinSugerencia } = calcularSugerenciasParaMovimientos(
    [
      { id: "1", concepto: "COMISION", importe: -0.5 },
      { id: "2", concepto: "PAGADOR NUEVO", importe: 200 },
      { id: "3", concepto: "PAGO RARO", importe: -200 },
    ],
    indice,
    REGLA
  );
  assert.deepEqual(sugerencias, [
    { id: "1", clasificacion: "COMISION BANCARIA", origen: "historial" },
    { id: "2", clasificacion: REGLA, origen: "regla" },
  ]);
  assert.deepEqual(sinSugerencia.map((m) => m.id), ["3"]);
});

// ---- Cableado: la base y los scripts -------------------------------------------------------------

test("aplicar a existentes: la condición «solo SIN CLASIFICAR no sugerido, abierto, sin prorrateo» está en la lectura y en CADA update", () => {
  const db = readFileSync("lib/clasificacionHistorialDb.ts", "utf8");
  const donde = db.slice(db.indexOf("function dondePendiente"), db.indexOf("export async function sugerirAExistentes"));
  assert.match(donde, /clasificacion: "SIN CLASIFICAR"/);
  assert.match(donde, /sugeridaPorSistema: false/);
  assert.match(donde, /ignorado: false/);
  assert.match(donde, /desglose: \{ none: \{\} \}/);
  assert.match(donde, /estado: "ABIERTA"/);
  assert.match(donde, /unidadNegocio: a\.unidad/);
  const sug = db.slice(db.indexOf("export async function sugerirAExistentes"));
  assert.match(sug, /findMany\(\{ where: dondePendiente\(a\)/);
  assert.match(sug, /updateMany\(\{\s*where: \{ \.\.\.dondePendiente\(a\), id: \{ in: ids \} \}/);
  // Solo cambia estos dos campos.
  assert.match(sug, /data: \{ clasificacion, sugeridaPorSistema: true \}/);
  // Una transacción con el lock del período (el mismo que las cargas), y solo escribe con aplicar.
  assert.match(sug, /\$transaction\(/);
  assert.match(sug, /bloquearPeriodo\(tx, a\.periodo\)/);
  assert.match(sug, /if \(!aplicar\) continue;/);
});

test("script aplicar-sugerencias-existentes: dry-run por defecto, host obligatorio y verificado ANTES de abrir la base", () => {
  const src = readFileSync("prisma/scripts/aplicar-sugerencias-existentes.ts", "utf8");
  assert.match(src, /const aplicar = process\.argv\.includes\("--aplicar"\)/);
  assert.match(src, /falta --host-esperado/);
  assert.ok(src.indexOf("host !== hostEsperado") < src.indexOf('await import("@prisma/client")'), "la guardia va antes de importar y abrir la base");
  assert.ok(src.indexOf("host !== hostEsperado") < src.indexOf("sugerirAExistentes("), "la guardia va antes de leer");
  assert.match(src, /config\.sugerenciasPorHistorial/);
  assert.match(src, /sugerirAExistentes\(prisma, \{[^}]*ingresoPorDefecto: config\.ingresoPorDefecto, umbrales: config\.umbralesSugerencia \}, aplicar\)/);
  assert.doesNotMatch(src, /\.deleteMany|\.delete\(|DROP |TRUNCATE/i);
});

test("script de sembrado: una sola entrada para las tres empresas, dry-run por defecto y guardia de host antes de la base", () => {
  const src = readFileSync("prisma/scripts/sembrar-historial-empresa.ts", "utf8");
  for (const slug of ['"havanna-peru"', "bradenton:", '"plate-silver"']) assert.ok(src.includes(slug), slug);
  assert.match(src, /equivalenciaBradenton\(f\.etiqueta, f\.tipo\)/);
  assert.match(src, /equivalenciaEtiquetaPlateSilver\(f\.etiqueta\)/);
  assert.match(src, /dedup: "entre-origenes"/);
  assert.ok(src.indexOf("if (!aplicar) {") < src.indexOf("host !== hostEsperado"), "sin --aplicar no se llega a la base");
  assert.ok(src.indexOf("host !== hostEsperado") < src.indexOf("new PrismaClient()"));
  assert.doesNotMatch(src, /\.deleteMany|\.delete\(/);
});

test("la acción de carga pasa la regla de respaldo de la empresa y avisa cuántos ingresos salieron por regla", () => {
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  assert.match(src, /aplicarSugerenciasAFilas\(nuevas, indice, config\.ingresoPorDefecto, config\.umbralesSugerencia\)/);
  assert.match(src, /ingresos sin coincidencia en el historial/);
});

// ---- Umbral propio de Bradenton ------------------------------------------------------------------

// 60 depósitos de efectivo, 3 de ICE MACHINE y 4 de FOOD TRUCK con el MISMO texto: DEP EFECTIVO domina con 60/67 = 89,6 %.
const DEPOSITOS = [
  { concepto: "DEPOSIT ID NUMBER 293053", signo: 1, clasificacion: "DEP EFECTIVO", veces: 60 },
  { concepto: "DEPOSIT ID NUMBER 293052", signo: 1, clasificacion: "VENTA ICE MACHINE-TC", veces: 3 },
  { concepto: "DEPOSIT ID NUMBER 293058", signo: 1, clasificacion: "COBRO FOOD TRUCK", veces: 4 },
];

test("umbral de Bradenton: 85 % (con las 3 apariciones de siempre); solo Bradenton lo tiene", () => {
  assert.deepEqual(configDeEmpresa("bradenton")!.umbralesSugerencia, { minApariciones: 3, minDominancia: 0.85 });
  assert.equal(configDeEmpresa("havanna-peru")!.umbralesSugerencia, undefined);
  assert.equal(configDeEmpresa("plate-silver")!.umbralesSugerencia, undefined);
  assert.equal(UMBRALES_INICIALES.minDominancia, 0.9);
});

test("umbral de Bradenton: con el 90 % general los depósitos no se sugieren; con el 85 % de Bradenton sí (DEP EFECTIVO)", () => {
  const indice = construirIndiceDeEmpresa(DEPOSITOS, LISTA_B);
  assert.equal(sugerir("DEPOSIT ID NUMBER 999999", 100, indice), null);
  assert.equal(sugerirConRegla("DEPOSIT ID NUMBER 999999", 100, indice), null);
  const u = configDeEmpresa("bradenton")!.umbralesSugerencia!;
  assert.deepEqual(sugerirConRegla("DEPOSIT ID NUMBER 999999", 100, indice, null, u), { clasificacion: "DEP EFECTIVO", origen: "historial" });
  // También por el camino de «aplicar a lo ya cargado» y por el de la carga.
  const mov = [{ id: "1", concepto: "DEPOSIT ID NUMBER 999999", importe: 100 }];
  assert.equal(calcularSugerenciasParaMovimientos(mov, indice, null, u).sugerencias[0]?.clasificacion, "DEP EFECTIVO");
  assert.equal(calcularSugerenciasParaMovimientos(mov, indice).sugerencias.length, 0);
  assert.equal(aplicarSugerenciasAFilas([fila("DEPOSIT ID NUMBER 999999", 10000)], indice, null, u).sugeridas, 1);
  assert.equal(aplicarSugerenciasAFilas([fila("DEPOSIT ID NUMBER 999999", 10000)], indice).sugeridas, 0);
});

test("umbral de Bradenton: no baja la exigencia de apariciones ni habilita empates ni el 80/20", () => {
  const u = configDeEmpresa("bradenton")!.umbralesSugerencia!;
  const pocas = construirIndiceDeEmpresa([{ concepto: "ALGO", signo: 1, clasificacion: "DEP EFECTIVO", veces: 2 }], LISTA_B);
  assert.equal(sugerir("ALGO", 1, pocas, u), null);
  const empate = construirIndiceDeEmpresa(
    [
      { concepto: "ALGO", signo: 1, clasificacion: "DEP EFECTIVO", veces: 5 },
      { concepto: "ALGO", signo: 1, clasificacion: "REBATE", veces: 5 },
    ],
    LISTA_B
  );
  assert.equal(sugerir("ALGO", 1, empate, u), null);
  const dudoso = construirIndiceDeEmpresa(
    [
      { concepto: "ALGO", signo: 1, clasificacion: "DEP EFECTIVO", veces: 8 },
      { concepto: "ALGO", signo: 1, clasificacion: "REBATE", veces: 2 },
    ],
    LISTA_B
  );
  assert.equal(sugerir("ALGO", 1, dudoso, u), null);
});

test("los umbrales de la empresa llegan a la carga, a la aplicación sobre lo cargado y al script", () => {
  assert.match(readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8"), /aplicarSugerenciasAFilas\(nuevas, indice, config\.ingresoPorDefecto, config\.umbralesSugerencia\)/);
  assert.match(readFileSync("lib/clasificacionHistorialDb.ts", "utf8"), /calcularSugerenciasParaMovimientos\(movimientos, indice, a\.ingresoPorDefecto, a\.umbrales\)/);
  assert.match(readFileSync("prisma/scripts/aplicar-sugerencias-existentes.ts", "utf8"), /umbrales: config\.umbralesSugerencia/);
});
