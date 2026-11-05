import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Rol } from "@prisma/client";
import {
  decidirConfirmacion,
  ejecutarConfirmacion,
  ERROR_CAMBIO_MIENTRAS_CONFIRMABA,
  MIN_MOTIVO_EN_NOMBRE,
  puedeConfirmarComoGerente,
  puedeConfirmarEnNombreDelGerente,
  validarMotivoEnNombre,
  type DbConfirmacion,
  type EntradaConfirmacion,
} from "@/lib/confirmacionFinal";

// Confirmación final del presupuesto: "Confirmar versión final" solo el GERENTE; "Confirmar en nombre del
// gerente" solo ADMIN o FINANZAS con permiso de revisor, con motivo escrito. Las acciones del servidor
// (confirmarVersionFinal / confirmarEnNombreDelGerente) son una envoltura de resolverEmpresaYPresupuesto +
// ejecutarConfirmacion: acá se prueba ejecutarConfirmacion directamente, con una base falsa, que es donde
// vive la regla y la escritura.

const MOTIVO = "El gerente está de licencia y hay que cerrar el mes";

function dbFalsa(count = 1) {
  const llamadas: Parameters<DbConfirmacion["updateMany"]>[0][] = [];
  const db: DbConfirmacion = {
    async updateMany(args) {
      llamadas.push(args);
      return { count };
    },
  };
  return { db, llamadas };
}

function entrada(rol: Rol, modo: EntradaConfirmacion["modo"], over: Partial<EntradaConfirmacion> = {}): EntradaConfirmacion {
  return {
    modo,
    usuario: { id: `u-${rol}`, rol },
    esRevisor: rol === "ADMIN",
    presupuesto: { id: "p1", estado: "EN_REVISION", revisionCompletada: true },
    motivo: MOTIVO,
    ...over,
  };
}

// ---- Qué botón le toca a cada rol ---------------------------------------------------------------------

test("botones por rol: GERENTE solo la normal; ADMIN solo la de en nombre; FINANZAS en nombre solo si revisa", () => {
  const casos: [Rol, boolean, boolean, boolean][] = [
    // rol, esRevisor, ve "Confirmar versión final", ve "Confirmar en nombre del gerente"
    ["GERENTE", false, true, false],
    ["GERENTE", true, true, false], // un gerente con permiso de revisor sigue viendo solo la normal
    ["ADMIN", true, false, true],
    ["ADMIN", false, false, true],
    ["FINANZAS", true, false, true],
    ["FINANZAS", false, false, false], // sin permiso de revisor: no ve ninguna de las dos
  ];
  for (const [rol, esRevisor, normal, enNombre] of casos) {
    assert.equal(puedeConfirmarComoGerente(rol), normal, `${rol} revisor=${esRevisor} normal`);
    assert.equal(puedeConfirmarEnNombreDelGerente(rol, esRevisor), enNombre, `${rol} revisor=${esRevisor} en nombre`);
  }
});

// ---- GERENTE: la normal -------------------------------------------------------------------------------

test("GERENTE confirma la versión final: VALIDADO, validadoPorId = él, sin marca de en nombre ni motivo", async () => {
  const { db, llamadas } = dbFalsa();
  const ahora = new Date("2026-11-06T12:00:00Z");
  const r = await ejecutarConfirmacion(db, entrada("GERENTE", "GERENTE", { ahora, motivo: undefined }));
  assert.deepEqual(r, { ok: true });
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0].where, { id: "p1", estado: "EN_REVISION", revisionCompletada: true });
  assert.deepEqual(llamadas[0].data, {
    estado: "VALIDADO",
    fechaValidacion: ahora,
    validadoPorId: "u-GERENTE",
    confirmadoEnNombreDeGerente: false,
    motivoConfirmacionEnNombre: null,
  });
});

test("GERENTE: aunque mande un motivo por la acción normal, no se guarda ninguna marca de en nombre", async () => {
  const { db, llamadas } = dbFalsa();
  const r = await ejecutarConfirmacion(db, entrada("GERENTE", "GERENTE", { motivo: MOTIVO }));
  assert.equal(r.ok, true);
  assert.equal(llamadas[0].data.confirmadoEnNombreDeGerente, false);
  assert.equal(llamadas[0].data.motivoConfirmacionEnNombre, null);
});

// ---- ADMIN y FINANZAS NO pueden la normal (el servidor, no solo el botón) ---------------------------

test("ADMIN no puede usar la acción normal: se rechaza y no se escribe nada", async () => {
  const { db, llamadas } = dbFalsa();
  const r = await ejecutarConfirmacion(db, entrada("ADMIN", "GERENTE"));
  assert.deepEqual(r, { ok: false, error: "Solo el gerente de la empresa puede confirmar la versión final." });
  assert.equal(llamadas.length, 0);
});

test("FINANZAS (con o sin permiso de revisor) no puede usar la acción normal", async () => {
  for (const esRevisor of [true, false]) {
    const { db, llamadas } = dbFalsa();
    const r = await ejecutarConfirmacion(db, entrada("FINANZAS", "GERENTE", { esRevisor }));
    assert.equal(r.ok, false, `revisor=${esRevisor}`);
    assert.equal(llamadas.length, 0, `revisor=${esRevisor}`);
  }
});

// ---- ADMIN: en nombre del gerente --------------------------------------------------------------------

test("ADMIN confirma en nombre del gerente con motivo válido: VALIDADO, validadoPorId = él, marca y motivo guardados", async () => {
  const { db, llamadas } = dbFalsa();
  const ahora = new Date("2026-11-06T12:00:00Z");
  const r = await ejecutarConfirmacion(db, entrada("ADMIN", "EN_NOMBRE", { ahora, motivo: `   ${MOTIVO}  ` }));
  assert.deepEqual(r, { ok: true });
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0].data, {
    estado: "VALIDADO",
    fechaValidacion: ahora,
    validadoPorId: "u-ADMIN",
    confirmadoEnNombreDeGerente: true,
    motivoConfirmacionEnNombre: MOTIVO, // recortado
  });
  assert.deepEqual(llamadas[0].where, { id: "p1", estado: "EN_REVISION", revisionCompletada: true });
});

test("FINANZAS con permiso de revisor también puede confirmar en nombre del gerente", async () => {
  const { db, llamadas } = dbFalsa();
  const r = await ejecutarConfirmacion(db, entrada("FINANZAS", "EN_NOMBRE", { esRevisor: true }));
  assert.deepEqual(r, { ok: true });
  assert.equal(llamadas[0].data.validadoPorId, "u-FINANZAS");
  assert.equal(llamadas[0].data.confirmadoEnNombreDeGerente, true);
});

test("FINANZAS sin permiso de revisor no puede confirmar en nombre del gerente", async () => {
  const { db, llamadas } = dbFalsa();
  const r = await ejecutarConfirmacion(db, entrada("FINANZAS", "EN_NOMBRE", { esRevisor: false }));
  assert.deepEqual(r, { ok: false, error: "No tenés permiso para confirmar en nombre del gerente." });
  assert.equal(llamadas.length, 0);
});

test("GERENTE no puede usar la acción de en nombre del gerente, ni siquiera con permiso de revisor ni con motivo", async () => {
  for (const esRevisor of [false, true]) {
    const { db, llamadas } = dbFalsa();
    const r = await ejecutarConfirmacion(db, entrada("GERENTE", "EN_NOMBRE", { esRevisor }));
    assert.deepEqual(r, { ok: false, error: "No tenés permiso para confirmar en nombre del gerente." }, `revisor=${esRevisor}`);
    assert.equal(llamadas.length, 0, `revisor=${esRevisor}`);
  }
});

// ---- Motivo -------------------------------------------------------------------------------------------

test("motivo vacío, de solo espacios, corto o que no es texto: se rechaza y no se escribe nada", async () => {
  const malos: unknown[] = ["", "   ", "corto", "123456789", "  123456789  ", undefined, null, 12345678901234];
  for (const motivo of malos) {
    const { db, llamadas } = dbFalsa();
    const r = await ejecutarConfirmacion(db, entrada("ADMIN", "EN_NOMBRE", { motivo }));
    assert.equal(r.ok, false, String(motivo));
    if (!r.ok) assert.match(r.error, /motivo/i, String(motivo));
    assert.equal(llamadas.length, 0, String(motivo));
  }
});

test("motivo de exactamente 10 caracteres (ya recortado) se acepta; uno de más de 500 no", () => {
  assert.equal(MIN_MOTIVO_EN_NOMBRE, 10);
  assert.deepEqual(validarMotivoEnNombre("1234567890"), { ok: true, motivo: "1234567890" });
  assert.equal(validarMotivoEnNombre("x".repeat(501)).ok, false);
  assert.equal(validarMotivoEnNombre("x".repeat(500)).ok, true);
});

// ---- Estados: valen para las dos acciones -----------------------------------------------------------

test("fuera de EN_REVISION con revisión terminada no se confirma, por ninguna de las dos acciones", async () => {
  const casos: [string, EntradaConfirmacion["presupuesto"]][] = [
    ["ABIERTO", { id: "p1", estado: "ABIERTO", revisionCompletada: false }],
    ["VALIDADO", { id: "p1", estado: "VALIDADO", revisionCompletada: true }],
    ["EN_REVISION sin terminar", { id: "p1", estado: "EN_REVISION", revisionCompletada: false }],
  ];
  for (const [nombre, presupuesto] of casos) {
    for (const [rol, modo] of [["GERENTE", "GERENTE"], ["ADMIN", "EN_NOMBRE"]] as const) {
      const { db, llamadas } = dbFalsa();
      const r = await ejecutarConfirmacion(db, entrada(rol, modo, { presupuesto }));
      assert.equal(r.ok, false, `${nombre} / ${modo}`);
      assert.equal(llamadas.length, 0, `${nombre} / ${modo}`);
    }
  }
});

test("guardia atómica: si el presupuesto cambió entre la lectura y la escritura (0 filas), no se da por confirmado", async () => {
  const { db } = dbFalsa(0);
  for (const [rol, modo] of [["GERENTE", "GERENTE"], ["ADMIN", "EN_NOMBRE"]] as const) {
    const r = await ejecutarConfirmacion(db, entrada(rol, modo));
    assert.deepEqual(r, { ok: false, error: ERROR_CAMBIO_MIENTRAS_CONFIRMABA }, modo);
  }
});

test("decidirConfirmacion no toca la base: devuelve los datos a escribir", () => {
  const d = decidirConfirmacion(entrada("ADMIN", "EN_NOMBRE"));
  assert.equal(d.ok, true);
});

// ---- Que las acciones del servidor usen la regla (no alcanza con ocultar el botón) ------------------

test("las dos acciones del servidor pasan por ejecutarConfirmacion, cada una con su modo", () => {
  const actions = readFileSync(new URL("../../app/[empresa]/[periodo]/presupuesto/actions.ts", import.meta.url), "utf8");
  const cuerpo = (nombre: string) => {
    const ini = actions.indexOf(`export async function ${nombre}(`);
    assert.ok(ini >= 0, nombre);
    const sig = actions.indexOf("\nexport async function ", ini + 10);
    return actions.slice(ini, sig === -1 ? undefined : sig);
  };
  const normal = cuerpo("confirmarVersionFinal");
  assert.match(normal, /ejecutarConfirmacion\(/);
  assert.match(normal, /modo: "GERENTE"/);
  assert.doesNotMatch(normal, /EN_NOMBRE/);
  const enNombre = cuerpo("confirmarEnNombreDelGerente");
  assert.match(enNombre, /ejecutarConfirmacion\(/);
  assert.match(enNombre, /modo: "EN_NOMBRE"/);
  assert.match(enNombre, /puedeRevisarPresupuesto\(usuario, empresa\.id\)/);
  // Ninguna escribe VALIDADO por su cuenta: solo ejecutarConfirmacion.
  assert.doesNotMatch(actions, /estado: "VALIDADO"/);
});

test("la migración solo agrega las dos columnas, con default o nulas, sin tocar filas existentes", () => {
  const sql = readFileSync(
    new URL("../../prisma/migrations/20261105120000_confirmacion_en_nombre_gerente/migration.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /ALTER TABLE "PresupuestoMensual"/);
  assert.match(sql, /"confirmadoEnNombreDeGerente" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /"motivoConfirmacionEnNombre" TEXT\b(?! NOT NULL)/);
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/i);
});
