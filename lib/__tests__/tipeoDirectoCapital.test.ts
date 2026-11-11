import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, type DatosMes } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import {
  armarVistaTipeo,
  AVISO_PRESUPUESTO_VALIDADO,
  camposTipeables,
  motivoRechazoTipeo,
  type InterruptoresTipeo,
} from "@/lib/reporte/tipeoDirecto";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";

// Presupuestado del Capital de trabajo (Cierre) en el tipeo directo del Reporte: solo ADMIN y FINANZAS, por la misma acción
// de guardado que el resto (guardarTipeoDelReporte → guardarValoresManuales). Vacío = la regla de la plantilla.

const SLUGS = Object.keys(PLANTILLAS_POR_SLUG);
// Empresas habilitadas con fila `capital` (incluye el alias de testing de Conexión).
const CON_CAPITAL: Record<string, string> = {
  "conexion-logistica": "cx.capital",
  "conexion-logistica-spp": "cx.capital",
  brillante: "br.capital",
  havanna: "hv.capital",
  radio: "ra.capital",
  "fredy-publicidad": "fr.capital",
  hwc: "hw.capital",
  mantenor: "mn.capital",
};
// Capital de trabajo que NO es una fila `capital`: en Bradenton y Havanna Perú es una LÍNEA manual de Cierre y abre celda
// de Presupuestado y de Real (solo ADMIN y FINANZAS); en Plate Silver es un total y no abre celda aunque el tipeo esté prendido.
const CAPITAL_LINEA: Record<string, string> = { bradenton: "bd.capital", "havanna-peru": "hp.capital" };
const CAPITAL_TOTAL = ["plate-silver"];
const TODAS: InterruptoresTipeo = { tipeo: SLUGS, disponibilidades: SLUGS, filasExtra: [] };

const ABIERTO = { abiertas: 1, cerradas: 0 };
const CERRADO = { abiertas: 0, cerradas: 4 };

function vista(slug: string, over: Partial<Parameters<typeof armarVistaTipeo>[0]> = {}) {
  return armarVistaTipeo({
    empresaSlug: slug,
    plantilla: PLANTILLAS_POR_SLUG[slug],
    esAdminOFinanzas: true,
    periodo: "2026-10",
    actual: "2026-10",
    semanas: ABIERTO,
    valoresReales: new Map(),
    ...over,
  });
}

const celdaCapital = (slug: string, over: Partial<Parameters<typeof armarVistaTipeo>[0]> = {}) =>
  vista(slug, over)?.celdas.find((c) => c.id === `${CON_CAPITAL[slug]}|PRESUPUESTADO`);

test("la lista de empresas con Capital de trabajo es la de la plantilla (fila `capital`)", () => {
  const conFilaCapital = SLUGS.filter((s) => PLANTILLAS_POR_SLUG[s].filas.some((f) => f.tipo === "capital")).sort();
  assert.deepEqual(conFilaCapital, Object.keys(CON_CAPITAL).sort());
});

for (const [slug, clave] of Object.entries(CON_CAPITAL)) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];

  test(`${slug}: de Cierre solo se tipea el Presupuestado de ${clave}`, () => {
    const cierre = camposTipeables(plantilla, slug).filter((c) => c.bloque === "CIERRE");
    assert.deepEqual(cierre.map((c) => `${c.clave}|${c.columna}`), [`${clave}|PRESUPUESTADO`]);
  });

  test(`${slug}: ADMIN y FINANZAS reciben la celda de Capital, vacía y sin aviso`, () => {
    // ADMIN y FINANZAS son lo mismo para esta lógica (esAdminOFinanzas).
    const c = celdaCapital(slug);
    assert.ok(c);
    assert.equal(c.columna, "PRESUPUESTADO");
    assert.equal(c.importeInicial, "");
    assert.equal(c.avisoUnaVez, false);
    assert.equal(c.aviso, null);
  });

  test(`${slug}: el gerente no recibe la celda y el servidor rechaza guardarla`, () => {
    assert.equal(vista(slug, { esAdminOFinanzas: false, valoresPresupuesto: new Map([[clave, 100]]) }), null);
    const args = { empresaSlug: slug, plantilla, esAdminOFinanzas: false };
    assert.match(
      motivoRechazoTipeo({ ...args, entradas: [{ filaClave: clave, columna: "PRESUPUESTADO", texto: "1.000,00" }] })!,
      /ADMIN y FINANZAS/
    );
  });

  test(`${slug}: el servidor acepta el Presupuestado del Capital para ADMIN/FINANZAS y rechaza su Real`, () => {
    const args = { empresaSlug: slug, plantilla, esAdminOFinanzas: true };
    assert.equal(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: clave, columna: "PRESUPUESTADO", texto: "1.000,00" }] }), null);
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: clave, columna: "REAL", texto: "1.000,00" }] }));
  });

  test(`${slug}: con valor cargado viaja en formato argentino; sin valor no hay nada guardado`, () => {
    assert.equal(celdaCapital(slug, { valoresPresupuesto: new Map([[clave, 23120000000]]) })!.importeInicial, "231.200.000");
  });

  test(`${slug}: vacío vuelve a la regla de la plantilla`, () => {
    const meses = mesesDePrueba(plantilla);
    const sinCapital = (m: DatosMes): DatosMes => {
      const presupuesto = new Map(m.manuales!.presupuesto);
      presupuesto.delete(clave);
      return { ...m, manuales: { ...m.manuales!, presupuesto } };
    };
    const conCapital = (m: DatosMes): DatosMes => ({
      ...m,
      manuales: { ...m.manuales!, presupuesto: new Map(m.manuales!.presupuesto).set(clave, 123456789) },
    });
    const p = (ms: DatosMes[]) => armarReporte(plantilla, ms, 1).filas.find((f) => f.fila.clave === clave)!.celdas[0].presupuestado;
    assert.equal(p(meses.map(conCapital)), 123456789);
    const regla = p(meses.map(sinCapital));
    const fila = plantilla.filas.find((f) => f.clave === clave)!;
    assert.equal(fila.tipo, "capital");
    if (fila.tipo === "capital" && fila.regla === "manual") {
      assert.equal(regla, null, "Capital manual sin valor: queda vacío");
    } else {
      assert.notEqual(regla, null, "con regla, sin valor tipeado se calcula");
      assert.notEqual(regla, 123456789);
    }
  });

  test(`${slug}: con el Presupuesto VALIDADO el Capital solo se carga una vez; ya cargado no viaja`, () => {
    const vacia = celdaCapital(slug, { presupuestoValidado: true })!;
    assert.equal(vacia.avisoUnaVez, true);
    assert.equal(vacia.aviso, AVISO_PRESUPUESTO_VALIDADO);
    assert.equal(celdaCapital(slug, { presupuestoValidado: true, valoresPresupuesto: new Map([[clave, 100]]) }), undefined);
  });

  test(`${slug}: el mes cerrado no bloquea el Presupuestado del Capital (solo el VALIDADO)`, () => {
    const c = celdaCapital(slug, { periodo: "2026-09", semanas: CERRADO, valoresPresupuesto: new Map([[clave, 100]]) })!;
    assert.equal(c.avisoUnaVez, false);
    assert.equal(c.importeInicial, "1");
  });
}

test("aunque el tipeo esté prendido en todas, de Cierre solo abre el Capital: la fila `capital` (P) y la línea de Bradenton y Havanna Perú (P y R)", () => {
  for (const slug of SLUGS) {
    const esperado = Object.hasOwn(CON_CAPITAL, slug)
      ? [`${CON_CAPITAL[slug]}|PRESUPUESTADO`]
      : Object.hasOwn(CAPITAL_LINEA, slug)
        ? [`${CAPITAL_LINEA[slug]}|PRESUPUESTADO`, `${CAPITAL_LINEA[slug]}|REAL`]
        : [];
    const cierre = camposTipeables(PLANTILLAS_POR_SLUG[slug], slug, TODAS).filter((c) => c.bloque === "CIERRE");
    assert.deepEqual(cierre.map((c) => `${c.clave}|${c.columna}`).sort(), esperado.sort(), slug);
  }
});

test("el Capital de plate-silver (un total), el Disponible y el Saldo no abren celda y el servidor los rechaza", () => {
  for (const slug of CAPITAL_TOTAL) {
    const plantilla = PLANTILLAS_POR_SLUG[slug];
    assert.equal(plantilla.filas.some((f) => f.tipo === "capital"), false, `${slug}: su Capital no es una fila capital`);
    assert.equal(plantilla.filas.find((f) => f.clave.endsWith(".capital"))?.tipo, "total", `${slug}: su Capital es un total`);
    const capital = plantilla.filas.find((f) => f.clave.endsWith(".capital"));
    assert.ok(capital, `${slug}: tiene fila de Capital`);
    const args = { empresaSlug: slug, plantilla, esAdminOFinanzas: true, interruptores: TODAS };
    for (const columna of ["PRESUPUESTADO", "REAL"] as const) {
      assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: capital.clave, columna, texto: "1.000,00" }] }), `${slug} ${columna}`);
    }
  }
  for (const slug of SLUGS) {
    const plantilla = PLANTILLAS_POR_SLUG[slug];
    const abiertas = new Set(camposTipeables(plantilla, slug, TODAS).map((c) => c.clave));
    const args = { empresaSlug: slug, plantilla, esAdminOFinanzas: true, interruptores: TODAS };
    for (const f of plantilla.filas) {
      const esDisponible = f.tipo === "disponible";
      const esSaldo = f.tipo === "total" && f.rol === "saldo";
      if (!esDisponible && !esSaldo) continue;
      assert.equal(abiertas.has(f.clave), false, `${slug}/${f.clave}`);
      for (const columna of ["PRESUPUESTADO", "REAL"] as const) {
        assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: f.clave, columna, texto: "1.000,00" }] }), `${slug}/${f.clave} ${columna}`);
      }
    }
  }
});
