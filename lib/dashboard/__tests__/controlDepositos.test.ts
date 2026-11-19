import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolverAlcance, type Alcance } from "@/lib/dashboard/alcance";
import { leerControlDepositosDeCheques } from "@/lib/dashboard/consultas";
import {
  ROTULO_CONTROL_DEPOSITOS,
  armarControlDepositos,
  esDepositoDeCheques,
  puedeVerControlDepositos,
  sinDepositosDeCheques,
} from "@/lib/dashboard/controles";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { IDS_ACTIVAS, alcanceDe, lectorDePrueba } from "@/lib/dashboard/__tests__/fixturesAlcance";

// DEP CH 3° en el dashboard: NO es cobranza; se muestra solo a ADMIN como control aparte («Depósitos de cheques pendientes de
// registro», neto de la semana, no sumado a ningún total). Para cualquier otro rol el bloque no existe: ni importe, ni
// cantidad, ni aviso. El filtro va en el servidor (consultas.ts), ANTES de consultar la base.

const FECHA = "2026-11-10"; // martes; semana del 9 al 15/11

// ---- Un test por rol -----------------------------------------------------------------------------------------------

test("ADMIN: puede ver el control (su alcance es el holding)", async () => {
  const a = await alcanceDe("ADMIN", []);
  assert.equal(puedeVerControlDepositos(a), true);
});

test("FINANZAS: el bloque no existe, tenga las empresas que tenga (aun las 12): null, sin consultar", async () => {
  for (const ids of [["brillante"], IDS_ACTIVAS.filter((id) => id !== "avianor" && id !== "expensas"), IDS_ACTIVAS]) {
    const a = await alcanceDe("FINANZAS", ids);
    assert.equal(puedeVerControlDepositos(a), false, ids.length + " empresas");
    assert.strictEqual(await leerControlDepositosDeCheques(a, FECHA), null, ids.length + " empresas");
  }
});

test("GERENTE: el bloque no existe: null, sin consultar", async () => {
  for (const ids of [["brillante"], ["brillante", "radio"], IDS_ACTIVAS]) {
    const a = await alcanceDe("GERENTE", ids);
    assert.equal(puedeVerControlDepositos(a), false);
    assert.strictEqual(await leerControlDepositosDeCheques(a, FECHA), null);
  }
});

test("VIEWER: el bloque no existe, con o sin la casilla «ve bloques reservados» y con las 12 empresas: null, sin consultar", async () => {
  for (const veBloquesReservados of [undefined, false, true]) {
    // El usuario de la sesión trae la casilla; el resolvedor no la mira: no puede ampliar el alcance.
    const usuario = { id: "u1", rol: "VIEWER", veBloquesReservados };
    const { lector } = lectorDePrueba({ u1: IDS_ACTIVAS });
    const a = await resolverAlcance(usuario, lector);
    assert.equal(a.empresas.length, 12);
    assert.equal(a.esHolding, false, `casilla=${veBloquesReservados}`);
    assert.equal(puedeVerControlDepositos(a), false, `casilla=${veBloquesReservados}`);
    assert.strictEqual(await leerControlDepositosDeCheques(a, FECHA), null, `casilla=${veBloquesReservados}`);
  }
});

test("sin empresas asignadas (cualquier rol que no sea ADMIN): el bloque tampoco existe", async () => {
  for (const rol of ["FINANZAS", "GERENTE", "VIEWER"] as const) {
    const a = await alcanceDe(rol, []);
    assert.strictEqual(await leerControlDepositosDeCheques(a, FECHA), null, rol);
  }
});

test("para quien no es ADMIN la respuesta es la misma (null) con cualquier fecha: ni siquiera un error distinto revela el bloque", async () => {
  const a = await alcanceDe("VIEWER", IDS_ACTIVAS);
  for (const fecha of [FECHA, "2026-13-45", "mañana", ""]) {
    assert.strictEqual(await leerControlDepositosDeCheques(a, fecha), null, JSON.stringify(fecha));
  }
});

test("ADMIN: una fecha inválida se rechaza antes de consultar (nada de texto libre en el SQL)", async () => {
  const a = await alcanceDe("ADMIN", []);
  for (const fecha of ["2026-13-45", "mañana", "", "2026-11-10'; DROP TABLE \"Usuario\"; --"]) {
    await assert.rejects(leerControlDepositosDeCheques(a, fecha), /AAAA-MM-DD/, JSON.stringify(fecha));
  }
});

test("un Alcance falsificado que dice ser holding NO ve el control: se rechaza antes de mirar el rol", async () => {
  const falso = { empresas: [], unidades: ["BRILLANTE"], vacio: false, esHolding: true } as unknown as Alcance;
  await assert.rejects(leerControlDepositosDeCheques(falso, FECHA), /Alcance inválido/);
});

test("ADMIN con el alcance vacío (sin empresas activas): el control existe pero sin movimientos, sin consultar", async () => {
  const a = await alcanceDe("ADMIN", [], []);
  assert.equal(a.vacio, true);
  const c = await leerControlDepositosDeCheques(a, FECHA);
  assert.deepEqual(c, { rotulo: ROTULO_CONTROL_DEPOSITOS, lunes: "2026-11-09", domingo: "2026-11-15", porMoneda: [] });
});

// ---- Qué devuelve el control (ADMIN): neto y cantidad, sin ningún total ----------------------------------------------

test("el control: semana lunes a domingo, una fila por moneda, neto y cantidad; sin total", () => {
  const c = armarControlDepositos("2026-11-12", [
    { moneda: "USD", netoCentavos: 5_000, movimientos: 2, enLotesAbiertos: 1 },
    { moneda: "ARS", netoCentavos: 7_240_000_00, movimientos: 90, enLotesAbiertos: 0 },
  ]);
  assert.equal(c.rotulo, "Depósitos de cheques pendientes de registro");
  assert.equal(c.lunes, "2026-11-09");
  assert.equal(c.domingo, "2026-11-15");
  assert.deepEqual(c.porMoneda.map((f) => f.moneda), ["ARS", "USD"]);
  assert.deepEqual(Object.keys(c).sort(), ["domingo", "lunes", "porMoneda", "rotulo"], "no hay total ni porcentaje");
  assert.deepEqual(Object.keys(c.porMoneda[0]).sort(), ["enLotesAbiertos", "moneda", "movimientos", "netoCentavos"]);
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.porMoneda));
});

test("el control rechaza importes que no son centavos enteros y cantidades imposibles", () => {
  assert.throws(() => armarControlDepositos(FECHA, [{ moneda: "ARS", netoCentavos: 1.5, movimientos: 1, enLotesAbiertos: 0 }]), /centavos enteros/);
  assert.throws(() => armarControlDepositos(FECHA, [{ moneda: "ARS", netoCentavos: 1, movimientos: 1, enLotesAbiertos: 2 }]), /inválidas/);
  assert.throws(() => armarControlDepositos(FECHA, [{ moneda: "ARS", netoCentavos: 1, movimientos: -1, enLotesAbiertos: 0 }]), /inválidas/);
});

// ---- DEP CH 3° no es cobranza ni entra en ningún total ---------------------------------------------------------------

test("esDepositoDeCheques: reconoce DEP CH 3° con la equivalencia del Reporte y no confunde otras clasificaciones", () => {
  for (const v of ["DEP CH 3°", "dep ch 3°", "  DEP  CH 3° "]) assert.equal(esDepositoDeCheques(v), true, v);
  for (const v of ["COBRANZAS", "COBRANZAS LATAM", "CHEQUES DIFERIDOS", "CH DIFERIDOS IVA", "TRANSF ENTRE BCOS", "FCI", ""]) {
    assert.equal(esDepositoDeCheques(v), false, v);
  }
});

test("sinDepositosDeCheques: los depósitos no pasan a ningún total (ni por mayúsculas distintas)", () => {
  const filas = [
    { c: "COBRANZAS", n: 1 },
    { c: "DEP CH 3°", n: 2 },
    { c: "dep ch 3°", n: 3 },
    { c: "SUELDOS", n: 4 },
  ];
  assert.deepEqual(sinDepositosDeCheques(filas, (f) => f.c).map((f) => f.n), [1, 4]);
});

// ---- Diferencia con el Reporte -------------------------------------------------------------------------------------

test("el Reporte deja DEP CH 3° afuera de TODA fila de TODA plantilla (el dashboard lo deja afuera igual: no hay divergencia)", () => {
  let filasRevisadas = 0;
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    for (const fila of plantilla.filas) {
      if (fila.tipo !== "linea" || fila.real.tipo !== "clasificaciones") continue;
      filasRevisadas++;
      for (const c of fila.real.clasificaciones) assert.equal(esDepositoDeCheques(c), false, `${slug}/${fila.clave} lee ${c}`);
      for (const c of fila.real.espejoUnidad?.clasificaciones ?? []) assert.equal(esDepositoDeCheques(c), false, `${slug}/${fila.clave} (espejo) lee ${c}`);
    }
  }
  assert.ok(filasRevisadas > 100, "se revisaron las filas de las plantillas");
});

test("Ejecución solo CONTROLA los depósitos (neto por lote igual a cero, en pesos); no los suma a nada", () => {
  const fuente = readFileSync(join(__dirname, "..", "..", "agregadosEjecucion.ts"), "utf8");
  assert.match(fuente, /\{ nombre: "Depósito de cheques de terceros", clasificacion: "DEP CH 3°" \}/);
  assert.match(fuente, /CHEQUEOS_SUMA_CERO/);
});

// ---- El filtro de rol está en el servidor y antes de la base ---------------------------------------------------------

test("la consulta del control valida el Alcance y el rol (ADMIN) ANTES de tocar la base", () => {
  const fuente = readFileSync(join(__dirname, "..", "consultas.ts"), "utf8").replace(/\r\n/g, "\n");
  const cuerpo = fuente.slice(fuente.indexOf("export async function leerControlDepositosDeCheques"));
  const iAlcance = cuerpo.indexOf("exigirAlcance(alcance);");
  const iRol = cuerpo.indexOf("if (!puedeVerControlDepositos(alcance)) return null;");
  const iBase = cuerpo.indexOf("prisma.");
  assert.ok(iAlcance > -1 && iRol > iAlcance && iBase > iRol, "orden: exigirAlcance, rol, base");
});

test("solo controles.ts y consultas.ts conocen DEP CH 3° dentro de lib/dashboard (ningún armado de totales lo lee)", () => {
  const dir = join(__dirname, "..");
  const conDeposito = readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => /DEP CH|esDepositoDeCheques|CLASIFICACION_DEPOSITO/.test(readFileSync(join(dir, f), "utf8")))
    .sort();
  assert.deepEqual(conDeposito, ["consultas.ts", "controles.ts"]);
});
