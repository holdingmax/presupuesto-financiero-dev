import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, camposManuales, type DatosMes, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { camposTipeables, motivoRechazoTipeo } from "@/lib/reporte/tipeoDirecto";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";

// Expensas pasa a Real manual en Brillante, Havanna y Conexión Logística (Kike la carga sobre el Reporte). Las claves y los
// totales están escritos a mano, a propósito. Corre con el motor real (armarReporte), sin base.

const EMPRESAS: Record<string, { expensas: string; operativos: string; egresos: string; saldo: string; noSocios?: string }> = {
  brillante: { expensas: "br.expensas", operativos: "br.totalEgresosOperativos", egresos: "br.totalEgresos", saldo: "br.saldo" },
  havanna: { expensas: "hv.expensas", operativos: "hv.totalEgresosOperativos", egresos: "hv.totalEgresos", saldo: "hv.saldo" },
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
