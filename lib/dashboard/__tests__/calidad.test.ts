import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ROTULOS_DE_INDICADOR,
  armarCalidadDelMes,
  armarSemanasProvisorias,
  contarClasificacionesSinFila,
  indicadoresVisibles,
  reglaDeClasificaciones,
  type FilaDeCalidadPorLote,
  type FilaSinAsignar,
} from "@/lib/dashboard/calidad";
import { leerCalidadPorLote, leerClasificacionesDelMes, leerCortesPorUnidad, leerPresupuestosDelMes, leerSinAsignar } from "@/lib/dashboard/consultasMes";
import { accesoDelDashboard } from "@/lib/dashboard/accesoUsuario";
import { rangoDeMes, type FilaDeLote } from "@/lib/dashboard/semana";
import { clasificacionesOcultasParaUsuario } from "@/lib/clasificacionesOcultas";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { IDS_ACTIVAS, alcanceDe } from "@/lib/dashboard/__tests__/fixturesAlcance";
import type { Alcance } from "@/lib/dashboard/alcance";

// ENTREGA 2, bloque B: calidad del dato. Quién ve cada indicador (un caso por rol), qué no puede deducirse y los candados
// de las consultas. Sin base: las consultas con alcance vacío o sin permiso no consultan.

const DIR = join(__dirname, "..");
const fuente = (archivo: string) => readFileSync(join(DIR, archivo), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

const lote = (estado: "ABIERTA" | "CERRADA", n: number, extra: Partial<FilaDeCalidadPorLote> = {}): FilaDeCalidadPorLote => ({
  estado,
  movimientos: n,
  sinClasificar: 0,
  clasificacionSugerida: 0,
  unidadSugerida: 0,
  chequeIvaAmbiguo: 0,
  saldoFaltante: 0,
  otraMoneda: 0,
  ...extra,
});

const SEMANAS: FilaDeLote[] = [
  { lunes: "2026-10-26", periodo: "2026-10", estado: "CERRADA", movimientos: 100, ultimaFecha: "2026-10-30" },
  { lunes: "2026-10-26", periodo: "2026-10", estado: "ABIERTA", movimientos: 45, ultimaFecha: "2026-10-31" },
  { lunes: "2026-10-26", periodo: "2026-11", estado: "CERRADA", movimientos: 7, ultimaFecha: "2026-11-01" },
  { lunes: "2026-10-19", periodo: "2026-10", estado: "CERRADA", movimientos: 90, ultimaFecha: "2026-10-25" },
];

const SIN_ASIGNAR: FilaSinAsignar[] = [{ moneda: "ARS", movimientos: 60, enLotesAbiertos: 60, ingresosCentavos: 429_30, egresosCentavos: -429_30 }];

async function calidad(rol: "ADMIN" | "FINANZAS" | "GERENTE" | "VIEWER", ids: string[], operaEjecucion = false) {
  const alcance = await alcanceDe(rol, ids);
  const acceso = accesoDelDashboard({ rol, operaEjecucion });
  return armarCalidadDelMes({
    alcance,
    acceso: { verSaldos: acceso.verSaldos },
    periodo: "2026-10",
    porLote: [lote("CERRADA", 1000, { unidadSugerida: 508, saldoFaltante: 53 }), lote("ABIERTA", 409, { sinClasificar: 97, saldoFaltante: 227, otraMoneda: 409 })],
    semanas: SEMANAS,
    clasificaciones: { movimientos: 812, deMovimientos: 19_932 },
    sinAsignar: SIN_ASIGNAR, // la consulta real devuelve null para quien no es ADMIN; acá se prueba que la capa pura tampoco lo deja pasar
  });
}

// ---- Indicadores -----------------------------------------------------------------------------------------------

test("indicadores: totales del mes y cuántos están en lotes abiertos (los que todavía no entran en el Reporte)", async () => {
  const c = await calidad("ADMIN", []);
  const por = Object.fromEntries(c.indicadores.map((i) => [i.clave, i]));
  assert.equal(por.sinClasificar.total, 97);
  assert.equal(por.sinClasificar.enLotesAbiertos, 97);
  assert.equal(por.unidadSugeridaSinConfirmar.total, 508);
  assert.equal(por.unidadSugeridaSinConfirmar.enLotesAbiertos, 0, "las 508 están en lotes cerrados");
  assert.equal(por.saldoFaltante.total, 280);
  assert.equal(por.saldoFaltante.enLotesAbiertos, 227);
  assert.equal(por.otraMoneda.total, 409);
  assert.equal(c.movimientosEnLotesCerrados, 1000);
  assert.equal(c.movimientosEnLotesAbiertos, 409);
  assert.deepEqual(c.clasificacionesSinFila, { movimientos: 812, deMovimientos: 19_932 });
});

test("semanas provisorias del mes: cuántas y cuántos movimientos quedan afuera; «datos al» solo con lotes cerrados del mes", async () => {
  const s = armarSemanasProvisorias(SEMANAS, "2026-10");
  assert.deepEqual({ ...s }, { semanas: 1, movimientosAfuera: 45 });
  // el mes siguiente de la misma semana no cuenta la parte de octubre
  assert.deepEqual({ ...armarSemanasProvisorias(SEMANAS, "2026-11") }, { semanas: 0, movimientosAfuera: 0 });
  const c = await calidad("ADMIN", []);
  assert.equal(c.datosAl, "30/10", "el lote abierto (31/10) no cuenta");
});

test("armarCalidadDelMes rechaza cantidades imposibles", async () => {
  const alcance = await alcanceDe("ADMIN", []);
  const base = { alcance, acceso: { verSaldos: true }, periodo: "2026-10", semanas: [], clasificaciones: { movimientos: 0, deMovimientos: 0 }, sinAsignar: null };
  assert.throws(() => armarCalidadDelMes({ ...base, porLote: [lote("CERRADA", -1)] }), /inválida/);
  assert.throws(() => armarCalidadDelMes({ ...base, porLote: [lote("CERRADA", 1.5)] }), /inválida/);
});

// ---- Quién ve cada indicador: un caso por rol ------------------------------------------------------------------

test("ADMIN: ve todos los indicadores, incluido saldo faltante, y la línea aparte «Sin asignar»", async () => {
  const c = await calidad("ADMIN", []);
  assert.deepEqual(c.indicadores.map((i) => i.clave), ["sinClasificar", "clasificacionSugeridaSinConfirmar", "unidadSugeridaSinConfirmar", "chequeIvaAmbiguo", "saldoFaltante", "otraMoneda"]);
  assert.ok(c.sinAsignar);
  assert.equal(c.sinAsignar.rotulo, "Sin asignar");
  assert.deepEqual(c.sinAsignar.porMoneda.map((f) => [f.moneda, f.movimientos]), [["ARS", 60]]);
});

test("FINANZAS (con las 12 empresas): ve saldo faltante pero NO «Sin asignar» (no es el holding)", async () => {
  const c = await calidad("FINANZAS", IDS_ACTIVAS);
  assert.ok(c.indicadores.some((i) => i.clave === "saldoFaltante"));
  assert.strictEqual(c.sinAsignar, null);
});

test("GERENTE: sin saldo faltante (reservado) y sin «Sin asignar»; con operaEjecucion sí ve saldos pero tampoco «Sin asignar»", async () => {
  for (const ids of [["brillante"], IDS_ACTIVAS]) {
    const c = await calidad("GERENTE", ids);
    assert.ok(!c.indicadores.some((i) => i.clave === "saldoFaltante"), `${ids.length} empresas`);
    assert.strictEqual(c.sinAsignar, null);
    assert.equal(c.indicadores.length, 5);
  }
  const opera = await calidad("GERENTE", ["brillante"], true);
  assert.ok(opera.indicadores.some((i) => i.clave === "saldoFaltante"));
  assert.strictEqual(opera.sinAsignar, null);
});

test("VIEWER: nunca ve saldo faltante ni «Sin asignar», aunque la base diga operaEjecucion y tenga las 12 empresas", async () => {
  for (const opera of [false, true]) {
    const c = await calidad("VIEWER", IDS_ACTIVAS, opera);
    assert.ok(!c.indicadores.some((i) => i.clave === "saldoFaltante"));
    assert.strictEqual(c.sinAsignar, null);
    assert.equal(JSON.stringify(c).includes("429"), false, "ni un importe de «sin asignar»");
  }
});

test("un valor de «saldo faltante» no se filtra por otro camino: sin permiso la clave no existe", () => {
  assert.deepEqual(indicadoresVisibles({ verSaldos: false }).includes("saldoFaltante"), false);
  assert.deepEqual(indicadoresVisibles({ verSaldos: true }).includes("saldoFaltante"), true);
});

test("el resultado no trae nada que deje deducir otras empresas: sin nombres, sin cantidad de empresas, sin % sobre el total", async () => {
  const c = await calidad("GERENTE", ["brillante", "radio"]);
  assert.deepEqual(Object.keys(c).sort(), ["clasificacionesSinFila", "datosAl", "indicadores", "movimientosEnLotesAbiertos", "movimientosEnLotesCerrados", "periodo", "semanasProvisorias", "sinAsignar"]);
  for (const i of c.indicadores) assert.deepEqual(Object.keys(i).sort(), ["clave", "enLotesAbiertos", "rotulo", "total"]);
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.indicadores));
  const texto = JSON.stringify(c).toLowerCase();
  for (const palabra of ["brillante", "radio", "fredy", "empresas", "holding"]) assert.equal(texto.includes(palabra), false, palabra);
});

test("los rótulos no mencionan ninguna empresa ni cantidad de empresas", () => {
  for (const r of Object.values(ROTULOS_DE_INDICADOR)) assert.doesNotMatch(r, /empresa|holding|\d/i);
});

// ---- Clasificaciones sin fila ----------------------------------------------------------------------------------

test("clasificaciones sin fila propia en el Reporte de su empresa: se cuentan sobre los movimientos en pesos de empresas con plantilla", () => {
  const reglas = new Map([["BRILLANTE", reglaDeClasificaciones(PLANTILLAS_POR_SLUG["brillante"], [])]]);
  const plantilla = PLANTILLAS_POR_SLUG["brillante"];
  const conFila = plantilla.filas.flatMap((f) => (f.tipo === "linea" && f.real.tipo === "clasificaciones" ? f.real.clasificaciones : []))[0];
  const r = contarClasificacionesSinFila(
    [
      { unidad: "BRILLANTE", clasificacion: conFila, movimientos: 10 },
      { unidad: "BRILLANTE", clasificacion: "CLASIFICACION QUE NADIE LEE", movimientos: 3 },
      { unidad: "EXPENSAS", clasificacion: "LO QUE SEA", movimientos: 500 }, // sin plantilla: ni numerador ni denominador
    ],
    reglas
  );
  assert.deepEqual({ ...r }, { movimientos: 3, deMovimientos: 13 });
});

test("SIN CLASIFICAR tiene su propio indicador y no se cuenta acá", () => {
  const reglas = new Map([["BRILLANTE", reglaDeClasificaciones(PLANTILLAS_POR_SLUG["brillante"], [])]]);
  const r = contarClasificacionesSinFila([{ unidad: "BRILLANTE", clasificacion: "SIN CLASIFICAR", movimientos: 97 }], reglas);
  assert.deepEqual({ ...r }, { movimientos: 0, deMovimientos: 0 });
});

test("DEP CH 3° no cuenta en ningún lado (es un control aparte, solo ADMIN): ni en el numerador ni en el denominador", () => {
  const reglas = new Map([["BRILLANTE", reglaDeClasificaciones(PLANTILLAS_POR_SLUG["brillante"], [])]]);
  for (const c of ["DEP CH 3°", "dep ch 3°", " DEP  CH 3° "]) {
    assert.deepEqual({ ...contarClasificacionesSinFila([{ unidad: "BRILLANTE", clasificacion: c, movimientos: 277 }], reglas) }, { movimientos: 0, deMovimientos: 0 }, c);
  }
});

test("las clasificaciones ocultas para el usuario no entran: gerente (y VIEWER) de Conexión no cuentan AVION, MS ni PRESTAMO MS; ADMIN sí", () => {
  const slug = "conexion-logistica";
  const filas = [
    { unidad: "LOGISTICA", clasificacion: "AVION", movimientos: 100 },
    { unidad: "SPP", clasificacion: "MS", movimientos: 50 },
    { unidad: "LOGISTICA", clasificacion: "OTRA SIN FILA", movimientos: 1 },
  ];
  const para = (u: { rol: string; operaEjecucion: boolean }) => {
    const regla = reglaDeClasificaciones(PLANTILLAS_POR_SLUG[slug], clasificacionesOcultasParaUsuario(slug, u));
    return contarClasificacionesSinFila(filas, new Map([["LOGISTICA", regla], ["SPP", regla]]));
  };
  const gerente = para({ rol: "GERENTE", operaEjecucion: false });
  assert.deepEqual({ ...gerente }, { movimientos: 1, deMovimientos: 1 });
  assert.deepEqual({ ...para({ rol: "VIEWER", operaEjecucion: true }) }, { movimientos: 1, deMovimientos: 1 }, "VIEWER como gerente, aunque opere");
  const admin = para({ rol: "ADMIN", operaEjecucion: false });
  assert.ok(admin.deMovimientos > gerente.deMovimientos, "ADMIN cuenta lo oculto (si tiene o no fila propia lo dice el Reporte)");
});

// ---- Las consultas: alcance, rol y sin consultar ---------------------------------------------------------------

test("«Sin asignar»: para quien no es ADMIN devuelve null SIN consultar, con cualquier período (aun uno inválido)", async () => {
  for (const rol of ["FINANZAS", "GERENTE", "VIEWER"] as const) {
    for (const ids of [[], ["brillante"], IDS_ACTIVAS]) {
      const a = await alcanceDe(rol, ids);
      for (const periodo of ["2026-10", "2026-13", "octubre", ""]) {
        assert.strictEqual(await leerSinAsignar(a, periodo), null, `${rol} ${ids.length} ${periodo}`);
      }
    }
  }
});

test("alcance vacío: ninguna consulta toca la base y devuelven vacío", async () => {
  for (const rol of ["FINANZAS", "GERENTE", "VIEWER"] as const) {
    const a = await alcanceDe(rol, []);
    assert.equal(a.vacio, true);
    assert.deepEqual(await leerCalidadPorLote(a, "2026-10", { verSaldos: true }), []);
    assert.deepEqual(await leerClasificacionesDelMes(a, "2026-10"), []);
    assert.deepEqual(await leerCortesPorUnidad(a, "2026-10"), []);
    assert.equal((await leerPresupuestosDelMes(a, "2026-10")).size, 0);
  }
});

test("un Alcance falsificado se rechaza en todas las consultas por mes, antes de mirar nada", async () => {
  const falso = { empresas: [], unidades: ["BRILLANTE"], vacio: false, esHolding: true } as unknown as Alcance;
  await assert.rejects(leerCalidadPorLote(falso, "2026-10", { verSaldos: true }), /Alcance inválido/);
  await assert.rejects(leerClasificacionesDelMes(falso, "2026-10"), /Alcance inválido/);
  await assert.rejects(leerSinAsignar(falso, "2026-10"), /Alcance inválido/);
  await assert.rejects(leerCortesPorUnidad(falso, "2026-10"), /Alcance inválido/);
  await assert.rejects(leerPresupuestosDelMes(falso, "2026-10"), /Alcance inválido/);
});

test("el período se valida antes de consultar (nada de texto libre en el SQL)", async () => {
  const a = await alcanceDe("GERENTE", ["brillante"]);
  for (const periodo of ["2026-13", "2026-00", "octubre", "", "2026-10'; DROP TABLE \"Usuario\"; --"]) {
    await assert.rejects(leerCalidadPorLote(a, periodo, { verSaldos: false }), /Período inválido/, JSON.stringify(periodo));
    await assert.rejects(leerCortesPorUnidad(a, periodo), /Período inválido/, JSON.stringify(periodo));
  }
});

test("rango del mes: [primer día, primer día del mes siguiente), también en diciembre", () => {
  assert.deepEqual(rangoDeMes("2026-11"), { desde: "2026-11-01", hasta: "2026-12-01" });
  assert.deepEqual(rangoDeMes("2026-12"), { desde: "2026-12-01", hasta: "2027-01-01" });
  assert.throws(() => rangoDeMes("2026-1"), /Período inválido/);
});

// ---- Candados estáticos de consultasMes.ts ---------------------------------------------------------------------

test("consultasMes.ts: cada función valida el Alcance primero y las de movimientos filtran unidad y prorrateo en las dos ramas, sin ignorados", () => {
  const f = sinComentarios(fuente("consultasMes.ts"));
  const funciones = f.split(/^export async function /m).slice(1);
  assert.deepEqual(funciones.map((x) => x.slice(0, x.indexOf("("))), ["leerCalidadPorLote", "leerClasificacionesDelMes", "leerSinAsignar", "leerCortesPorUnidad", "leerPresupuestosDelMes"]);
  for (const fn of funciones) {
    const nombre = fn.slice(0, fn.indexOf("("));
    assert.match(fn, /^\w+\(\s*alcance: Alcance,/, nombre);
    assert.ok(fn.slice(fn.indexOf("{\n")).trimStart().slice(1).trimStart().startsWith("exigirAlcance(alcance);"), `${nombre}: valida el Alcance primero`);
    assert.ok(fn.indexOf("exigirAlcance(alcance)") < Math.max(fn.indexOf("prisma"), fn.indexOf("$queryRaw")), nombre);
  }
  for (const nombre of ["leerCalidadPorLote", "leerClasificacionesDelMes", "leerCortesPorUnidad"]) {
    const fn = funciones.find((x) => x.startsWith(nombre))!;
    assert.match(fn, /const unidades = \[\.\.\.alcance\.unidades\];/, nombre);
    assert.match(fn, /NOT EXISTS \(SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d\."movimientoId" = m\.id\)/, nombre);
    assert.match(fn, /upper\(btrim\(d\."unidadNegocio"\)\) = ANY\(\$\{unidades\}::text\[\]\)/, nombre);
    assert.match(fn, /upper\(btrim\(m\."unidadNegocio"\)\) = ANY\(\$\{unidades\}::text\[\]\)/, nombre);
    assert.match(fn, /WHERE NOT mb\.ignorado/, nombre);
  }
  // «Sin asignar» solo después de comprobar que el alcance es el holding
  const sinAsignar = funciones.find((x) => x.startsWith("leerSinAsignar"))!;
  assert.ok(sinAsignar.indexOf("if (!alcance.esHolding) return null;") > -1 && sinAsignar.indexOf("if (!alcance.esHolding) return null;") < sinAsignar.indexOf("$queryRaw"));
  // los presupuestos salen de las empresas del Alcance validado
  const pres = funciones.find((x) => x.startsWith("leerPresupuestosDelMes"))!;
  assert.match(pres, /empresaId: \{ in: alcance\.empresas\.map\(\(e\) => e\.id\) \}/);
});

test("la regla de la unidad sugerida en prorrateos: solo cuenta si la unidad del movimiento PADRE es del alcance", () => {
  const f = sinComentarios(fuente("consultasMes.ts"));
  assert.match(f, /COUNT\(\*\) FILTER \(WHERE p\.usug AND upper\(btrim\(p\."unidadNegocio"\)\) = ANY\(\$\{unidades\}::text\[\]\)\)/);
});

test("«saldo faltante» solo se calcula con permiso de saldos y solo en cuentas bancarias reales", () => {
  const f = sinComentarios(fuente("consultasMes.ts"));
  assert.match(f, /FILTER \(WHERE \$\{verSaldos\}::boolean AND p\.saldo IS NULL AND p\.cuenta !~\* '\^\(efectivo\|cheque\|brou\|d\.lar\|\[\(\]sin banco\[\)\]\)'\)/);
});

test("lib/dashboard: DEP CH 3° sigue conocido solo por controles.ts y consultas.ts (calidad usa el helper sinDepositosDeCheques)", () => {
  const conDeposito = readdirSync(DIR)
    .filter((x) => x.endsWith(".ts"))
    .filter((x) => /DEP CH|esDepositoDeCheques|CLASIFICACION_DEPOSITO/.test(readFileSync(join(DIR, x), "utf8")))
    .sort();
  assert.deepEqual(conDeposito, ["consultas.ts", "controles.ts"]);
  assert.match(sinComentarios(fuente("calidad.ts")), /sinDepositosDeCheques\(filas/);
});

test("calidad.ts es puro (sin Prisma ni next) y no muestra ni cuenta empresas", () => {
  for (const archivo of ["calidad.ts", "avance.ts", "accesoUsuario.ts"]) {
    const f = sinComentarios(fuente(archivo));
    assert.doesNotMatch(f, /from\s+["'](@\/lib\/prisma|next\/)/, archivo);
    assert.doesNotMatch(f, /\bempresas\.(length|size)\b/, archivo);
  }
});
