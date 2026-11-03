import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANTILLA_BRILLANTE } from "@/lib/reporte/plantillas/brillante";
import {
  cambioMientrasEditaba,
  DETALLE_CARGA_DESDE_REPORTE,
  idCelda,
  planDeCarga,
  validarImporteCarga,
  vistaDeCarga,
  type LineaParaCarga,
  type ValorManualParaCarga,
} from "@/lib/reporte/cargaGerente";
import { celdaModificada } from "@/lib/reporte/tipeoDirecto";
import { formatearCentavos } from "@/lib/reporte/bloqueo";

// Las celdas de Presupuestado del editor de CargaPresupuesto.tsx (gerente y Reporte) muestran pesos enteros; lo guardado
// conserva los centavos. La huella y la comparación de cambios usan los centavos exactos, y la `base` del chequeo de
// cambios concurrentes de las filas manuales también.

const linea = (clasificacion: string, importeCentavos: number): LineaParaCarga => ({
  id: `l-${clasificacion}-${importeCentavos}`,
  clasificacion,
  detalle: DETALLE_CARGA_DESDE_REPORTE,
  importeCentavos,
  tieneDesglose: false,
});

const manual = (filaClave: string, centavos: number): ValorManualParaCarga => ({
  filaClave,
  centavos,
  nota: null,
  cargadoPor: "Prueba FINANZAS",
  actualizadoEn: new Date("2026-10-28T15:00:00Z"),
});

const celdaFila = (centavos: number) =>
  vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [linea("SUELDOS", centavos)])).celdas.find(
    (c) => c.id === idCelda("fila", "br.sueldos")
  )!;
const celdaManual = (centavos: number) =>
  vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [], [manual("br.ajusteCaja", centavos)])).celdas.find(
    (c) => c.id === idCelda("manual", "br.ajusteCaja")
  )!;

test("71.815.208,61 se muestra «71.815.209» y se conserva exacto (fila y manual)", () => {
  for (const c of [celdaFila(7181520861), celdaManual(7181520861)]) {
    assert.equal(c.importeInicial, "71.815.209");
    assert.equal(c.centavos, 7181520861);
    assert.equal(c.valorExacto, "71.815.208,61");
  }
  // Lo tipeado se guarda como se lee: el parser sigue aceptando centavos y no redondea.
  assert.deepEqual(validarImporteCarga("71.815.208,61", false), { ok: true, centavos: 7181520861, nota: null });
});

test("valorExacto solo si el valor guardado tiene centavos", () => {
  assert.equal(celdaFila(7181520800).valorExacto, null);
  assert.equal(celdaManual(7181520800).valorExacto, null);
  const vacia = vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [])).celdas.find((c) => c.id === idCelda("fila", "br.sueldos"))!;
  assert.equal(vacia.importeInicial, "");
  assert.equal(vacia.centavos, null);
  assert.equal(vacia.valorExacto, null);
});

test("huella con centavos exactos: valores que se muestran igual tienen huellas distintas", () => {
  const a = vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [linea("SUELDOS", 7181520900)]));
  const b = vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [linea("SUELDOS", 7181520861)]));
  assert.equal(a.celdas.find((c) => c.id === idCelda("fila", "br.sueldos"))!.importeInicial, "71.815.209");
  assert.equal(b.celdas.find((c) => c.id === idCelda("fila", "br.sueldos"))!.importeInicial, "71.815.209");
  assert.notEqual(a.huella, b.huella);
  const m1 = vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [], [manual("br.ajusteCaja", 7181520900)]));
  const m2 = vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [], [manual("br.ajusteCaja", 7181520861)]));
  assert.notEqual(m1.huella, m2.huella);
});

test("corregir 71.815.209,00 a 71.815.208,61 es un cambio en la celda del gerente (el texto mostrado es el mismo)", () => {
  const c = celdaFila(7181520900);
  assert.equal(celdaModificada(c, "71.815.208,61"), true);
  assert.equal(celdaModificada(c, "71.815.209"), false);
  assert.equal(celdaModificada(c, "71.815.209,00"), false);
  assert.equal(celdaModificada(c, ""), true); // vaciar = borrar
});

test("base de una fila manual con centavos: el valor exacto no da falso «cambió mientras lo editabas»", () => {
  const c = celdaManual(7181520861);
  const base = c.valorExacto ?? c.importeInicial;
  assert.equal(base, "71.815.208,61");
  assert.equal(cambioMientrasEditaba(base, 7181520861), false);
  // Con el texto redondeado habría dado un falso conflicto: por eso la base no es importeInicial.
  assert.equal(cambioMientrasEditaba(c.importeInicial, 7181520861), true);
  // Sin centavos la base es el texto mostrado.
  const entera = celdaManual(7181520800);
  assert.equal(cambioMientrasEditaba(entera.valorExacto ?? entera.importeInicial, 7181520800), false);
  // Si otra persona lo cambió, se sigue detectando.
  assert.equal(cambioMientrasEditaba(base, 7181520900), true);
});

test("/reporte/carga y el bloque «Sin fila» siguen con 2 decimales (formatearCentavos)", () => {
  assert.equal(formatearCentavos(7181520861), "71.815.208,61");
  assert.equal(formatearCentavos(123456), "1.234,56");
  const v = vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [linea("Juicios", 123456)]));
  const soloLectura = v.sinFila.map((s) => s.soloLectura).filter((x) => x !== null);
  for (const s of soloLectura) assert.match(s!.valor, /,\d{2}$/);
  if (v.fueraDeLista) assert.match(v.fueraDeLista.valor, /,\d{2}$/);
});
