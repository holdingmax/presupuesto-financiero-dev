import { test } from "node:test";
import assert from "node:assert/strict";
import { claveDeScrollInicial, corresponderScrollAlFinal } from "@/lib/reporte/scrollInicial";

test("scroll inicial: con un solo mes no corresponde (no hay contenedor que scrollee)", () => {
  assert.equal(corresponderScrollAlFinal(1, claveDeScrollInicial("2026-11", "1"), null), false);
});

test("scroll inicial: con varios meses corresponde la primera vez", () => {
  assert.equal(corresponderScrollAlFinal(3, claveDeScrollInicial("2026-11", "3"), null), true);
  assert.equal(corresponderScrollAlFinal(2, claveDeScrollInicial("2026-10", "2"), null), true);
});

test("scroll inicial: no se repite con la misma clave (un router.refresh no mueve lo scrolleado)", () => {
  const clave = claveDeScrollInicial("2026-11", "3");
  assert.equal(corresponderScrollAlFinal(3, clave, clave), false);
});

test("scroll inicial: cambia la clave al cambiar de mes o de vista, y vuelve a corresponder", () => {
  const antes = claveDeScrollInicial("2026-11", "3");
  assert.notEqual(claveDeScrollInicial("2026-10", "3"), antes);
  assert.notEqual(claveDeScrollInicial("2026-11", "2"), antes);
  assert.equal(corresponderScrollAlFinal(3, claveDeScrollInicial("2026-10", "3"), antes), true);
  assert.equal(corresponderScrollAlFinal(2, claveDeScrollInicial("2026-11", "2"), antes), true);
});
