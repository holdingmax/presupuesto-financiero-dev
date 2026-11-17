import { test } from "node:test";
import assert from "node:assert/strict";
import { fechaIsoEnArgentina, formatearDescarga } from "@/lib/fecha";

// «Descargado el martes 17/11/2026 11:40» siempre en hora de Argentina (UTC-3, sin horario de verano), aunque el servidor
// (Render) corra en UTC o en cualquier otra zona. Estos tests fijan instantes UTC; correrlos con TZ distintos
// (TZ=UTC, TZ=Asia/Tokyo, TZ=America/Los_Angeles) debe dar lo mismo.

test("mediodía: 14:40 UTC es 11:40 en Argentina, mismo día", () => {
  assert.equal(formatearDescarga(new Date("2026-11-17T14:40:00Z")), "Descargado el martes 17/11/2026 11:40");
  assert.equal(fechaIsoEnArgentina(new Date("2026-11-17T14:40:00Z")), "2026-11-17");
});

test("cerca de medianoche: 02:40 UTC del miércoles 18 todavía es el martes 17 a las 23:40 en Argentina", () => {
  const ahora = new Date("2026-11-18T02:40:00Z");
  assert.equal(formatearDescarga(ahora), "Descargado el martes 17/11/2026 23:40");
  assert.equal(fechaIsoEnArgentina(ahora), "2026-11-17");
});

test("medianoche en punto: 03:00 UTC es miércoles 18/11 a las 00:00 (no «24:00»)", () => {
  const ahora = new Date("2026-11-18T03:00:00Z");
  assert.equal(formatearDescarga(ahora), "Descargado el miércoles 18/11/2026 00:00");
  assert.equal(fechaIsoEnArgentina(ahora), "2026-11-18");
});

test("un minuto antes de medianoche: 02:59 UTC sigue en el día anterior", () => {
  assert.equal(formatearDescarga(new Date("2026-11-18T02:59:00Z")), "Descargado el martes 17/11/2026 23:59");
});

test("cambio de año: 02:59 UTC del 1/1/2027 es jueves 31/12/2026; 03:00 UTC es viernes 01/01/2027", () => {
  assert.equal(formatearDescarga(new Date("2027-01-01T02:59:00Z")), "Descargado el jueves 31/12/2026 23:59");
  assert.equal(formatearDescarga(new Date("2027-01-01T03:00:00Z")), "Descargado el viernes 01/01/2027 00:00");
  assert.equal(fechaIsoEnArgentina(new Date("2027-01-01T02:59:00Z")), "2026-12-31");
});

test("día y mes de una cifra salen con cero a la izquierda y sin comas", () => {
  const texto = formatearDescarga(new Date("2026-03-05T12:05:00Z"));
  assert.equal(texto, "Descargado el jueves 05/03/2026 09:05");
  assert.equal(texto.includes(","), false);
});
