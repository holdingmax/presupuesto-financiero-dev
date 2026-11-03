import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, camposManuales, validarPlantilla, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";

// Desde 2026-10, «Cobranza Contado» de Brillante resta el Real manual de «Gold Salta» y «Otro (MSNT…)»: esos cobros ya
// están dentro de COBRANZAS de la unidad y se tipean aparte, así que sin restar se contarían dos veces.

const BRILLANTE = PLANTILLAS_POR_SLUG["brillante"];
const COBRANZA = "br.cobranzaContado";
const GOLD = "br.goldSalta";
const MSNT = "br.otroMsnt";
const FCI = "br.resultadoFci";

// Centavos.
const COBRANZAS = 77_405_597_000; // 774.055.970
const VALOR_GOLD = 1_855_009_244; // 18.550.092,44
const VALOR_MSNT = 7_082_661_112; // 70.826.611,12
const VALOR_FCI = 328_133_200; // 3.281.332

function mes(periodo: string, extra: Partial<DatosMes> = {}, conManuales = true): DatosMes {
  const real = new Map<string, number>(conManuales ? [[GOLD, VALOR_GOLD], [MSNT, VALOR_MSNT], [FCI, VALOR_FCI]] : [[FCI, VALOR_FCI]]);
  return {
    periodo,
    real: new Map([["COBRANZAS", COBRANZAS]]),
    presupuesto: new Map(),
    semanasCerradas: 4,
    manuales: { presupuesto: new Map(), real },
    ...extra,
  };
}

function celdaReal(datos: DatosMes, clave: string): number | null {
  const reporte = armarReporte(BRILLANTE, [datos], 0);
  return reporte.filas.find((f) => f.fila.clave === clave)!.celdas[0].real;
}

test("octubre 2026: Cobranza Contado queda sin Gold ni MSNT y el Total ingresos no cuenta nada dos veces", () => {
  const m = mes("2026-10");
  const cobranza = celdaReal(m, COBRANZA);
  assert.equal(cobranza, COBRANZAS - VALOR_GOLD - VALOR_MSNT);
  assert.equal(cobranza, 68_467_926_644); // 684.679.266,44
  const total = celdaReal(m, "br.totalIngresos");
  assert.equal(total, cobranza! + VALOR_GOLD + VALOR_MSNT + VALOR_FCI);
  assert.equal(total, COBRANZAS + VALOR_FCI); // 777.337.302: lo mismo que COBRANZAS + FCI, sin duplicar
});

test("septiembre y agosto 2026, y meses anteriores: Cobranza Contado queda igual que antes (COBRANZAS completo)", () => {
  for (const periodo of ["2026-09", "2026-08", "2026-07", "2025-12"]) {
    assert.equal(celdaReal(mes(periodo), COBRANZA), COBRANZAS, periodo);
  }
});

test("octubre sin semanas cerradas: Cobranza Contado es null, no un negativo", () => {
  assert.equal(celdaReal(mes("2026-10", { semanasCerradas: 0 }), COBRANZA), null);
});

test("octubre sin Gold ni MSNT tipeados: no resta nada (queda duplicado hasta que se tipeen)", () => {
  assert.equal(celdaReal(mes("2026-10", {}, false), COBRANZA), COBRANZAS);
});

test("noviembre en adelante también netea", () => {
  assert.equal(celdaReal(mes("2026-11"), COBRANZA), COBRANZAS - VALOR_GOLD - VALOR_MSNT);
});

test("Gold Salta es un campo manual de Real y la plantilla es válida", () => {
  assert.ok(camposManuales(BRILLANTE).some((c) => c.clave === GOLD && c.columna === "REAL"));
  assert.deepEqual(validarPlantilla(BRILLANTE), []);
});

test("solo Brillante usa restarManuales", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const usan = plantilla.filas.filter(
      (f) => f.tipo === "linea" && f.real.tipo === "clasificaciones" && f.real.restarManuales !== undefined
    );
    assert.deepEqual(usan.map((f) => f.clave), slug === "brillante" ? [COBRANZA] : [], slug);
  }
});
