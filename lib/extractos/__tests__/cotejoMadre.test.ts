import { test } from "node:test";
import assert from "node:assert/strict";
import { cuentasCargadasPorOtroCamino, existentesDeLasCuentas } from "@/lib/extractos/madreWeb";
import {
  centavosDeDecimalTexto,
  centavosDeNumero,
  claveMovimiento,
  claveMovimientoBase,
  separarNuevasDosPasadas,
} from "@/lib/conteoMovimientos";
import { normalizarCuenta } from "@/lib/unidadesNegocio";

// Cotejo del archivo madre con lo ya cargado, en dos pasadas (con saldo, después sin saldo), con los
// casos reales del madre del 20.11. Se arma como calcularCargaMadre (app/ejecucion/actions.ts): claves
// del archivo, lo ya cargado filtrado por cuenta con existentesDeLasCuentas, omisión de cuentas por
// "otro camino" y separarNuevasDosPasadas sobre el resto.

type Mov = { fecha: string; cuenta: string; concepto: string; importe: number; saldo: number | null; ref?: string };

function camposDe(m: Mov) {
  return {
    fecha: new Date(`${m.fecha}T00:00:00Z`),
    importeCentavos: centavosDeNumero(m.importe),
    bancoYCuenta: m.cuenta,
    concepto: m.concepto,
    nroReferencia: m.ref ?? null,
    saldoCentavos: m.saldo === null ? null : centavosDeNumero(m.saldo),
  };
}

function cotejar(archivo: Mov[], base: Mov[]) {
  const filas = archivo.map((m) => {
    const c = camposDe(m);
    return {
      m,
      cuenta: normalizarCuenta(m.cuenta),
      clave: claveMovimiento(c),
      claveBase: claveMovimientoBase(c),
      claveFIC: JSON.stringify([m.fecha, c.importeCentavos, normalizarCuenta(m.cuenta)]),
    };
  });
  const cuentas = new Set(filas.map((f) => f.cuenta));
  // La base devuelve la cuenta TAL CUAL se guardó (con tilde) y el importe como texto.
  const delaBase = base.map((m) => ({ bancoYCuenta: m.cuenta, campos: camposDe(m), importe: m.importe.toFixed(2) }));
  const existentes = existentesDeLasCuentas(delaBase, cuentas).map((b) => ({
    cuenta: normalizarCuenta(b.bancoYCuenta),
    clave: claveMovimiento(b.campos),
    claveBase: claveMovimientoBase(b.campos),
    claveFIC: JSON.stringify([
      b.campos.fecha.toISOString().slice(0, 10),
      centavosDeDecimalTexto(b.importe),
      normalizarCuenta(b.bancoYCuenta),
    ]),
  }));
  const omitidas = cuentasCargadasPorOtroCamino(filas, existentes);
  const aCargar = filas.filter((f) => !omitidas.has(f.cuenta));
  const { nuevas, cantidadYaCargadas } = separarNuevasDosPasadas(
    aCargar,
    (f) => ({ conSaldo: f.clave, base: f.claveBase }),
    existentes.map((e) => ({ conSaldo: e.clave, base: e.claveBase }))
  );
  return { nuevas: nuevas.map((n) => n.m), cantidadYaCargadas, omitidas: [...omitidas] };
}

// conReferencia = false: la fila como la cargó el madre del 13.11 (referencia vacía).
const cheque = (i: number, saldo: number, conReferencia = true): Mov => ({
  fecha: "2026-11-05",
  cuenta: "CHEQUE",
  concepto: `RECIBO NRO: 0001 - ${String(1000 + i).padStart(8, "0")} - CLIENTE ${i}`,
  importe: 100000 + i,
  saldo,
  ref: conReferencia ? String(21000 + i) : undefined,
});

test("cotejo: CHEQUE real (referencia vacía en la base, completa en el archivo; 101 cargadas + 78 nuevas) carga exactamente las 78 y no omite la cuenta", () => {
  const base = Array.from({ length: 101 }, (_, i) => cheque(i, 1000000 + i * 10, false));
  const archivo = [
    ...Array.from({ length: 101 }, (_, i) => cheque(i, 1000000 + i * 10)), // mismo saldo, ahora con referencia
    ...Array.from({ length: 78 }, (_, i) => cheque(101 + i, 9000000 + i * 10)),
  ];
  const r = cotejar(archivo, base);
  assert.deepEqual(r.omitidas, []);
  assert.equal(r.cantidadYaCargadas, 101);
  assert.equal(r.nuevas.length, 78);
  assert.deepEqual(
    r.nuevas.map((n) => n.ref),
    Array.from({ length: 78 }, (_, i) => String(21101 + i))
  );
});

test("cotejo: CHEQUE con la referencia completada Y los saldos recalculados también se reconoce", () => {
  const base = Array.from({ length: 101 }, (_, i) => cheque(i, 1000000 + i * 10, false));
  const archivo = [
    ...Array.from({ length: 101 }, (_, i) => cheque(i, 5000000 + i * 10)),
    ...Array.from({ length: 78 }, (_, i) => cheque(101 + i, 9000000 + i * 10)),
  ];
  const r = cotejar(archivo, base);
  assert.deepEqual(r.omitidas, []);
  assert.equal(r.cantidadYaCargadas, 101);
  assert.equal(r.nuevas.length, 78);
});

test("cotejo: una cuenta cargada por OTRO camino (nada coincide, ni en la clave base) sigue omitiéndose", () => {
  const base = [{ ...cheque(1, 10), concepto: "OTRO TEXTO" }];
  const archivo = [cheque(1, 10), cheque(2, 20)];
  assert.deepEqual(cotejar(archivo, base).omitidas, ["CHEQUE"]);
});

test("cotejo: DÓLAR con tilde en la base se reconoce (antes se recargaba entera en cada subida)", () => {
  const dolar = (c: string, imp: number): Mov => ({ fecha: "2026-11-13", cuenta: "DÓLAR", concepto: c, importe: imp, saldo: -562079 });
  const base = [dolar("FAR OSCAR SAMSOM - VIAJE A LAS VEGAS - 600USD - TC 1585", -951000), dolar("OTRO", -10)];
  const r = cotejar([...base, dolar("COMPRA NUEVA", -5)], base);
  assert.equal(r.cantidadYaCargadas, 2);
  assert.deepEqual(r.nuevas.map((n) => n.concepto), ["COMPRA NUEVA"]);
});

test("existentesDeLasCuentas: compara sin tildes, mayúsculas ni espacios de más, y deja afuera otras cuentas", () => {
  const base = [{ bancoYCuenta: "DÓLAR" }, { bancoYCuenta: " macro  599 " }, { bancoYCuenta: "MACRO 565" }];
  const r = existentesDeLasCuentas(base, new Set(["DOLAR", "MACRO 599"]));
  assert.deepEqual(r.map((b) => b.bancoYCuenta), ["DÓLAR", " macro  599 "]);
});

test("cotejo: 'Viaje a Salta' en EFECTIVO con el saldo recalculado no se duplica", () => {
  const salta = (saldo: number): Mov => ({
    fecha: "2026-11-13",
    cuenta: "EFECTIVO",
    concepto: "Viaje a Salta por capa de nuevo comercial",
    importe: -400000,
    saldo,
  });
  const r = cotejar([salta(-59509452.31)], [salta(-59253296.31)]);
  assert.equal(r.nuevas.length, 0);
  assert.equal(r.cantidadYaCargadas, 1);
});

test("cotejo: filas idénticas (3 recibos de 333.000 el 11/11) se cuentan: ni se pierden ni se duplican", () => {
  const recibo = (saldo: number | null): Mov => ({
    fecha: "2026-11-11",
    cuenta: "CHEQUE",
    concepto: "RECIBO NRO: 0001 - 00002268 - CLIENTE: PIU ALTO",
    importe: 333000,
    saldo,
  });
  const otro: Mov = { fecha: "2026-11-11", cuenta: "CHEQUE", concepto: "OTRA COSA", importe: 1, saldo: 1 };
  // exactamente iguales (mismo saldo) en archivo y base → 0 nuevas
  assert.equal(cotejar([recibo(1), recibo(1), recibo(1)], [recibo(1), recibo(1), recibo(1)]).nuevas.length, 0);
  // 3 en el archivo, 2 en la base → 1 nueva
  assert.equal(cotejar([recibo(1), recibo(1), recibo(1)], [recibo(1), recibo(1), otro]).nuevas.length, 1);
  // saldos distintos entre sí y recalculados en el archivo → 0 nuevas (las 3 las reconoce la 2ª pasada)
  const r = cotejar([recibo(11), recibo(12), recibo(13)], [recibo(1), recibo(2), recibo(3)]);
  assert.equal(r.nuevas.length, 0);
  assert.equal(r.cantidadYaCargadas, 3);
  // 4 en el archivo con saldos recalculados, 3 en la base → 1 nueva
  assert.equal(cotejar([recibo(11), recibo(12), recibo(13), recibo(14)], [recibo(1), recibo(2), recibo(3)]).nuevas.length, 1);
});

test("dos pasadas: la 1ª reserva el match exacto (con saldo) antes de ofrecer lo sobrante a la 2ª", () => {
  const k = (conSaldo: string) => ({ conSaldo, base: "A" });
  // base: A con saldo 1. Archivo: A con saldo 9 (primero) y A con saldo 1 (después).
  const r = separarNuevasDosPasadas(["fila9", "fila1"], (f) => (f === "fila1" ? k("1") : k("9")), [k("1")]);
  assert.deepEqual(r.nuevas, ["fila9"]);
  assert.equal(r.cantidadYaCargadas, 1);
});

test("dos pasadas: no consume más existentes de las que hay y no toca lo que el archivo no trae", () => {
  const k = (conSaldo: string) => ({ conSaldo, base: "A" });
  assert.equal(separarNuevasDosPasadas(["a", "b"], (f) => k(f), [k("x")]).nuevas.length, 1);
  assert.equal(separarNuevasDosPasadas([], () => k("x"), [k("x"), k("y")]).nuevas.length, 0);
});

test("cotejo: cuando todo coincide, la 1ª pasada gana: la fila exacta se queda con su par y la otra es la nueva", () => {
  const mov = (ref?: string): Mov => ({ fecha: "2026-11-11", cuenta: "CHEQUE", concepto: "RECIBO NRO: 0001 - 00002268 - CLIENTE: PIU ALTO", importe: 333000, saldo: 1, ref });
  // base: una fila con referencia 1. Archivo: primero una con referencia 2, después la exacta (referencia 1).
  // Si ganara el orden del archivo con la clave base, la de referencia 2 se llevaría el par y la exacta
  // quedaría como nueva. Con la 1ª pasada, la exacta se queda con su par y la nueva es la de referencia 2.
  const r = cotejar([mov("2"), mov("1")], [mov("1")]);
  assert.deepEqual(r.nuevas.map((n) => n.ref), ["2"]);
  assert.equal(r.cantidadYaCargadas, 1);
  // todo exacto: se reconoce todo, sin nuevas
  const t = cotejar([mov("1"), mov("2")], [mov("1"), mov("2")]);
  assert.equal(t.nuevas.length, 0);
  assert.equal(t.cantidadYaCargadas, 2);
});

test("cotejo: filas idénticas siguen contando N − M también en la 2ª pasada (3 recibos de 333.000, referencia nueva en el archivo)", () => {
  const mov = (ref?: string): Mov => ({ fecha: "2026-11-11", cuenta: "CHEQUE", concepto: "RECIBO NRO: 0001 - 00002268 - CLIENTE: PIU ALTO", importe: 333000, saldo: 1, ref });
  const otro: Mov = { fecha: "2026-11-11", cuenta: "CHEQUE", concepto: "OTRA COSA", importe: 1, saldo: 1 };
  // base: 3 sin referencia. Archivo: 3 con referencia distinta cada una → 0 nuevas, 3 ya cargadas.
  const igual = cotejar([mov("1"), mov("2"), mov("3")], [mov(), mov(), mov()]);
  assert.equal(igual.nuevas.length, 0);
  assert.equal(igual.cantidadYaCargadas, 3);
  // archivo: 4, base: 3 → 1 nueva (ni se pierde ni se duplica)
  assert.equal(cotejar([mov("1"), mov("2"), mov("3"), mov("4")], [mov(), mov(), mov()]).nuevas.length, 1);
  // archivo: 3, base: 2 (+ otra fila) → 1 nueva
  assert.equal(cotejar([mov("1"), mov("2"), mov("3")], [mov(), mov(), otro]).nuevas.length, 1);
});
