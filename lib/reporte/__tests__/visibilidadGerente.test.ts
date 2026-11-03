import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  armarReporte,
  clavesCalculables,
  clavesVisibles,
  esBloqueReservado,
  esFilaDeCierreVisibleParaGerente,
  type Reporte,
} from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import {
  EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE,
  EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE,
} from "@/lib/config";
import { mesesDePrueba } from "./fixtures/datosGerente";

// Etapa 5 B, commit 3: visibilidad granular de Disponibilidades y Cierre para el gerente, con los dos
// interruptores apagados (lista vacía) = el Reporte de siempre.

const APAGADOS = { disponibilidades: [], cierre: [] };

// Misma proyección con la que se generó fixtures/gerenteSinReservados.json (con el motor de ANTES del
// refactor): si algo del Reporte restringido cambia, esto lo avisa.
function proyeccion(r: Reporte) {
  return JSON.parse(
    JSON.stringify({
      periodos: r.periodos,
      sinPresupuesto: r.sinPresupuesto,
      sinEjecucion: r.sinEjecucion,
      pendientes: r.pendientes,
      arrastre: r.arrastre,
      sinBloquesReservados: r.sinBloquesReservados,
      filas: r.filas.map((f) => [
        f.fila.clave,
        f.celdas.map((c) => [c.presupuestado, c.real, c.avance, c.faltaEjecutar, c.presupuestoIncompleto, c.realIncompleto]),
      ]),
    })
  );
}

const GOLDEN = JSON.parse(
  readFileSync(new URL("./fixtures/gerenteSinReservados.json", import.meta.url), "utf-8")
) as Record<string, unknown>;

// Excepción explícita (ver brillanteRealManual.test.ts): «Gold Salta» de Brillante pasó de «Sin Real» a Real manual, y una celda de
// Real manual vacía ya no se marca como incompleta (realIncompleto). Es la ÚNICA diferencia con la foto de Brillante
// (tomada antes del cambio, que no se regenera): se pone en una copia ese único campo de esa única fila.
function esperado(slug: string): unknown {
  // Misma excepción para Havanna: «Cobranzas locales» pasó de «Sin Real» a Real manual (neteo de cobranzas) y su celda de Real
  // vacía ya no se marca como incompleta. Es la única diferencia con la foto de Havanna (que no se regenera).
  if (slug === "havanna") {
    const copia = JSON.parse(JSON.stringify(GOLDEN[slug])) as { filas: [string, unknown[][]][] };
    const locales = copia.filas.find(([clave]) => clave === "hv.cobranzasLocales")![1][0];
    assert.equal(locales[5], true, "la foto de antes tiene Cobranzas locales con el Real incompleto");
    locales[5] = false;
    return copia;
  }
  if (slug !== "brillante") return GOLDEN[slug];
  const copia = JSON.parse(JSON.stringify(GOLDEN[slug])) as { filas: [string, unknown[][]][] };
  const gold = copia.filas.find(([clave]) => clave === "br.goldSalta")![1][0];
  assert.equal(gold[5], true, "la foto de antes tiene Gold Salta con el Real incompleto");
  gold[5] = false;
  return copia;
}

test("golden: cubre todas las plantillas", () => {
  assert.deepEqual(Object.keys(GOLDEN).sort(), Object.keys(PLANTILLAS_POR_SLUG).sort());
});

for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
  test(`${slug}: con ambos interruptores apagados el Reporte del gerente es idéntico al de antes`, () => {
    const meses = mesesDePrueba(plantilla);
    // Las tres formas de «sin bloques reservados» dan exactamente lo que daba el motor antes del refactor.
    const acceso = accesoReservadosDelReporte(false, slug, APAGADOS);
    assert.equal(acceso, false);
    for (const verBloquesReservados of [false, acceso, { disponibilidades: false, cierre: false }]) {
      const r = armarReporte(plantilla, meses, 1, { verBloquesReservados });
      assert.deepEqual(proyeccion(r), esperado(slug));
    }
  });

  test(`${slug}: ADMIN y FINANZAS siguen viendo todo, con arrastre`, () => {
    const meses = mesesDePrueba(plantilla);
    const completo = armarReporte(plantilla, meses, 1);
    assert.deepEqual(proyeccion(armarReporte(plantilla, meses, 1, { verBloquesReservados: true })), proyeccion(completo));
    assert.equal(completo.filas.length, plantilla.filas.length);
    assert.equal(completo.sinBloquesReservados, false);
  });
}

test("accesoReservadosDelReporte: ADMIN/FINANZAS todo; sin interruptores, nada", () => {
  assert.equal(accesoReservadosDelReporte(true, "brillante", APAGADOS), true);
  assert.equal(accesoReservadosDelReporte(false, "brillante", APAGADOS), false);
  const soloDisp = { disponibilidades: ["brillante"], cierre: [] };
  assert.deepEqual(accesoReservadosDelReporte(false, "brillante", soloDisp), { disponibilidades: true, cierre: false });
  assert.equal(accesoReservadosDelReporte(false, "radio", soloDisp), false); // fuera de la lista pasada, aunque esté en la de config
  const ambos = { disponibilidades: ["brillante"], cierre: ["brillante"] };
  assert.deepEqual(accesoReservadosDelReporte(false, "brillante", ambos), { disponibilidades: true, cierre: true });
  // Un interruptor de una empresa no prende el de otra.
  assert.equal(accesoReservadosDelReporte(false, "havanna", ambos), false);
});

test("accesoReservadosDelReporte: Cierre sin Disponibilidades no existe (falla cerrado)", () => {
  assert.equal(accesoReservadosDelReporte(false, "brillante", { disponibilidades: [], cierre: ["brillante"] }), false);
});

test("config: Cierre solo puede estar prendido donde Disponibilidades también lo está", () => {
  for (const slug of EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE) {
    assert.ok(
      EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes(slug),
      `${slug} ve Cierre pero no Disponibilidades: el Saldo revela el total de Disponibilidades`
    );
  }
});

test("config real: Cierre prendido en las diez empresas con Disponibilidades; el alias de testing de Conexión y Havanna Perú siguen fuera", () => {
  assert.deepEqual(
    [...EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE],
    ["brillante", "fredy-publicidad", "hwc", "avianor", "mantenor", "havanna", "radio", "conexion-logistica", "bradenton", "plate-silver"]
  );
  for (const slug of EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE) {
    assert.deepEqual(accesoReservadosDelReporte(false, slug), { disponibilidades: true, cierre: true }, slug);
  }
  for (const slug of ["conexion-logistica-spp", "havanna-peru", "expensas"]) {
    assert.equal(accesoReservadosDelReporte(false, slug), false, slug);
  }
});

test("Cierre del gerente: Capital y Disponible solo con Presupuestado (como la planilla); el Saldo, con su Real", () => {
  for (const slug of EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE) {
    const r = reporteParcial(slug, { disponibilidades: true, cierre: true });
    for (const f of r.filas.filter((x) => x.fila.bloque === "CIERRE")) {
      const c = f.celdas[0];
      const clave = `${slug}/${f.fila.clave}`;
      if (f.fila.tipo === "capital" || f.fila.tipo === "disponible") {
        assert.equal(c.real, null, clave);
        assert.equal(c.avance, null, clave);
        assert.equal(c.faltaEjecutar, null, clave);
      } else if (f.fila.tipo === "total") {
        // Saldo, o Posición / Capital / Excedente de Plate Silver y Bradenton (visibleGerente): con Presupuestado y Real.
        assert.equal(f.fila.rol === "saldo" || f.fila.visibleGerente === true, true, clave);
        assert.notEqual(c.real, null, clave);
        assert.notEqual(c.presupuestado, null, clave);
      } else {
        // Capital tipeado de Bradenton (línea manual de Cierre): P y R.
        assert.equal(f.fila.tipo === "linea" && f.fila.presupuesto.tipo === "manual", true, clave);
      }
    }
  }
});

test("config: todos los slugs de los interruptores tienen plantilla de Reporte", () => {
  for (const slug of [...EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE, ...EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE]) {
    assert.ok(PLANTILLAS_POR_SLUG[slug], `${slug} no tiene plantilla de Reporte`);
  }
});

// ---- El motor con permiso parcial (todavía sin uso en producción: los interruptores están apagados) ----

function reporteParcial(slug: string, verBloquesReservados: { disponibilidades: boolean; cierre: boolean }) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  return armarReporte(plantilla, mesesDePrueba(plantilla), 1, { verBloquesReservados });
}

for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
  test(`${slug}: solo Disponibilidades — están las filas de ese bloque, ninguna de Cierre, sin arrastre`, () => {
    const r = reporteParcial(slug, { disponibilidades: true, cierre: false });
    const bloques = new Set(r.filas.map((f) => f.fila.bloque));
    assert.equal(bloques.has("DISPONIBILIDADES"), true);
    assert.equal(bloques.has("CIERRE"), false);
    assert.ok(r.arrastre.every((a) => a === null));
    assert.equal(r.sinBloquesReservados, true);
    // Una fila por cada fila del bloque.
    assert.equal(
      r.filas.filter((f) => f.fila.bloque === "DISPONIBILIDADES").length,
      plantilla.filas.filter((f) => f.bloque === "DISPONIBILIDADES").length
    );
  });

  test(`${slug}: Disponibilidades y Cierre — de Cierre solo el Saldo, el Capital y el Disponible; nunca «Disponible antes de gastos»`, () => {
    const r = reporteParcial(slug, { disponibilidades: true, cierre: true });
    const deCierre = r.filas.filter((f) => f.fila.bloque === "CIERRE");
    for (const f of deCierre) {
      assert.equal(esFilaDeCierreVisibleParaGerente(f.fila), true, `${slug}/${f.fila.clave}`);
      assert.ok(!f.fila.clave.endsWith("disponibleAntes"), `${slug}: no se muestra ${f.fila.clave}`);
    }
    assert.ok(r.arrastre.every((a) => a === null), "el gerente nunca recibe el control de arrastre");
    // Sin el título ni las filas de otros bloques sobrantes: lo que no es de Cierre es igual que con permiso total.
    const completo = armarReporte(plantilla, mesesDePrueba(plantilla), 1);
    assert.equal(
      r.filas.filter((f) => f.fila.bloque !== "CIERRE").length,
      completo.filas.filter((f) => f.fila.bloque !== "CIERRE").length
    );
  });

  test(`${slug}: Cierre sin Disponibilidades en el motor — falla cerrado, no hay ni uno ni otro`, () => {
    const r = reporteParcial(slug, { disponibilidades: false, cierre: true });
    assert.deepEqual(proyeccion(r), esperado(slug));
  });
}

test("Brillante con ambos: Saldo, Capital y Disponible se calculan; Disponible antes de gastos no viaja", () => {
  const r = reporteParcial("brillante", { disponibilidades: true, cierre: true });
  const claves = r.filas.map((f) => f.fila.clave);
  for (const k of ["br.saldo", "br.capital", "br.disponible", "br.totalDisponibilidades"]) {
    assert.ok(claves.includes(k), k);
  }
  assert.equal(claves.includes("br.disponibleAntes"), false);
  const celda = (k: string) => r.filas.find((f) => f.fila.clave === k)!.celdas[0];
  assert.notEqual(celda("br.saldo").presupuestado, null);
  assert.notEqual(celda("br.disponible").presupuestado, null);
});

test("Cierre visible: la lista explícita son las filas de rol saldo, capital y disponible", () => {
  const visibles = PLANTILLAS_POR_SLUG["brillante"].filas.filter((f) => esFilaDeCierreVisibleParaGerente(f)).map((f) => f.clave);
  assert.deepEqual(visibles, ["br.saldo", "br.capital", "br.disponible"]);
  // Y en ninguna plantilla entra una fila fuera de Cierre.
  for (const p of Object.values(PLANTILLAS_POR_SLUG)) {
    for (const f of p.filas) {
      if (esFilaDeCierreVisibleParaGerente(f)) assert.equal(f.bloque, "CIERRE");
    }
  }
});

test("clavesCalculables: qué valores manuales se leen según el acceso", () => {
  const p = PLANTILLAS_POR_SLUG["brillante"];
  const sin = clavesCalculables(p, false);
  assert.deepEqual(Array.from(sin).sort(), Array.from(clavesVisibles(p)).sort());
  assert.ok(Array.from(sin).every((k) => !esBloqueReservado(p.filas.find((f) => f.clave === k)!.bloque)));
  const disp = clavesCalculables(p, { disponibilidades: true, cierre: false });
  assert.ok(disp.has("br.dBancoFci"));
  assert.equal(disp.has("br.capital"), false);
  const ambos = clavesCalculables(p, { disponibilidades: true, cierre: true });
  assert.ok(ambos.has("br.capital") && ambos.has("br.dBancoFci"));
  assert.equal(clavesCalculables(p, true).size, p.filas.length);
  // Cierre sin Disponibilidades se descarta también al leer.
  assert.deepEqual(
    Array.from(clavesCalculables(p, { disponibilidades: false, cierre: true })).sort(),
    Array.from(sin).sort()
  );
});
