import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { mesesDePrueba } from "./fixtures/datosGerente";

// Tercera tanda de Disponibilidades y Cierre para el gerente: lo que ve el gerente de Radio, Conexión, Havanna,
// Plate Silver y Bradenton tiene que tener los rótulos exactos de su planilla (docs/reporte_diagnostico.md §2).

function delGerente(slug: string) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const r = armarReporte(plantilla, mesesDePrueba(plantilla), 1, { verBloquesReservados: accesoReservadosDelReporte(false, slug) });
  const textos = (bloque: string) => r.filas.filter((f) => f.fila.bloque === bloque).map((f) => f.fila.texto ?? "");
  return { r, textos };
}

const DISPONIBILIDADES: Record<string, string[]> = {
  radio: [
    "DISPONIBILIDADES (principios de mes)",
    "BANCO Y FCI",
    "EFECTIVO",
    "CHEQUES EN CARTERA",
    "CHEQUES NEGOCIADOS PENDIENTES DE INGRESO",
    "COMISIONES ESPECIALES PENDIENTES",
    "RESERVA AGUINALDO",
    "CHEQUES EN CARTERA DESPUES DEL 15",
    " TOTAL DISPONIBILIDADES",
  ],
  "conexion-logistica": [
    "DISPONIBILIDADES ",
    "BANCO",
    "EFECTIVO",
    "DOLARES",
    "CHEQUES EN CARTERA ",
    "CHEQUES NEGOCIADOS PENDIENTES DE INGRESO",
    "COBRANZA TECH PACK 02 Y 09",
    "RESERVA AGUINALDO",
    "CHEQUES EN CARTERA DESPUES DEL 10",
    "ADICIONALES PENDIENTES",
    "RECUPERO APORTE BLANQUEO",
    "GASTOS JET PARTS SOLUTIONS A RECUPERAR",
    " TOTAL DISPONIBILIDADES",
  ],
};

const CIERRE: Record<string, string[]> = {
  radio: ["SALDO INICIAL + INGRESOS - TOTAL EGRESOS", "CAPITAL DE TRABAJO PROPUESTO (15 DIAS)", "DISPONIBLE SI - CAPITAL DE TRABAJO"],
  "conexion-logistica": [
    "SALDO INICIAL + INGRESOS - TOTAL EGRESOS",
    "CAPITAL DE TRABAJO PROPUESTO (15 DIAS)",
    "DISPONIBLE SI - CAPITAL DE TRABAJO",
  ],
  havanna: ["SALDO INICIAL + INGRESOS - TOTAL EGRESOS", "CAPITAL DE TRABAJO PROPUESTO", "DISPONIBLE SI - CAPITAL DE TRABAJO"],
  "plate-silver": ["POSICIÓN DE EFECTIVO (fin de mes)", "Capital de trabajo propuesto", "Excedente(+) / Faltante (-)"],
  bradenton: ["POSICIÓN DE EFECTIVO (fin de mes)", "Capital de trabajo propuesto", "Excedente / Faltante"],
};

for (const slug of Object.keys(CIERRE)) {
  test(`${slug}: el gerente ve las filas de Cierre con el rótulo exacto de la planilla, y nunca «DISPONIBLE ANTES DE GASTOS»`, () => {
    const { r, textos } = delGerente(slug);
    assert.deepEqual(textos("CIERRE"), CIERRE[slug]);
    assert.equal(r.filas.some((f) => f.fila.texto === "DISPONIBLE ANTES DE GASTOS"), false);
    assert.ok(r.arrastre.every((a) => a === null), "el gerente nunca recibe el control de arrastre");
  });
}

for (const slug of Object.keys(DISPONIBILIDADES)) {
  test(`${slug}: el gerente ve las filas de Disponibilidades de su planilla, con título y total, y sin % ni «falta ejecutar»`, () => {
    const { r, textos } = delGerente(slug);
    assert.deepEqual(textos("DISPONIBILIDADES"), DISPONIBILIDADES[slug]);
    for (const f of r.filas.filter((x) => x.fila.bloque === "DISPONIBILIDADES" && x.fila.tipo !== "titulo")) {
      assert.notEqual(f.celdas[0].real, null, f.fila.clave);
      assert.equal(f.celdas[0].avance, null, f.fila.clave);
      assert.equal(f.celdas[0].faltaEjecutar, null, f.fila.clave);
    }
  });
}

test("conexión: son 11 filas de Disponibilidades, con «COBRANZA TECH PACK 02 Y 09» y «GASTOS JET PARTS SOLUTIONS A RECUPERAR»", () => {
  const { r } = delGerente("conexion-logistica");
  const lineas = r.filas.filter((f) => f.fila.bloque === "DISPONIBILIDADES" && f.fila.tipo === "linea");
  assert.equal(lineas.length, 11);
  const textos = lineas.map((f) => f.fila.texto);
  assert.ok(textos.includes("COBRANZA TECH PACK 02 Y 09"));
  assert.ok(textos.includes("GASTOS JET PARTS SOLUTIONS A RECUPERAR"));
});

test("radio y conexión: las filas espejo muestran en Presupuestado el saldo de Disponibilidades, y el gerente no pierde nada de lo que tipea", () => {
  for (const [slug, espejo] of [
    ["radio", "ra.chequesDespuesDel15"],
    ["conexion-logistica", "cx.chequesDespuesDel10"],
  ] as const) {
    const { r } = delGerente(slug);
    const fila = r.filas.find((f) => f.fila.clave === espejo)!;
    assert.notEqual(fila.celdas[0].presupuestado, null, `${slug}: el espejo ahora trae Presupuestado`);
    // Las filas de Ingresos / Egresos que tipea el gerente siguen todas presentes.
    const plantilla = PLANTILLAS_POR_SLUG[slug];
    const esperadas = plantilla.filas.filter((f) => f.bloque === "INGRESOS" || f.bloque === "EGRESOS" || f.bloque === "ABAJO").length;
    assert.equal(r.filas.filter((f) => ["INGRESOS", "EGRESOS", "ABAJO"].includes(f.fila.bloque)).length, esperadas, slug);
  }
});
