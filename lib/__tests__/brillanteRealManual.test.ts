import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarReporte, camposManuales, esBloqueReservado, type DatosMes, type Reporte } from "@/lib/reporte/motor";
import { EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE } from "@/lib/config";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { armarVistaTipeo, motivoRechazoTipeo } from "@/lib/reporte/tipeoDirecto";
import { leerCuenta } from "@/lib/importes";
import { CLAVES_MANUALES } from "@/lib/reporte/__tests__/fixtures/clavesManuales";
import { CENTINELA, clavesDeCierre, mesesDePrueba, sinCierre } from "@/lib/reporte/__tests__/fixtures/datosGerente";

// «Otras operaciones (MANTENOR JUJUY)» y «Recupero Gastos» de Brillante pasan de «Sin Real» a Real manual
// (se tipean en la columna Real, como «Otro (MSNT…)»). Expensas queda como estaba. Solo Brillante cambia.

const JUJUY = "br.otrasOperacionesJujuy";
const RECUPERO = "br.recuperoGastos";
// Los números del Excel de agosto de Kike, en centavos: 27.776.193 y −1.313.615 (negativo: baja los egresos).
const VALOR_JUJUY = 2_777_619_300;
const VALOR_RECUPERO = -131_361_500;

const BRILLANTE = PLANTILLAS_POR_SLUG["brillante"];
const fotoBrillante = JSON.parse(
  readFileSync(new URL("../reporte/__tests__/fixtures/gerenteBrillante.json", import.meta.url), "utf-8")
);
const fotoDeLasOtras = JSON.parse(
  readFileSync(new URL("../reporte/__tests__/fixtures/gerenteSinReservados.json", import.meta.url), "utf-8")
) as Record<string, unknown>;

// Excepción explícita: Expensas pasó de «Sin Real» a Real manual, y una celda de Real manual vacía ya no se marca como
// incompleta (realIncompleto) como la de una fila «Sin Real». Es la ÚNICA diferencia con la foto gerenteBrillante.json
// (tomada antes del cambio, que no se toca): se pone en la foto ese único campo de esa única fila y se compara el resto.
function conExpensasManual(foto: { filas: [string, unknown[][]][] }) {
  const copia = JSON.parse(JSON.stringify(foto)) as typeof foto;
  const celda = copia.filas.find(([clave]) => clave === "br.expensas")![1][0];
  assert.equal(celda[5], true, "la foto de antes tiene Expensas con el Real incompleto");
  celda[5] = false;
  // Gold Salta también pasó de «Sin Real» a Real manual (neteo de cobranzas, desde 2026-10): mismo motivo.
  const gold = copia.filas.find(([clave]) => clave === "br.goldSalta")![1][0];
  assert.equal(gold[5], true, "la foto de antes tiene Gold Salta con el Real incompleto");
  gold[5] = false;
  return copia;
}

function proyeccion(r: Reporte) {
  return JSON.parse(
    JSON.stringify({
      periodos: r.periodos,
      sinPresupuesto: r.sinPresupuesto,
      sinEjecucion: r.sinEjecucion,
      pendientes: r.pendientes,
      arrastre: r.arrastre,
      sinBloquesReservados: r.sinBloquesReservados,
      filas: r.filas.map((f) => [
        f.fila.clave,
        f.celdas.map((c) => [c.presupuestado, c.real, c.avance, c.faltaEjecutar, c.presupuestoIncompleto, c.realIncompleto]),
      ]),
    })
  );
}

// Datos de prueba de Brillante con el Real de las dos filas puesto (o no). mesesDePrueba numera los valores
// manuales con un contador (1000 + n) que recorre todos los campos: las dos celdas nuevas de Real ocupan lugar
// en ese contador y correrían todos los valores siguientes. Para comparar contra la foto de ANTES del cambio
// se numera igual que antes (sin contar esas dos), sin tocar el fixture compartido.
function datos(conValores: boolean): DatosMes[] {
  const meses = mesesDePrueba(BRILLANTE);
  const real = new Map<string, number>();
  const presupuesto = new Map<string, number>();
  let n = 0;
  for (const c of camposManuales(BRILLANTE)) {
    if (c.columna === "REAL" && (c.clave === JUJUY || c.clave === RECUPERO || c.clave === "br.expensas" || c.clave === "br.goldSalta" || c.clave === "br.sac")) continue;
    const valor = esBloqueReservado(c.bloque) ? CENTINELA + n++ : 1000 + n++;
    (c.columna === "REAL" ? real : presupuesto).set(c.clave, valor);
  }
  if (conValores) {
    real.set(JUJUY, VALOR_JUJUY);
    real.set(RECUPERO, VALOR_RECUPERO);
  }
  return [meses[0], { ...meses[1], manuales: { presupuesto, real } }];
}

const gerente = (meses: DatosMes[]) =>
  armarReporte(BRILLANTE, meses, 1, { verBloquesReservados: accesoReservadosDelReporte(false, "brillante") });
const admin = (meses: DatosMes[]) => armarReporte(BRILLANTE, meses, 1, { verBloquesReservados: true });
const real = (r: Reporte, clave: string) => r.filas.find((f) => f.fila.clave === clave)!.celdas[0].real;

// ---- La plantilla ---------------------------------------------------------------------------------

test("las dos filas son de Real manual y conservan su Presupuestado manual", () => {
  for (const clave of [JUJUY, RECUPERO]) {
    const fila = BRILLANTE.filas.find((f) => f.clave === clave)!;
    assert.equal(fila.tipo, "linea");
    if (fila.tipo !== "linea") continue;
    assert.deepEqual(fila.real, { tipo: "manual" }, clave);
    assert.deepEqual(fila.presupuesto, { tipo: "manual" }, `${clave}: el Presupuestado no se toca`);
  }
  const campos = camposManuales(BRILLANTE).map((c) => `${c.clave}|${c.columna}`);
  assert.ok(campos.includes(`${JUJUY}|REAL`) && campos.includes(`${RECUPERO}|REAL`));
  assert.ok(campos.includes(`${JUJUY}|PRESUPUESTADO`) && campos.includes(`${RECUPERO}|PRESUPUESTADO`));
});

test("Expensas pasó a Real manual (Kike la carga sobre el Reporte); Gastos Gold sigue sin Real y no se puede tipear", () => {
  const fila = BRILLANTE.filas.find((f) => f.clave === "br.expensas")!;
  assert.ok(fila.tipo === "linea" && fila.real.tipo === "manual");
  assert.equal(camposManuales(BRILLANTE).some((c) => c.clave === "br.expensas" && c.columna === "REAL"), true);
  assert.equal(
    motivoRechazoTipeo({
      empresaSlug: "brillante",
      plantilla: BRILLANTE,
      esAdminOFinanzas: true,
      entradas: [{ filaClave: "br.expensas", columna: "REAL", texto: "12.959.207" }],
    }),
    null
  );
  assert.ok(
    motivoRechazoTipeo({
      empresaSlug: "brillante",
      plantilla: BRILLANTE,
      esAdminOFinanzas: true,
      entradas: [{ filaClave: "br.gastosGold", columna: "REAL", texto: "12.959.207" }],
    })
  );
});

// ---- Foto del gerente -----------------------------------------------------------------------------

test("gerente de Brillante: con las dos filas vacías el Reporte (sin el Cierre, que ahora ve) es idéntico a la foto de antes del cambio", () => {
  assert.deepEqual(proyeccion(sinCierre(gerente(datos(false)))), conExpensasManual(fotoBrillante));
  // La foto tiene las dos filas con Real vacío: es el «antes».
  const filas = new Map(fotoBrillante.filas as [string, unknown[][]][]);
  assert.equal(filas.get(JUJUY)![0][1], null);
  assert.equal(filas.get(RECUPERO)![0][1], null);
});

test("las otras plantillas no cambian: foto del gerente y claves manuales idénticas", () => {
  // La foto es la del gerente SIN Disponibilidades: solo vale para las empresas que no las ven (las que sí, tienen
  // su propio test en tipeoDirectoDisponibilidades.test.ts).
  const sinDisponibilidades = Object.keys(PLANTILLAS_POR_SLUG).filter(
    (s) => s !== "brillante" && !EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes(s)
  );
  assert.ok(sinDisponibilidades.includes("conexion-logistica-spp") && !sinDisponibilidades.includes("havanna-peru"), "sanidad");
  for (const slug of sinDisponibilidades) {
    const p = PLANTILLAS_POR_SLUG[slug];
    const r = armarReporte(p, mesesDePrueba(p), 1, { verBloquesReservados: accesoReservadosDelReporte(false, slug) });
    assert.deepEqual(proyeccion(r), fotoDeLasOtras[slug], slug);
  }
  for (const slug of Object.keys(CLAVES_MANUALES).filter((s) => s !== "brillante")) {
    assert.deepEqual(
      camposManuales(PLANTILLAS_POR_SLUG[slug]).map((c) => `${c.clave}|${c.columna}`),
      CLAVES_MANUALES[slug],
      slug
    );
  }
});

// ---- Signo y totales ------------------------------------------------------------------------------

test("totales: Jujuy suma en Total ingresos y Recupero Gastos (negativo) RESTA de Total egresos; el Saldo sube la suma de los dos", () => {
  const sin = admin(datos(false));
  const con = admin(datos(true));
  assert.equal(real(con, JUJUY), VALOR_JUJUY);
  assert.equal(real(con, RECUPERO), VALOR_RECUPERO);
  assert.equal(real(con, "br.totalIngresos")! - real(sin, "br.totalIngresos")!, VALOR_JUJUY);
  assert.equal(real(con, "br.totalEgresos")! - real(sin, "br.totalEgresos")!, VALOR_RECUPERO);
  assert.equal(real(con, "br.saldo")! - real(sin, "br.saldo")!, VALOR_JUJUY - VALOR_RECUPERO);
});

test("Recupero Gastos se muestra con su signo, sin dar vuelta", () => {
  const celda = admin(datos(true)).filas.find((f) => f.fila.clave === RECUPERO)!.celdas[0];
  assert.equal(celda.real, VALOR_RECUPERO);
  assert.equal(celda.realIncompleto, false);
});

test("importes: «-1.313.615» y «27.776.193» se leen bien (formato argentino, con signo)", () => {
  assert.deepEqual(leerCuenta("-1.313.615"), { ok: true, centavos: VALOR_RECUPERO, nota: null });
  assert.deepEqual(leerCuenta("27.776.193"), { ok: true, centavos: VALOR_JUJUY, nota: null });
});

// ---- Gerente: ve el Real, sin inputs --------------------------------------------------------------

test("gerente con valores: ve el Real de las dos filas y los totales, igual que con Otro (MSNT…); del Cierre, solo Saldo, Capital y Disponible", () => {
  const sin = gerente(datos(false));
  const con = gerente(datos(true));
  assert.equal(real(con, JUJUY), VALOR_JUJUY);
  assert.equal(real(con, RECUPERO), VALOR_RECUPERO);
  assert.equal(real(con, "br.totalIngresos")! - real(sin, "br.totalIngresos")!, VALOR_JUJUY);
  assert.equal(real(con, "br.totalEgresos")! - real(sin, "br.totalEgresos")!, VALOR_RECUPERO);
  // Mismo criterio que una manual que ya existía.
  assert.notEqual(real(con, "br.otroMsnt"), null);
  assert.deepEqual(clavesDeCierre(con), ["br.saldo", "br.capital", "br.disponible"]);
});

test("gerente: ni celdas, ni claves, ni la acción — con valores cargados y el interruptor prendido", () => {
  const manuales = datos(true)[1].manuales!.real;
  for (const semanas of [{ abiertas: 1, cerradas: 0 }, { abiertas: 0, cerradas: 4 }]) {
    const vista = armarVistaTipeo({
      empresaSlug: "brillante",
      plantilla: BRILLANTE,
      esAdminOFinanzas: false,
      periodo: "2026-10",
      actual: "2026-10",
      semanas,
      valoresReales: manuales,
    });
    assert.equal(vista, null);
  }
  for (const clave of [JUJUY, RECUPERO]) {
    assert.ok(
      motivoRechazoTipeo({
        empresaSlug: "brillante",
        plantilla: BRILLANTE,
        esAdminOFinanzas: false,
        entradas: [{ filaClave: clave, columna: "REAL", texto: "1.000" }],
      }),
      clave
    );
  }
});

test("ADMIN y FINANZAS: las dos filas son tipeables y en cerrado vale la carga única", () => {
  const entradas = [JUJUY, RECUPERO].map((filaClave) => ({ filaClave, columna: "REAL" as const, texto: "1.000" }));
  assert.equal(motivoRechazoTipeo({ empresaSlug: "brillante", plantilla: BRILLANTE, esAdminOFinanzas: true, entradas }), null);

  const cerrado = { abiertas: 0, cerradas: 4 };
  const base = { empresaSlug: "brillante", plantilla: BRILLANTE, esAdminOFinanzas: true, periodo: "2026-08", actual: "2026-10", semanas: cerrado };
  // Vacías: se pueden cargar una vez.
  const vacia = armarVistaTipeo({ ...base, valoresReales: new Map() })!;
  for (const clave of [JUJUY, RECUPERO]) {
    const celda = vacia.celdas.find((c) => c.clave === clave)!;
    assert.ok(celda && celda.avisoUnaVez, clave);
  }
  // Ya cargadas: sin input, sin override de admin.
  const cargada = armarVistaTipeo({ ...base, valoresReales: new Map([[JUJUY, VALOR_JUJUY], [RECUPERO, VALOR_RECUPERO]]) })!;
  assert.equal(cargada.celdas.some((c) => c.clave === JUJUY || c.clave === RECUPERO), false);
});
