import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE, EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE } from "@/lib/config";
import { armarReporte, clavesCalculables, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { planDeCarga, vistaDeCarga } from "@/lib/reporte/cargaGerente";
import { armarVistaTipeo, motivoRechazoTipeo } from "@/lib/reporte/tipeoDirecto";
import { CENTINELA, clavesDeCierre, fotoConFilasNuevas, mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";

// Segunda tanda: Fredy Publicidad, HWC y Avianor se suman a EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE. Cada
// gerente ve en SOLO LECTURA las Disponibilidades de SU empresa (nunca las de otra) y ADMIN/FINANZAS las tipean.
// Las listas de claves están escritas a mano, a propósito. Usan la configuración REAL de lib/config.ts.

const GOLDEN = JSON.parse(
  readFileSync(new URL("../reporte/__tests__/fixtures/gerenteSinReservados.json", import.meta.url), "utf-8")
) as Record<string, { filas: [string, unknown][] }>;

// `cierre`: lo único de Cierre que ve el gerente (Saldo, Capital y Disponible; Avianor solo tiene el Saldo).
const ESPERADO: Record<string, { prefijo: string; lineas: string[]; titulo: string | null; total: string | null; cierre: string[] }> = {
  "fredy-publicidad": {
    prefijo: "fr.",
    lineas: [
      "fr.dBancosFci",
      "fr.dEfectivo",
      "fr.dDolar",
      "fr.dChequesNegociados",
      "fr.dReservaCapitalTrabajo",
      "fr.dReservaAguinaldo",
      "fr.dComisionesPendientes",
      "fr.dDividendosPendientes",
      "fr.dRecuperoBlanqueo",
    ],
    titulo: "fr.tituloDisponibilidades",
    total: "fr.totalDisponibilidades",
    cierre: ["fr.saldo", "fr.capital", "fr.disponible"],
  },
  hwc: {
    prefijo: "hw.",
    lineas: [
      "hw.dBancosFci",
      "hw.dCaja",
      "hw.dTransferenciaSaife",
      "hw.dChequesEnCartera",
      "hw.dChequesPendientes",
      "hw.dDolaresEnCaja",
      "hw.dPrevisionSac",
      "hw.dPagoLatamPendiente",
    ],
    titulo: "hw.tituloDisponibilidades",
    total: "hw.totalDisponibilidades",
    cierre: ["hw.saldo", "hw.capital", "hw.disponible"],
  },
  // Avianor lleva una sola fila de Disponibilidades, sin título ni total.
  avianor: { prefijo: "av.", lineas: ["av.dEfectivo"], titulo: null, total: null, cierre: ["av.saldo"] },
  // Mantenor: 5 componentes y su total, sin título (como la planilla). El gerente ve también el Efectivo (K9 pendiente).
  mantenor: {
    prefijo: "mn.",
    lineas: ["mn.dBancoFci", "mn.dEfectivo", "mn.dDolares", "mn.dChequesNegociados", "mn.dReservaSac"],
    titulo: null,
    total: "mn.totalDisponibilidades",
    cierre: ["mn.saldo", "mn.capital", "mn.disponible"],
  },
};

const SLUGS = Object.keys(ESPERADO);

// Filas que NO son de Disponibilidades ni de Cierre pero se calculan con el Disponible: antes el gerente las veía vacías
// (dependían de Cierre) y ahora, que ve el Disponible, las ve con valor. Mantenor: «Prestamos» (de abajo) tiene como
// Presupuestado el Disponible, como la planilla, y TOTAL GASTOS la suma.
const DEPENDEN_DEL_CIERRE: Record<string, string[]> = { mantenor: ["mn.prestamos", "mn.totalGastos"] };
const ABIERTO = { abiertas: 1, cerradas: 0 };

function reporteDelGerente(slug: string): Reporte {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  return armarReporte(plantilla, mesesDePrueba(plantilla), 1, { verBloquesReservados: accesoReservadosDelReporte(false, slug) });
}

function proyeccionDeFilas(r: Reporte) {
  return JSON.parse(
    JSON.stringify(
      r.filas.map((f) => [
        f.fila.clave,
        f.celdas.map((c) => [c.presupuestado, c.real, c.avance, c.faltaEjecutar, c.presupuestoIncompleto, c.realIncompleto]),
      ])
    )
  );
}

test("interruptor: las cuatro están en la lista de Disponibilidades y en la de Cierre", () => {
  for (const slug of SLUGS) {
    assert.ok(EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes(slug), slug);
    assert.ok(EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE.includes(slug), slug);
  }
});

for (const slug of SLUGS) {
  const esperado = ESPERADO[slug];
  const plantilla = PLANTILLAS_POR_SLUG[slug];

  test(`${slug}: el gerente recibe exactamente sus filas de Disponibilidades y solo Saldo/Capital/Disponible de Cierre, sin arrastre`, () => {
    const r = reporteDelGerente(slug);
    const deDisp = r.filas.filter((f) => f.fila.bloque === "DISPONIBILIDADES");
    const clavesEsperadas = [
      ...(esperado.titulo ? [esperado.titulo] : []),
      ...esperado.lineas,
      ...(esperado.total ? [esperado.total] : []),
    ];
    assert.deepEqual(deDisp.map((f) => f.fila.clave).sort(), clavesEsperadas.sort());
    assert.deepEqual(clavesDeCierre(r), esperado.cierre);
    assert.ok(r.arrastre.every((a) => a === null));
    assert.equal(r.sinBloquesReservados, true);
  });

  test(`${slug}: sus Disponibilidades llegan sin % ni «falta ejecutar», y el total suma las filas`, () => {
    const r = reporteDelGerente(slug);
    const lineas = r.filas.filter((f) => f.fila.tipo === "linea" && f.fila.bloque === "DISPONIBILIDADES");
    assert.equal(lineas.length, esperado.lineas.length);
    for (const f of lineas) {
      const c = f.celdas[0];
      assert.ok(c.real !== null && c.real >= CENTINELA, `${f.fila.clave} trae su valor`);
      assert.equal(c.avance, null, f.fila.clave);
      assert.equal(c.faltaEjecutar, null, f.fila.clave);
    }
    if (esperado.total) {
      const total = r.filas.find((f) => f.fila.clave === esperado.total)!.celdas[0];
      assert.equal(total.real, lineas.reduce((a, f) => a + (f.celdas[0].real ?? 0), 0));
    }
  });

  test(`${slug}: fuera de Disponibilidades el Reporte del gerente es idéntico a la foto anterior`, () => {
    const r = reporteDelGerente(slug);
    const derivadas = DEPENDEN_DEL_CIERRE[slug] ?? [];
    const resto = {
      ...r,
      filas: r.filas.filter(
        (f) => f.fila.bloque !== "DISPONIBILIDADES" && f.fila.bloque !== "CIERRE" && !derivadas.includes(f.fila.clave)
      ),
    };
    assert.deepEqual(
      proyeccionDeFilas(resto),
      fotoConFilasNuevas(slug, GOLDEN[slug]).filas.filter(([clave]) => !derivadas.includes(clave))
    );
    // Y esas filas derivadas ahora traen su Presupuestado (el mismo Disponible que ya ve el gerente).
    for (const clave of derivadas) {
      assert.notEqual(r.filas.find((f) => f.fila.clave === clave)!.celdas[0].presupuestado, null, clave);
    }
  });

  test(`${slug}: el gerente no recibe celdas editables ni claves de Disponibilidades, y el servidor lo rechaza`, () => {
    const tipeo = armarVistaTipeo({
      empresaSlug: slug,
      plantilla,
      esAdminOFinanzas: false,
      periodo: "2026-10",
      actual: "2026-10",
      semanas: ABIERTO,
      valoresReales: mesesDePrueba(plantilla)[1].manuales!.real,
    });
    assert.equal(tipeo, null);
    for (const clave of esperado.lineas) {
      const rechazo = motivoRechazoTipeo({
        empresaSlug: slug,
        plantilla,
        esAdminOFinanzas: false,
        entradas: [{ filaClave: clave, columna: "REAL", texto: "1,00" }],
      });
      assert.match(rechazo!, /ADMIN y FINANZAS/);
    }
    // Carga del Presupuestado del gerente: no abre ni lleva ninguna fila de Disponibilidades.
    const plan = planDeCarga(plantilla, [], []);
    const json = JSON.stringify(vistaDeCarga(plan));
    for (const clave of esperado.lineas) {
      assert.equal(Object.hasOwn(plan.filas, clave), false, clave);
      assert.equal(json.includes(clave), false, clave);
    }
  });

  test(`${slug}: el gerente de esta empresa no recibe las Disponibilidades de otra`, () => {
    // Datos «mezclados»: Real manual de las Disponibilidades de LAS TRES empresas con centinela, como si una
    // lectura filtrara de más. El Reporte de esta empresa solo puede tener claves de su plantilla.
    const mezcla = new Map<string, number>();
    for (const otra of SLUGS) for (const clave of ESPERADO[otra].lineas) mezcla.set(clave, CENTINELA);
    const meses = mesesDePrueba(plantilla).map((m) => ({
      ...m,
      manuales: { presupuesto: m.manuales!.presupuesto, real: new Map([...m.manuales!.real, ...mezcla]) },
    }));
    const acceso = accesoReservadosDelReporte(false, slug);
    const r = armarReporte(plantilla, meses, 1, { verBloquesReservados: acceso });
    assert.ok(r.filas.every((f) => f.fila.clave.startsWith(esperado.prefijo)), "solo claves propias");
    const json = JSON.stringify(r);
    for (const otra of SLUGS.filter((s) => s !== slug)) {
      for (const clave of ESPERADO[otra].lineas) assert.equal(json.includes(`"${clave}"`), false, clave);
    }
    const propias = new Set(plantilla.filas.map((f) => f.clave));
    for (const clave of clavesCalculables(plantilla, acceso)) assert.ok(propias.has(clave), clave);
  });
}

test("accesoReservadosDelReporte: vale solo para el slug exacto, no para otro parecido ni de otra empresa", () => {
  for (const slug of SLUGS) {
    assert.deepEqual(accesoReservadosDelReporte(false, slug), { disponibilidades: true, cierre: true }, slug);
    assert.equal(accesoReservadosDelReporte(false, `${slug}-peru`), false);
  }
  for (const otra of ["conexion-logistica-spp", "havanna-peru", "empresa-inventada"]) {
    assert.equal(accesoReservadosDelReporte(false, otra), false, otra);
  }
  assert.equal(accesoReservadosDelReporte(true, "havanna-peru"), true, "ADMIN y FINANZAS ven todo");
});

test("la lectura de manuales filtra por la empresa de la página y la página resuelve el acceso antes de leer", () => {
  const lectura = readFileSync(new URL("../reporte/valoresManuales.ts", import.meta.url), "utf-8").split("\r\n").join("\n");
  assert.match(lectura, /where: \{\s*empresaId,/);
  const pagina = readFileSync(new URL("../../app/[empresa]/[periodo]/reporte/page.tsx", import.meta.url), "utf-8");
  assert.ok(pagina.indexOf("requireAccesoEmpresa(empresa.id)") < pagina.indexOf("cargarDatosMeses("));
  assert.ok(pagina.includes("accesoReservadosDelReporte(verBloquesReservados, empresaSlug)"));
});

test("Avianor: un Efectivo negativo llega al gerente tal cual, en su única fila", () => {
  const plantilla = PLANTILLAS_POR_SLUG["avianor"];
  const meses = mesesDePrueba(plantilla).map((m) => ({
    ...m,
    manuales: { presupuesto: m.manuales!.presupuesto, real: new Map([...m.manuales!.real, ["av.dEfectivo", -123_456_789]]) },
  }));
  const r = armarReporte(plantilla, meses, 1, { verBloquesReservados: accesoReservadosDelReporte(false, "avianor") });
  assert.equal(r.filas.find((f) => f.fila.clave === "av.dEfectivo")!.celdas[0].real, -123_456_789);
});
