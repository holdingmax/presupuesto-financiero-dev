import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { armarCalidadDelMes, type FilaDeCalidadPorLote, type FilaSinAsignar } from "@/lib/dashboard/calidad";
import { accesoDelDashboard } from "@/lib/dashboard/accesoUsuario";
import { filaSinReporte, totalesDeEgresosOperativos, type CeldaDeAvance, type FilaDeAvance } from "@/lib/dashboard/avance";
import { armarControlDepositos } from "@/lib/dashboard/controles";
import { armarEncabezadoDeAvance, fechaDelControl, opcionesDeMes, periodoDelDashboard } from "@/lib/dashboard/encabezado";
import { cantidad, ddMm, importeDeAvance, porcentajeDeAvance } from "@/lib/dashboard/formato";
import { iniciarCargasDelDashboard } from "@/lib/dashboard/iniciarCargas";
import { aResultado, crearLimitador } from "@/lib/dashboard/limitador";
import type { FilaDeLote } from "@/lib/dashboard/semana";
import {
  CalidadVista,
  ControlDeDepositosVista,
  FilaConErrorVista,
  FilaDeAvanceVista,
  PieDeTotalesVista,
  PieNoDisponibleVista,
  TituloDeAvance,
  marcasDeFila,
} from "@/app/dashboard/vistas";
import { IDS_ACTIVAS, alcanceDe } from "@/lib/dashboard/__tests__/fixturesAlcance";

// ENTREGA 3: la pantalla /dashboard. Qué se renderiza y qué NO por rol (las vistas son síncronas y se renderizan a HTML), el
// limitador de lecturas, el formato y los candados estáticos (solo lectura, un único componente de navegador, enlace en la home).

const RAIZ = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const celda = (p: number | null, r: number | null): CeldaDeAvance => ({
  presupuestado: p,
  real: r,
  avance: p !== null && r !== null && p !== 0 ? (r / p) * 100 : null,
  presupuestoIncompleto: false,
  realIncompleto: false,
});

function fila(extra: Partial<FilaDeAvance> = {}): FilaDeAvance {
  return {
    empresaId: "brillante",
    nombre: "Brillante",
    slug: "brillante",
    moneda: "ARS",
    sinReporte: false,
    estadoPresupuesto: "validado",
    cartelPresupuesto: null,
    incluyePartesManualesOParciales: false,
    realManualPendiente: false,
    corte: "2026-11-13",
    ritmo: { diasConDatos: 13, diasDelMes: 30, porcentaje: (13 / 30) * 100 },
    ingresos: celda(742_58_000_00, 100_09_000_00),
    egresosOperativos: celda(674_96_000_00, 394_29_000_00),
    ...extra,
  };
}

const lote = (estado: "ABIERTA" | "CERRADA", n: number, extra: Partial<FilaDeCalidadPorLote> = {}): FilaDeCalidadPorLote => ({
  estado, movimientos: n, sinClasificar: 0, clasificacionSugerida: 0, unidadSugerida: 0, chequeIvaAmbiguo: 0, saldoFaltante: 0, otraMoneda: 0, ...extra,
});
const SIN_ASIGNAR: FilaSinAsignar[] = [{ moneda: "ARS", movimientos: 60, enLotesAbiertos: 60, ingresosCentavos: 429_30, egresosCentavos: -429_30 }];
const SEMANAS: FilaDeLote[] = [{ lunes: "2026-11-09", periodo: "2026-11", estado: "CERRADA", movimientos: 100, ultimaFecha: "2026-11-13" }];

async function calidadParaRol(rol: "ADMIN" | "FINANZAS" | "GERENTE" | "VIEWER", ids: string[]) {
  const alcance = await alcanceDe(rol, ids);
  const acceso = accesoDelDashboard({ rol, operaEjecucion: false });
  return armarCalidadDelMes({
    alcance,
    acceso: { verSaldos: acceso.verSaldos },
    periodo: "2026-11",
    porLote: [lote("CERRADA", 1000, { saldoFaltante: 2, unidadSugerida: 508 })],
    semanas: SEMANAS,
    clasificaciones: { movimientos: 205, deMovimientos: 8266 },
    sinAsignar: SIN_ASIGNAR,
  });
}

// ---- Qué se renderiza por rol ----------------------------------------------------------------------------------

test("ADMIN: la calidad del dato trae «Sin asignar» como bloque aparte, con importes", async () => {
  const salida = html(createElement(CalidadVista, { calidad: await calidadParaRol("ADMIN", []) }));
  assert.match(salida, /Sin asignar/);
  assert.match(salida, /Movimientos sin saldo/);
  assert.match(salida, /429/);
});

test("FINANZAS, GERENTE y VIEWER: el HTML de la calidad NO trae «Sin asignar» (ni oculto con CSS: el texto no existe), aunque tengan las 12 empresas", async () => {
  for (const rol of ["FINANZAS", "GERENTE", "VIEWER"] as const) {
    for (const ids of [["brillante"], IDS_ACTIVAS]) {
      const salida = html(createElement(CalidadVista, { calidad: await calidadParaRol(rol, ids) }));
      assert.doesNotMatch(salida, /Sin asignar|sin-asignar|Sin unidad de negocio|429/i, `${rol} ${ids.length}`);
      assert.doesNotMatch(salida, /Depósitos de cheques|control-depositos/i, rol);
      assert.doesNotMatch(salida, /hidden|display:\s*none|sr-only[^>]*Sin asignar/i, rol);
    }
  }
});

test("GERENTE y VIEWER: no ven «Movimientos sin saldo» (reservado); ADMIN y FINANZAS sí", async () => {
  for (const rol of ["GERENTE", "VIEWER"] as const) {
    assert.doesNotMatch(html(createElement(CalidadVista, { calidad: await calidadParaRol(rol, ["brillante"]) })), /Movimientos sin saldo/, rol);
  }
  for (const rol of ["ADMIN", "FINANZAS"] as const) {
    assert.match(html(createElement(CalidadVista, { calidad: await calidadParaRol(rol, IDS_ACTIVAS) })), /Movimientos sin saldo/, rol);
  }
});

test("el control de depósitos de cheques: la vista dice «Control aparte: no se suma a ningún total» y muestra neto por moneda", () => {
  const control = armarControlDepositos("2026-11-12", [{ moneda: "ARS", netoCentavos: 7_240_000_00, movimientos: 90, enLotesAbiertos: 0 }]);
  const salida = html(createElement(ControlDeDepositosVista, { control }));
  assert.match(salida, /Depósitos de cheques pendientes de registro/);
  assert.match(salida, /09\/11 al 15\/11/);
  assert.match(salida, /no se suma a ningún total/);
  assert.match(salida, /90 movimientos/);
  assert.match(html(createElement(ControlDeDepositosVista, { control: null })), /No hay movimientos en el mes/);
});

test("las cargas del dashboard: el control existe SOLO para ADMIN (para el resto es null y no se consulta); el VIEWER con las 12 ve su dashboard", async () => {
  const usuarios = { ADMIN: { rol: "ADMIN", operaEjecucion: false }, FINANZAS: { rol: "FINANZAS", operaEjecucion: false }, GERENTE: { rol: "GERENTE", operaEjecucion: false }, VIEWER: { rol: "VIEWER", operaEjecucion: false, veBloquesReservados: true } } as const;
  for (const rol of ["FINANZAS", "GERENTE", "VIEWER"] as const) {
    for (const ids of [[], ["brillante"], IDS_ACTIVAS]) {
      const alcance = await alcanceDe(rol, ids);
      const cargas = iniciarCargasDelDashboard(alcance, usuarios[rol], "2026-11");
      assert.strictEqual(cargas.control, null, `${rol} ${ids.length}`);
      assert.deepEqual([...cargas.empresas.keys()].sort(), alcance.empresas.map((e) => e.id).sort(), "una promesa por empresa del alcance, ninguna más");
      if (alcance.vacio) {
        assert.equal((await cargas.contexto).estado, "ok", "alcance vacío: no se consulta la base");
        assert.deepEqual((await cargas.calidad).estado, "ok");
        const r = await cargas.calidad;
        assert.ok(r.estado === "ok" && r.valor.sinAsignar === null);
      }
    }
  }
  const alcanceAdmin = await alcanceDe("ADMIN", []);
  assert.notStrictEqual(iniciarCargasDelDashboard(alcanceAdmin, usuarios.ADMIN, "2026-11").control, null);
});

test("las cargas exigen el período habilitado y un alcance de la misma sesión", async () => {
  const gerente = await alcanceDe("GERENTE", []);
  const cargas = iniciarCargasDelDashboard(gerente, { rol: "GERENTE", operaEjecucion: false }, "2026-12");
  assert.equal((await cargas.contexto).estado, "error", "2026-12 no está habilitado: ni ADMIN lo abre");
  assert.throws(() => iniciarCargasDelDashboard(gerente, { rol: "ADMIN", operaEjecucion: false }, "2026-11"), /no corresponde/);
  const admin = await alcanceDe("ADMIN", []);
  assert.throws(() => iniciarCargasDelDashboard(admin, { rol: "VIEWER", operaEjecucion: false }, "2026-11"), /no corresponde/);
});

// ---- Avance del mes --------------------------------------------------------------------------------------------

test("fila de avance: egresos operativos (P, R, %, ritmo) e ingresos (P, R, %), con formato del Reporte y enlace al Reporte", () => {
  const salida = html(createElement("table", null, createElement("tbody", null, createElement(FilaDeAvanceVista, { fila: fila(), hrefReporte: "/brillante/2026-11/reporte" }))));
  assert.match(salida, /href="\/brillante\/2026-11\/reporte"/);
  assert.match(salida, /\$67\.496\.000/);
  assert.match(salida, /\$39\.429\.000/);
  assert.match(salida, />58%</);
  assert.match(salida, />43%</, "ritmo del mes");
  assert.match(salida, /13 de 30 días con datos/);
  assert.match(salida, /\$74\.258\.000/);
  assert.match(salida, />13%</);
});

test("marcas de estado: presupuesto sin validar, sin presupuesto, partes manuales o parciales, Real manual pendiente y sin Reporte por plantilla", () => {
  assert.deepEqual(marcasDeFila(fila({ estadoPresupuesto: "sinValidar", cartelPresupuesto: "presupuesto sin validar", incluyePartesManualesOParciales: true, realManualPendiente: true })), [
    "presupuesto sin validar",
    "incluye partes manuales o parciales",
    "Real manual pendiente",
  ]);
  assert.deepEqual(marcasDeFila(fila({ estadoPresupuesto: "sinPresupuesto", cartelPresupuesto: "sin presupuesto" })), ["sin presupuesto"]);
  assert.deepEqual(marcasDeFila(filaSinReporte({ id: "expensas", nombre: "Expensas", slug: "expensas" })), ["sin Reporte por plantilla"]);
  assert.deepEqual(marcasDeFila(fila()), []);
});

test("Expensas y los datos que faltan se muestran «—», nunca 0", () => {
  const e = filaSinReporte({ id: "expensas", nombre: "Expensas", slug: "expensas" });
  const salida = html(createElement("table", null, createElement("tbody", null, createElement(FilaDeAvanceVista, { fila: e, hrefReporte: "/expensas/2026-11/reporte" }))));
  assert.equal((salida.match(/>—</g) ?? []).length, 7, "las 7 celdas numéricas");
  assert.match(salida, /sin Reporte por plantilla/);
  assert.doesNotMatch(salida, /\$0\b/);
});

test("monedas separadas: Bradenton en dólares y Havanna Perú en soles llevan su símbolo, no el peso", () => {
  const usd = html(createElement("table", null, createElement("tbody", null, createElement(FilaDeAvanceVista, { fila: fila({ nombre: "Bradenton", slug: "bradenton", moneda: "USD", egresosOperativos: celda(100_000_00, 50_000_00) }), hrefReporte: "/b" }))));
  assert.match(usd, /US\$ 100\.000/);
  assert.match(usd, /\(US\$\)/);
  const pen = html(createElement("table", null, createElement("tbody", null, createElement(FilaDeAvanceVista, { fila: fila({ nombre: "Havanna Perú", slug: "havanna-peru", moneda: "PEN" }), hrefReporte: "/h" }))));
  assert.match(pen, /S\/ /);
});

test("el pie: total por moneda, rotulado «Total del holding» solo para ADMIN y «Total de tus empresas» para el resto; los ingresos no se suman", async () => {
  const filas = [fila({ empresaId: "brillante", nombre: "Brillante" }), fila({ empresaId: "radio", nombre: "Radio", slug: "radio", egresosOperativos: celda(100_14_000_00, 65_81_000_00) })];
  const admin = await alcanceDe("ADMIN", []);
  const pieAdmin = html(createElement(PieDeTotalesVista, { totales: totalesDeEgresosOperativos(filas, admin) }));
  assert.match(pieAdmin, /Total del holding/);
  assert.match(pieAdmin, /egresos operativos/);
  assert.match(pieAdmin, /Los ingresos no se suman/);
  for (const rol of ["FINANZAS", "GERENTE", "VIEWER"] as const) {
    const a = await alcanceDe(rol, ["brillante", "radio"]);
    const pie = html(createElement(PieDeTotalesVista, { totales: totalesDeEgresosOperativos(filas, a) }));
    assert.match(pie, /Total de tus empresas/, rol);
    assert.doesNotMatch(pie, /holding/i, rol);
  }
  // el total de ADMIN con una empresa de otra moneda: dos filas de pie, una por moneda
  assert.match(html(createElement(PieNoDisponibleVista)), /falta cargar alguna empresa/);
});

test("el pie no muestra una suma parcial: si falta un dato, lo dice", async () => {
  const a = await alcanceDe("ADMIN", []);
  const filas = [fila({ empresaId: "brillante" }), fila({ empresaId: "radio", nombre: "Radio", slug: "radio", egresosOperativos: celda(100, null) })];
  const pie = html(createElement(PieDeTotalesVista, { totales: totalesDeEgresosOperativos(filas, a) }));
  assert.match(pie, /no se muestra una suma parcial/);
  assert.doesNotMatch(pie, /\$\d/);
});

test("error de una empresa: mensaje genérico, sin detalles", () => {
  const salida = html(createElement("table", null, createElement("tbody", null, createElement(FilaConErrorVista, { nombre: "Radio" }))));
  assert.match(salida, /No se pudo cargar esta empresa/);
});

// ---- Encabezado y selector de mes ------------------------------------------------------------------------------

test("título: «Avance de <mes> · datos al dd/mm · N % del mes» y el aviso de semanas provisorias con los movimientos afuera", () => {
  const semanas: FilaDeLote[] = [
    { lunes: "2026-10-26", periodo: "2026-10", estado: "CERRADA", movimientos: 100, ultimaFecha: "2026-10-30" },
    { lunes: "2026-10-26", periodo: "2026-10", estado: "ABIERTA", movimientos: 45, ultimaFecha: "2026-10-31" },
  ];
  const e = armarEncabezadoDeAvance("2026-10", semanas);
  const salida = html(createElement(TituloDeAvance, { encabezado: e }));
  assert.match(salida, /Avance de Octubre 2026 · datos al 30\/10 · 97 % del mes/);
  assert.match(salida, /Hay 1 semana con movimientos todavía en lotes abiertos: 45 movimientos quedan afuera/);
  const limpio = html(createElement(TituloDeAvance, { encabezado: armarEncabezadoDeAvance("2026-11", SEMANAS) }));
  assert.match(limpio, /Avance de Noviembre 2026 · datos al 13\/11 · 43 % del mes/);
  assert.doesNotMatch(limpio, /lotes abiertos/);
  assert.equal(html(createElement(TituloDeAvance, { encabezado: armarEncabezadoDeAvance("2026-11", []) })).includes("datos al"), false);
});

test("el selector de mes solo ofrece los períodos habilitados y cualquier otro valor cae en el último", () => {
  assert.deepEqual(opcionesDeMes("2026-11").map((o) => o.periodo), ["2026-10", "2026-11"]);
  assert.deepEqual(opcionesDeMes("2026-10").map((o) => o.actual), [true, false]);
  for (const v of [undefined, "", "2026-09", "2026-12", "2027-01", "abc", ["2026-10", "2026-11"], "2026-10'; DROP TABLE x;--", "2026-1"]) {
    assert.equal(periodoDelDashboard(v), "2026-11", JSON.stringify(v));
  }
  assert.equal(periodoDelDashboard("2026-10"), "2026-10");
});

test("el control semanal se mira en la fecha del último dato del mes (con lotes abiertos), o ninguna si el mes está vacío", () => {
  const semanas: FilaDeLote[] = [
    { lunes: "2026-10-26", periodo: "2026-10", estado: "CERRADA", movimientos: 1, ultimaFecha: "2026-10-30" },
    { lunes: "2026-10-26", periodo: "2026-10", estado: "ABIERTA", movimientos: 1, ultimaFecha: "2026-10-31" },
  ];
  assert.equal(fechaDelControl("2026-10", semanas), "2026-10-31");
  assert.equal(fechaDelControl("2026-11", semanas), null);
});

// ---- Formato ---------------------------------------------------------------------------------------------------

test("formato: pesos enteros es-AR, negativos con «-», faltantes «—», símbolos por moneda y porcentajes enteros", () => {
  assert.equal(importeDeAvance(123_456_700, "ARS"), "$1.234.567");
  assert.equal(importeDeAvance(-50_000, "ARS"), "-$500");
  assert.equal(importeDeAvance(null, "ARS"), "—");
  assert.equal(importeDeAvance(100_000_00, "USD"), "US$ 100.000");
  assert.equal(importeDeAvance(5_00, "PEN"), "S/ 5");
  assert.equal(porcentajeDeAvance(98.5), "99%");
  assert.equal(porcentajeDeAvance(null), "—");
  assert.equal(cantidad(19872), "19.872");
  assert.equal(ddMm("2026-11-13"), "13/11");
});

// ---- Limitador -------------------------------------------------------------------------------------------------

test("limitador: a lo sumo 2 trabajos a la vez, en orden de llegada, aunque se pidan más", async () => {
  for (const pedido of [1, 2, 5, 0, Number.NaN]) {
    const limitar = crearLimitador(pedido);
    let activas = 0;
    let maximo = 0;
    const orden: number[] = [];
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        limitar(async () => {
          orden.push(i);
          activas++;
          maximo = Math.max(maximo, activas);
          await new Promise((ok) => setTimeout(ok, 2));
          activas--;
        })
      )
    );
    assert.deepEqual(orden, Array.from({ length: 12 }, (_, i) => i), `pedido ${pedido}: orden de arranque`);
    assert.ok(maximo >= 1 && maximo <= 2, `pedido ${pedido}: máximo ${maximo}`);
  }
});

test("limitador: un trabajo que falla (también de forma síncrona) libera su lugar y no frena a los demás", async () => {
  const limitar = crearLimitador();
  const resultados = await Promise.all([
    aResultado(limitar(async () => { throw new Error("secreto interno"); })),
    aResultado(limitar(() => { throw new Error("falla síncrona"); })),
    aResultado(limitar(async () => 3)),
    aResultado(limitar(async () => 4)),
  ]);
  assert.deepEqual(resultados.map((r) => r.estado), ["error", "error", "ok", "ok"]);
  assert.deepEqual(resultados[0], { estado: "error" }, "el resultado de error no trae el mensaje");
});

// ---- Candados estáticos de la pantalla -------------------------------------------------------------------------

const ARCHIVOS_PANTALLA = readdirSync(join(RAIZ, "app", "dashboard")).sort();

test("la pantalla es de solo lectura: ningún archivo de app/dashboard tiene Server Actions, formularios ni escritura", () => {
  assert.deepEqual(ARCHIVOS_PANTALLA, ["Progreso.tsx", "cargas.tsx", "page.tsx", "vistas.tsx"]);
  for (const archivo of ARCHIVOS_PANTALLA) {
    const f = sinComentarios(leer(`app/dashboard/${archivo}`));
    assert.doesNotMatch(f, /["']use server["']/, archivo);
    assert.doesNotMatch(f, /<form\b|\baction=\{|\.create\(|\.update\(|\.delete\(|\.upsert\(|\$executeRaw|\$queryRaw|from\s+["']@\/lib\/prisma["']/, archivo);
  }
});

test("el único componente de navegador es Progreso.tsx y solo recibe un número y ids de empresas del propio alcance", () => {
  const conCliente = ARCHIVOS_PANTALLA.filter((a) => /^\s*["']use client["']/m.test(leer(`app/dashboard/${a}`)));
  assert.deepEqual(conCliente, ["Progreso.tsx"]);
  const progreso = sinComentarios(leer("app/dashboard/Progreso.tsx"));
  assert.doesNotMatch(progreso, /from\s+["']@\/lib\//, "no importa nada de lib (ni datos ni tipos del dashboard)");
  assert.match(progreso, /ProgresoProvider\(\{ total, children \}: \{ total: number; children: ReactNode \}\)/);
  assert.match(progreso, /Listo\(\{ id \}: \{ id: string \}\)/);
  const page = sinComentarios(leer("app/dashboard/page.tsx"));
  assert.match(page, /<ProgresoProvider total=\{alcance\.empresas\.length\}>/, "solo la cantidad de las empresas del propio alcance");
  assert.equal((page.match(/<Listo\b/g) ?? []).length, 0);
  assert.match(sinComentarios(leer("app/dashboard/cargas.tsx")), /<Listo id=\{empresa\.id\} \/>/);
});

test("page.tsx: el alcance sale de la sesión, el mes se limita a los habilitados, y el control de administración solo se genera si existe", () => {
  const page = sinComentarios(leer("app/dashboard/page.tsx"));
  assert.match(page, /resolverAlcanceDeSesion\(\)/);
  assert.match(page, /periodoDelDashboard\(pedido\)/);
  assert.doesNotMatch(page, /resolverAlcance\s*\(/, "nunca con un usuario propio");
  assert.match(page, /\{cargas\.control && \(/);
  assert.doesNotMatch(page, /"ADMIN"|"FINANZAS"|"GERENTE"|"VIEWER"|usuario\.rol/, "la pantalla no decide por rol: lo decide el servidor en el alcance");
  assert.match(page, /ordenarFilas\(alcance\.empresas\)/, "orden alfabético");
  // La búsqueda no toma empresas, unidades ni usuarios de la URL: lo único que lee es el mes.
  assert.match(page, /const \{ periodo: pedido \} = await searchParams;/);
});

test("ningún componente de la pantalla importa Prisma, auth ni resuelve alcances por su cuenta (solo page.tsx pide el alcance)", () => {
  for (const archivo of ARCHIVOS_PANTALLA.filter((a) => a !== "page.tsx")) {
    const f = sinComentarios(leer(`app/dashboard/${archivo}`));
    assert.doesNotMatch(f, /resolverAlcance|requireUsuario|from\s+["']@\/lib\/auth["']/, archivo);
  }
});

test("la home: el enlace al dashboard está para TODOS los roles (fuera de cualquier condición de rol) y no se rompieron los de siempre", () => {
  const home = leer("app/page.tsx");
  const iNav = home.indexOf('<nav aria-label="Secciones del sistema"');
  const antes = home.slice(home.lastIndexOf("{/* Cada grupo", iNav), iNav);
  assert.doesNotMatch(antes, /&& \(\s*$/, "el nav ya no depende del rol");
  const iEnlace = home.indexOf('<Link href="/dashboard"');
  assert.ok(iNav > -1 && iEnlace > iNav);
  const hastaEnlace = home.slice(iNav, iEnlace);
  assert.doesNotMatch(hastaEnlace, /veTodoEjecucion|esAdminOFinanzas|usuario\.rol|esViewer/, "el enlace no está dentro de un grupo condicionado por rol");
  assert.match(home, /Dashboard semanal/);
  // Los enlaces de siempre siguen, cada uno con su condición.
  for (const enlace of ['href={`/ejecucion/${PERIODO_POR_DEFECTO}`}', 'href="/admin/pago-referencia"', 'href="/admin/cheque-iva-referencia"', 'href="/admin/cuentas-bancarias"', 'href="/admin/tipo-cambio"', 'href="/admin/usuarios"', 'href="/admin/unidades-negocio"', 'href="/admin/reparto-expensas"', 'href="/cuenta"']) {
    assert.ok(home.includes(enlace), enlace);
  }
  assert.match(home, /\{veTodoEjecucion\(usuario\) && \(\s*<li>\s*<Link href=\{`\/ejecucion/);
  assert.match(home, /\{usuario\.rol === "ADMIN" && \(\s*<li>\s*<Link href="\/admin\/usuarios"/);
  assert.match(home, /enlaceDeEmpresaViewer\(slugDeEmpresa\(empresa\.nombre\)\)/);
});

test("las vistas no calculan: ninguna importa el motor, el cargador ni consultas", () => {
  for (const archivo of ["vistas.tsx", "cargas.tsx"]) {
    const f = sinComentarios(leer(`app/dashboard/${archivo}`));
    assert.doesNotMatch(f, /lib\/reporte|cargarAvance|cargarCalidad|consultas/, archivo);
  }
  assert.doesNotMatch(sinComentarios(leer("app/dashboard/vistas.tsx")), /\.reduce\(|Math\.(round|floor)\(/);
});
