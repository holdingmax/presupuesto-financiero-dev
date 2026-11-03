import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, camposManuales, validarPlantilla, type DatosMes, type Plantilla } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { armarVistaTipeo, camposTipeables, motivoRechazoTipeo } from "@/lib/reporte/tipeoDirecto";
import { AVISO_UNA_VEZ } from "@/lib/reporte/bloqueo";

// SAC de Brillante y Conexión: desde 2026-10 el Real es lo que dan las clasificaciones MÁS el valor tipeado de la misma
// fila (sumarManual). Antes de 2026-10 y sin valor tipeado, igual que antes.

const FILAS: Record<string, string> = { brillante: "br.sac", "conexion-logistica": "cx.sac" };
const SAC = 5_000_000; // 50.000,00 que dan las clasificaciones
const MANUAL = 1_234_567; // 12.345,67 tipeado

function mes(periodo: string, over: Partial<DatosMes> = {}, manual?: number, slug = "brillante"): DatosMes {
  const real = new Map<string, number>();
  // Un egreso se muestra en positivo: las clasificaciones traen el neto con signo de banco (negativo).
  real.set("SAC", -SAC);
  return {
    periodo,
    real,
    presupuesto: new Map(),
    semanasCerradas: 4,
    manuales: { presupuesto: new Map(), real: new Map(manual === undefined ? [] : [[FILAS[slug], manual]]) },
    ...over,
  };
}

function real(slug: string, datos: DatosMes): number | null {
  const r = armarReporte(PLANTILLAS_POR_SLUG[slug], [datos], 0);
  return r.filas.find((f) => f.fila.clave === FILAS[slug])!.celdas[0].real;
}

for (const slug of Object.keys(FILAS)) {
  test(`${slug}: antes del corte (2026-09) el Real es el de siempre, aunque haya un valor tipeado`, () => {
    assert.equal(real(slug, mes("2026-09", {}, undefined, slug)), SAC);
    assert.equal(real(slug, mes("2026-09", {}, MANUAL, slug)), SAC);
    assert.equal(real(slug, mes("2025-12", {}, MANUAL, slug)), SAC);
  });

  test(`${slug}: desde el corte (2026-10) suma lo tipeado a las clasificaciones`, () => {
    assert.equal(real(slug, mes("2026-10", {}, MANUAL, slug)), SAC + MANUAL);
    assert.equal(real(slug, mes("2026-11", {}, MANUAL, slug)), SAC + MANUAL);
  });

  test(`${slug}: desde el corte, sin valor tipeado queda igual que hoy`, () => {
    assert.equal(real(slug, mes("2026-10", {}, undefined, slug)), SAC);
  });

  test(`${slug}: sin semanas cerradas, con valor tipeado muestra el manual; sin él sigue «—»`, () => {
    assert.equal(real(slug, mes("2026-10", { semanasCerradas: 0 }, MANUAL, slug)), MANUAL);
    assert.equal(real(slug, mes("2026-10", { semanasCerradas: 0 }, undefined, slug)), null);
    // Antes del corte no cuenta el manual.
    assert.equal(real(slug, mes("2026-09", { semanasCerradas: 0 }, MANUAL, slug)), null);
  });

  test(`${slug}: es un campo manual de Real y la plantilla sigue siendo válida`, () => {
    assert.ok(camposManuales(PLANTILLAS_POR_SLUG[slug]).some((c) => c.clave === FILAS[slug] && c.columna === "REAL"));
    assert.deepEqual(validarPlantilla(PLANTILLAS_POR_SLUG[slug]), []);
  });

  test(`${slug}: el Total de egresos suma el SAC con lo tipeado`, () => {
    const sin = armarReporte(PLANTILLAS_POR_SLUG[slug], [mes("2026-10", {}, undefined, slug)], 0);
    const con = armarReporte(PLANTILLAS_POR_SLUG[slug], [mes("2026-10", {}, MANUAL, slug)], 0);
    const total = (r: typeof sin) => r.filas.find((f) => f.fila.tipo === "total" && f.fila.clave.endsWith("totalEgresos"))!.celdas[0].real;
    assert.equal(total(con)! - total(sin)!, MANUAL);
  });
}

test("solo br.sac y cx.sac usan sumarManual; el SAC de las demás plantillas no cambia", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const usan = plantilla.filas.filter(
      (f) => f.tipo === "linea" && f.real.tipo === "clasificaciones" && f.real.sumarManual !== undefined
    );
    assert.deepEqual(usan.map((f) => f.clave), slug === "brillante" ? ["br.sac"] : slug.startsWith("conexion-logistica") ? ["cx.sac"] : [], slug);
  }
  // El alias de testing de Conexión comparte la plantilla.
  assert.equal(PLANTILLAS_POR_SLUG["conexion-logistica-spp"], PLANTILLAS_POR_SLUG["conexion-logistica"]);
});

test("sumarManual en Disponibilidades o Cierre es un error de plantilla", () => {
  const base = PLANTILLAS_POR_SLUG["brillante"];
  const mala: Plantilla = {
    ...base,
    filas: base.filas.map((f) =>
      f.clave === "br.sac" && f.tipo === "linea" ? { ...f, bloque: "DISPONIBILIDADES" as const } : f
    ),
  };
  assert.ok(validarPlantilla(mala).some((e) => e.includes("sumarManual")));
});

// ---- Tipeo directo: solo ADMIN y FINANZAS ------------------------------------------------------------

function vista(slug: string, over: Partial<Parameters<typeof armarVistaTipeo>[0]> = {}) {
  return armarVistaTipeo({
    empresaSlug: slug,
    plantilla: PLANTILLAS_POR_SLUG[slug],
    esAdminOFinanzas: true,
    periodo: "2026-10",
    actual: "2026-10",
    semanas: { abiertas: 1, cerradas: 0 },
    valoresReales: new Map(),
    ...over,
  });
}

for (const slug of Object.keys(FILAS)) {
  const clave = FILAS[slug];

  test(`${slug}: ${clave} es tipeable en la columna Real (y solo ahí) para ADMIN y FINANZAS`, () => {
    const campos = camposTipeables(PLANTILLAS_POR_SLUG[slug], slug).filter((c) => c.clave === clave);
    assert.deepEqual(campos.map((c) => c.columna), ["REAL"]);
    const celda = vista(slug)!.celdas.find((c) => c.id === `${clave}|REAL`);
    assert.ok(celda);
    assert.equal(celda.avisoUnaVez, false);
  });

  test(`${slug}: el gerente no recibe la celda y el servidor rechaza lo que mande`, () => {
    assert.equal(vista(slug, { esAdminOFinanzas: false }), null);
    const motivo = motivoRechazoTipeo({
      empresaSlug: slug,
      plantilla: PLANTILLAS_POR_SLUG[slug],
      esAdminOFinanzas: false,
      entradas: [{ filaClave: clave, columna: "REAL", texto: "1.000" }],
    });
    assert.ok(motivo);
  });

  test(`${slug}: período cerrado permite cargar una vez, como las otras filas de Real manual`, () => {
    const cerrado = { periodo: "2026-09", semanas: { abiertas: 0, cerradas: 4 } };
    const vacia = vista(slug, cerrado)!.celdas.find((c) => c.id === `${clave}|REAL`)!;
    assert.equal(vacia.avisoUnaVez, true);
    assert.equal(vacia.aviso, AVISO_UNA_VEZ);
    // Ya cargada en un período cerrado, no viaja: nadie la modifica ni la borra.
    const cargada = vista(slug, { ...cerrado, valoresReales: new Map([[clave, 100]]) })!;
    assert.equal(cargada.celdas.some((c) => c.id === `${clave}|REAL`), false);
  });
}
