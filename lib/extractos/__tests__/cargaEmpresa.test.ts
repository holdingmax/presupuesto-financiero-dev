import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPRESAS_CON_CARGA_EN_REPORTE, EMPRESAS_CON_EXTRACTO_POR_EMPRESA } from "@/lib/config";
import { puedeCargarRealConAcceso } from "@/lib/permisosReal";
import { puedeCargarMadreEjecucion } from "@/lib/permisosEjecucion";
import { errorPeriodoNoHabilitado } from "@/lib/periodosHabilitados";
import { slugDeEmpresa } from "@/lib/slug";
import { decimalTextoDeCentavos } from "@/lib/conteoMovimientos";
import { validarCuenta } from "@/lib/cuentasBancarias";
import { BANCOS_EXTRACTO } from "@/lib/extractos/tipos";
import { BANCO_BBVA_PERU, BANCOS_CUENTA, CUENTAS_BBVA_PERU } from "@/lib/extractos/bancosCuenta";
import { leerHavannaPeru } from "@/lib/extractos/havannaPeru";
import { leerPestanaHavannaPeru } from "@/lib/extractos/havannaPeruPestanas";
import {
  CONFIG_EXTRACTO_EMPRESA,
  armarFilasACargar,
  configDeEmpresa,
  errorDeLectura,
  errorFechasFueraDelPeriodo,
  planificarCarga,
  rangoDelPeriodo,
  resolverCuentasForzadas,
  type CuentaDeLaBase,
  type FilaACargar,
  type FilaExistente,
} from "@/lib/extractos/cargaEmpresa";
import { MOVS_OCTUBRE, libroCompleto, type OpcionesLibro } from "./fixtures/havannaPeru";

const HOY = new Date(Date.UTC(2026, 10, 10));
const EMPRESA = "emp-peru";
const CONFIG = configDeEmpresa("havanna-peru")!;

const CUENTAS_OK: CuentaDeLaBase[] = [
  { id: "c1", nombre: "BBVA PERÚ SOLES", banco: BANCO_BBVA_PERU, activa: true, empresaId: EMPRESA, moneda: "PEN" },
  { id: "c2", nombre: "BBVA PERÚ USD", banco: BANCO_BBVA_PERU, activa: true, empresaId: EMPRESA, moneda: "USD" },
];

function lecturaOct(libro: OpcionesLibro = {}) {
  const hoja = leerPestanaHavannaPeru(libroCompleto(libro), "MOVIMIENTOS OCTUBRE 26");
  return leerHavannaPeru(hoja, { monedaCuenta: "PEN", hoy: HOY });
}
function filasOct(libro: OpcionesLibro = {}): FilaACargar[] {
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, CUENTAS_OK);
  assert.ok(r.ok);
  return armarFilasACargar(lecturaOct(libro), CONFIG, r.cuentas);
}
// Lo que quedaría en la base después de cargar esas filas (como lo devolvería el SELECT).
const comoExistentes = (filas: FilaACargar[]): FilaExistente[] =>
  filas.map((f) => ({
    fecha: f.fecha,
    importe: decimalTextoDeCentavos(f.importeCentavos),
    bancoYCuenta: f.bancoYCuenta,
    concepto: f.concepto,
    nroReferencia: f.nroReferencia,
    saldo: null,
    moneda: f.moneda,
  }));

// ------------------------------------------------------------------ config y lista

test("config: Havanna Perú y Bradenton, cada una con su entrada, y con Reporte por plantilla", () => {
  assert.deepEqual([...EMPRESAS_CON_EXTRACTO_POR_EMPRESA], ["havanna-peru", "bradenton"]);
  for (const slug of EMPRESAS_CON_EXTRACTO_POR_EMPRESA) {
    assert.ok(CONFIG_EXTRACTO_EMPRESA[slug], `falta la entrada de ${slug}`);
    assert.ok(EMPRESAS_CON_CARGA_EN_REPORTE.includes(slug));
  }
  assert.deepEqual(Object.keys(CONFIG_EXTRACTO_EMPRESA), [...EMPRESAS_CON_EXTRACTO_POR_EMPRESA]);
  assert.equal(slugDeEmpresa("Havanna Perú"), "havanna-peru");
  assert.equal(configDeEmpresa("havanna"), null, "otra empresa: no está habilitada");
  assert.equal(configDeEmpresa("brillante"), null);
  assert.equal(CONFIG.unidad, "HAVANNA PERU");
  assert.deepEqual(CONFIG.cuentaPorMoneda, { PEN: "BBVA PERÚ SOLES", USD: "BBVA PERÚ USD" });
});

// ------------------------------------------------------------------ permisos

test("permisos: ADMIN y FINANZAS pasan; el gerente solo con la tilde de ESA empresa", () => {
  assert.equal(puedeCargarRealConAcceso({ rol: "ADMIN" }, null), true);
  assert.equal(puedeCargarRealConAcceso({ rol: "FINANZAS" }, null), true);
  assert.equal(puedeCargarRealConAcceso({ rol: "GERENTE" }, { puedeOperarEjecucion: true }), true, "gerente con tilde");
  assert.equal(puedeCargarRealConAcceso({ rol: "GERENTE" }, { puedeOperarEjecucion: false }), false, "gerente sin tilde");
  assert.equal(puedeCargarRealConAcceso({ rol: "GERENTE" }, null), false, "gerente sin fila en esa empresa (otra empresa)");
});

test("permisos: la acción nueva pide requireCargaRealEmpresa(empresaId) ANTES de leer nada", () => {
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  const permiso = src.indexOf("await requireCargaRealEmpresa(empresaId)");
  assert.ok(permiso > 0);
  for (const despues of ["prisma.empresa.findUnique", "formData.get", "prisma.cuentaBancaria", "leerHavannaPeru(", "prisma.$transaction"]) {
    assert.ok(src.indexOf(despues) > permiso, `${despues} tiene que ir después del permiso`);
  }
  const guarda = readFileSync("lib/cargaRealEmpresa.ts", "utf8");
  assert.ok(guarda.includes("requireAccesoEmpresa(empresaId)"), "y la guarda exige acceso a ESA empresa");
});

test("permisos: subirMadre sigue cerrada (solo ADMIN/FINANZAS) y no se tocó", () => {
  assert.equal(puedeCargarMadreEjecucion({ rol: "GERENTE", operaEjecucion: true } as never), false);
  assert.equal(puedeCargarMadreEjecucion({ rol: "ADMIN", operaEjecucion: false } as never), true);
  const src = readFileSync("app/ejecucion/actions.ts", "utf8");
  const madre = src.slice(src.indexOf("export async function subirMadre"), src.indexOf("export async function actualizarMovimiento"));
  assert.ok(madre.includes("requireCargaMadreEjecucion()"));
  assert.ok(!madre.includes("requireCargaRealEmpresa"));
});

test("subirExtracto y subirMadre no conocen el camino nuevo", () => {
  const src = readFileSync("app/ejecucion/actions.ts", "utf8");
  assert.ok(!/havannaPeru|cargaEmpresa|subirExtractoEmpresa|bancosCuenta|tipoCambio/i.test(src));
});

test("período: la acción valida el período habilitado antes de leer el archivo", () => {
  assert.notEqual(errorPeriodoNoHabilitado("2099-01"), null, "un período no habilitado se rechaza");
  assert.equal(errorPeriodoNoHabilitado("2026-10"), null);
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  assert.ok(src.indexOf("errorPeriodoNoHabilitado(periodo)") > 0);
  assert.ok(src.indexOf("errorPeriodoNoHabilitado(periodo)") < src.indexOf('formData.get("archivo")'));
});

test("empresa no configurada: la acción la rechaza con el mensaje de config", () => {
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  assert.ok(src.includes("configDeEmpresa(slugDeEmpresa(empresa.nombre))"));
  assert.ok(src.includes("ERROR_EMPRESA_SIN_EXTRACTO"));
});

// ------------------------------------------------------------------ cuentas forzadas

test("cuentas forzadas: existen y son de la empresa → una por moneda", () => {
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, CUENTAS_OK);
  assert.ok(r.ok);
  assert.equal(r.cuentas.PEN.nombre, "BBVA PERÚ SOLES");
  assert.equal(r.cuentas.USD.nombre, "BBVA PERÚ USD");
  // El nombre se compara sin tildes ni mayúsculas.
  const sinTilde = CUENTAS_OK.map((c) => ({ ...c, nombre: c.nombre.replace("Ú", "u").toLowerCase() }));
  assert.ok(resolverCuentasForzadas(CONFIG, EMPRESA, sinTilde).ok);
});

test("cuentas forzadas: si falta alguna, rechaza con mensaje claro", () => {
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, [CUENTAS_OK[0]]);
  assert.ok(!r.ok);
  assert.match(r.error, /no existe la cuenta BBVA PERÚ USD/);
  assert.match(r.error, /Administración → Cuentas bancarias/);
  assert.match(r.error, /No se cargó nada/);
  const ninguna = resolverCuentasForzadas(CONFIG, EMPRESA, []);
  assert.ok(!ninguna.ok && ninguna.error.includes("BBVA PERÚ SOLES") && ninguna.error.includes("BBVA PERÚ USD"));
});

test("cuentas forzadas: inactiva, de otra empresa, de otro banco o con otra moneda → rechaza", () => {
  const con = (i: number, cambio: Partial<CuentaDeLaBase>) => CUENTAS_OK.map((c, k) => (k === i ? { ...c, ...cambio } : c));
  const casos: [Partial<CuentaDeLaBase>, RegExp][] = [
    [{ activa: false }, /inactiva/],
    [{ empresaId: "otra" }, /no es de esta empresa/],
    [{ empresaId: null }, /no es de esta empresa/],
    [{ banco: "MACRO" }, /no es del banco BBVA Perú/],
    [{ moneda: "ARS" }, /moneda ARS/],
  ];
  for (const [cambio, patron] of casos) {
    const r = resolverCuentasForzadas(CONFIG, EMPRESA, con(1, cambio));
    assert.ok(!r.ok, JSON.stringify(cambio));
    assert.match(r.error, patron);
  }
});

// ------------------------------------------------------------------ unidad y cuentas en las filas

test("filas: cada una va a la cuenta de su moneda, con moneda, sin saldo", () => {
  const filas = filasOct();
  assert.equal(filas.length, 5);
  for (const f of filas) {
    assert.equal(f.bancoYCuenta, f.moneda === "PEN" ? "BBVA PERÚ SOLES" : "BBVA PERÚ USD");
    assert.equal(f.saldoCentavos, null);
  }
  assert.equal(filas.filter((f) => f.moneda === "USD").length, 2);
  assert.equal(filas[0].nroReferencia, "0000221444");
});

test("filas: unidad FORZADA HAVANNA PERU, explícita (no sugerida), todo SIN CLASIFICAR", () => {
  const filas = filasOct();
  assert.ok(filas.every((f) => f.unidadNegocio === "HAVANNA PERU"));
  assert.ok(filas.every((f) => f.unidadSugeridaPorSistema === false));
  assert.ok(filas.every((f) => f.clasificacion === "SIN CLASIFICAR" && f.clasificacion2 === null && f.sugeridaPorSistema === false));
});

test("filas: el archivo no puede cambiar la unidad (el lector no lee ninguna; DETALLE no llega)", () => {
  const hoja = leerPestanaHavannaPeru(libroCompleto(), "MOVIMIENTOS OCTUBRE 26");
  // Una columna extra "Unidad de negocio" con otro valor no cambia nada.
  hoja.filas[0].push("UNIDAD DE NEGOCIO");
  hoja.filas.slice(1, 6).forEach((f) => (f[12] = "BRILLANTE"));
  const l = leerHavannaPeru(hoja, { monedaCuenta: "PEN", hoy: HOY });
  const r = resolverCuentasForzadas(CONFIG, EMPRESA, CUENTAS_OK);
  assert.ok(r.ok);
  assert.ok(armarFilasACargar(l, CONFIG, r.cuentas).every((f) => f.unidadNegocio === "HAVANNA PERU" && f.detalle === null));
});

// ------------------------------------------------------------------ regla dura de la lectura

test("REGLA DURA: pie que no cuadra → no se carga nada (con la moneda y el motivo)", () => {
  const l = lecturaOct({ saldoFinalPen: 1234.56 });
  const e = errorDeLectura(l, CONFIG, "MOVIMIENTOS OCTUBRE 26");
  assert.ok(e);
  assert.match(e, /no cuadra en PEN/);
  assert.match(e, /No se cargó nada/);
  assert.match(errorDeLectura(lecturaOct({ saldoFinalUsd: 1 }), CONFIG, "X")!, /no cuadra en USD/);
});

test("REGLA DURA: la acción corta ANTES de la transacción cuando hay errores", () => {
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  const corte = src.indexOf("errorDeLectura(lectura, config, nombrePestana)");
  assert.ok(corte > 0);
  assert.ok(corte < src.indexOf("prisma.$transaction"));
  assert.ok(corte < src.indexOf("createMany"));
});

test("pie que cuadra y con Moneda: sin error de lectura", () => {
  assert.equal(errorDeLectura(lecturaOct(), CONFIG, "X"), null);
});

test("sin columna Moneda: no se puede repartir entre las dos cuentas → rechaza (no asume en silencio)", () => {
  const l = lecturaOct({ conMoneda: false, movimientos: MOVS_OCTUBRE.filter((m) => m.mon === "Soles") });
  assert.equal(l.monedaAsumida, true);
  assert.match(errorDeLectura(l, CONFIG, "MOVIMIENTOS OCTUBRE 26")!, /no tiene columna Moneda/);
  assert.equal(lecturaOct().monedaAsumida, false);
});

test("fechas fuera del período: rechaza (no reparte entre meses)", () => {
  const filas = filasOct();
  assert.equal(errorFechasFueraDelPeriodo(filas, "2026-10"), null);
  assert.match(errorFechasFueraDelPeriodo(filas, "2026-11")!, /5 movimientos tienen fecha fuera de 2026-11/);
  assert.deepEqual(
    [rangoDelPeriodo("2026-10").desde.toISOString().slice(0, 10), rangoDelPeriodo("2026-10").hasta.toISOString().slice(0, 10)],
    ["2026-10-01", "2026-10-31"]
  );
});

// ------------------------------------------------------------------ reconocimiento y resubida

test("primera carga: todo es nuevo", () => {
  const filas = filasOct();
  const p = planificarCarga(filas, []);
  assert.equal(p.nuevas.length, 5);
  assert.equal(p.cantidadYaCargadas, 0);
  assert.equal(p.bloqueo, null);
  assert.deepEqual(p.avisos, []);
});

test("resubida del MISMO mes: no duplica (0 nuevas) y lo avisa", () => {
  const filas = filasOct();
  const p = planificarCarga(filasOct(), comoExistentes(filas));
  assert.equal(p.nuevas.length, 0);
  assert.equal(p.cantidadYaCargadas, 5);
  assert.equal(p.bloqueo, null);
  assert.match(p.avisos[0], /ya está cargado/);
});

test("resubida con algunas ya cargadas: se cargan solo las que faltan (N − M) y avisa", () => {
  const filas = filasOct();
  const p = planificarCarga(filas, comoExistentes(filas.slice(0, 2)));
  assert.equal(p.nuevas.length, 3);
  assert.equal(p.cantidadYaCargadas, 2);
  assert.match(p.avisos[0], /Ya hay 2 movimientos/);
});

test("N − M cuenta: dos filas iguales en el archivo y una ya cargada → se carga una", () => {
  const f = filasOct()[0];
  const p = planificarCarga([f, { ...f, numeroFila: 99 }], comoExistentes([f]));
  assert.equal(p.nuevas.length, 1);
  assert.equal(p.cantidadYaCargadas, 1);
});

test("mismo movimiento con Nº Doc distinto: claves distintas, entran los dos", () => {
  const dos = filasOct({
    movimientos: [
      { mon: "Soles", dia: 0, cod: 527, doc: "0000000001", concepto: "ITF", importe: -1.45 },
      { mon: "Soles", dia: 0, cod: 527, doc: "0000000002", concepto: "ITF", importe: -1.45 },
    ],
    sinPie: true,
  });
  assert.notEqual(dos[0].clave, dos[1].clave);
  assert.equal(planificarCarga(dos, []).nuevas.length, 2);
  // Con una ya cargada, solo falta la otra.
  assert.equal(planificarCarga(dos, comoExistentes([dos[0]])).nuevas.length, 1);
});

test("el reconocimiento distingue cuenta/moneda: lo de soles no tapa lo de dólares", () => {
  const filas = filasOct();
  const soloSoles = filas.filter((f) => f.moneda === "PEN");
  const p = planificarCarga(filas, comoExistentes(soloSoles));
  assert.equal(p.cantidadYaCargadas, 3);
  assert.deepEqual(p.nuevas.map((f) => f.moneda), ["USD", "USD"]);
});

test("movimientos de esas cuentas que no vienen en el archivo: aviso, no se tocan", () => {
  const filas = filasOct();
  const otro: FilaExistente = { ...comoExistentes([filas[0]])[0], nroReferencia: "9999999999", concepto: "OTRA COSA", importe: "7.00" };
  const p = planificarCarga(filas, [...comoExistentes(filas), otro]);
  assert.equal(p.nuevas.length, 0);
  assert.ok(p.avisos.some((a) => a.includes("NO vienen en este archivo")));
});

test("cargado antes por otro camino (misma fecha e importe, otra clave): bloquea para no duplicar", () => {
  const filas = filasOct();
  const otroCamino = comoExistentes(filas).map((e) => ({ ...e, nroReferencia: null, concepto: "TEXTO DISTINTO" }));
  const p = planificarCarga(filas, otroCamino);
  assert.ok(p.bloqueo);
  assert.match(p.bloqueo, /por otro camino/);
  assert.match(p.bloqueo, /No se cargó nada/);
});

test("la consulta de lo ya cargado es por nombre EXACTO de la cuenta (el nombre lleva tilde)", () => {
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  assert.ok(src.includes('mb."bancoYCuenta" = ANY(${nombresCuentas}::text[])'));
  assert.ok(!src.includes("regexp_replace"));
});

test("misma transacción y mismos locks que subirExtracto (por cuenta y por período)", () => {
  const src = readFileSync("app/ejecucion/actionsExtractoEmpresa.ts", "utf8");
  assert.ok(src.includes('"ejecucion:cuenta:" + n'));
  assert.ok(src.includes("bloquearPeriodo(tx, ejecucion.periodo)"));
  assert.ok(src.indexOf("pg_advisory_xact_lock") < src.indexOf("$queryRaw<FilaExistente[]>"));
  assert.ok(src.indexOf("$queryRaw<FilaExistente[]>") < src.indexOf("createMany"));
  // Sin vista previa confirmada no escribe.
  assert.ok(src.indexOf("!opciones.confirmarVistaPrevia") < src.indexOf("createMany"));
});

// ------------------------------------------------------------------ banco BBVA Perú y no regresión

test("BBVA Perú y Chase se suman a la lista de bancos de las cuentas sin tocar los 6 de los lectores", () => {
  assert.deepEqual([...BANCOS_EXTRACTO], ["MACRO", "GALICIA", "FRANCES", "BNA", "SANT", "BSE"]);
  assert.deepEqual([...BANCOS_CUENTA], [...BANCOS_EXTRACTO, "BBVA_PERU", "CHASE"]);
});

test("cuentas: BBVA PERÚ SOLES y USD se validan; otro nombre o repetida no", () => {
  const ok = validarCuenta({ nombre: "bbva peru soles", banco: BANCO_BBVA_PERU, terminacion: "" }, []);
  assert.deepEqual(ok, { ok: true, cuenta: { nombre: CUENTAS_BBVA_PERU.PEN, banco: BANCO_BBVA_PERU, terminacion: "", moneda: "PEN" } });
  assert.ok(validarCuenta({ nombre: "BBVA PERÚ USD", banco: BANCO_BBVA_PERU, terminacion: "1234" }, []).ok);
  assert.ok(!validarCuenta({ nombre: "BBVA PERÚ EUR", banco: BANCO_BBVA_PERU, terminacion: "" }, []).ok);
  assert.ok(!validarCuenta({ nombre: "BBVA PERÚ SOLES", banco: BANCO_BBVA_PERU, terminacion: "12" }, []).ok);
  const rep = validarCuenta({ nombre: "BBVA PERÚ SOLES", banco: BANCO_BBVA_PERU, terminacion: "" }, [
    { id: "x", nombre: "BBVA PERÚ SOLES", activa: true },
  ]);
  assert.ok(!rep.ok && /Ya existe/.test(rep.error));
});

test("cuentas: las de los 6 bancos de siempre se validan igual que antes", () => {
  assert.deepEqual(validarCuenta({ nombre: " frances  891 ", banco: "FRANCES", terminacion: "891" }, []), {
    ok: true,
    cuenta: { nombre: "FRANCES 891", banco: "FRANCES", terminacion: "891" },
  });
  assert.ok(!validarCuenta({ nombre: "BBVA PERÚ SOLES", banco: "FRANCES", terminacion: "891" }, []).ok, "el nombre de Perú no vale con otro banco");
  assert.ok(!validarCuenta({ nombre: "MACRO 599", banco: "BBVA_PERUX", terminacion: "599" }, []).ok);
});

test("no regresión: ningún archivo existente de extractos importa el camino nuevo", () => {
  for (const f of ["lib/extractos/archivo.ts", "lib/extractos/detectar.ts", "lib/extractos/contenedor.ts", "lib/extractos/madre.ts", "lib/extractos/tipos.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/havannaPeru|cargaEmpresa|bancosCuenta/.test(src), f);
  }
});
