import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, camposManuales, type DatosMes, type Reporte } from "@/lib/reporte/motor";
import { CLASIFICACIONES_SUGERIDAS } from "@/lib/clasificaciones";
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

// HWC: Expensas y los pagos a LATAM y Flybondi son Real manual (Kike los tipea en VALORES A MANO). Las tres filas de Ingresos de
// aerolíneas y los pagos a Globe, Avianca y GOL ya NO: leen su Real de Ejecución por clasificación propia (los nombres exactos del
// archivo madre de Kike, hoja CONTROL VS PF). Todas siguen con su Presupuestado manual y su pendiente K6/K2.
const HWC_INGRESOS_CLASIF: Record<string, string> = {
  "hw.facturacionLatam": "COBRANZAS LATAM",
  "hw.recaudacionLatamAvianca": "COBRANZAS LAN/AVIANCA",
  "hw.recaudacionJetsmart": "COBRANZA JETSMART",
};
const HWC_PAGOS_CLASIF: Record<string, string> = {
  "hw.pagoGlobe": "WCS",
  "hw.pagoAvianca": "AVIANCA",
  "hw.pagoGol": "GOL LINHEAS A",
};
const HWC_PAGOS_MANUALES = ["hw.pagoLatam", "hw.pagoFlybondi"];

test("HWC: tres ingresos de aerolíneas y tres pagos leen su clasificación; Pago LATAM y Flybondi siguen siendo Real manual", () => {
  const p = PLANTILLAS_POR_SLUG["hwc"];
  const campos = camposTipeables(p, "hwc");
  for (const [clave, clasificacion] of Object.entries({ ...HWC_INGRESOS_CLASIF, ...HWC_PAGOS_CLASIF })) {
    const f = p.filas.find((x) => x.clave === clave)!;
    assert.ok(f.tipo === "linea" && f.real.tipo === "clasificaciones" && f.presupuesto.tipo === "manual", clave);
    assert.deepEqual(f.real.clasificaciones, [clasificacion], clave);
    assert.equal(f.pendiente, "K6", clave);
    assert.equal(campos.some((c) => c.clave === clave && c.columna === "REAL"), false, `${clave}: ya no se tipea el Real`);
  }
  for (const clave of HWC_PAGOS_MANUALES) {
    const f = p.filas.find((x) => x.clave === clave)!;
    assert.ok(f.tipo === "linea" && f.real.tipo === "manual" && f.presupuesto.tipo === "manual", clave);
    assert.equal(f.pendiente, "K6", clave);
    assert.equal(campos.some((c) => c.clave === clave && c.columna === "REAL"), true, clave);
  }
  const exp = p.filas.find((x) => x.clave === "hw.expensas")!;
  assert.ok(exp.tipo === "linea" && exp.pendiente === "K2" && exp.nota === "Planilla: reparto de la unidad EXPENSAS.");
});

test("HWC: las seis clasificaciones de aerolíneas están en CLASIFICACIONES_SUGERIDAS (no figuran como nuevas en la madre)", () => {
  for (const c of [...Object.values(HWC_INGRESOS_CLASIF), ...Object.values(HWC_PAGOS_CLASIF)]) {
    assert.ok(CLASIFICACIONES_SUGERIDAS.includes(c), c);
  }
});

test("HWC: el Real de las seis filas sale de la Ejecución, suma una sola vez en sus totales y ignora un valor manual viejo", () => {
  const p = PLANTILLAS_POR_SLUG["hwc"];
  const meses = mesesDePrueba(p);
  const claves = [...Object.keys(HWC_INGRESOS_CLASIF), ...Object.keys(HWC_PAGOS_CLASIF)];
  const clasificaciones = { ...HWC_INGRESOS_CLASIF, ...HWC_PAGOS_CLASIF };
  // Ingresos en créditos (+), pagos en débitos (−), como los guarda la Ejecución.
  const ejecucion = new Map<string, number>([
    ...Object.keys(HWC_INGRESOS_CLASIF).map((k) => [clasificaciones[k], IMPORTE] as [string, number]),
    ...Object.keys(HWC_PAGOS_CLASIF).map((k) => [clasificaciones[k], -IMPORTE] as [string, number]),
  ]);
  const manualViejo = new Map(meses[1].manuales!.real);
  for (const c of claves) manualViejo.set(c, 999_999);
  const armar = (real: Map<string, number>) =>
    armarReporte(p, [meses[0], { ...meses[1], semanasCerradas: 1, real, manuales: { ...meses[1].manuales!, real: manualViejo } }], 1);
  const antes = armar(new Map());
  const despues = armar(ejecucion);
  for (const c of claves) {
    assert.equal(celda(antes, c).real, 0, `${c}: sin movimientos y con semana cerrada es 0, no el manual viejo`);
    assert.equal(celda(despues, c).real, IMPORTE, `${c}: toma la Ejecución, no el manual de 999.999`);
  }
  assert.equal(celda(despues, "hw.totalIngresos").real! - celda(antes, "hw.totalIngresos").real!, IMPORTE * 3, "ingresos");
  assert.equal(celda(despues, "hw.totalPagado").real! - celda(antes, "hw.totalPagado").real!, IMPORTE * 3, "pagos");
});

test("HWC: Pago LATAM y Pago Flybondi tipeados suman una sola vez en TOTAL EN EFECTIVO PAGADO", () => {
  const p = PLANTILLAS_POR_SLUG["hwc"];
  const meses = mesesDePrueba(p);
  const base = new Map(meses[1].manuales!.real);
  for (const c of HWC_PAGOS_MANUALES) base.delete(c);
  const con = new Map(base);
  for (const c of HWC_PAGOS_MANUALES) con.set(c, IMPORTE);
  const armar = (r: Map<string, number>) =>
    armarReporte(p, [meses[0], { ...meses[1], manuales: { ...meses[1].manuales!, real: r } }], 1);
  const antes = armar(base);
  const despues = armar(con);
  for (const c of HWC_PAGOS_MANUALES) {
    assert.equal(celda(antes, c).real, null, `${c} sin valor`);
    assert.equal(celda(despues, c).real, IMPORTE, c);
    assert.equal(celda(antes, c).realIncompleto, false, `${c}: con celda tipeable ya no queda marcada incompleta`);
  }
  assert.equal(celda(despues, "hw.totalPagado").real! - (celda(antes, "hw.totalPagado").real ?? 0), IMPORTE * 2, "pagos");
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
