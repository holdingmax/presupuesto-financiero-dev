import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, camposManuales, type DatosMes, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { camposTipeables, motivoRechazoTipeo } from "@/lib/reporte/tipeoDirecto";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";

// Expensas pasa a Real manual en Brillante, Havanna, Conexión Logística y HWC (Kike la carga sobre el Reporte). Las claves y los
// totales están escritos a mano, a propósito. Corre con el motor real (armarReporte), sin base.

const EMPRESAS: Record<string, { expensas: string; operativos: string; egresos: string; saldo: string; noSocios?: string }> = {
  brillante: { expensas: "br.expensas", operativos: "br.totalEgresosOperativos", egresos: "br.totalEgresos", saldo: "br.saldo" },
  havanna: { expensas: "hv.expensas", operativos: "hv.totalEgresosOperativos", egresos: "hv.totalEgresos", saldo: "hv.saldo" },
  hwc: { expensas: "hw.expensas", operativos: "hw.subtotalEstructura", egresos: "hw.totalPagado", saldo: "hw.saldo" },
  "conexion-logistica": {
    expensas: "cx.expensas",
    operativos: "cx.totalEgresosOperativos",
    egresos: "cx.totalEgresos",
    saldo: "cx.saldo",
    noSocios: "cx.expensasNoSocios",
  },
  "conexion-logistica-spp": {
    expensas: "cx.expensas",
    operativos: "cx.totalEgresosOperativos",
    egresos: "cx.totalEgresos",
    saldo: "cx.saldo",
    noSocios: "cx.expensasNoSocios",
  },
};

const IMPORTE = 123_456;
const celda = (r: Reporte, clave: string) => r.filas.find((f) => f.fila.clave === clave)!.celdas[0];

// Dos juegos de datos idénticos salvo el Real de Expensas (sin valor / con IMPORTE).
function conYSinExpensas(slug: string, clave: string): { sin: DatosMes[]; con: DatosMes[] } {
  const meses = mesesDePrueba(PLANTILLAS_POR_SLUG[slug]);
  const real = new Map(meses[1].manuales!.real);
  const sinReal = new Map(real);
  sinReal.delete(clave);
  const conReal = new Map(real).set(clave, IMPORTE);
  const armar = (r: Map<string, number>): DatosMes[] => [meses[0], { ...meses[1], manuales: { ...meses[1].manuales!, real: r } }];
  return { sin: armar(sinReal), con: armar(conReal) };
}

for (const [slug, e] of Object.entries(EMPRESAS)) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];

  test(`${slug}: Expensas es Real manual y se tipea; el Presupuestado sigue saliendo de la Ejecución`, () => {
    const fila = plantilla.filas.find((f) => f.clave === e.expensas)!;
    assert.ok(fila.tipo === "linea" && fila.real.tipo === "manual" && fila.presupuesto.tipo === "categorias");
    assert.equal(camposManuales(plantilla).some((c) => c.clave === e.expensas && c.columna === "REAL"), true);
    assert.equal(camposManuales(plantilla).some((c) => c.clave === e.expensas && c.columna === "PRESUPUESTADO"), false);
    assert.equal(camposTipeables(plantilla, slug).some((c) => c.clave === e.expensas && c.columna === "REAL"), true);
    assert.equal(
      motivoRechazoTipeo({
        empresaSlug: slug,
        plantilla,
        esAdminOFinanzas: true,
        entradas: [{ filaClave: e.expensas, columna: "REAL", texto: "123.456" }],
      }),
      null
    );
  });

  test(`${slug}: el Real de Expensas suma en TOTAL EGRESOS OPERATIVOS (y de ahí en Total egresos y Saldo)`, () => {
    const { sin, con } = conYSinExpensas(slug, e.expensas);
    const antes = armarReporte(plantilla, sin, 1);
    const despues = armarReporte(plantilla, con, 1);
    assert.equal(celda(antes, e.expensas).real, null, "sin valor cargado, la celda queda vacía");
    assert.equal(celda(despues, e.expensas).real, IMPORTE);
    assert.equal(celda(despues, e.operativos).real! - (celda(antes, e.operativos).real ?? 0), IMPORTE, "operativos");
    assert.equal(celda(despues, e.egresos).real! - (celda(antes, e.egresos).real ?? 0), IMPORTE, "total egresos");
    // El Saldo es Disponible antes de gastos − Total egresos: baja lo mismo.
    assert.equal((celda(antes, e.saldo).real ?? 0) - (celda(despues, e.saldo).real ?? 0), IMPORTE, "saldo");
    // El Presupuestado no se mueve.
    assert.equal(celda(despues, e.operativos).presupuestado, celda(antes, e.operativos).presupuestado);
  });

  if (e.noSocios) {
    test(`${slug}: «Expensas - No socios» sigue sin Real`, () => {
      const fila = plantilla.filas.find((f) => f.clave === e.noSocios)!;
      assert.ok(fila.tipo === "linea" && fila.real.tipo === "ninguna");
      assert.equal(camposManuales(plantilla).some((c) => c.clave === e.noSocios && c.columna === "REAL"), false);
    });
  }
}

test("Havanna: Compra IVA y Otros Ingresos no cambian (Kike no trae valor para esas)", () => {
  const p = PLANTILLAS_POR_SLUG["havanna"];
  const real = (clave: string) => {
    const f = p.filas.find((x) => x.clave === clave)!;
    return f.tipo === "linea" ? f.real.tipo : null;
  };
  assert.equal(real("hv.compraIva"), "ninguna");
  assert.equal(real("hv.otrosIngresos"), "clasificaciones");
});

test("Brillante: Compra IVA no cambia", () => {
  const f = PLANTILLAS_POR_SLUG["brillante"].filas.find((x) => x.clave === "br.compraIva")!;
  assert.ok(f.tipo === "linea" && f.real.tipo === "clasificaciones");
});

// HWC: además de Expensas, las tres filas de Ingresos de aerolíneas y las cinco de pagos pasan a Real manual (Kike las
// tipea en VALORES A MANO). Siguen con su Presupuestado manual y sus pendientes K6/K2. Ninguna tiene clasificaciones.
const HWC_INGRESOS = ["hw.facturacionLatam", "hw.recaudacionLatamAvianca", "hw.recaudacionJetsmart"];
const HWC_PAGOS = ["hw.pagoGlobe", "hw.pagoLatam", "hw.pagoAvianca", "hw.pagoFlybondi", "hw.pagoGol"];

test("HWC: ingresos de aerolíneas y cinco pagos son Real manual con Presupuestado manual y su pendiente", () => {
  const p = PLANTILLAS_POR_SLUG["hwc"];
  for (const clave of [...HWC_INGRESOS, ...HWC_PAGOS]) {
    const f = p.filas.find((x) => x.clave === clave)!;
    assert.ok(f.tipo === "linea" && f.real.tipo === "manual" && f.presupuesto.tipo === "manual", clave);
    assert.equal(f.pendiente, "K6", clave);
    assert.equal(camposTipeables(p, "hwc").some((c) => c.clave === clave && c.columna === "REAL"), true, clave);
  }
  const exp = p.filas.find((x) => x.clave === "hw.expensas")!;
  assert.ok(exp.tipo === "linea" && exp.pendiente === "K2" && exp.nota === "Planilla: reparto de la unidad EXPENSAS.");
});

test("HWC: tipear los ingresos suma en TOTAL DE INGRESOS y los pagos en TOTAL EN EFECTIVO PAGADO, una sola vez", () => {
  const p = PLANTILLAS_POR_SLUG["hwc"];
  const meses = mesesDePrueba(p);
  const base = new Map(meses[1].manuales!.real);
  for (const c of [...HWC_INGRESOS, ...HWC_PAGOS]) base.delete(c);
  const con = new Map(base);
  for (const c of [...HWC_INGRESOS, ...HWC_PAGOS]) con.set(c, IMPORTE);
  const armar = (r: Map<string, number>) =>
    armarReporte(p, [meses[0], { ...meses[1], manuales: { ...meses[1].manuales!, real: r } }], 1);
  const antes = armar(base);
  const despues = armar(con);
  for (const c of [...HWC_INGRESOS, ...HWC_PAGOS]) {
    assert.equal(celda(antes, c).real, null, `${c} sin valor`);
    assert.equal(celda(despues, c).real, IMPORTE, c);
    assert.equal(celda(antes, c).realIncompleto, false, `${c}: con celda tipeable ya no queda marcada incompleta`);
  }
  assert.equal(celda(despues, "hw.totalIngresos").real! - (celda(antes, "hw.totalIngresos").real ?? 0), IMPORTE * 3, "ingresos");
  assert.equal(celda(despues, "hw.totalPagado").real! - (celda(antes, "hw.totalPagado").real ?? 0), IMPORTE * 5, "pagos");
  assert.equal(celda(despues, "hw.totalIngresos").presupuestado, celda(antes, "hw.totalIngresos").presupuestado);
});

test("HWC: Clientes propios, Proveedores y Sueldos siguen leyendo la Ejecución (sin tocar)", () => {
  const p = PLANTILLAS_POR_SLUG["hwc"];
  const real = (clave: string) => {
    const f = p.filas.find((x) => x.clave === clave)!;
    return f.tipo === "linea" ? f.real.tipo : null;
  };
  assert.equal(real("hw.clientesPropios"), "clasificaciones");
  assert.equal(real("hw.proveedores"), "clasificaciones");
  assert.equal(real("hw.sueldos"), "clasificaciones");
  assert.equal(real("hw.recuperoExpensas"), "ninguna");
});
