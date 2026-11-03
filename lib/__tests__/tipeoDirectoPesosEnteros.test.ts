import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { formatearCentavos, formatearPesos } from "@/lib/reporte/bloqueo";
import { armarVistaTipeo, celdaModificada, placeholderDeCelda } from "@/lib/reporte/tipeoDirecto";
import { leerCuenta } from "@/lib/importes";

// El tipeo directo del Reporte muestra pesos enteros (pedido de Kike), pero lo guardado conserva los centavos: el texto
// mostrado es solo la vista. La huella y la comparación de cambios usan los centavos exactos.

const SLUG = "brillante";
const CLAVE = "br.capital";
const ID = `${CLAVE}|PRESUPUESTADO`;

function celda(centavos?: number) {
  const v = armarVistaTipeo({
    empresaSlug: SLUG,
    plantilla: PLANTILLAS_POR_SLUG[SLUG],
    esAdminOFinanzas: true,
    periodo: "2026-10",
    actual: "2026-10",
    semanas: { abiertas: 1, cerradas: 0 },
    valoresReales: new Map(),
    valoresPresupuesto: centavos === undefined ? undefined : new Map([[CLAVE, centavos]]),
  })!;
  return { v, c: v.celdas.find((x) => x.id === ID)! };
}

test("formatearPesos: pesos enteros con puntos de miles; negativo con «-»; sin «-0»", () => {
  assert.equal(formatearPesos(7181520861), "71.815.209");
  assert.equal(formatearPesos(7181520840), "71.815.208");
  assert.equal(formatearPesos(-7323948700), "-73.239.487");
  assert.equal(formatearPesos(0), "0");
  assert.equal(formatearPesos(-30), "0");
});

test("71.815.208,61 se muestra «71.815.209» pero el valor guardado sigue exacto", () => {
  const { c } = celda(7181520861);
  assert.equal(c.importeInicial, "71.815.209");
  assert.equal(c.centavos, 7181520861);
  assert.equal(c.valorExacto, "71.815.208,61");
  // Lo que se tipeó se guarda como se lee: el parser sigue aceptando centavos y no redondea.
  const r = leerCuenta("71.815.208,61");
  assert.ok(r.ok && r.centavos === 7181520861);
});

test("tooltip con el valor exacto solo si el valor guardado tiene centavos", () => {
  assert.equal(celda(7181520861).c.valorExacto, "71.815.208,61");
  assert.equal(celda(7181520800).c.valorExacto, null);
  assert.equal(celda().c.valorExacto, null);
});

test("huella con centavos exactos: dos valores que se muestran igual tienen huellas distintas", () => {
  const a = celda(7181520900);
  const b = celda(7181520861);
  assert.equal(a.c.importeInicial, b.c.importeInicial);
  assert.notEqual(a.v.huella, b.v.huella);
  assert.ok(b.v.huella.includes(`${ID}=7181520861`));
});

test("corregir 71.815.209,00 a 71.815.208,61 es un cambio (el texto mostrado es el mismo)", () => {
  const { c } = celda(7181520900);
  assert.equal(c.importeInicial, "71.815.209");
  assert.equal(celdaModificada(c, "71.815.208,61"), true);
  // Sin tocar, o devuelto al valor exacto, no es cambio.
  assert.equal(celdaModificada(c, "71.815.209"), false);
  assert.equal(celdaModificada(c, "71.815.209,00"), false);
});

test("con centavos guardados: tipear el valor redondeado con ,00 es un cambio; tipear el exacto no", () => {
  const { c } = celda(7181520861);
  assert.equal(celdaModificada(c, "71.815.209"), false); // sin tocar: conserva los centavos
  assert.equal(celdaModificada(c, "71.815.209,00"), true);
  assert.equal(celdaModificada(c, "71.815.208,61"), false);
  assert.equal(celdaModificada(c, "100+50"), true); // una cuenta se guarda con su nota
  assert.equal(celdaModificada(c, "abc"), true); // lo que no se entiende lo rechaza el servidor
});

test("celda vacía: cualquier texto es un cambio; vacío no", () => {
  const { c } = celda();
  assert.equal(celdaModificada(c, ""), false);
  assert.equal(celdaModificada(c, "  "), false);
  assert.equal(celdaModificada(c, "1"), true);
});

test("placeholder gris sin decimales", () => {
  assert.equal(placeholderDeCelda("", 7181520861), "71.815.209");
  assert.equal(placeholderDeCelda("", 123), "1");
  assert.equal(placeholderDeCelda("", -7323948700), "-73.239.487");
  assert.equal(placeholderDeCelda("", 0), "0");
});

test("el gerente y /reporte/carga siguen usando formatearCentavos, con 2 decimales", () => {
  assert.equal(formatearCentavos(7181520861), "71.815.208,61");
  assert.equal(formatearCentavos(123456), "1.234,56");
  assert.equal(formatearCentavos(100), "1,00");
  assert.equal(formatearCentavos(-7323948700), "-73.239.487,00");
});
