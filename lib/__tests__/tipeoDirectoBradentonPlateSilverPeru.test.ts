import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPRESAS_CON_FILAS_EXTRA,
  EMPRESAS_CON_TIPEO_DIRECTO,
  EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE,
} from "@/lib/config";
import { camposManuales } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { armarVistaTipeo, camposTipeables, motivoRechazoTipeo } from "@/lib/reporte/tipeoDirecto";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";

// Tipeo directo del Real en Bradenton, Plate Silver y Havanna Perú (lib/reporte/tipeoDirecto.ts). Las tres tienen TODO el
// Real manual (ninguna fila lee de la Ejecución). Las listas de claves están escritas a mano, a propósito: si una plantilla
// cambia, este test lo avisa. Usan la configuración REAL de lib/config.ts.

const ESPERADO: Record<
  string,
  { disponibilidades: string[]; ingresos: string[]; egresos: string[]; abajo: string[] }
> = {
  bradenton: {
    disponibilidades: ["bd.dBanco", "bd.dEfectivo"],
    ingresos: ["bd.cobranzaClientes", "bd.otrasOperaciones", "bd.ventaPropiedades", "bd.cobroCapitalPrestamos", "bd.prestamo", "bd.otroTc", "bd.otroIngreso"],
    egresos: [
      "bd.chequesDiferidos", "bd.sueldos", "bd.prestamosTarjetas", "bd.adicionales", "bd.impuestos", "bd.impuestoInmobiliario", "bd.expensas",
      "bd.gastosBancarios", "bd.proveedores", "bd.proveedoresIva", "bd.liquidacionesFinales", "bd.juicios", "bd.otroLottery",
    ],
    abajo: ["bd.reembolsosPrestamos", "bd.dividendos", "bd.inversionFoodTruck", "bd.otroAbajo"],
  },
  "plate-silver": {
    disponibilidades: ["ps.dBanco", "ps.dEfectivo", "ps.dChequesEnCartera"],
    ingresos: ["ps.cobranzaClientes", "ps.otrasOperaciones", "ps.ventaPropiedades", "ps.cobroCapitalPrestamos", "ps.prestamo", "ps.otroRetencion", "ps.otroIngreso"],
    egresos: [
      "ps.chequesDiferidos", "ps.sueldos", "ps.impuestos", "ps.prestamosTarjetas", "ps.adicionales", "ps.expensas", "ps.gastosBancarios",
      "ps.proveedores", "ps.proveedoresIva", "ps.liquidacionesFinales", "ps.diferenciaCambio", "ps.otroFondoFijo",
    ],
    abajo: ["ps.reembolsosPrestamos", "ps.dividendos", "ps.otroAbajo"],
  },
  // Havanna Perú ve Disponibilidades desde la segunda tanda de permisos del Real (decisión de Kike): su única fila es el
  // «EFECTIVO DISPONIBLE (principios de mes)».
  "havanna-peru": {
    disponibilidades: ["hp.dEfectivo"],
    ingresos: ["hp.cobranzaClientes", "hp.otrasOperaciones", "hp.ventaPropiedades", "hp.cobroCapitalPrestamos", "hp.prestamo", "hp.devolucionPercepcionIgv", "hp.otroIngreso"],
    egresos: [
      "hp.gratificaciones", "hp.sueldos", "hp.prestamos", "hp.tarjetas", "hp.adicionales", "hp.impuestos", "hp.expensas", "hp.gastosBancarios",
      "hp.proveedores", "hp.regalias", "hp.otroEgreso",
    ],
    abajo: ["hp.importacionHavanna", "hp.solesADolares", "hp.dividendos", "hp.implementacionLocales"],
  },
};
const CANTIDAD: Record<string, number> = { bradenton: 26, "plate-silver": 25, "havanna-peru": 23 };
const SLUGS = Object.keys(ESPERADO);

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

test("config: las tres están en el interruptor de tipeo y en el de filas extra (con permiso de gerente), y las tres ven Disponibilidades", () => {
  for (const slug of SLUGS) {
    assert.ok(EMPRESAS_CON_TIPEO_DIRECTO.includes(slug), slug);
    assert.equal(EMPRESAS_CON_FILAS_EXTRA.includes(slug), true, `${slug} tiene filas extra (a pedido; ver filasExtraGerente.test.ts)`);
  }
  assert.equal(EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes("bradenton"), true);
  assert.equal(EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes("plate-silver"), true);
  assert.equal(EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes("havanna-peru"), true);
});

for (const slug of SLUGS) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const esperado = ESPERADO[slug];

  test(`${slug}: sus campos tipeables son exactamente el Real manual de flujo (y de Disponibilidades si las ve)`, () => {
    const campos = camposTipeables(plantilla, slug);
    assert.equal(campos.length, CANTIDAD[slug]);
    assert.ok(campos.every((c) => c.columna === "REAL"), "solo Real: el Presupuestado se carga en la pantalla de carga");
    assert.deepEqual(campos.filter((c) => c.bloque === "DISPONIBILIDADES").map((c) => c.clave), esperado.disponibilidades);
    assert.deepEqual(campos.filter((c) => c.bloque === "INGRESOS").map((c) => c.clave), esperado.ingresos);
    assert.deepEqual(campos.filter((c) => c.bloque === "EGRESOS").map((c) => c.clave), esperado.egresos);
    assert.deepEqual(campos.filter((c) => c.bloque === "ABAJO").map((c) => c.clave), esperado.abajo);
    assert.equal(campos.some((c) => c.bloque === "CIERRE"), false, "el Capital de trabajo no abre celda");
    assert.equal(campos.some((c) => c.clave.startsWith("extra.")), false);
  });

  test(`${slug}: todo su Real manual de flujo es tipeable y ninguna fila lee el Real de la Ejecución`, () => {
    const tipeables = new Set(camposTipeables(plantilla, slug).map((c) => `${c.clave}|${c.columna}`));
    const deFlujo = camposManuales(plantilla).filter((c) => c.columna === "REAL" && ["INGRESOS", "EGRESOS", "ABAJO"].includes(c.bloque));
    assert.ok(deFlujo.length > 0);
    for (const c of deFlujo) assert.ok(tipeables.has(`${c.clave}|REAL`), c.clave);
    for (const f of plantilla.filas) if (f.tipo === "linea") assert.equal(f.real.tipo, "manual", f.clave);
  });

  test(`${slug}: ADMIN y FINANZAS reciben las celdas; el gerente no recibe nada, con valores cargados`, () => {
    const valores = mesesDePrueba(plantilla)[1].manuales!.real;
    const v = vista(slug, { valoresReales: valores });
    assert.ok(v);
    assert.equal(v.celdas.length, CANTIDAD[slug]);
    assert.equal(vista(slug, { esAdminOFinanzas: false, valoresReales: valores }), null);
    assert.equal(vista(slug, { esAdminOFinanzas: false, valoresReales: valores, semanas: CERRADO }), null);
  });

  test(`${slug}: el servidor acepta el Real de flujo y rechaza al gerente, el Presupuestado, el Capital, la fila extra y la ajena`, () => {
    const clave = esperado.ingresos[0];
    const args = { empresaSlug: slug, plantilla, esAdminOFinanzas: true };
    assert.equal(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: clave, columna: "REAL", texto: "1.000,00" }] }), null);
    assert.match(
      motivoRechazoTipeo({ ...args, esAdminOFinanzas: false, entradas: [{ filaClave: clave, columna: "REAL", texto: "1.000,00" }] })!,
      /ADMIN y FINANZAS/
    );
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: clave, columna: "PRESUPUESTADO", texto: "1.000,00" }] }));
    const capital = plantilla.filas.find((f) => f.clave.endsWith(".capital"))!;
    for (const columna of ["PRESUPUESTADO", "REAL"] as const) {
      assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: capital.clave, columna, texto: "1.000,00" }] }), `Capital ${columna}`);
    }
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: "extra.x", columna: "REAL", texto: "1.000,00" }] }));
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: "no.existe", columna: "REAL", texto: "1.000,00" }] }));
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: "br.sueldos", columna: "REAL", texto: "1.000,00" }] }), "fila de otra empresa");
  });

  // Carga única de bloqueo.ts, sin cambios: un mes pasado sin semanas abiertas admite la PRIMERA carga y nada más.
  test(`${slug}: mes pasado sin semanas abiertas — la celda vacía viaja (carga única) y la ya cargada no viaja`, () => {
    const clave = esperado.egresos[0];
    const pasado = { periodo: "2026-09", actual: "2026-10", semanas: CERRADO };
    const vacia = vista(slug, pasado)!.celdas.find((c) => c.clave === clave)!;
    assert.equal(vacia.avisoUnaVez, true);
    assert.equal(vacia.aviso, "Período cerrado: solo se puede cargar una vez");
    const cargada = vista(slug, { ...pasado, valoresReales: new Map([[clave, 12345]]) })!;
    assert.equal(cargada.celdas.some((c) => c.clave === clave), false);
    // En el mes en curso el valor cargado sí viaja y se puede corregir.
    const enCurso = vista(slug, { valoresReales: new Map([[clave, 12345]]) })!.celdas.find((c) => c.clave === clave)!;
    assert.equal(enCurso.avisoUnaVez, false);
    assert.equal(enCurso.centavos, 12345);
  });
}

test("Bradenton y Plate Silver: sus Disponibilidades se bloquean con semanas cerradas en un mes pasado; Havanna Perú tiene la de Efectivo, con el mismo bloqueo", () => {
  for (const [slug, clave] of [["bradenton", "bd.dBanco"], ["plate-silver", "ps.dBanco"]] as const) {
    const pasado = { periodo: "2026-09", actual: "2026-10", semanas: CERRADO };
    assert.equal(vista(slug, { ...pasado, valoresReales: new Map([[clave, 100]]) })!.celdas.some((c) => c.clave === clave), false, slug);
    assert.equal(vista(slug, pasado)!.celdas.find((c) => c.clave === clave)!.avisoUnaVez, true, slug);
  }
  const peru = vista("havanna-peru")!;
  assert.equal(peru.celdas.some((c) => c.clave === "hp.dEfectivo"), true);
  const pasadoPeru = { periodo: "2026-09", actual: "2026-10", semanas: CERRADO };
  assert.equal(vista("havanna-peru", { ...pasadoPeru, valoresReales: new Map([["hp.dEfectivo", 100]]) })!.celdas.some((c) => c.clave === "hp.dEfectivo"), false);
  assert.equal(
    motivoRechazoTipeo({
      empresaSlug: "havanna-peru",
      plantilla: PLANTILLAS_POR_SLUG["havanna-peru"],
      esAdminOFinanzas: true,
      entradas: [{ filaClave: "hp.dEfectivo", columna: "REAL", texto: "1.000,00" }],
    }),
    null
  );
});
