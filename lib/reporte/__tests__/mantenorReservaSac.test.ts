import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLA_MANTENOR } from "@/lib/reporte/plantillas/mantenor";

// RESERVA SAC de Mantenor (hoja VALORES A MANO del PF de octubre): se tipea en negativo y resta del total de
// Disponibilidades. Valores del PF de Kike, en centavos.

function mes(real: Record<string, number>): DatosMes {
  return {
    periodo: "2026-10",
    real: new Map(),
    presupuesto: new Map(),
    mesCerrado: false,
    semanasCerradas: 0,
    manuales: { presupuesto: new Map(), real: new Map(Object.entries(real)) },
  };
}

function totalDisponibilidades(real: Record<string, number>): number | null {
  // Un mes de contexto (vacío) y el mes a medir, como el resto de los tests del motor.
  const r = armarReporte(PLANTILLA_MANTENOR, [{ ...mes({}), periodo: "2026-09" }, mes(real)], 1);
  const fila = r.filas.find((f) => f.fila.clave === "mn.totalDisponibilidades");
  assert.ok(fila);
  return fila.celdas[0].real;
}

const PF_KIKE = {
  "mn.dBancoFci": 34374667768,
  "mn.dEfectivo": 1929008033,
  "mn.dChequesNegociados": -2102154940,
};

test("mantenor: RESERVA SAC entra al total de Disponibilidades y resta (PF de Kike: 333.015.208,61)", () => {
  assert.equal(totalDisponibilidades({ ...PF_KIKE, "mn.dReservaSac": -900000000 }), 33301520861);
});

test("mantenor: sin RESERVA SAC el total no la resta (342.015.208,61)", () => {
  assert.equal(totalDisponibilidades(PF_KIKE), 34201520861);
});

test("mantenor: RESERVA SAC es un componente de ajuste, sin espejo en Ingresos", () => {
  const fila = PLANTILLA_MANTENOR.filas.find((f) => f.clave === "mn.dReservaSac");
  assert.ok(fila && fila.tipo === "linea");
  assert.equal(fila.bloque, "DISPONIBILIDADES");
  assert.equal(fila.arrastre, "ajuste");
  assert.equal(PLANTILLA_MANTENOR.filas.some((f) => f.bloque === "INGRESOS" && f.texto.toUpperCase().includes("RESERVA")), false);
});
