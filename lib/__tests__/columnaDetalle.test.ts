import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { textoDetalle, totalColumnasTabla, MOSTRAR_DETALLE_EMPRESA } from "@/lib/columnaDetalle";
import { mapearMovimiento } from "@/lib/ejecucionVista";
import { whereMovimientosDeEmpresa } from "@/lib/filtroClasificacionEmpresa";
import { whereMovimientosDelMes } from "@/lib/ejecucionMes";

const leer = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const tabla = leer("app", "ejecucion", "TablaMovimientos.tsx");

test("celdas vacías: null, undefined y espacios quedan en blanco (nunca 'null' ni guiones)", () => {
  assert.equal(textoDetalle(null), "");
  assert.equal(textoDetalle(undefined), "");
  assert.equal(textoDetalle("   "), "");
  assert.equal(textoDetalle(""), "");
  assert.equal(textoDetalle("  FACTURA 123 "), "FACTURA 123");
  const largo = "x".repeat(500);
  assert.equal(textoDetalle(largo), largo, "el texto largo no se recorta en datos: se corta al mostrar, con tooltip");
});

test("mapearMovimiento: detalle null viaja como '' y el texto se conserva", () => {
  const base = {
    id: "m1", fecha: new Date("2026-09-10T00:00:00.000Z"), concepto: "C", importe: "1", bancoYCuenta: "X",
    clasificacion: "PROV", unidadNegocio: "SPP", ignorado: false, sugeridaPorSistema: false,
    chequeIvaAmbiguo: false, unidadSugeridaPorSistema: false, desglose: [],
  };
  assert.equal(mapearMovimiento({ ...base, detalle: null }).detalle, "");
  assert.equal(mapearMovimiento({ ...base, detalle: "ALQUILER" }).detalle, "ALQUILER");
});

test("totalColumnas: suma 1 con mostrarDetalle y respeta las demás combinaciones", () => {
  const o = { soloLectura: false, mostrarSaldo: false, mostrarSemana: false, mostrarDetalle: false };
  assert.equal(totalColumnasTabla(o), 8);
  assert.equal(totalColumnasTabla({ ...o, soloLectura: true }), 7);
  assert.equal(totalColumnasTabla({ ...o, mostrarDetalle: true }), 9);
  assert.equal(totalColumnasTabla({ ...o, soloLectura: true, mostrarDetalle: true }), 8);
  assert.equal(totalColumnasTabla({ soloLectura: true, mostrarSaldo: true, mostrarSemana: true, mostrarDetalle: true }), 10);
  assert.equal(totalColumnasTabla({ soloLectura: true, mostrarSaldo: true, mostrarSemana: true, mostrarDetalle: false }), 9);
});

test("TablaMovimientos: la columna existe solo con la prop (default false), al lado de Concepto, y usa totalColumnasTabla", () => {
  assert.match(tabla, /mostrarDetalle\?: boolean;/);
  assert.match(tabla, /mostrarDetalle = false,/);
  // Encabezado y celda condicionados a la prop, inmediatamente después de Concepto.
  assert.match(tabla, />Concepto<\/th>\s*\{mostrarDetalle && <th[^>]*>Detalle<\/th>\}/);
  assert.match(tabla, /\{m\.concepto\}<\/td>\s*\{mostrarDetalle && \(/);
  assert.match(tabla, /totalColumnasTabla\(\{ soloLectura, mostrarSaldo, mostrarSemana, mostrarDetalle \}\)/);
  // Texto largo: tope de líneas con el completo en el tooltip.
  assert.match(tabla, /line-clamp-2/);
  assert.match(tabla, /title=\{textoDetalle\(m\.detalle\) \|\| undefined\}/);
  // No hay "Detalle 2".
  assert.equal(/Detalle 2|detalle2/i.test(tabla), false);
});

test("las 3 pantallas de la empresa pasan la prop; las de la Ejecución global no", () => {
  const empresa = [
    ["app", "[empresa]", "[periodo]", "ejecucion", "[numeroSemana]", "page.tsx"],
    ["app", "[empresa]", "[periodo]", "ejecucion", "mes", "page.tsx"],
    ["app", "[empresa]", "[periodo]", "ejecucion", "[numeroSemana]", "MovimientosEditablesEmpresa.tsx"],
  ];
  for (const r of empresa) assert.match(leer(...r), /mostrarDetalle=\{MOSTRAR_DETALLE_EMPRESA\}/, r.join("/"));
  for (const r of [["app", "ejecucion", "[periodo]", "[numeroSemana]", "page.tsx"], ["app", "ejecucion", "PanelImputacion.tsx"]]) {
    assert.equal(/mostrarDetalle/.test(leer(...r)), false, r.join("/"));
  }
  assert.equal(MOSTRAR_DETALLE_EMPRESA, true);
});

test("clasificación oculta: se filtra por fila en la consulta (semana y mes), así su Detalle no sale de la base", () => {
  const sem = whereMovimientosDeEmpresa("e1", ["SPP"], undefined, ["SUELDOS"]);
  assert.deepEqual(sem.NOT, { clasificacion: { in: ["SUELDOS"] } });
  const mes = whereMovimientosDelMes(["e1", "e2"], ["SPP"], undefined, ["SUELDOS"]);
  assert.deepEqual(mes.NOT, { clasificacion: { in: ["SUELDOS"] } });
  // Aunque la URL pida la oculta, el NOT sigue.
  assert.deepEqual(whereMovimientosDeEmpresa("e1", ["SPP"], "SUELDOS", ["SUELDOS"]).NOT, { clasificacion: { in: ["SUELDOS"] } });
  // Sin ocultas no se agrega nada.
  assert.equal("NOT" in whereMovimientosDeEmpresa("e1", ["SPP"], undefined, []), false);
  // La página consulta con ese where y la fila viaja entera (detalle incluido) solo si pasó el filtro.
  const datos = leer("app", "[empresa]", "[periodo]", "ejecucion", "datos.ts");
  assert.equal((datos.match(/prisma\.movimientoBancario\.findMany\(\{\s*where,/g) ?? []).length, 2);
});
