import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";

// Septiembre 2026 queda oculto (config), pero sigue entrando como mes de CONTEXTO invisible de octubre
// (la página pide periodosHasta(periodo, cantidad + 1) y armarReporte descarta ese primer mes). Con septiembre
// sin Real ni valores manuales (el caso de testing), el control de arrastre de octubre queda «sin dato».

const septiembreVacio: DatosMes = {
  periodo: "2026-09",
  real: new Map(),
  presupuesto: null,
  semanasCerradas: 0,
  mesCerrado: false,
  manuales: undefined,
};

test("el mes de contexto (septiembre) no se muestra y el arrastre de octubre queda sin dato, no «no cuadra»", () => {
  const plantilla = PLANTILLAS_POR_SLUG["radio"];
  const octubre: DatosMes = {
    periodo: "2026-10",
    real: new Map(),
    presupuesto: new Map(),
    semanasCerradas: 3,
    mesCerrado: false,
    manuales: { presupuesto: new Map(), real: new Map([["ra.dBancoFci", 10000000]]) },
  };
  const r = armarReporte(plantilla, [septiembreVacio, octubre], 1);
  assert.deepEqual(r.periodos, ["2026-10"]); // septiembre no aparece
  assert.equal(r.arrastre.length, 1);
  assert.equal(r.arrastre[0]!.cierreRealAnterior, null);
  assert.equal(r.arrastre[0]!.diferencia, null);
  assert.equal(r.arrastre[0]!.cuadra, null); // «sin dato»: ni cuadra ni no cuadra
});
