import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { calcularReparto, notaDeReparto } from "@/lib/reporte/repartoExpensasCalculo";
import {
  empresasConExpensas,
  estadoEmpresaReparto,
  filaExpensasManual,
  planificarReparto,
  type EntradaReparto,
} from "@/lib/reporte/repartoExpensas";
import type { Plantilla } from "@/lib/reporte/motor";

// Calculadora de reparto de Expensas. Todo contra las funciones puras y las plantillas reales, sin base.
// La escritura (guardarRepartoExpensas) solo agrega la transacción: lo que decide está acá.

const HABILITADOS = ["2026-10", "2026-11"] as const;
const SEMANAS_ABIERTAS = { abiertas: 1, cerradas: 2 };
const SEMANAS_CERRADAS = { abiertas: 0, cerradas: 4 };

function entrada(parcial: Partial<EntradaReparto> = {}): EntradaReparto {
  return {
    esAdminOFinanzas: true,
    periodo: "2026-11",
    actual: "2026-11",
    habilitados: HABILITADOS,
    semanas: SEMANAS_ABIERTAS,
    totalTexto: "1.000.000,00",
    empresas: [
      { empresaId: "e1", nombre: "Fredy", filaClave: "fr.expensas", bloque: "EGRESOS", porcentajeTexto: "60", existenteCentavos: null },
      { empresaId: "e2", nombre: "HWC", filaClave: "hw.expensas", bloque: "EGRESOS", porcentajeTexto: "40", existenteCentavos: null },
    ],
    confirmarReemplazo: false,
    ...parcial,
  };
}

// --- Cálculo ---------------------------------------------------------------------------------------------------

test("la suma de los montos repartidos es igual al total, también con redondeo", () => {
  const casos: { total: string; pct: string[] }[] = [
    { total: "100,00", pct: ["33,33", "33,33", "33,34"] },
    { total: "0,01", pct: ["50", "50"] },
    { total: "1.000.000,01", pct: ["33,33", "33,33", "33,34"] },
    { total: "999.999,99", pct: ["14,29", "14,29", "14,29", "14,29", "14,28", "14,28", "14,28"] },
    { total: "10,00", pct: ["0,01", "99,99"] },
    { total: "123.456.789,12", pct: ["12,5", "37,5", "", "50"] },
  ];
  for (const c of casos) {
    const r = calcularReparto(c.total, c.pct);
    assert.ok(r.ok, `${c.total} ${c.pct.join("/")}`);
    assert.equal(r.montos.reduce((a, m) => a + m, 0), r.totalCentavos, `${c.total} ${c.pct.join("/")}`);
    assert.ok(r.montos.every((m) => Number.isInteger(m) && m >= 0));
  }
});

test("mayor resto: 100,00 en tres tercios deja el centavo que sobra en la empresa de mayor resto", () => {
  const r = calcularReparto("100,00", ["33,33", "33,33", "33,34"]);
  assert.ok(r.ok);
  assert.deepEqual(r.montos, [3333, 3333, 3334]);
});

test("una empresa vacía o en 0 no recibe monto", () => {
  const r = calcularReparto("1.000,00", ["", "0", "100"]);
  assert.ok(r.ok);
  assert.deepEqual(r.montos, [0, 0, 100000]);
});

test("se rechaza si los porcentajes no suman exactamente 100", () => {
  for (const pct of [["50", "49,99"], ["50", "50,01"], ["", ""], ["99,99"]]) {
    const r = calcularReparto("1.000,00", pct);
    assert.equal(r.ok, false, pct.join("/"));
  }
  const falta = calcularReparto("1.000,00", ["60", "30"]);
  assert.ok(!falta.ok && /faltan 10,00%/.test(falta.error));
  const sobra = calcularReparto("1.000,00", ["60", "50"]);
  assert.ok(!sobra.ok && /sobran 10,00%/.test(sobra.error));
});

test("se rechazan un porcentaje mal escrito, con más de 2 decimales o mayor a 100, y un total vacío, cero o negativo", () => {
  assert.equal(calcularReparto("1.000,00", ["abc", "100"]).ok, false);
  assert.equal(calcularReparto("1.000,00", ["33,333", "66,667"]).ok, false);
  assert.equal(calcularReparto("1.000,00", ["101", "-1"]).ok, false);
  assert.equal(calcularReparto("", ["100"]).ok, false);
  assert.equal(calcularReparto("0", ["100"]).ok, false);
  assert.equal(calcularReparto("-1.000,00", ["100"]).ok, false);
  assert.equal(calcularReparto("1.000,005", ["100"]).ok, false);
});

test("la nota lleva el porcentaje y el total", () => {
  assert.equal(notaDeReparto(1250, 100000000), "Reparto de Expensas: 12,50% de $1.000.000,00");
});

// --- Qué empresas aparecen -------------------------------------------------------------------------------------

test("la lista sale de las plantillas: solo filas de Expensas con Real manual; Avianor y las filas parecidas no entran", () => {
  const todas = Object.keys(PLANTILLAS_POR_SLUG).map((slug) => ({ id: `id-${slug}`, nombre: slug, slug }));
  const lista = empresasConExpensas(todas);
  const claves = new Map(lista.map((e) => [e.slug, e.fila.clave]));

  assert.equal(claves.get("fredy-publicidad"), "fr.expensas");
  assert.equal(claves.get("hwc"), "hw.expensas");
  assert.equal(claves.get("havanna"), "hv.expensas");
  assert.equal(claves.get("brillante"), "br.expensas");
  assert.equal(claves.get("mantenor"), "mn.expensas");
  assert.equal(claves.get("radio"), "ra.expensas");
  assert.equal(claves.get("conexion-logistica"), "cx.expensas");
  assert.equal(claves.get("bradenton"), "bd.expensas");
  assert.equal(claves.get("plate-silver"), "ps.expensas");
  assert.equal(claves.get("havanna-peru"), "hp.expensas");

  assert.equal(claves.has("avianor"), false, "Avianor: su Real sale de Ejecución");
  const usadas = new Set(lista.map((e) => e.fila.clave));
  for (const prohibida of ["av.expensas", "av.expensasNoSocios", "cx.dividendosExpensas", "fr.expensasNoSocios", "cx.expensasNoSocios"]) {
    assert.equal(usadas.has(prohibida), false, prohibida);
  }
  // Una sola fila por plantilla, y la lista no escribe nada fijo: cada clave es de la plantilla de su empresa.
  for (const e of lista) assert.ok(PLANTILLAS_POR_SLUG[e.slug].filas.some((f) => f.clave === e.fila.clave));
});

test("una empresa sin plantilla, o con plantilla sin fila de Expensas manual, no aparece", () => {
  const sinFila: Plantilla = {
    ...PLANTILLAS_POR_SLUG["hwc"],
    filas: PLANTILLAS_POR_SLUG["hwc"].filas.filter((f) => f.clave !== "hw.expensas"),
  };
  assert.equal(filaExpensasManual(sinFila), null);

  const lista = empresasConExpensas(
    [
      { id: "1", nombre: "Sin plantilla", slug: "expensas" },
      { id: "2", nombre: "Sin fila", slug: "sin-fila" },
      { id: "3", nombre: "Con fila", slug: "hwc" },
    ],
    { ...PLANTILLAS_POR_SLUG, "sin-fila": sinFila }
  );
  assert.deepEqual(lista.map((e) => e.id), ["3"]);
});

// --- Plan de guardado ------------------------------------------------------------------------------------------

test("planificar: reparte y arma la nota; con el rol correcto y el período editable escribe a las dos empresas", () => {
  const p = planificarReparto(entrada());
  assert.ok(p.ok);
  assert.deepEqual(p.escrituras.map((x) => [x.empresaId, x.filaClave, x.centavos]), [
    ["e1", "fr.expensas", 60000000],
    ["e2", "hw.expensas", 40000000],
  ]);
  assert.equal(p.escrituras[0].nota, "Reparto de Expensas: 60,00% de $1.000.000,00");
  assert.equal(p.escrituras.reduce((a, x) => a + x.centavos, 0), p.totalCentavos);
});

test("planificar: las empresas con 0% o vacías no se tocan", () => {
  const p = planificarReparto(
    entrada({
      empresas: [
        { empresaId: "e1", nombre: "Fredy", filaClave: "fr.expensas", bloque: "EGRESOS", porcentajeTexto: "100", existenteCentavos: null },
        { empresaId: "e2", nombre: "HWC", filaClave: "hw.expensas", bloque: "EGRESOS", porcentajeTexto: "", existenteCentavos: 5000 },
      ],
    })
  );
  assert.ok(p.ok);
  assert.deepEqual(p.escrituras.map((x) => x.empresaId), ["e1"]);
  assert.deepEqual(p.sinTocar, ["HWC"]);
});

test("planificar: se rechaza si los porcentajes no suman 100", () => {
  const p = planificarReparto(
    entrada({
      empresas: [
        { empresaId: "e1", nombre: "Fredy", filaClave: "fr.expensas", bloque: "EGRESOS", porcentajeTexto: "60", existenteCentavos: null },
        { empresaId: "e2", nombre: "HWC", filaClave: "hw.expensas", bloque: "EGRESOS", porcentajeTexto: "39", existenteCentavos: null },
      ],
    })
  );
  assert.equal(p.ok, false);
});

test("planificar: se rechaza si el rol no es ADMIN ni FINANZAS", () => {
  const p = planificarReparto(entrada({ esAdminOFinanzas: false }));
  assert.equal(p.ok, false);
  assert.ok(!p.ok && /ADMIN y FINANZAS/.test(p.error));
});

test("planificar: un período fuera de la lista de habilitados se rechaza", () => {
  const p = planificarReparto(entrada({ periodo: "2026-09", actual: "2026-11" }));
  assert.ok(!p.ok && /no está habilitado/.test(p.error));
});

test("octubre (ya pasó, sin semanas abiertas): con un valor ya cargado queda no editable y se rechaza, con el motivo", () => {
  const estado = estadoEmpresaReparto({
    periodo: "2026-10",
    actual: "2026-11",
    habilitados: HABILITADOS,
    bloque: "EGRESOS",
    semanas: SEMANAS_CERRADAS,
    existenteCentavos: 123400,
  });
  assert.equal(estado.editable, false);
  assert.match(estado.motivo ?? "", /ya pasó y no tiene semanas abiertas/);

  const p = planificarReparto(
    entrada({
      periodo: "2026-10",
      actual: "2026-11",
      semanas: SEMANAS_CERRADAS,
      empresas: [
        { empresaId: "e1", nombre: "Fredy", filaClave: "fr.expensas", bloque: "EGRESOS", porcentajeTexto: "100", existenteCentavos: 123400 },
      ],
      confirmarReemplazo: true, // ni siquiera confirmando se pisa un valor de un período bloqueado
    })
  );
  assert.ok(!p.ok && /no se puede modificar un valor ya cargado/.test(p.error));
});

test("octubre bloqueado pero con la fila vacía: admite la primera carga (carga única), como el tipeo directo", () => {
  const estado = estadoEmpresaReparto({
    periodo: "2026-10",
    actual: "2026-11",
    habilitados: HABILITADOS,
    bloque: "EGRESOS",
    semanas: SEMANAS_CERRADAS,
    existenteCentavos: null,
  });
  assert.equal(estado.editable, true);
  assert.equal(estado.avisoUnaVez, true);

  const p = planificarReparto(
    entrada({ periodo: "2026-10", actual: "2026-11", semanas: SEMANAS_CERRADAS })
  );
  assert.ok(p.ok);
});

test("octubre con una semana todavía abierta no está bloqueado", () => {
  const estado = estadoEmpresaReparto({
    periodo: "2026-10",
    actual: "2026-11",
    habilitados: HABILITADOS,
    bloque: "EGRESOS",
    semanas: { abiertas: 1, cerradas: 3 },
    existenteCentavos: 100,
  });
  assert.equal(estado.editable, true);
  assert.equal(estado.avisoUnaVez, false);
});

test("todo o nada: si una sola empresa está bloqueada, no se escribe ninguna", () => {
  const p = planificarReparto(
    entrada({
      periodo: "2026-10",
      actual: "2026-11",
      semanas: SEMANAS_CERRADAS,
      empresas: [
        { empresaId: "e1", nombre: "Fredy", filaClave: "fr.expensas", bloque: "EGRESOS", porcentajeTexto: "60", existenteCentavos: null },
        { empresaId: "e2", nombre: "HWC", filaClave: "hw.expensas", bloque: "EGRESOS", porcentajeTexto: "40", existenteCentavos: 100 },
      ],
    })
  );
  assert.ok(!p.ok);
  assert.equal("escrituras" in p, false);
});

test("no pisa un valor existente sin confirmación: devuelve los reemplazos y no escribe", () => {
  const empresas = entrada().empresas.map((e) => (e.empresaId === "e1" ? { ...e, existenteCentavos: 55555 } : e));
  const p = planificarReparto(entrada({ empresas }));
  assert.ok(!p.ok);
  assert.equal(p.ok === false && p.requiereConfirmacion, true);
  assert.deepEqual(p.ok === false ? p.reemplazos : null, [
    { empresaId: "e1", nombre: "Fredy", actualCentavos: 55555, nuevoCentavos: 60000000 },
  ]);
  assert.equal("escrituras" in p, false);
});

test("con confirmación explícita sí reemplaza el valor existente", () => {
  const empresas = entrada().empresas.map((e) => (e.empresaId === "e1" ? { ...e, existenteCentavos: 55555 } : e));
  const p = planificarReparto(entrada({ empresas, confirmarReemplazo: true }));
  assert.ok(p.ok);
  assert.equal(p.escrituras.find((x) => x.empresaId === "e1")?.reemplazaCentavos, 55555);
  assert.equal(p.escrituras.find((x) => x.empresaId === "e2")?.reemplazaCentavos, null);
});

test("la confirmación no se pide cuando no hay nada que pisar", () => {
  const p = planificarReparto(entrada({ confirmarReemplazo: false }));
  assert.ok(p.ok);
});
