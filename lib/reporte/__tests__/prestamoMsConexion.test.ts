import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, type DatosMes, type FilaLinea, type FilaTotal } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { PLANTILLA_CONEXION } from "@/lib/reporte/plantillas/conexion";
import { esFilaDeCategoria, planDeCarga, vistaDeCarga, idCelda } from "@/lib/reporte/cargaGerente";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { mesesDePrueba } from "./fixtures/datosGerente";

// Conexión Logística: «Préstamo MS» se movió de EGRESOS OPERATIVOS al bloque de abajo, entre «Gastos Jet Parts Solutions a recuperar»
// y «Gastos MS» (cambio pedido por Kike el 6/11/2026). Mismo renglón, mismas columnas: solo cambia de lugar.

const SLUGS = ["conexion-logistica", "conexion-logistica-spp"];
const claves = (p = PLANTILLA_CONEXION) => p.filas.map((f) => f.clave);
const fila = (k: string) => PLANTILLA_CONEXION.filas.find((f) => f.clave === k)!;

test("orden en la plantilla: después de TOTAL EGRESOS OPERATIVOS, entre Gastos Jet Parts y Gastos MS", () => {
  const c = claves();
  const i = c.indexOf("cx.prestamoMs");
  assert.equal(c[i - 1], "cx.gastosJps");
  assert.equal(c[i + 1], "cx.gastosMs");
  assert.ok(i > c.indexOf("cx.totalEgresosOperativos"));
  assert.equal(c[c.indexOf("cx.totalEgresosOperativos") - 1], "cx.juicios", "el último operativo ahora es Juicios");
  assert.equal(fila("cx.prestamoMs").bloque, "ABAJO");
});

test("la definición de la fila no cambió: clave, texto, signo, Real por débitos de PRESTAMOS MS, Presupuestado por categoría, K13", () => {
  const f = fila("cx.prestamoMs") as FilaLinea;
  assert.equal(f.texto, "Préstamo MS");
  assert.equal(f.signo, -1);
  assert.deepEqual(f.real, { tipo: "clasificaciones", clasificaciones: ["PRESTAMOS MS"], sentido: "debitos" });
  assert.deepEqual(f.presupuesto, { tipo: "categorias", categorias: ["Préstamo MS"] });
  assert.equal(f.pendiente, "K13");
});

test("subtotales en la plantilla: sale de TOTAL EGRESOS OPERATIVOS y entra (una sola vez) en TOTAL DE EGRESOS", () => {
  const op = fila("cx.totalEgresosOperativos") as FilaTotal;
  const total = fila("cx.totalEgresos") as FilaTotal;
  assert.equal(op.suma.includes("cx.prestamoMs"), false);
  assert.equal(total.suma.filter((k) => k === "cx.prestamoMs").length, 1);
  assert.equal(total.suma.includes("cx.totalEgresosOperativos"), true);
});

test("efecto en los subtotales: el Real de Préstamo MS no entra en OPERATIVOS y sí en TOTAL DE EGRESOS (octubre: 143.609.524)", () => {
  const PRESTAMO = 14360952400; // centavos
  const SUELDOS = 100000000;
  const mes = (conPrestamo: boolean): DatosMes => ({
    periodo: "2026-10",
    real: new Map([["SUELDOS", -SUELDOS]]),
    realCreditos: new Map(),
    realDebitos: new Map(conPrestamo ? [["PRESTAMOS MS", -PRESTAMO]] : []),
    presupuesto: new Map(),
    semanasCerradas: 4,
    mesCerrado: true,
  });
  const celda = (r: ReturnType<typeof armarReporte>, k: string) => r.filas.find((f) => f.fila.clave === k)!.celdas[0];
  const con = armarReporte(PLANTILLA_CONEXION, [mes(true)]);
  const sin = armarReporte(PLANTILLA_CONEXION, [mes(false)]);
  assert.equal(celda(con, "cx.prestamoMs").real, PRESTAMO);
  assert.equal(celda(con, "cx.totalEgresosOperativos").real, SUELDOS, "OPERATIVOS no suma Préstamo MS");
  assert.equal(celda(sin, "cx.totalEgresosOperativos").real, celda(con, "cx.totalEgresosOperativos").real);
  assert.equal(celda(con, "cx.totalEgresos").real, SUELDOS + PRESTAMO, "TOTAL DE EGRESOS sí lo suma");
  assert.equal(celda(con, "cx.totalEgresos").real! - celda(sin, "cx.totalEgresos").real!, PRESTAMO);
});

for (const slug of SLUGS) {
  test(`${slug}: el orden en pantalla del gerente y de ADMIN/FINANZAS es el mismo y Préstamo MS queda entre Jet Parts y Gastos MS`, () => {
    const plantilla = PLANTILLAS_POR_SLUG[slug];
    const meses = mesesDePrueba(plantilla);
    const gerente = armarReporte(plantilla, meses, 1, {
      verBloquesReservados: accesoReservadosDelReporte(false, slug, { disponibilidades: [], cierre: [] }),
    });
    const admin = armarReporte(plantilla, meses, 1);
    for (const [quien, r] of [["gerente", gerente], ["ADMIN", admin]] as const) {
      const c = r.filas.map((f) => f.fila.clave);
      const i = c.indexOf("cx.prestamoMs");
      assert.equal(c[i - 1], "cx.gastosJps", quien);
      assert.equal(c[i + 1], "cx.gastosMs", quien);
      assert.ok(i > c.indexOf("cx.totalEgresosOperativos"), quien);
    }
  });

  test(`${slug}: el gerente sigue pudiendo cargar el Presupuestado de Préstamo MS, en el mismo orden relativo de la carga`, () => {
    const plantilla = PLANTILLAS_POR_SLUG[slug];
    const f = plantilla.filas.find((x) => x.clave === "cx.prestamoMs")!;
    assert.equal(esFilaDeCategoria(f), true);
    const vista = vistaDeCarga(planDeCarga(plantilla, []));
    const ids = vista.celdas.map((c) => c.id);
    const i = ids.indexOf(idCelda("fila", "cx.prestamoMs"));
    assert.ok(i >= 0, "tiene celda de carga");
    assert.ok(i > ids.indexOf(idCelda("fila", "cx.juicios")), "después de Juicios (cargable)");
    assert.ok(i < ids.indexOf(idCelda("fila", "cx.dividendosEfectivo")), "antes de Dividendos en efectivo (cargable)");
  });
}
