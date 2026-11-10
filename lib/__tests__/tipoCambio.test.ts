import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  avisoTipoCambioFaltante,
  buscarTipoCambio,
  convertirCentavos,
  puedeCargarTipoCambio,
  validarTipoCambio,
} from "@/lib/tipoCambio";

const FILAS = [{ periodo: "2026-10", moneda: "USD", valor: "3.467" }];

test("TC: lo carga ADMIN o FINANZAS, no el gerente", () => {
  assert.equal(puedeCargarTipoCambio({ rol: "ADMIN" }), true);
  assert.equal(puedeCargarTipoCambio({ rol: "FINANZAS" }), true);
  assert.equal(puedeCargarTipoCambio({ rol: "GERENTE" }), false);
});

test("TC: la acción de carga exige ADMIN o FINANZAS antes de escribir", () => {
  const src = readFileSync("app/admin/tipo-cambio/actions.ts", "utf8");
  assert.ok(src.indexOf("requireAdminOFinanzas()") > 0);
  assert.ok(src.indexOf("requireAdminOFinanzas()") < src.indexOf("prisma.tipoCambio.upsert"));
  assert.ok(src.includes("cargadoPorId: usuario.id"), "guarda quién lo cargó");
});

test("TC: lectura del mes (octubre 2026 = 3,467)", () => {
  assert.deepEqual(buscarTipoCambio(FILAS, "2026-10", "USD"), { ok: true, valor: "3.467", esBase: false });
  assert.deepEqual(buscarTipoCambio(FILAS, "2026-10", "usd"), { ok: true, valor: "3.467", esBase: false });
});

test("TC faltante: avisa y NO inventa un valor (otro mes, otra moneda, lista vacía)", () => {
  for (const r of [buscarTipoCambio(FILAS, "2026-11", "USD"), buscarTipoCambio([], "2026-10", "USD"), buscarTipoCambio(FILAS, "2026-10", "EUR")]) {
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.aviso.includes("Falta el tipo de cambio"));
  }
  assert.equal(avisoTipoCambioFaltante("2026-11", "USD"), "Falta el tipo de cambio USD → PEN de 2026-11: no se convirtieron los importes en USD (ADMIN o FINANZAS lo tienen que cargar).");
});

test("TC: un valor guardado roto (0, texto) cuenta como faltante", () => {
  for (const valor of ["0", "abc", "", "-3"]) {
    assert.equal(buscarTipoCambio([{ periodo: "2026-10", moneda: "USD", valor }], "2026-10", "USD").ok, false, valor);
  }
});

test("TC: soles no necesita fila (vale 1)", () => {
  assert.deepEqual(buscarTipoCambio([], "2026-10", "PEN"), { ok: true, valor: "1", esBase: true });
});

test("TC: validación de lo que se escribe", () => {
  assert.deepEqual(validarTipoCambio("2026-10", "USD", "3,467"), { ok: true, periodo: "2026-10", moneda: "USD", valor: "3.467" });
  assert.deepEqual(validarTipoCambio("2026-10", "usd", " 3.467 "), { ok: true, periodo: "2026-10", moneda: "USD", valor: "3.467" });
  for (const mal of ["", "0", "0,0", "-3", "abc", "1.234,56", "3,4671234", "3,"]) {
    assert.equal(validarTipoCambio("2026-10", "USD", mal).ok, false, mal);
  }
  assert.equal(validarTipoCambio("2026-13", "USD", "3,4").ok, false);
  assert.equal(validarTipoCambio("2026-10", "ARS", "3,4").ok, false);
});

test("TC: conversión exacta en centavos, sin float, con signo", () => {
  assert.equal(convertirCentavos(120368, "3.467"), 417316, "1.203,68 USD × 3,467 = 4.173,16 soles");
  assert.equal(convertirCentavos(100, "3.467"), 347); // 1,00 USD → 3,47 PEN (3,467 redondeado)
  assert.equal(convertirCentavos(-100, "3.467"), -347);
  assert.equal(convertirCentavos(0, "3.467"), 0);
  assert.equal(convertirCentavos(1, "0.5"), 1, "mitad lejos del cero: 0,5 → 1");
  assert.equal(convertirCentavos(-1, "0.5"), -1);
  assert.equal(convertirCentavos(24711_57, "3.467"), 8567501, "24.711,57 USD × 3,467 = 85.675,01 soles");
  assert.throws(() => convertirCentavos(100, "0"), /inválido/);
});

test("TC: la migración es SOLO aditiva (tabla nueva, nada de ALTER/DROP/UPDATE sobre lo existente)", () => {
  const sql = readFileSync("prisma/migrations/20261111120000_tipo_cambio/migration.sql", "utf8");
  const sentencias = sql.split("\n").filter((l) => !l.startsWith("--") && l.trim() !== "");
  const ejecutables = sentencias.join("\n");
  // Al inicio de sentencia (ON DELETE / ON UPDATE de una clave foránea no son sentencias).
  assert.ok(!/^(DROP|UPDATE|DELETE|TRUNCATE|INSERT)\b/im.test(ejecutables));
  assert.ok(!/ALTER TABLE "(?!TipoCambio")/.test(ejecutables), "no altera ninguna tabla que no sea la nueva");
  assert.ok(ejecutables.includes('CREATE TABLE "TipoCambio"'));
  assert.ok(ejecutables.includes('CREATE UNIQUE INDEX "TipoCambio_periodo_moneda_key"'));
});
