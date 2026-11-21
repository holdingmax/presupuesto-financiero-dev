import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, camposManuales, validarPlantilla, type DatosMes, type Plantilla } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { camposTipeables, armarVistaTipeo } from "@/lib/reporte/tipeoDirecto";
import { clasifPisable, egreso, PRESUPUESTO_MANUAL } from "@/lib/reporte/plantillas/filas";

// Costo de IVA tipeable en todas las empresas: un Real manual del mes REEMPLAZA al calculado; sin manual rige el cálculo.

const PLANTILLA: Plantilla = { empresa: "Prueba", filas: [egreso("iva", "Compra IVA", clasifPisable("IVA"), PRESUPUESTO_MANUAL)] };
const mes = (extra: Partial<DatosMes> = {}): DatosMes => ({
  periodo: "2026-11",
  real: new Map([["IVA", -50000]]),
  presupuesto: new Map(),
  semanasCerradas: 1,
  ...extra,
});
const real = (m: DatosMes) => armarReporte(PLANTILLA, [m]).filas[0].celdas[0].real;
const man = (v?: number) => ({ presupuesto: new Map(), real: new Map(v === undefined ? [] : [["iva", v]]) });

test("plantilla válida y el campo de Real queda abierto", () => {
  assert.deepEqual(validarPlantilla(PLANTILLA), []);
  assert.deepEqual(camposManuales(PLANTILLA).map((c) => `${c.clave}|${c.columna}`), ["iva|REAL", "iva|PRESUPUESTADO"]);
});

test("sin manual rige el cálculo; con manual lo reemplaza (no suma); 0 también pisa", () => {
  assert.equal(real(mes({ manuales: man() })), 50000);
  assert.equal(real(mes({ manuales: man(12000) })), 12000);
  assert.equal(real(mes({ manuales: man(0) })), 0);
});

test("el manual rige en cualquier mes, también sin ejecución", () => {
  assert.equal(real(mes({ periodo: "2026-05", manuales: man(7000) })), 7000);
  assert.equal(real(mes({ real: new Map(), semanasCerradas: 0, manuales: man(7000) })), 7000);
  assert.equal(real(mes({ real: new Map(), semanasCerradas: 0, manuales: man() })), null);
});

test("la casilla del Reporte se marca como pisable y respeta el bloqueo de semanas", () => {
  const ent = {
    empresaSlug: "brillante",
    plantilla: PLANTILLA,
    esAdminOFinanzas: true,
    periodo: "2026-11",
    actual: "2026-11",
    valoresReales: new Map([["iva", 12000]]),
    interruptores: { tipeo: ["brillante"], disponibilidades: [] },
  };
  const abierta = armarVistaTipeo({ ...ent, semanas: { abiertas: 1, cerradas: 0 } })!;
  const c = abierta.celdas.find((x) => x.id === "iva|REAL")!;
  assert.equal(c.pisaCalculado, true);
  assert.equal(c.avisoUnaVez, false);
  // Mes pasado sin semanas abiertas: con valor ya cargado no se puede modificar (no viaja la celda).
  const cerrada = armarVistaTipeo({ ...ent, periodo: "2026-10", semanas: { abiertas: 0, cerradas: 4 } });
  assert.equal(cerrada?.celdas.some((x) => x.id === "iva|REAL") ?? false, false);
});

test("todas las plantillas con fila de IVA la tienen tipeable en Real", () => {
  const con: string[] = [];
  for (const [slug, p] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const iva = p.filas.filter((f) => f.tipo === "linea" && f.bloque === "EGRESOS" && /iva|IVA/.test(f.texto) && !/Reserva|Cobro/.test(f.texto));
    for (const f of iva) {
      con.push(slug);
      const abiertos = camposTipeables(p, slug, { tipeo: [slug], disponibilidades: [] }).map((c) => `${c.clave}|${c.columna}`);
      assert.ok(abiertos.includes(`${f.clave}|REAL`), `${slug}: ${f.clave} no es tipeable`);
    }
  }
  assert.ok(con.length >= 9, `se esperaban >= 9 empresas con IVA, hay ${con.length}`);
});
