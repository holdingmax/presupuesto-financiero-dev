import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { formatearCentavos } from "@/lib/reporte/bloqueo";
import { placeholderDeCelda } from "@/lib/reporte/tipeoDirecto";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";

// Texto gris de las celdas de Presupuestado vacías del tipeo directo: el valor que calcula la regla de la plantilla.

test("sin valor guardado devuelve el derivado en formato argentino, el mismo que acepta el input", () => {
  assert.equal(placeholderDeCelda("", 56597300000), "565.973.000,00");
  assert.equal(placeholderDeCelda("", 56597300000), formatearCentavos(56597300000));
  assert.equal(placeholderDeCelda("", 123), "1,23");
  assert.equal(placeholderDeCelda("", -7323948700), "-73.239.487,00");
  assert.equal(placeholderDeCelda("", 0), "0,00");
});

test("con valor guardado no devuelve el derivado", () => {
  assert.equal(placeholderDeCelda("231.200.000,00", 56597300000), "0");
  assert.equal(placeholderDeCelda("1,00", null), "0");
});

test("sin derivado queda «0»", () => {
  assert.equal(placeholderDeCelda("", null), "0");
  assert.equal(placeholderDeCelda("", undefined), "0");
});

// El derivado que llega a la celda es el Presupuestado de la fila en el último mes, sin el valor tipeado de esa fila.
function derivadoDe(slug: string, clave: string): number | null {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const sinLaFila = (m: DatosMes): DatosMes => {
    const presupuesto = new Map(m.manuales!.presupuesto);
    presupuesto.delete(clave);
    return { ...m, manuales: { ...m.manuales!, presupuesto } };
  };
  const r = armarReporte(plantilla, mesesDePrueba(plantilla).map(sinLaFila), 1);
  return r.filas.find((f) => f.fila.clave === clave)!.celdas[0].presupuestado;
}

for (const [slug, clave] of [
  ["brillante", "br.capital"],
  ["conexion-logistica", "cx.capital"],
  ["havanna", "hv.capital"],
  ["radio", "ra.capital"],
  ["fredy-publicidad", "fr.capital"],
  ["hwc", "hw.capital"],
  ["mn-prestamos", "mn.prestamos"],
  ["hv-acreditacion", "hv.acreditacionTarjetas"],
] as const) {
  const real = slug === "mn-prestamos" ? "mantenor" : slug === "hv-acreditacion" ? "havanna" : slug;
  test(`${clave}: con regla y sin valor guardado, el placeholder es el derivado`, () => {
    const derivado = derivadoDe(real, clave);
    assert.notEqual(derivado, null, "con los datos de prueba la regla da un valor");
    assert.equal(placeholderDeCelda("", derivado), formatearCentavos(derivado!));
    assert.notEqual(placeholderDeCelda("", derivado), "0");
    assert.equal(placeholderDeCelda("1,00", derivado), "0");
  });
}

test("Mantenor Capital: su regla es manual, sin valor el derivado es null y el placeholder queda «0»", () => {
  const derivado = derivadoDe("mantenor", "mn.capital");
  assert.equal(derivado, null);
  assert.equal(placeholderDeCelda("", derivado), "0");
});
