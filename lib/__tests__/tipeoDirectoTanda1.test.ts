import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPRESAS_CON_FILAS_EXTRA } from "@/lib/config";
import { camposManuales } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { armarVistaTipeo, camposTipeables, motivoRechazoTipeo } from "@/lib/reporte/tipeoDirecto";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";

// Tanda 1 del tipeo directo: Fredy Publicidad, HWC y Avianor. Flujo (Real manual de Ingresos, Egresos y de abajo)
// y, desde la segunda tanda, también Disponibilidades (las ven en solo lectura sus gerentes: ver
// tipeoDirectoDisponibilidades.test.ts). Las filas extra tienen su propio test (filasExtraEmpresas.test.ts). Las listas de claves están escritas a mano, a propósito:
// si una plantilla cambia, este test lo avisa. Usan la configuración REAL de lib/config.ts.

const ESPERADO: Record<string, { ingresos: string[]; egresos: string[]; abajo: string[]; disponibilidades: string[] }> = {
  "fredy-publicidad": {
    ingresos: ["fr.resultadoFci"],
    egresos: ["fr.compraIva", "fr.expensas"],
    abajo: [],
    disponibilidades: [
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
  },
  hwc: {
    ingresos: ["hw.resultadoFci"],
    egresos: ["hw.costoIva"],
    abajo: [],
    disponibilidades: [
      "hw.dBancosFci",
      "hw.dCaja",
      "hw.dTransferenciaSaife",
      "hw.dChequesEnCartera",
      "hw.dChequesPendientes",
      "hw.dDolaresEnCaja",
      "hw.dPrevisionSac",
      "hw.dPagoLatamPendiente",
    ],
  },
  avianor: {
    ingresos: [
      "av.otrasOperaciones",
      "av.ventaPropiedades",
      "av.cobroCapitalPrestamos",
      "av.prestamo",
      "av.aporteMs",
      "av.otroIngreso",
    ],
    egresos: ["av.comisiones", "av.tarjetas", "av.adicionales", "av.expensasNoSocios", "av.otroEgreso"],
    abajo: ["av.reembolsosPrestamos", "av.cuentaParticular", "av.otroAbajo"],
    disponibilidades: ["av.dEfectivo"],
  },
  // Mantenor: 3 Real manual de Ingresos + 1 de Egresos (Expensas) + 4 de Disponibilidades (el resto sale de Ejecución o es «Sin Real»).
  mantenor: {
    ingresos: ["mn.traspasoSaldoInicial", "mn.traspasoPrestamoMs", "mn.resultadoFci"],
    egresos: ["mn.expensas"],
    abajo: [],
    disponibilidades: ["mn.dBancoFci", "mn.dEfectivo", "mn.dDolares", "mn.dChequesNegociados", "mn.dReservaSac"],
  },
};

// Flujo + Disponibilidades: Fredy 3 + 9, HWC 2 + 8, Avianor 14 + 1, Mantenor 4 + 5.
const CANTIDAD: Record<string, number> = { "fredy-publicidad": 12, hwc: 10, avianor: 15, mantenor: 9 };

const ABIERTO = { abiertas: 1, cerradas: 0 };

for (const slug of Object.keys(ESPERADO)) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const esperado = ESPERADO[slug];

  test(`${slug}: sus campos tipeables son exactamente los esperados (Real manual de flujo y de Disponibilidades)`, () => {
    const campos = camposTipeables(plantilla, slug);
    assert.equal(campos.length, CANTIDAD[slug]);
    assert.ok(campos.every((c) => c.columna === "REAL"), "solo la columna Real");
    assert.deepEqual(campos.filter((c) => c.bloque === "INGRESOS").map((c) => c.clave), esperado.ingresos);
    assert.deepEqual(campos.filter((c) => c.bloque === "EGRESOS").map((c) => c.clave), esperado.egresos);
    assert.deepEqual(campos.filter((c) => c.bloque === "ABAJO").map((c) => c.clave), esperado.abajo);
    assert.deepEqual(campos.filter((c) => c.bloque === "DISPONIBILIDADES").map((c) => c.clave), esperado.disponibilidades);
    assert.equal(campos.some((c) => c.bloque === "CIERRE"), false);
    assert.equal(campos.some((c) => c.clave.startsWith("extra.")), false);
  });

  test(`${slug}: el Presupuestado y las filas sin Real manual no se tipean`, () => {
    const tipeables = new Set(camposTipeables(plantilla, slug).map((c) => `${c.clave}|${c.columna}`));
    for (const f of plantilla.filas) {
      if (f.tipo !== "linea") continue;
      assert.equal(tipeables.has(`${f.clave}|PRESUPUESTADO`), false, `${f.clave} Presupuestado`);
      if (f.real.tipo !== "manual") {
        assert.equal(tipeables.has(`${f.clave}|REAL`), false, `${f.clave} Real`);
      }
    }
  });

  // Las tres tienen filas extra (filasExtraEmpresas.test.ts cubre el comportamiento).
  test(`${slug}: tiene filas extra (el interruptor está prendido)`, () => {
    assert.equal(EMPRESAS_CON_FILAS_EXTRA.includes(slug), true);
  });

  test(`${slug}: ADMIN tipea sus Disponibilidades; el servidor las acepta solo en Real`, () => {
    const dispo = esperado.disponibilidades[0];
    const args = { empresaSlug: slug, plantilla, esAdminOFinanzas: true };
    assert.equal(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: dispo, columna: "REAL", texto: "1.000,00" }] }), null);
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: dispo, columna: "PRESUPUESTADO", texto: "1.000,00" }] }));
    const vista = armarVistaTipeo({
      empresaSlug: slug,
      plantilla,
      esAdminOFinanzas: true,
      periodo: "2026-10",
      actual: "2026-10",
      semanas: ABIERTO,
      valoresReales: mesesDePrueba(plantilla)[1].manuales!.real,
    });
    assert.ok(vista);
    assert.equal(vista.celdas.length, CANTIDAD[slug]);
    assert.deepEqual(vista.celdas.filter((c) => c.clave === dispo).length, 1);
  });

  test(`${slug}: el servidor acepta sus celdas de flujo y rechaza Presupuestado, fila extra y fila ajena`, () => {
    const clave = [...esperado.ingresos, ...esperado.egresos, ...esperado.abajo][0];
    const args = { empresaSlug: slug, plantilla, esAdminOFinanzas: true };
    assert.equal(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: clave, columna: "REAL", texto: "1.000,00" }] }), null);
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: clave, columna: "PRESUPUESTADO", texto: "1.000,00" }] }));
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: "extra.x", columna: "REAL", texto: "1.000,00" }] }));
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: "no.existe", columna: "REAL", texto: "1.000,00" }] }));
    assert.match(motivoRechazoTipeo({ ...args, esAdminOFinanzas: false, entradas: [] })!, /ADMIN y FINANZAS/);
  });

  test(`${slug}: el gerente no recibe vista de tipeo, con valores cargados`, () => {
    const v = armarVistaTipeo({
      empresaSlug: slug,
      plantilla,
      esAdminOFinanzas: false,
      periodo: "2026-10",
      actual: "2026-10",
      semanas: ABIERTO,
      valoresReales: mesesDePrueba(plantilla)[1].manuales!.real,
    });
    assert.equal(v, null);
  });
}

test("Avianor: 6 de Ingresos + 5 de Egresos + 3 de abajo + 1 de Disponibilidades; su Presupuestado manual queda fuera del tipeo", () => {
  const plantilla = PLANTILLAS_POR_SLUG["avianor"];
  const campos = camposTipeables(plantilla, "avianor");
  assert.equal(campos.filter((c) => c.bloque === "DISPONIBILIDADES").length, 1);
  assert.deepEqual([6, 5, 3], [
    campos.filter((c) => c.bloque === "INGRESOS").length,
    campos.filter((c) => c.bloque === "EGRESOS").length,
    campos.filter((c) => c.bloque === "ABAJO").length,
  ]);
  const presupuestoManual = camposManuales(plantilla).filter((c) => c.columna === "PRESUPUESTADO");
  assert.equal(presupuestoManual.length, 14);
  assert.deepEqual(
    presupuestoManual.map((c) => c.clave).sort(),
    campos.filter((c) => c.bloque !== "DISPONIBILIDADES").map((c) => c.clave).sort()
  );
});
