import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { PLANTILLA_HAVANNA } from "@/lib/reporte/plantillas/havanna";
import {
  cambioMientrasEditaba,
  idCelda,
  manualDeEntrada,
  planDeCarga,
  validarImporteCarga,
  vistaDeCarga,
  type ValorManualParaCarga,
} from "@/lib/reporte/cargaGerente";

// Havanna «Devolucion prestamo - Prestamo MS»: su Presupuestado es el Disponible (automático) y el gerente también puede
// pisarlo tipeando en su pantalla de carga (mismo ValorManualReporte que tipean ADMIN y FINANZAS).

const CLAVE = "hv.devolucionPrestamoMs";
const valor = (centavos: number): ValorManualParaCarga => ({
  filaClave: CLAVE,
  centavos,
  nota: null,
  cargadoPor: "Gerente Havanna",
  actualizadoEn: new Date("2026-11-06T15:00:00Z"),
});

test("el gerente de Havanna recibe la celda manual de «Prestamo MS»; sin valor guardado viene vacía", () => {
  const plan = planDeCarga(PLANTILLA_HAVANNA, []);
  assert.equal(Object.hasOwn(plan.manuales, CLAVE), true);
  assert.deepEqual(plan.manuales[CLAVE], { valorCentavos: null, nota: null, leyenda: null });
  assert.ok(manualDeEntrada(plan, { destino: "manual", clave: CLAVE }));
  const celda = vistaDeCarga(plan).celdas.find((c) => c.id === idCelda("manual", CLAVE))!;
  assert.equal(celda.importeInicial, "");
  assert.equal(celda.centavos, null);
});

test("con un valor guardado, la celda lo muestra con quién lo cargó", () => {
  const plan = planDeCarga(PLANTILLA_HAVANNA, [], [valor(150000000)]);
  const celda = vistaDeCarga(plan).celdas.find((c) => c.id === idCelda("manual", CLAVE))!;
  assert.equal(celda.importeInicial, "1.500.000");
  assert.match(celda.leyenda!, /^Cargó Gerente Havanna/);
});

test("el resto de Havanna no cambia: las demás derivadas (Acreditación Tarjetas) y Cierre siguen sin celda del gerente", () => {
  const plan = planDeCarga(PLANTILLA_HAVANNA, []);
  for (const clave of ["hv.acreditacionTarjetas", "hv.capital", "hv.disponible", "hv.saldo", "hv.totalEgresos", "hv.dBancoFci"]) {
    assert.equal(Object.hasOwn(plan.manuales, clave), false, clave);
    assert.equal(manualDeEntrada(plan, { destino: "manual", clave }), null, clave);
  }
  // «Deuda expensas» (manual, hermana de la fila) sigue como antes.
  assert.equal(Object.hasOwn(plan.manuales, "hv.devolucionExpensas"), true);
});

test("otras empresas: ninguna fila derivada ganó celda del gerente, y la clave de Havanna no sirve en otra empresa", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const plan = planDeCarga(plantilla, []);
    for (const f of plantilla.filas) {
      if (f.tipo === "linea" && f.presupuesto.tipo !== "manual") {
        assert.equal(Object.hasOwn(plan.manuales, f.clave), slug === "havanna" && f.clave === CLAVE, `${slug}/${f.clave}`);
      }
    }
    if (slug !== "havanna") assert.equal(manualDeEntrada(plan, { destino: "manual", clave: CLAVE }), null, slug);
  }
});

// ---- Efecto en el Reporte (motor con la plantilla real) -------------------------------------------------

function mes(presupuestado: [string, number][] = []): DatosMes {
  return {
    periodo: "2026-11",
    real: new Map(),
    // Egresos del mes para que haya Capital de trabajo y Presupuesto cargado.
    presupuesto: new Map([["SUELDOS", 100000000]]),
    semanasCerradas: 0,
    manuales: { presupuesto: new Map(presupuestado), real: new Map([["hv.dChequesEnCartera", 500000000]]) },
  };
}
const celdaDe = (r: ReturnType<typeof armarReporte>, clave: string) => r.filas.find((f) => f.fila.clave === clave)!.celdas[0];

test("sin tipear nada la fila muestra el automático (Disponible); con un valor lo reemplaza en la fila, TOTAL EGRESOS y SALDO; al borrarlo vuelve", () => {
  const auto = armarReporte(PLANTILLA_HAVANNA, [mes()]);
  const automatico = celdaDe(auto, CLAVE).presupuestado;
  assert.notEqual(automatico, null);
  assert.equal(automatico, celdaDe(auto, "hv.disponible").presupuestado);

  const tipeado = armarReporte(PLANTILLA_HAVANNA, [mes([[CLAVE, 7000000]])]);
  assert.equal(celdaDe(tipeado, CLAVE).presupuestado, 7000000);
  const dEgresos = celdaDe(tipeado, "hv.totalEgresos").presupuestado! - celdaDe(auto, "hv.totalEgresos").presupuestado!;
  assert.equal(dEgresos, 7000000 - automatico!);
  const dSaldo = celdaDe(tipeado, "hv.saldo").presupuestado! - celdaDe(auto, "hv.saldo").presupuestado!;
  assert.equal(dSaldo, -dEgresos);
  // El Capital de trabajo no se toca.
  assert.equal(celdaDe(tipeado, "hv.capital").presupuestado, celdaDe(auto, "hv.capital").presupuestado);

  // Borrar lo tipeado = el servidor borra el ValorManualReporte (importe vacío → centavos null) → vuelve el automático.
  assert.deepEqual(validarImporteCarga("", false), { ok: true, centavos: null, nota: null });
  const borrado = armarReporte(PLANTILLA_HAVANNA, [mes([])]);
  assert.equal(celdaDe(borrado, CLAVE).presupuestado, automatico);
});

test("ADMIN y gerente sobre la misma celda: el gerente que cargó la pantalla antes del cambio de ADMIN es rechazado (no pisa en silencio)", () => {
  // La pantalla del gerente mostró vacío; mientras tanto ADMIN guardó 5.000.000 → conflicto.
  assert.equal(cambioMientrasEditaba("", 500000000), true);
  // Con la pantalla ya recargada (base = lo de ADMIN), puede pisarlo.
  assert.equal(cambioMientrasEditaba("5.000.000", 500000000), false);
});
