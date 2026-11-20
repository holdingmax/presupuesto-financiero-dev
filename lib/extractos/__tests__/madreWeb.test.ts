import { test } from "node:test";
import assert from "node:assert/strict";
import { leerFilasMadre } from "@/lib/extractos/madre";
import {
  cuentasCargadasPorOtroCamino,
  esClasificacionExplicita,
  resumirMadre,
  type FilaParaCotejo,
} from "@/lib/extractos/madreWeb";
import { crearExclusionMutua } from "@/lib/exclusionMutua";
import { madreNormal } from "./fixtures/madre";

// Piezas puras de la carga de la madre por la web.

function filasDeLaFixture() {
  const r = leerFilasMadre(madreNormal());
  assert.ok(r.ok);
  return r.filas;
}

test("clasificación explícita: la del archivo sí; la sugerida y SIN CLASIFICAR no", () => {
  assert.equal(esClasificacionExplicita({ clasificacion: "Prov y serv", sugeridaPorSistema: false }), true);
  assert.equal(esClasificacionExplicita({ clasificacion: "Gastos bancarios", sugeridaPorSistema: true }), false);
  assert.equal(esClasificacionExplicita({ clasificacion: "SIN CLASIFICAR", sugeridaPorSistema: false }), false);
});

test("fixture madre: solo la fila 2 trae clasificación explícita", () => {
  const explicitas = filasDeLaFixture().filter(esClasificacionExplicita);
  assert.deepEqual(explicitas.map((f) => f.clasificacion), ["Prov y serv"]);
});

test("resumen: filas, cuentas, sin banco, sin clasificar y sin unidad", () => {
  const r = resumirMadre(filasDeLaFixture(), { cuentasDelCatalogo: ["MACRO 599"], clasificaciones: ["PROV Y SERV"] });
  assert.equal(r.filas, 7);
  assert.equal(r.filasSinBanco, 1);
  assert.equal(r.sinClasificar, 4);
  assert.equal(r.sinUnidad, 1); // la fila sin banco ni unidad
  assert.ok(r.cuentas.some((c) => c.cuenta === "MACRO 599"));
});

test("resumen: cuentas fuera del catálogo (sin contar '(sin banco)') y comparación sin mayúsculas/tildes", () => {
  const r = resumirMadre(filasDeLaFixture(), { cuentasDelCatalogo: ["macro 599"], clasificaciones: [] });
  assert.ok(!r.cuentasFueraDelCatalogo.includes("MACRO 599"));
  assert.ok(!r.cuentasFueraDelCatalogo.some((c) => c.toLowerCase().includes("sin banco")));
  assert.ok(r.cuentasFueraDelCatalogo.length > 0);
});

test("resumen: clasificación explícita que no está en la lista se avisa con nombre y cantidad; si está (aunque cambie el caso), no", () => {
  const filas = filasDeLaFixture();
  const conocida = resumirMadre(filas, { cuentasDelCatalogo: [], clasificaciones: ["PROV Y SERV"] });
  assert.deepEqual(conocida.clasificacionesNuevas, []);
  const nueva = resumirMadre(filas, { cuentasDelCatalogo: [], clasificaciones: ["COBRANZAS"] });
  assert.deepEqual(nueva.clasificacionesNuevas, [{ nombre: "Prov y serv", cantidad: 1 }]);
});

test("resumen: dos grafías de la misma clasificación nueva se cuentan juntas", () => {
  const f = filasDeLaFixture()[0];
  const filas = [
    { ...f, clasificacion: "Cobranzs", sugeridaPorSistema: false },
    { ...f, clasificacion: "COBRANZS ", sugeridaPorSistema: false },
    { ...f, clasificacion: "SIN CLASIFICAR", sugeridaPorSistema: false },
    { ...f, clasificacion: "Gastos raros", sugeridaPorSistema: true }, // sugerida por el sistema: no cuenta
  ];
  const r = resumirMadre(filas, { cuentasDelCatalogo: [], clasificaciones: [] });
  assert.equal(r.clasificacionesNuevas.length, 1);
  assert.equal(r.clasificacionesNuevas[0].cantidad, 2);
});

// --- una cuenta por un solo camino, por cuenta -------------------------------------------------

const fila = (cuenta: string, clave: string, fic = `fic-${clave}`, claveBase = clave): FilaParaCotejo => ({
  cuenta,
  clave,
  claveBase,
  claveFIC: fic,
});

test("otro camino: cuenta con movimientos en esas fechas, ninguno idéntico y alguno con misma fecha+importe → se omite", () => {
  const archivo = [fila("MACRO 599", "a", "x"), fila("GALICIA 731", "b")];
  const base = [fila("MACRO 599", "otra-clave", "x")];
  assert.deepEqual([...cuentasCargadasPorOtroCamino(archivo, base)], ["MACRO 599"]);
});

test("otro camino: si alguna fila de la cuenta ya está cargada igual (madre sobre madre) NO se omite", () => {
  const archivo = [fila("MACRO 599", "a", "x"), fila("MACRO 599", "b", "y")];
  const base = [fila("MACRO 599", "a", "x")];
  assert.equal(cuentasCargadasPorOtroCamino(archivo, base).size, 0);
});

test("otro camino: se decide cuenta por cuenta, no con el total del archivo", () => {
  // GALICIA ya tiene una fila idéntica (no se omite); MACRO no, y parece cargada por el otro camino.
  const archivo = [fila("GALICIA 731", "g", "gx"), fila("MACRO 599", "m", "mx")];
  const base = [fila("GALICIA 731", "g", "gx"), fila("MACRO 599", "otra", "mx")];
  assert.deepEqual([...cuentasCargadasPorOtroCamino(archivo, base)], ["MACRO 599"]);
});

test("otro camino: sin movimientos previos o sin nada parecido, no se omite", () => {
  assert.equal(cuentasCargadasPorOtroCamino([fila("MACRO 599", "a", "x")], []).size, 0);
  assert.equal(cuentasCargadasPorOtroCamino([fila("MACRO 599", "a", "x")], [fila("MACRO 599", "z", "otro")]).size, 0);
});

// --- una sola carga a la vez ---------------------------------------------------------------------

test("exclusión mutua: una sola a la vez, se libera, y soltar dos veces no libera la de otro", () => {
  const e = crearExclusionMutua();
  const a = e.intentar();
  assert.ok(a);
  assert.equal(e.intentar(), null);
  a!();
  const b = e.intentar();
  assert.ok(b);
  a!(); // ya liberada: no debe soltar la de b
  assert.equal(e.intentar(), null);
  b!();
  assert.ok(e.intentar());
});
