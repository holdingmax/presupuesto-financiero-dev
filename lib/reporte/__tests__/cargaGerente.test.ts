import { test } from "node:test";
import assert from "node:assert/strict";
import { CLASIFICACIONES_PRESUPUESTO_UNICAS } from "@/app/[empresa]/[periodo]/presupuesto/clasificacionesPresupuesto";
import { claveEquivalencia, esBloqueReservado } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { PLANTILLA_BRILLANTE } from "@/lib/reporte/plantillas/brillante";
import {
  BLOQUES_CARGABLES,
  DETALLE_CARGA_DESDE_REPORTE,
  MENSAJE_IMPORTE_NEGATIVO,
  MOTIVO_SE_AJUSTA_EN_PRESUPUESTO,
  categoriasSinFila,
  celdaDeEntrada,
  esFilaDeCategoria,
  idCelda,
  nombreDeEntrada,
  permiteNegativos,
  planCelda,
  planDeCarga,
  requiereAclaracion,
  validarAclaracion,
  validarImporteCarga,
  vistaDeCarga,
  type LineaParaCarga,
} from "@/lib/reporte/cargaGerente";

function linea(clasificacion: string, importeCentavos: number, extra: Partial<LineaParaCarga> = {}): LineaParaCarga {
  return {
    id: `l-${clasificacion}-${importeCentavos}`,
    clasificacion,
    detalle: DETALLE_CARGA_DESDE_REPORTE,
    importeCentavos,
    tieneDesglose: false,
    ...extra,
  };
}

// ---- Importes -------------------------------------------------------------------------------

test("validarImporteCarga: vacío, espacios y 0 borran la línea (centavos null)", () => {
  for (const texto of ["", "   ", "0", "0,00", "0.00", "10-10"]) {
    assert.deepEqual(validarImporteCarga(texto, false), { ok: true, centavos: null, nota: null }, JSON.stringify(texto));
  }
});

test("validarImporteCarga: importes en formato argentino y cuentas", () => {
  assert.deepEqual(validarImporteCarga("1.234,56", false), { ok: true, centavos: 123456, nota: null });
  assert.deepEqual(validarImporteCarga("1000", false), { ok: true, centavos: 100000, nota: null });
  assert.deepEqual(validarImporteCarga(" $ 2.500.000 ", false), { ok: true, centavos: 250000000, nota: null });
  assert.deepEqual(validarImporteCarga("100+50", false), { ok: true, centavos: 15000, nota: "100+50" });
});

test("validarImporteCarga: el gerente no puede cargar negativos, con el mensaje central", () => {
  assert.equal(MENSAJE_IMPORTE_NEGATIVO, "Los importes se cargan en positivo.");
  for (const texto of ["-500", "-1.234,56", "10-50", "−100"]) {
    assert.deepEqual(validarImporteCarga(texto, false), { ok: false, error: MENSAJE_IMPORTE_NEGATIVO }, texto);
  }
});

test("validarImporteCarga: ADMIN y FINANZAS sí pueden cargar negativos", () => {
  assert.deepEqual(validarImporteCarga("-500", true), { ok: true, centavos: -50000, nota: null });
  assert.equal(permiteNegativos(true), true);
  assert.equal(permiteNegativos(false), false);
});

test("validarImporteCarga: texto que no es un importe, o demasiado grande, se rechaza", () => {
  assert.equal(validarImporteCarga("abc", false).ok, false);
  assert.equal(validarImporteCarga("12,3x", false).ok, false);
  assert.equal(validarImporteCarga("99999999999999999", true).ok, false);
});

test("validarAclaracion: obligatoria, recortada y con tope de largo", () => {
  assert.deepEqual(validarAclaracion("  Reintegro obra social "), { ok: true, detalle: "Reintegro obra social" });
  for (const t of [undefined, "", "   "]) assert.equal(validarAclaracion(t).ok, false);
  assert.equal(validarAclaracion("a".repeat(200)).ok, true);
  assert.equal(validarAclaracion("a".repeat(201)).ok, false);
});

test("requiereAclaracion: solo «Otros» (con sus alias), ninguna otra categoría", () => {
  assert.equal(requiereAclaracion("OTROS"), true);
  assert.equal(requiereAclaracion("Otros"), true);
  for (const o of CLASIFICACIONES_PRESUPUESTO_UNICAS) {
    if (claveEquivalencia(o.valorPersistido) !== claveEquivalencia("OTROS")) {
      assert.equal(requiereAclaracion(o.valorPersistido), false, o.valorPersistido);
    }
  }
});

// ---- planCelda ------------------------------------------------------------------------------

test("planCelda: sin líneas la celda es editable y se guarda en la primera categoría", () => {
  const c = planCelda(["Liquidación final", "Juicios"], "Liquidaciones finales y juicios", []);
  assert.equal(c.modo, "editable");
  if (c.modo !== "editable") return;
  assert.equal(c.categoria, "Liquidación final");
  assert.equal(c.lineaId, null);
  assert.equal(c.valorCentavos, null);
  assert.equal(c.texto, "Liquidaciones finales y juicios");
});

test("planCelda: con una línea sin desglose es editable y muestra su importe", () => {
  const l = linea("SUELDOS", 500000);
  const c = planCelda(["SUELDOS"], "Sueldos", [l, linea("PROV Y SERV", 100)]);
  assert.equal(c.modo, "editable");
  if (c.modo !== "editable") return;
  assert.equal(c.lineaId, l.id);
  assert.equal(c.valorCentavos, 500000);
  assert.equal(c.categoria, "SUELDOS");
});

test("planCelda: más de una línea → solo lectura con la suma y el motivo", () => {
  const c = planCelda(["SUELDOS"], "Sueldos", [linea("SUELDOS", 100), linea("SUELDOS", 250)]);
  assert.equal(c.modo, "soloLectura");
  if (c.modo !== "soloLectura") return;
  assert.equal(c.valorCentavos, 350);
  assert.match(c.motivo, /varias líneas/);
  assert.ok(c.motivo.includes(MOTIVO_SE_AJUSTA_EN_PRESUPUESTO));
});

test("planCelda: una línea con desglose → solo lectura con el motivo", () => {
  const c = planCelda(["SUELDOS"], "Sueldos", [linea("SUELDOS", 100, { tieneDesglose: true })]);
  assert.equal(c.modo, "soloLectura");
  if (c.modo !== "soloLectura") return;
  assert.match(c.motivo, /desglose/);
  assert.ok(c.motivo.includes(MOTIVO_SE_AJUSTA_EN_PRESUPUESTO));
});

test("planCelda: fila de 2 categorías, línea en la SEGUNDA → solo lectura con texto, no editable ni muda", () => {
  const c = planCelda(["Liquidación final", "Juicios"], "Liquidaciones finales y juicios", [linea("Juicios", 777)]);
  assert.equal(c.modo, "soloLectura");
  if (c.modo !== "soloLectura") return;
  assert.equal(c.valorCentavos, 777);
  assert.match(c.motivo, /Juicios/);
  assert.ok(c.motivo.includes(MOTIVO_SE_AJUSTA_EN_PRESUPUESTO));
});

test("planCelda: fila de 2 categorías, línea en la primera → editable (y se actualiza esa línea)", () => {
  const l = linea("Liquidación final", 900);
  const c = planCelda(["Liquidación final", "Juicios"], "x", [l]);
  assert.equal(c.modo, "editable");
  if (c.modo !== "editable") return;
  assert.equal(c.lineaId, l.id);
});

test("planCelda: una línea guardada con un alias de la categoría cuenta como esa categoría", () => {
  const l = linea("LIQ FINAL", 900);
  const c = planCelda(["Liquidación final", "Juicios"], "x", [l]);
  assert.equal(c.modo, "editable");
  if (c.modo !== "editable") return;
  assert.equal(c.categoria, "LIQ FINAL"); // se respeta cómo se guardó
  assert.equal(c.lineaId, l.id);
});

test("planCelda: «Otros» pide aclaración, y reusa el detalle de la línea existente", () => {
  const nueva = planCelda(["OTROS"], "Otros", []);
  assert.equal(nueva.modo === "editable" && nueva.requiereAclaracion, true);
  const existente = planCelda(["OTROS"], "Otros", [linea("OTROS", 100, { detalle: "Fondo fijo" })]);
  assert.equal(existente.modo === "editable" && existente.aclaracionInicial, "Fondo fijo");
  // El detalle automático de la carga no se muestra como si fuera una aclaración.
  const auto = planCelda(["OTROS"], "Otros", [linea("OTROS", 100)]);
  assert.equal(auto.modo === "editable" && auto.aclaracionInicial, "");
  // Y las demás categorías no la piden.
  const sueldos = planCelda(["SUELDOS"], "Sueldos", []);
  assert.equal(sueldos.modo === "editable" && sueldos.requiereAclaracion, false);
});

// ---- planDeCarga sobre las plantillas reales -----------------------------------------------

test("planDeCarga: en TODAS las plantillas, cada categoría de la lista está en una fila o en «sin fila», sin repetirse", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const enFilas = new Map<string, string>();
    for (const f of plantilla.filas) {
      if (f.tipo === "linea" && f.presupuesto.tipo === "categorias") {
        for (const c of f.presupuesto.categorias) enFilas.set(claveEquivalencia(c), f.clave);
      }
    }
    const sinFila = categoriasSinFila(plantilla).map((o) => claveEquivalencia(o.valorPersistido));
    for (const o of CLASIFICACIONES_PRESUPUESTO_UNICAS) {
      const clave = claveEquivalencia(o.valorPersistido);
      const veces = (enFilas.has(clave) ? 1 : 0) + sinFila.filter((x) => x === clave).length;
      assert.equal(veces, 1, `${slug}: ${o.valorPersistido} aparece ${veces} veces`);
    }
  }
});

test("planDeCarga: solo las filas de categoría de bloques cargables; nunca un bloque reservado", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const plan = planDeCarga(plantilla, []);
    const porClave = new Map(plantilla.filas.map((f) => [f.clave, f]));
    for (const clave of Object.keys(plan.filas)) {
      const fila = porClave.get(clave)!;
      assert.equal(fila.tipo, "linea", `${slug}/${clave}`);
      assert.ok(BLOQUES_CARGABLES.includes(fila.bloque), `${slug}/${clave}: bloque ${fila.bloque}`);
      assert.equal(esBloqueReservado(fila.bloque), false, `${slug}/${clave}`);
      assert.equal(esFilaDeCategoria(fila), true);
    }
    // Ninguna fila con P manual, Capital ni Disponibilidades entra al plan (Etapa 3 / reservado).
    for (const f of plantilla.filas) {
      if (f.tipo !== "linea" || f.presupuesto.tipo !== "categorias") {
        assert.equal(Object.hasOwn(plan.filas, f.clave), false, `${slug}/${f.clave}`);
      }
    }
    assert.equal(plan.fueraDeLista, null);
  }
});

test("planDeCarga: sin líneas, todas las celdas son editables", () => {
  for (const plantilla of Object.values(PLANTILLAS_POR_SLUG)) {
    const plan = planDeCarga(plantilla, []);
    for (const c of Object.values(plan.filas)) assert.equal(c.modo, "editable");
    for (const s of plan.sinFila) assert.equal(s.celda.modo, "editable");
  }
});

test("categoriasSinFila: Brillante (lista exacta, igual a la del diagnóstico)", () => {
  assert.deepEqual(
    categoriasSinFila(PLANTILLA_BRILLANTE).map((o) => o.valorPersistido),
    ["Préstamo Cocos", "OTROS", "PAGOS ESPECIALES"]
  );
});

test("planDeCarga: Brillante con líneas variadas (editable, solo lectura, sin fila y fuera de lista)", () => {
  const plan = planDeCarga(PLANTILLA_BRILLANTE, [
    linea("SUELDOS", 1000),
    linea("PROV Y SERV", 10),
    linea("PROV Y SERV", 20),
    linea("Juicios", 5),
    linea("PAGOS ESPECIALES", 40),
    linea("CATEGORIA VIEJA", 300),
  ]);
  assert.equal(plan.filas["br.sueldos"].modo, "editable");
  assert.equal(plan.filas["br.proveedores"].modo, "soloLectura");
  assert.equal(plan.filas["br.liquidacionesJuicios"].modo, "soloLectura");
  const pagos = plan.sinFila.find((s) => s.categoria === "PAGOS ESPECIALES")!;
  assert.equal(pagos.celda.modo, "editable");
  assert.deepEqual(plan.fueraDeLista, { centavos: 300, lineas: 1 });
});

test("celdaDeEntrada: encuentra filas y categorías sin fila; lo demás (incluido __proto__) es null", () => {
  const plan = planDeCarga(PLANTILLA_BRILLANTE, []);
  assert.ok(celdaDeEntrada(plan, { destino: "fila", clave: "br.sueldos" }));
  assert.ok(celdaDeEntrada(plan, { destino: "sinFila", clave: "OTROS" }));
  for (const clave of ["br.dBancoFci", "br.capital", "br.totalIngresos", "inexistente", "__proto__", "constructor"]) {
    assert.equal(celdaDeEntrada(plan, { destino: "fila", clave }), null, clave);
  }
  assert.equal(celdaDeEntrada(plan, { destino: "sinFila", clave: "SUELDOS" }), null);
});

test("nombreDeEntrada: texto de la fila de la plantilla o de la categoría", () => {
  assert.equal(nombreDeEntrada(PLANTILLA_BRILLANTE, { destino: "fila", clave: "br.sueldos" }), "Sueldos");
  assert.equal(nombreDeEntrada(PLANTILLA_BRILLANTE, { destino: "sinFila", clave: "OTROS" }), "Otros");
  assert.equal(nombreDeEntrada(PLANTILLA_BRILLANTE, { destino: "fila", clave: "nada" }), "nada");
});

test("vistaDeCarga: formatea los valores, informa los motivos y la huella cambia con los valores", () => {
  const a = vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [linea("SUELDOS", 123456), linea("Juicios", 5)]));
  const sueldos = a.celdas.find((c) => c.id === idCelda("fila", "br.sueldos"))!;
  assert.equal(sueldos.importeInicial, "1.235");
  assert.equal(sueldos.destino, "fila");
  assert.ok(a.motivosFilas["br.liquidacionesJuicios"].includes(MOTIVO_SE_AJUSTA_EN_PRESUPUESTO));
  assert.equal(a.celdas.some((c) => c.id === idCelda("fila", "br.liquidacionesJuicios")), false);
  const vacia = a.celdas.find((c) => c.id === idCelda("fila", "br.proveedores"))!;
  assert.equal(vacia.importeInicial, "");
  const otros = a.celdas.find((c) => c.id === idCelda("sinFila", "OTROS"))!;
  assert.equal(otros.requiereAclaracion, true);

  const b = vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [linea("SUELDOS", 999900), linea("Juicios", 5)]));
  assert.notEqual(a.huella, b.huella);
  const a2 = vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [linea("SUELDOS", 123456), linea("Juicios", 5)]));
  assert.equal(a.huella, a2.huella);
});
