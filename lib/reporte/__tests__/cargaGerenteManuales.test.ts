import { test } from "node:test";
import assert from "node:assert/strict";
import { esBloqueReservado } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { PLANTILLA_BRILLANTE } from "@/lib/reporte/plantillas/brillante";
import {
  BLOQUES_CARGABLES,
  cambioMientrasEditaba,
  esFilaManualEditable,
  idCelda,
  manualDeEntrada,
  nombreDeEntrada,
  planDeCarga,
  vistaDeCarga,
  type ValorManualParaCarga,
} from "@/lib/reporte/cargaGerente";

// Etapa 3: filas de Presupuestado manual (ValorManualReporte, PRESUPUESTADO). El Capital de trabajo ya no lo carga el
// gerente: queda la fórmula de la plantilla o el valor que carga ADMIN en /reporte/carga.

const manual = (filaClave: string, centavos: number, extra: Partial<ValorManualParaCarga> = {}): ValorManualParaCarga => ({
  filaClave,
  centavos,
  nota: null,
  cargadoPor: "Prueba FINANZAS",
  actualizadoEn: new Date("2026-10-28T15:00:00Z"),
  ...extra,
});

test("ninguna fila de datos de Ingresos/Egresos/Abajo queda sin fuente de Presupuestado (las 61 que eran «sin presupuesto» ahora son manuales)", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    for (const f of plantilla.filas) {
      if (f.tipo === "linea" && BLOQUES_CARGABLES.includes(f.bloque)) {
        assert.notEqual(f.presupuesto.tipo, "ninguna", `${slug}/${f.clave}`);
      }
    }
  }
});

test("filas manuales editables: solo Ingresos/Egresos/Abajo con P manual; nunca totales, Disponibilidades, Cierre ni derivadas", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const plan = planDeCarga(plantilla, []);
    const porClave = new Map(plantilla.filas.map((f) => [f.clave, f]));
    for (const clave of Object.keys(plan.manuales)) {
      const f = porClave.get(clave)!;
      assert.equal(f.tipo, "linea", `${slug}/${clave}`);
      if (f.tipo !== "linea") continue;
      assert.ok(BLOQUES_CARGABLES.includes(f.bloque), `${slug}/${clave}: bloque ${f.bloque}`);
      assert.equal(esBloqueReservado(f.bloque), false, `${slug}/${clave}`);
      assert.equal(f.presupuesto.tipo, "manual", `${slug}/${clave}`);
    }
    // Y al revés: toda fila de datos con P manual en un bloque cargable está en el plan.
    for (const f of plantilla.filas) {
      if (f.tipo === "linea" && BLOQUES_CARGABLES.includes(f.bloque) && f.presupuesto.tipo === "manual") {
        assert.equal(Object.hasOwn(plan.manuales, f.clave), true, `${slug}/${f.clave} debería ser editable`);
      }
      // Lo que no es manual nunca entra a manuales.
      if (f.tipo !== "linea" || f.presupuesto.tipo !== "manual" || !BLOQUES_CARGABLES.includes(f.bloque)) {
        assert.equal(Object.hasOwn(plan.manuales, f.clave), false, `${slug}/${f.clave} no debería ser editable`);
      }
    }
    // Ninguna clave se repite entre categorías y manuales.
    for (const clave of Object.keys(plan.manuales)) assert.equal(Object.hasOwn(plan.filas, clave), false);
  }
});

test("las cinco filas de Presupuestado derivado quedan excluidas", () => {
  const derivadas: [string, string][] = [
    ["conexion-logistica", "cx.chequesDespuesDel10"],
    ["radio", "ra.chequesDespuesDel15"],
    ["havanna", "hv.acreditacionTarjetas"],
    ["havanna", "hv.devolucionPrestamoMs"],
    ["mantenor", "mn.prestamos"],
  ];
  for (const [slug, clave] of derivadas) {
    const plan = planDeCarga(PLANTILLAS_POR_SLUG[slug], []);
    assert.equal(Object.hasOwn(plan.manuales, clave), false, clave);
    assert.equal(Object.hasOwn(plan.filas, clave), false, clave);
  }
});

test("Brillante: las filas que nombra Kike son editables (Dividendos y Inversiones por categoría; el resto, manuales)", () => {
  const plan = planDeCarga(PLANTILLA_BRILLANTE, []);
  for (const clave of [
    "br.prestamoMs",
    "br.cobranzaChequeDiferido",
    "br.goldSalta",
    "br.otrasOperacionesJujuy",
    "br.otroMsnt",
    "br.reservaSac",
    "br.devolucionMsCamioneta",
    "br.traspasoPrestamoMs",
    "br.traspasoSaldoInicial",
    "br.ajusteCaja",
    "br.aporteBlanqueo",
    "br.recuperoGastos",
  ]) {
    assert.equal(Object.hasOwn(plan.manuales, clave), true, clave);
  }
  for (const clave of ["br.dividendos", "br.inversiones"]) assert.equal(Object.hasOwn(plan.filas, clave), true, clave);
  // Disponibilidades y totales, no.
  for (const clave of ["br.dBancoFci", "br.dReservaAguinaldo", "br.totalIngresos", "br.totalDisponibilidades", "br.saldo", "br.disponible"]) {
    assert.equal(Object.hasOwn(plan.manuales, clave), false, clave);
  }
});

test("Capital de trabajo: el gerente ya no lo carga — ninguna fila de Cierre ni de Disponibilidades es editable", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const plan = planDeCarga(plantilla, []);
    assert.equal(Object.hasOwn(plan, "capital"), false, slug);
    for (const f of plantilla.filas) {
      if (f.bloque === "CIERRE" || f.bloque === "DISPONIBILIDADES") {
        assert.equal(esFilaManualEditable(f), false, `${slug}/${f.clave}`);
        assert.equal(Object.hasOwn(plan.manuales, f.clave), false, `${slug}/${f.clave}`);
        assert.equal(Object.hasOwn(plan.filas, f.clave), false, `${slug}/${f.clave}`);
      }
    }
    const vista = vistaDeCarga(plan);
    assert.equal(Object.hasOwn(vista, "capital"), false, slug);
    assert.equal(vista.celdas.some((c) => c.id.startsWith("capital|")), false, slug);
  }
});

test("Capital de trabajo: un cliente armado a mano que mande destino «capital» es rechazado por el servidor", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const plan = planDeCarga(plantilla, []);
    for (const f of plantilla.filas.filter((x) => x.tipo === "capital")) {
      assert.equal(manualDeEntrada(plan, { destino: "capital" as never, clave: f.clave }), null, `${slug}/${f.clave}`);
      assert.equal(manualDeEntrada(plan, { destino: "manual", clave: f.clave }), null, `${slug}/${f.clave}`);
    }
  }
});

test("cambioMientrasEditaba: vacío contra vacío NO es un cambio (sin falso positivo)", () => {
  assert.equal(cambioMientrasEditaba("", null), false);
  assert.equal(cambioMientrasEditaba("   ", null), false);
  // Un 0 guardado equivale a vacío.
  assert.equal(cambioMientrasEditaba("", 0), false);
  assert.equal(cambioMientrasEditaba("0,00", null), false);
});

test("cambioMientrasEditaba: el mismo valor que la pantalla mostró NO es un cambio, en cualquier formato", () => {
  assert.equal(cambioMientrasEditaba("1.234,56", 123456), false);
  assert.equal(cambioMientrasEditaba("1.000,00", 100000), false);
  assert.equal(cambioMientrasEditaba("1000", 100000), false);
  assert.equal(cambioMientrasEditaba("0,00", 0), false);
});

test("cambioMientrasEditaba: sí detecta que otra persona cargó, cambió o borró el valor", () => {
  assert.equal(cambioMientrasEditaba("", 500), true); // estaba vacío y ahora hay valor
  assert.equal(cambioMientrasEditaba("5,00", null), true); // tenía valor y lo borraron
  assert.equal(cambioMientrasEditaba("5,00", 600), true); // lo cambiaron
  assert.equal(cambioMientrasEditaba(undefined, null), true); // sin base no se puede saber
  assert.equal(cambioMientrasEditaba("abc", 500), true); // base ilegible: mejor rechazar
});

test("planDeCarga: los valores manuales cargados aparecen con quién y cuándo, y el resto queda vacío", () => {
  const plan = planDeCarga(PLANTILLA_BRILLANTE, [], [
    manual("br.ajusteCaja", 250000, { nota: "100+150" }),
    manual("br.capital", 3100000000),
    manual("br.dBancoFci", 999), // Disponibilidades: no es editable, no entra al plan
  ]);
  assert.equal(plan.manuales["br.ajusteCaja"].valorCentavos, 250000);
  assert.equal(plan.manuales["br.ajusteCaja"].nota, "100+150");
  assert.match(plan.manuales["br.ajusteCaja"].leyenda!, /^Cargó Prueba FINANZAS · \d{1,2}\/\d{1,2}\/2026$/);
  assert.equal(plan.manuales["br.recuperoGastos"].valorCentavos, null);
  assert.equal(plan.manuales["br.recuperoGastos"].leyenda, null);
  // Un valor de Capital guardado antes no se abre para el gerente (el motor lo sigue usando; lo edita ADMIN).
  assert.equal(Object.hasOwn(plan.manuales, "br.capital"), false);
  assert.equal(Object.hasOwn(plan.manuales, "br.dBancoFci"), false);
});

test("manualDeEntrada: encuentra manuales; todo lo demás (Disponibilidades, Cierre, Capital, claves raras) es null", () => {
  const plan = planDeCarga(PLANTILLA_BRILLANTE, []);
  assert.ok(manualDeEntrada(plan, { destino: "manual", clave: "br.ajusteCaja" }));
  for (const clave of ["br.dBancoFci", "br.disponible", "br.saldo", "br.totalIngresos", "__proto__", "constructor", "nada"]) {
    assert.equal(manualDeEntrada(plan, { destino: "manual", clave }), null, clave);
  }
  // El destino "capital" ya no existe: ni la clave del Capital ni otra de Cierre.
  assert.equal(manualDeEntrada(plan, { destino: "capital" as never, clave: "br.capital" }), null);
  assert.equal(manualDeEntrada(plan, { destino: "capital" as never, clave: "br.disponible" }), null);
  // Una clave de categoría no sirve como manual, ni al revés.
  assert.equal(manualDeEntrada(plan, { destino: "manual", clave: "br.sueldos" }), null);
});

test("nombreDeEntrada: manual usa el texto de la fila", () => {
  assert.equal(nombreDeEntrada(PLANTILLA_BRILLANTE, { destino: "manual", clave: "br.ajusteCaja" }).startsWith("Ajuste Caja"), true);
});

test("vistaDeCarga: celdas manuales con su valor formateado y leyenda", () => {
  const plan = planDeCarga(PLANTILLA_BRILLANTE, [], [manual("br.ajusteCaja", 123456)]);
  const vista = vistaDeCarga(plan);
  const aj = vista.celdas.find((c) => c.id === idCelda("manual", "br.ajusteCaja"))!;
  assert.equal(aj.destino, "manual");
  assert.equal(aj.importeInicial, "1.234,56");
  assert.ok(aj.leyenda?.startsWith("Cargó Prueba FINANZAS"));
  const vacia = vista.celdas.find((c) => c.id === idCelda("manual", "br.recuperoGastos"))!;
  assert.equal(vacia.importeInicial, "");
  assert.equal(vacia.leyenda, null);
  assert.equal(vista.celdas.some((c) => c.id === idCelda("manual", "br.dBancoFci")), false);
  // La huella cambia si cambia un valor manual (la pantalla repone lo guardado).
  const otra = vistaDeCarga(planDeCarga(PLANTILLA_BRILLANTE, [], [manual("br.ajusteCaja", 999)]));
  assert.notEqual(vista.huella, otra.huella);
});
