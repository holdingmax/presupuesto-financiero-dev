import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { CLASIFICACIONES_FUERA_DEL_REPORTE_INTENCIONAL, CLASIFICACIONES_SE_CARGAN_A_MANO } from "@/lib/config";
import { clasificacionesDePlantilla, claveEquivalencia } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { leerFilasMadre } from "@/lib/extractos/madre";
import { clasificacionesSinFila, descartadasPorImporte, MAX_DESCARTADAS_VISIBLES, unidadesNoReconocidas } from "@/lib/extractos/avisosMadre";
import { resumirMadre } from "@/lib/extractos/madreWeb";
import { madreHwc, madreNormal } from "./fixtures/madre";

const dia = (d: number) => new Date(Date.UTC(2026, 10, d));

function hoja(filas: unknown[][]): ExcelJS.Worksheet {
  const ws = new ExcelJS.Workbook().addWorksheet("Hoja1");
  ws.addRow(["Fecha", "Concepto", "Importe", "BANCO Y CTA", "Clasificación", "UNIDAD DE NEG"]);
  for (const f of filas) ws.addRow(f);
  return ws;
}

function leer(ws: ExcelJS.Worksheet) {
  const r = leerFilasMadre(ws);
  assert.ok(r.ok);
  return r;
}

// ---------- (c) la lista de intencionales ----------

test("lista (c): las 8 pedidas, y nunca IVA, EXPENSAS, INVERSIONES ni PRESTAMOS", () => {
  assert.deepEqual([...CLASIFICACIONES_FUERA_DEL_REPORTE_INTENCIONAL], [
    "FCI",
    "INT FCI",
    "TRANSF ENTRE BCOS",
    "DEP CH 3°",
    "CH DIFERIDOS IVA",
    "COMPRA ME",
    "COMPRA INTERNA",
    "MAL REGISTRADO",
  ]);
  const claves = new Set(CLASIFICACIONES_FUERA_DEL_REPORTE_INTENCIONAL.map(claveEquivalencia));
  for (const prohibida of ["IVA", "EXPENSAS", "INVERSIONES", "PRESTAMOS"]) {
    assert.equal(claves.has(claveEquivalencia(prohibida)), false, `${prohibida} no puede estar en la lista`);
  }
});

test("lista (c): ninguna está a la vez en la plantilla de alguna empresa (sería contradictorio)", () => {
  const claves = new Set(CLASIFICACIONES_FUERA_DEL_REPORTE_INTENCIONAL.map(claveEquivalencia));
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    for (const c of clasificacionesDePlantilla(plantilla)) {
      assert.equal(claves.has(claveEquivalencia(c)), false, `${c} está en la plantilla de ${slug} y en la lista de intencionales`);
    }
  }
});

test("lista 'se cargan a mano': IVA, INVERSIONES, PRESTAMOS y EXPENSAS, y ninguna repetida en la de intencionales", () => {
  assert.deepEqual([...CLASIFICACIONES_SE_CARGAN_A_MANO], ["IVA", "INVERSIONES", "PRESTAMOS", "EXPENSAS"]);
  const intencionales = new Set(CLASIFICACIONES_FUERA_DEL_REPORTE_INTENCIONAL.map(claveEquivalencia));
  for (const c of CLASIFICACIONES_SE_CARGAN_A_MANO) {
    assert.equal(intencionales.has(claveEquivalencia(c)), false, `${c} está en las dos listas`);
  }
});

// ---------- (a) 1: unidades no reconocidas ----------

test("unidades: guarda el texto original y no cambia la unidad que se asigna", () => {
  const r = leer(
    hoja([
      [dia(1), "PAGO", -100, "MACRO 599", "AVION", "AVIONES"], // texto ignorado: cae a la unidad de la cuenta (SPP)
      [dia(2), "PAGO", -100, "MACRO 599", "AVION", "AVIONES"],
      [dia(2), "PAGO", -100, "MACRO 599", "AVION", "AVION"], // alias reconocido (AVION → AVIANOR): no se avisa
      [dia(3), "PAGO", -100, "BANCO RARO 1", "AVION", "XYZ"], // sin cuenta: SIN ASIGNAR
      [dia(4), "PAGO", -100, "BANCO RARO 1", "AVION", "QUINTEROS"], // razón social conocida: no se avisa
      [dia(5), "PAGO", -100, "BANCO RARO 1", "AVION", "SPP "], // unidad válida: no se avisa
      [dia(6), "PAGO", -100, "BANCO RARO 1", "AVION", "SIN ASIGNAR"], // vacío: no se avisa
    ])
  );
  assert.deepEqual(
    r.filas.map((f) => f.unidadNegocio),
    ["SPP", "SPP", "AVIANOR", "SIN ASIGNAR", "FREDY", "SPP", "SIN ASIGNAR"]
  );
  assert.deepEqual(unidadesNoReconocidas(r.filas), [
    { texto: "AVIONES", columna: "UNIDAD DE NEG", cayoEn: "SPP", filas: 2 },
    { texto: "XYZ", columna: "UNIDAD DE NEG", cayoEn: "SIN ASIGNAR", filas: 1 },
  ]);
});

test("unidades: la columna EMPRESA sin mapa se avisa; con mapa (WHEELER) no", () => {
  const r = leer(madreHwc());
  assert.deepEqual(unidadesNoReconocidas(r.filas), []); // SPP, WHEELER y vacía: ninguna sin reconocer
  const ws = new ExcelJS.Workbook().addWorksheet("Hoja1");
  ws.addRow(["Fecha", "Descripcion", "Importe", "Banco", "CLASIF 2", "EMPRESA"]);
  ws.addRow([dia(1), "COBRO", 5, "BANCO X", "COBRANZAS", "CIELOS"]);
  const e = leer(ws);
  assert.deepEqual(unidadesNoReconocidas(e.filas), [{ texto: "CIELOS", columna: "EMPRESA", cayoEn: "SIN ASIGNAR", filas: 1 }]);
});

// ---------- (a) 2: clasificaciones sin fila ----------

const EMPRESAS = [
  { nombre: "HWC", unidades: ["HWC"], clasificacionesDePlantilla: ["COBRANZAS", "GOL LINHEAS A"] },
  { nombre: "Expensas", unidades: ["EXPENSAS"], clasificacionesDePlantilla: null },
];

test("clasificaciones sin fila: por empresa, con cantidad e importe; plantilla e intencionales no avisan", () => {
  const r = leer(
    hoja([
      [dia(1), "PAGO", -478816512.17, "MACRO 833", "LAN/LATAM SI", "HWC"],
      [dia(1), "PAGO", -92112671.15, "MACRO 833", "lan/latam si", "HWC"], // mismo grupo (sin mayúsculas)
      [dia(2), "COBRO", 10, "MACRO 833", "COBRANZAS", "HWC"], // en la plantilla
      [dia(3), "FCI", 10, "MACRO 833", "FCI", "HWC"], // intencional
      [dia(4), "IVA", -5, "MACRO 833", "IVA", "HWC"], // no es intencional: va al recordatorio "se cargan a mano"
      [dia(5), "X", 7, "MACRO 833", "OTRA COSA", "EXPENSAS"], // empresa sin plantilla: no avisa
      [dia(6), "X", 7, "MACRO 833", "SIN CLASIFICAR", "HWC"], // tiene su propio aviso
      [dia(7), "X", 7, "BANCO RARO 1", "OTRA COSA", "SIN ASIGNAR"], // sin unidad: tiene su propio aviso
    ])
  );
  assert.deepEqual(clasificacionesSinFila(r.filas, EMPRESAS), {
    // "No encajan": exigen confirmar.
    noEncajan: [{ empresa: "HWC", clasificacion: "LAN/LATAM SI", filas: 2, centavos: -57092918332 }],
    // "Se cargan a mano": solo recordatorio.
    seCarganAMano: [{ empresa: "HWC", clasificacion: "IVA", filas: 1, centavos: -500 }],
  });
});

test("clasificaciones sin fila: las grafías de Gol de la plantilla no avisan", () => {
  const r = leer(hoja([[dia(1), "GOL", -1, "MACRO 833", "GOL LINHEAS A", "HWC"]]));
  assert.deepEqual(clasificacionesSinFila(r.filas, EMPRESAS), { noEncajan: [], seCarganAMano: [] });
});

// ---------- (a) 3: filas descartadas ----------

test("descartadas: importe ilegible sí, fila vacía no; queda el texto original", () => {
  const r = leerFilasMadre(madreNormal());
  assert.ok(r.ok);
  assert.deepEqual(r.descartadas, [{ numeroFila: 5, concepto: "IMPORTE EN TEXTO", importeTexto: "1.234,56" }]);
});

test("descartadas: se muestran las primeras y el total", () => {
  const muchas = Array.from({ length: MAX_DESCARTADAS_VISIBLES + 3 }, (_, i) => ({ numeroFila: i + 2, concepto: "X", importeTexto: "a" }));
  const d = descartadasPorImporte(muchas);
  assert.equal(d.total, MAX_DESCARTADAS_VISIBLES + 3);
  assert.equal(d.primeras.length, MAX_DESCARTADAS_VISIBLES);
});

// ---------- resumirMadre: requiereConfirmar ----------

test("resumen: requiereConfirmar se prende con cualquiera de los tres avisos y se apaga sin ninguno", () => {
  const limpio = leer(hoja([[dia(1), "COBRO", 10, "MACRO 833", "COBRANZAS", "HWC"]]));
  const base = { cuentasDelCatalogo: ["MACRO 833"], clasificaciones: ["COBRANZAS"], empresas: EMPRESAS };
  assert.equal(resumirMadre(limpio.filas, { ...base, descartadas: limpio.descartadas }).requiereConfirmar, false);

  const conSinFila = leer(
    hoja([
      [dia(1), "PAGO", -5, "MACRO 833", "COBRANZAS", "HWC"],
      [dia(1), "PAGO", -5, "MACRO 833", "LAN/LATAM SI", "HWC"],
    ])
  );
  const r1 = resumirMadre(conSinFila.filas, { ...base, clasificaciones: ["COBRANZAS", "LAN/LATAM SI"] });
  assert.equal(r1.requiereConfirmar, true);
  assert.equal(r1.clasificacionesNuevas.length, 0); // ya existía: no es "nueva"; el aviso nuevo es otro
  assert.equal(r1.fueraDelReporte.clasificacionesSinFila.length, 1);
  assert.equal(r1.fueraDelReporte.seCarganAMano.length, 0);

  const conUnidad = leer(hoja([[dia(1), "PAGO", -5, "MACRO 599", "COBRANZAS", "AVIONES"]]));
  assert.equal(resumirMadre(conUnidad.filas, base).requiereConfirmar, true);

  const conDescarte = leerFilasMadre(madreNormal());
  assert.ok(conDescarte.ok);
  assert.equal(resumirMadre([], { ...base, descartadas: conDescarte.descartadas }).requiereConfirmar, true);
});

test("resumen: si solo hay avisos 'se cargan a mano' NO se exige confirmar; mezclados con uno de 'no encajan', sí", () => {
  const base = { cuentasDelCatalogo: ["MACRO 833"], clasificaciones: ["COBRANZAS", "IVA", "INVERSIONES", "PRESTAMOS", "EXPENSAS", "LAN/LATAM SI"], empresas: EMPRESAS };
  const soloManuales = leer(
    hoja([
      [dia(1), "X", -5, "MACRO 833", "IVA", "HWC"],
      [dia(2), "X", -6, "MACRO 833", "INVERSIONES", "HWC"],
      [dia(3), "X", 7, "MACRO 833", "PRESTAMOS", "HWC"],
      [dia(4), "X", -8, "MACRO 833", "EXPENSAS", "HWC"],
      [dia(5), "X", 9, "MACRO 833", "COBRANZAS", "HWC"],
    ])
  );
  const r = resumirMadre(soloManuales.filas, { ...base, descartadas: soloManuales.descartadas });
  assert.deepEqual(r.fueraDelReporte.seCarganAMano.map((c) => [c.clasificacion, c.filas, c.centavos]), [
    // Orden: por empresa y, dentro, el de mayor importe (en valor absoluto) primero.
    ["EXPENSAS", 1, -800],
    ["PRESTAMOS", 1, 700],
    ["INVERSIONES", 1, -600],
    ["IVA", 1, -500],
  ]);
  assert.deepEqual(r.fueraDelReporte.clasificacionesSinFila, []);
  assert.equal(r.requiereConfirmar, false);

  const mezcla = leer(hoja([[dia(1), "X", -5, "MACRO 833", "IVA", "HWC"], [dia(2), "X", -5, "MACRO 833", "LAN/LATAM SI", "HWC"]]));
  const m = resumirMadre(mezcla.filas, base);
  assert.equal(m.fueraDelReporte.seCarganAMano.length, 1);
  assert.equal(m.fueraDelReporte.clasificacionesSinFila.length, 1);
  assert.equal(m.requiereConfirmar, true);
});

test("resumen: sin empresas ni descartadas (llamadas viejas) las listas nuevas salen vacías", () => {
  const r = resumirMadre(leer(madreNormal()).filas, { cuentasDelCatalogo: [], clasificaciones: [] });
  assert.deepEqual(r.fueraDelReporte.clasificacionesSinFila, []);
  assert.deepEqual(r.fueraDelReporte.seCarganAMano, []);
  assert.equal(r.fueraDelReporte.descartadas.total, 0);
});
