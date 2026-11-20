import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARTEL_DE_ESTADO,
  EMPRESAS_CON_REAL_MANUAL,
  MAXIMA_CONCURRENCIA,
  armarFilaDeAvance,
  conConcurrencia,
  corteDeEmpresa,
  diasDelMes,
  estadoDePresupuesto,
  extraerAvance,
  filaSinReporte,
  monedaDeEmpresa,
  ordenarFilas,
  ritmoDelMes,
  totalesDeEgresosOperativos,
  type CeldaDeAvance,
  type FilaDeAvance,
} from "@/lib/dashboard/avance";
import { accesoDelDashboard, exigirAlcanceDelUsuario } from "@/lib/dashboard/accesoUsuario";
import { armarReporte, type AccesoReservados, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";
import { IDS_ACTIVAS, alcanceDe } from "@/lib/dashboard/__tests__/fixturesAlcance";

// ENTREGA 2, bloque A: avance del mes contra el presupuesto. Reglas puras, conciliación contra el Reporte y candados estáticos.

const DIR = join(__dirname, "..");
const fuente = (archivo: string) => readFileSync(join(DIR, archivo), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

const celda = (p: number | null, r: number | null, extra: Partial<CeldaDeAvance> = {}): CeldaDeAvance => ({
  presupuestado: p,
  real: r,
  avance: p !== null && r !== null && p !== 0 ? (r / p) * 100 : null,
  presupuestoIncompleto: false,
  realIncompleto: false,
  ...extra,
});

function fila(id: string, nombre: string, slug: string, egresos: CeldaDeAvance | null, extra: Partial<FilaDeAvance> = {}): FilaDeAvance {
  return {
    empresaId: id,
    nombre,
    slug,
    moneda: monedaDeEmpresa(slug),
    sinReporte: false,
    estadoPresupuesto: "validado",
    cartelPresupuesto: null,
    incluyePartesManualesOParciales: false,
    realManualPendiente: false,
    corte: "2026-11-13",
    ritmo: ritmoDelMes("2026-11", "2026-11-13"),
    ingresos: celda(1, 1),
    egresosOperativos: egresos,
    ...extra,
  };
}

// ---- Moneda ----------------------------------------------------------------------------------------------------

test("moneda de cada empresa: Bradenton y Plate Silver en dólares, Havanna Perú en soles, el resto en pesos", () => {
  assert.equal(monedaDeEmpresa("bradenton"), "USD");
  assert.equal(monedaDeEmpresa("plate-silver"), "USD");
  assert.equal(monedaDeEmpresa("havanna-peru"), "PEN");
  for (const slug of ["brillante", "havanna", "radio", "fredy-publicidad", "hwc", "mantenor", "avianor", "conexion-logistica", "expensas"]) {
    assert.equal(monedaDeEmpresa(slug), "ARS", slug);
  }
});

test("el Real 100 % manual es solo de las tres empresas del extracto por empresa", () => {
  assert.deepEqual([...EMPRESAS_CON_REAL_MANUAL].sort(), ["bradenton", "havanna-peru", "plate-silver"]);
});

// ---- Ritmo del mes ---------------------------------------------------------------------------------------------

test("días del mes: noviembre 30, octubre 31, febrero de año bisiesto 29", () => {
  assert.equal(diasDelMes("2026-11"), 30);
  assert.equal(diasDelMes("2026-10"), 31);
  assert.equal(diasDelMes("2028-02"), 29);
  assert.equal(diasDelMes("2027-02"), 28);
  assert.throws(() => diasDelMes("2026-13"), /Período inválido/);
  assert.throws(() => diasDelMes("noviembre"), /Período inválido/);
});

test("ritmo: días con datos sobre días del mes, informativo (13/30 = 43,3 %)", () => {
  const r = ritmoDelMes("2026-11", "2026-11-13")!;
  assert.equal(r.diasConDatos, 13);
  assert.equal(r.diasDelMes, 30);
  assert.ok(Math.abs(r.porcentaje - 43.333333) < 1e-4);
  assert.deepEqual(Object.keys(r).sort(), ["diasConDatos", "diasDelMes", "porcentaje"], "sin umbrales ni juicios");
  assert.ok(Object.isFrozen(r));
});

test("ritmo: mes cerrado (corte el último día) = 100 %; sin datos o corte de otro mes = null", () => {
  assert.equal(ritmoDelMes("2026-10", "2026-10-31")!.porcentaje, 100);
  assert.equal(ritmoDelMes("2026-11", null), null);
  assert.equal(ritmoDelMes("2026-11", "2026-10-31"), null);
});

test("el ritmo usa el corte de datos, no la fecha de hoy", () => {
  const codigo = sinComentarios(fuente("avance.ts"));
  assert.doesNotMatch(codigo, /new Date\(\)|Date\.now\(/);
});

test("corte de una empresa: la última fecha entre SUS unidades; las de otra empresa se ignoran", () => {
  const ultimas = new Map([["LOGISTICA", "2026-11-12"], ["SPP", "2026-11-13"], ["RADIO", "2026-11-30"]]);
  assert.equal(corteDeEmpresa(["LOGISTICA", "SPP"], ultimas), "2026-11-13");
  assert.equal(corteDeEmpresa(["AVIANOR"], ultimas), null);
});

// ---- Estado del presupuesto ------------------------------------------------------------------------------------

test("estado del presupuesto: sin presupuesto, sin líneas, sin validar (se calcula con cartel) y validado", () => {
  assert.equal(estadoDePresupuesto(undefined), "sinPresupuesto");
  assert.equal(estadoDePresupuesto(null), "sinPresupuesto");
  assert.equal(estadoDePresupuesto({ estado: "ABIERTO", lineas: 0 }), "sinLineas");
  assert.equal(estadoDePresupuesto({ estado: "VALIDADO", lineas: 0 }), "sinLineas");
  assert.equal(estadoDePresupuesto({ estado: "ABIERTO", lineas: 13 }), "sinValidar");
  assert.equal(estadoDePresupuesto({ estado: "EN_REVISION", lineas: 3 }), "sinValidar");
  assert.equal(estadoDePresupuesto({ estado: "VALIDADO", lineas: 3 }), "validado");
  assert.equal(CARTEL_DE_ESTADO.sinValidar, "presupuesto sin validar");
  assert.equal(CARTEL_DE_ESTADO.validado, null);
});

// ---- Conciliación contra el Reporte de cada empresa ------------------------------------------------------------

const PLANTILLAS = Array.from(new Set(Object.values(PLANTILLAS_POR_SLUG)));
const ACCESOS: { nombre: string; acceso: AccesoReservados }[] = [
  { nombre: "todo (ADMIN/FINANZAS)", acceso: true },
  { nombre: "nada (VIEWER sin casilla)", acceso: false },
  { nombre: "interruptores del gerente", acceso: { disponibilidades: true, cierre: false } },
];

function reporteDe(plantilla: (typeof PLANTILLAS)[number], acceso: AccesoReservados): Reporte {
  const meses = mesesDePrueba(plantilla).map((m, i) => ({ ...m, periodo: i === 0 ? "2026-10" : "2026-11" }));
  return armarReporte(plantilla, meses, 1, { verBloquesReservados: acceso });
}

// Búsqueda INDEPENDIENTE de extraerAvance: por la clave de la fila, no por el rol.
function celdaPorClave(r: Reporte, clave: string) {
  const f = r.filas.find((x) => x.fila.clave === clave);
  assert.ok(f, clave);
  return f.celdas[r.periodos.length - 1];
}

test("hay 12 plantillas distintas de Reporte (Conexión comparte una entre sus dos slugs) y todas tienen las dos filas por rol", () => {
  assert.equal(Object.keys(PLANTILLAS_POR_SLUG).length, 12);
  assert.equal(PLANTILLAS.length, 11);
  for (const p of PLANTILLAS) {
    for (const rol of ["totalIngresos", "totalEgresosOperativos"]) {
      assert.equal(p.filas.filter((f) => f.tipo === "total" && f.rol === rol).length, 1, `${p.empresa}: ${rol}`);
    }
  }
});

test("conciliación: extraerAvance devuelve EXACTAMENTE las celdas del Reporte (ingresos y egresos operativos), en los tres niveles de acceso", () => {
  for (const p of PLANTILLAS) {
    const claveIng = p.filas.find((f) => f.tipo === "total" && f.rol === "totalIngresos")!.clave;
    const claveEgr = p.filas.find((f) => f.tipo === "total" && f.rol === "totalEgresosOperativos")!.clave;
    for (const { nombre, acceso } of ACCESOS) {
      const r = reporteDe(p, acceso);
      const a = extraerAvance(r);
      for (const [rotulo, extraida, clave] of [["ingresos", a.ingresos, claveIng], ["egresos", a.egresosOperativos, claveEgr]] as const) {
        const esperada = celdaPorClave(r, clave);
        assert.ok(extraida, `${p.empresa} / ${nombre}: ${rotulo}`);
        assert.deepEqual(
          { ...extraida },
          {
            presupuestado: esperada.presupuestado,
            real: esperada.real,
            avance: esperada.avance,
            presupuestoIncompleto: esperada.presupuestoIncompleto,
            realIncompleto: esperada.realIncompleto,
          },
          `${p.empresa} / ${nombre}: ${rotulo}`
        );
      }
    }
  }
});

test("los egresos operativos NO cambian con el acceso a bloques reservados (los ingresos de Radio y Conexión sí dependen de él)", () => {
  for (const p of PLANTILLAS) {
    const todo = extraerAvance(reporteDe(p, true));
    for (const { nombre, acceso } of ACCESOS.slice(1)) {
      assert.deepEqual({ ...extraerAvance(reporteDe(p, acceso)).egresosOperativos }, { ...todo.egresosOperativos }, `${p.empresa} / ${nombre}`);
    }
  }
});

test("la fila elegida es la de rol totalEgresosOperativos y NUNCA la de totalEgresos (el espejo de Conexión y dividendos quedan afuera)", () => {
  for (const p of PLANTILLAS) {
    const r = reporteDe(p, true);
    const egr = extraerAvance(r).egresosOperativos!;
    const filaTotalEgresos = p.filas.find((f) => f.tipo === "total" && f.rol === "totalEgresos");
    if (!filaTotalEgresos) continue;
    const total = celdaPorClave(r, filaTotalEgresos.clave);
    // Si el total «de abajo» coincidiera con el operativo no se notaría el error; en las plantillas con espejo o dividendos difieren.
    if (p.filas.some((f) => f.bloque === "ABAJO" && f.tipo === "linea")) {
      assert.notEqual(egr.real, total.real, `${p.empresa}: se tomó el total de abajo`);
    }
  }
  const codigo = sinComentarios(fuente("avance.ts"));
  assert.doesNotMatch(codigo, /["']totalEgresos["']/, "avance.ts no menciona el rol totalEgresos");
  assert.match(codigo, /ROL_EGRESOS_OPERATIVOS = "totalEgresosOperativos"/);
});

test("Conexión: el espejo «Gastos Avion a recuperar» no está en los egresos operativos (sin doble conteo con Avianor)", () => {
  const p = PLANTILLAS_POR_SLUG["conexion-logistica"];
  const espejo = p.filas.find((f) => f.clave === "cx.gastosAvion");
  assert.ok(espejo);
  assert.equal(espejo.bloque, "ABAJO");
});

// ---- Fila de la pantalla ---------------------------------------------------------------------------------------

test("fila de avance: marcas de presupuesto, partes manuales y Real manual pendiente", () => {
  const p = PLANTILLAS_POR_SLUG["bradenton"];
  const base = extraerAvance(reporteDe(p, true));
  assert.ok(base.egresosOperativos);
  const r = reporteDe(p, true);
  const sin = armarFilaDeAvance({ id: "bradenton", nombre: "Bradenton", slug: "bradenton" }, "2026-11", { reporte: r, presupuesto: { estado: "ABIERTO", lineas: 5 }, corte: "2026-11-13" });
  assert.equal(sin.moneda, "USD");
  assert.equal(sin.estadoPresupuesto, "sinValidar");
  assert.equal(sin.cartelPresupuesto, "presupuesto sin validar");
  assert.equal(sin.ritmo?.diasConDatos, 13);
  assert.equal(sin.sinReporte, false);
});

test("Expensas (sin plantilla): fila «sin Reporte», sin celdas, sin presupuesto ni ritmo; no entra en ningún total", () => {
  const f = filaSinReporte({ id: "expensas", nombre: "Expensas", slug: "expensas" });
  assert.equal(f.sinReporte, true);
  assert.equal(f.egresosOperativos, null);
  assert.equal(f.ingresos, null);
  assert.equal(f.estadoPresupuesto, null);
  assert.equal(f.ritmo, null);
});

test("el orden es alfabético y el mismo para todos (sin ranking)", () => {
  const filas = [{ nombre: "Radio" }, { nombre: "Avianor" }, { nombre: "Handyway Cargo" }, { nombre: "Brillante" }];
  assert.deepEqual(ordenarFilas(filas).map((f) => f.nombre), ["Avianor", "Brillante", "Handyway Cargo", "Radio"]);
});

// ---- Totales por moneda ----------------------------------------------------------------------------------------

test("total de egresos operativos: solo por moneda, con rótulo por rol y sin total de ingresos", async () => {
  const admin = await alcanceDe("ADMIN", []);
  const filas = [
    fila("brillante", "Brillante", "brillante", celda(700_00, 600_00)),
    fila("radio", "Radio", "radio", celda(100_00, 50_00)),
    fila("bradenton", "Bradenton", "bradenton", celda(10_00, 4_00)),
    fila("plate-silver", "Plate Silver", "plate-silver", celda(20_00, 6_00)),
    fila("havanna-peru", "Havanna Perú", "havanna-peru", celda(5_00, 1_00)),
    filaSinReporte({ id: "expensas", nombre: "Expensas", slug: "expensas" }),
  ];
  const t = totalesDeEgresosOperativos(filas, admin);
  assert.deepEqual(t.map((x) => x.moneda), ["ARS", "USD"], "PEN tiene una sola empresa: sin fila de total");
  assert.deepEqual({ ...t[0] }, { moneda: "ARS", rotulo: "Total del holding", presupuestado: 800_00, real: 650_00, avance: 81.25 });
  assert.deepEqual({ ...t[1] }, { moneda: "USD", rotulo: "Total del holding", presupuestado: 30_00, real: 10_00, avance: (10 / 30) * 100 });
  for (const x of t) assert.deepEqual(Object.keys(x).sort(), ["avance", "moneda", "presupuestado", "real", "rotulo"]);
});

test("el rótulo del total: «Total del holding» solo ADMIN; el resto «Total de tus empresas», con dos empresas y con las doce", async () => {
  const filas = [
    fila("brillante", "Brillante", "brillante", celda(100, 50)),
    fila("radio", "Radio", "radio", celda(100, 50)),
  ];
  for (const rol of ["FINANZAS", "GERENTE", "VIEWER"] as const) {
    const a = await alcanceDe(rol, ["brillante", "radio"]);
    assert.equal(totalesDeEgresosOperativos(filas, a)[0].rotulo, "Total de tus empresas", rol);
    const todas = await alcanceDe(rol, IDS_ACTIVAS);
    assert.equal(totalesDeEgresosOperativos(filas, todas)[0].rotulo, "Total de tus empresas", `${rol} con las 12`);
  }
  assert.equal(totalesDeEgresosOperativos(filas, await alcanceDe("ADMIN", []))[0].rotulo, "Total del holding");
});

test("el total ignora filas de empresas que no son del alcance (aunque lleguen en los datos)", async () => {
  const a = await alcanceDe("GERENTE", ["brillante", "radio"]);
  const filas = [
    fila("brillante", "Brillante", "brillante", celda(100, 50)),
    fila("radio", "Radio", "radio", celda(100, 50)),
    fila("fredy", "Fredy Publicidad", "fredy-publicidad", celda(9_999, 9_999)),
  ];
  const t = totalesDeEgresosOperativos(filas, a);
  assert.equal(t[0].presupuestado, 200);
  assert.equal(t[0].real, 100);
});

test("una sola empresa de una moneda: no hay fila de total (sería repetir su fila)", async () => {
  const a = await alcanceDe("GERENTE", ["brillante"]);
  assert.deepEqual(totalesDeEgresosOperativos([fila("brillante", "Brillante", "brillante", celda(100, 50))], a), []);
  const a2 = await alcanceDe("GERENTE", ["brillante", "bradenton"]);
  const mixto = [fila("brillante", "Brillante", "brillante", celda(100, 50)), fila("bradenton", "Bradenton", "bradenton", celda(10, 5))];
  assert.deepEqual(totalesDeEgresosOperativos(mixto, a2), [], "pesos y dólares nunca se suman");
});

test("si a una empresa le falta el presupuestado o el real, el total de esa moneda es null (nunca una suma parcial)", async () => {
  const a = await alcanceDe("ADMIN", []);
  for (const faltante of [celda(null, 50), celda(100, null), celda(null, null)]) {
    const t = totalesDeEgresosOperativos([fila("brillante", "Brillante", "brillante", celda(100, 50)), fila("radio", "Radio", "radio", faltante)], a);
    assert.deepEqual({ ...t[0] }, { moneda: "ARS", rotulo: "Total del holding", presupuestado: null, real: null, avance: null });
  }
});

test("presupuestado total en cero: sin porcentaje (no se divide por cero)", async () => {
  const a = await alcanceDe("ADMIN", []);
  const t = totalesDeEgresosOperativos([fila("brillante", "Brillante", "brillante", celda(0, 0)), fila("radio", "Radio", "radio", celda(0, 5))], a);
  assert.equal(t[0].avance, null);
});

test("ningún tipo ni función de avance.ts agrega ingresos entre empresas", () => {
  const codigo = sinComentarios(fuente("avance.ts"));
  assert.doesNotMatch(codigo, /totalesDeIngresos|totalDeIngresos|ingresos\.reduce|\.ingresos\b[^;\n]*\+/);
});

// ---- Concurrencia (pool de 5 conexiones) -----------------------------------------------------------------------

test("conConcurrencia: nunca más de 2 a la vez, aunque se pida más, y conserva el orden de los resultados", async () => {
  for (const pedido of [1, 2, 3, 12, 0, -1, Number.NaN]) {
    let activas = 0;
    let maximo = 0;
    const r = await conConcurrencia([1, 2, 3, 4, 5, 6, 7], pedido, async (n) => {
      activas++;
      maximo = Math.max(maximo, activas);
      await new Promise((ok) => setTimeout(ok, 3 + ((n * 7) % 5)));
      activas--;
      return n * 10;
    });
    assert.deepEqual(r, [10, 20, 30, 40, 50, 60, 70], `pedido ${pedido}`);
    assert.ok(maximo <= MAXIMA_CONCURRENCIA && maximo >= 1, `pedido ${pedido}: máximo ${maximo}`);
  }
  assert.equal(MAXIMA_CONCURRENCIA, 2);
});

test("conConcurrencia: si una tarea falla se propaga el error y no arrancan tareas nuevas", async () => {
  let arrancadas = 0;
  await assert.rejects(
    conConcurrencia([1, 2, 3, 4, 5, 6], 2, async (n) => {
      arrancadas++;
      await new Promise((ok) => setTimeout(ok, 2));
      if (n === 2) throw new Error("falló");
      return n;
    }),
    /falló/
  );
  assert.ok(arrancadas < 6, `arrancaron ${arrancadas}`);
  assert.deepEqual(await conConcurrencia([], 2, async (n: number) => n), []);
});

// ---- Acceso del usuario ----------------------------------------------------------------------------------------

test("accesoDelDashboard: un caso por rol (mismos flags que el Reporte)", () => {
  const ver = (rol: string, operaEjecucion: boolean, veBloquesReservados?: boolean) => ({ ...accesoDelDashboard({ rol, operaEjecucion, veBloquesReservados }) });
  assert.deepEqual(ver("ADMIN", false), { esAdminOFinanzas: true, verBloquesReservados: true, sinBloquesReservados: false, verSaldos: true });
  assert.deepEqual(ver("FINANZAS", false), { esAdminOFinanzas: true, verBloquesReservados: true, sinBloquesReservados: false, verSaldos: true });
  assert.deepEqual(ver("GERENTE", false), { esAdminOFinanzas: false, verBloquesReservados: false, sinBloquesReservados: false, verSaldos: false });
  assert.deepEqual(ver("GERENTE", true), { esAdminOFinanzas: false, verBloquesReservados: false, sinBloquesReservados: false, verSaldos: true });
  assert.deepEqual(ver("GERENTE", false, true), { esAdminOFinanzas: false, verBloquesReservados: false, sinBloquesReservados: false, verSaldos: false }, "la casilla solo cuenta para VIEWER");
  assert.deepEqual(ver("VIEWER", false), { esAdminOFinanzas: false, verBloquesReservados: false, sinBloquesReservados: true, verSaldos: false });
  assert.deepEqual(ver("VIEWER", true), { esAdminOFinanzas: false, verBloquesReservados: false, sinBloquesReservados: true, verSaldos: false }, "VIEWER nunca ve saldos, aunque la base diga operaEjecucion");
  assert.deepEqual(ver("VIEWER", false, true), { esAdminOFinanzas: false, verBloquesReservados: true, sinBloquesReservados: false, verSaldos: false });
});

test("el alcance y el usuario tienen que ser de la misma sesión: el holding es solo de ADMIN", async () => {
  const admin = await alcanceDe("ADMIN", []);
  const gerente = await alcanceDe("GERENTE", ["brillante"]);
  exigirAlcanceDelUsuario(admin, { rol: "ADMIN", operaEjecucion: false });
  exigirAlcanceDelUsuario(gerente, { rol: "GERENTE", operaEjecucion: false });
  assert.throws(() => exigirAlcanceDelUsuario(admin, { rol: "VIEWER", operaEjecucion: false }), /no corresponde/);
  assert.throws(() => exigirAlcanceDelUsuario(gerente, { rol: "ADMIN", operaEjecucion: false }), /no corresponde/);
});

// ---- Candados estáticos de la carga ----------------------------------------------------------------------------

test("cargarAvance.ts usa armarReporteDePlantilla con los flags de bloquesReservadosDelUsuario y NUNCA el motor ni el cargador directo", () => {
  const codigo = sinComentarios(fuente("cargarAvance.ts"));
  assert.match(codigo, /armarReporteDePlantilla\(\{/);
  assert.doesNotMatch(codigo, /\barmarReporte\s*\(/);
  assert.doesNotMatch(codigo, /cargarDatosMeses|calcularRealPorClasificacion|cargarMeses/);
  assert.match(codigo, /verBloquesReservados: acceso\.verBloquesReservados/);
  assert.match(codigo, /sinBloquesReservados: acceso\.sinBloquesReservados/);
  const acceso = sinComentarios(fuente("accesoUsuario.ts"));
  assert.match(acceso, /bloquesReservadosDelUsuario\(usuario, veBloquesReservadosDelReporte\(u\)\)/);
  // Solo el período habilitado: ningún rol abre otros.
  assert.match(codigo, /PERIODOS_HABILITADOS\.includes\(periodo\)/);
});

test("las funciones de carga reciben un Alcance primero y lo validan antes de cualquier otra cosa", () => {
  for (const archivo of ["cargarAvance.ts", "cargarCalidad.ts"]) {
    const codigo = sinComentarios(fuente(archivo));
    const funciones = codigo.split(/^export async function /m).slice(1);
    assert.ok(funciones.length >= 1, archivo);
    for (const f of funciones) {
      const nombre = f.slice(0, f.indexOf("("));
      assert.match(f, /^\w+\(\s*alcance: Alcance\b/, `${archivo}:${nombre} no recibe un Alcance primero`);
      const cuerpo = f.slice(f.indexOf("{\n"));
      assert.ok(cuerpo.trimStart().slice(1).trimStart().startsWith("exigirAlcance(alcance);"), `${archivo}:${nombre} no valida el Alcance primero`);
    }
  }
});

test("el avance no usa DEP CH 3° ni lee la base por su cuenta", () => {
  for (const archivo of ["avance.ts", "cargarAvance.ts", "accesoUsuario.ts"]) {
    const codigo = sinComentarios(fuente(archivo));
    assert.doesNotMatch(codigo, /DEP CH|esDepositoDeCheques|sinDepositosDeCheques/, archivo);
    assert.doesNotMatch(codigo, /from\s+["']@\/lib\/prisma["']|\$queryRaw/, archivo);
  }
});
