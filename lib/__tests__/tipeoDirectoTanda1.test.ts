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

// `presupuestoPisable`: filas de flujo con Presupuestado derivado que se puede pisar tipeando (pisableConManual); además de su
// Real manual (si lo tienen), abren la celda de Presupuestado.
// `capital`: la fila `capital` de Cierre, de la que se tipea el Presupuestado (Avianor no tiene Capital de trabajo).
const ESPERADO: Record<
  string,
  {
    ingresos: string[];
    egresos: string[];
    abajo: string[];
    disponibilidades: string[];
    presupuestoPisable?: string[];
    capital?: string;
  }
> = {
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
    capital: "fr.capital",
  },
  hwc: {
    // Facturación/Recaudaciones de aerolíneas y los pagos a Globe, Avianca y GOL ya salen de Ejecución por
    // clasificación (COBRANZAS LATAM, WCS, …): quedan fuera del tipeo. Solo Pago LATAM y Pago Flybondi siguen a mano.
    ingresos: ["hw.resultadoFci"],
    egresos: ["hw.expensas", "hw.costoIva"],
    abajo: ["hw.pagoLatam", "hw.pagoFlybondi"],
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
    capital: "hw.capital",
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
  // Mantenor: 7 Real manual de Ingresos + 1 de Egresos (Expensas) + 4 de Disponibilidades (el resto sale de Ejecución o es «Sin Real»).
  mantenor: {
    ingresos: ["mn.otrosClientesJujuy", "mn.otrosClientesTucuman", "mn.msmColumnas", "mn.msmPinturaVial", "mn.traspasoSaldoInicial", "mn.traspasoPrestamoMs", "mn.resultadoFci"],
    egresos: ["mn.expensas"],
    abajo: [],
    disponibilidades: ["mn.dBancoFci", "mn.dEfectivo", "mn.dDolares", "mn.dChequesNegociados", "mn.dReservaSac"],
    presupuestoPisable: ["mn.prestamos"],
    capital: "mn.capital",
  },
  // Radio: 1 Real manual de Ingresos (Resultado FCI) + 2 de Egresos (Expensas, Costo IVA) + 7 de Disponibilidades.
  radio: {
    ingresos: ["ra.resultadoFci"],
    egresos: ["ra.expensas", "ra.costoIva"],
    abajo: [],
    disponibilidades: [
      "ra.dBancoFci",
      "ra.dEfectivo",
      "ra.dChequesEnCartera",
      "ra.dChequesNegociados",
      "ra.dComisionesPendientes",
      "ra.dReservaAguinaldo",
      "ra.dChequesDespuesDel15",
    ],
    capital: "ra.capital",
  },
  // Brillante: 4 Real manual de Ingresos (con Gold Salta) + 2 de Egresos (SAC, Expensas) + 2 de abajo + 11 de Disponibilidades.
  brillante: {
    ingresos: ["br.otrasOperacionesJujuy", "br.goldSalta", "br.resultadoFci", "br.otroMsnt"],
    egresos: ["br.sac", "br.expensas"],
    abajo: ["br.traspasoSaldoInicial", "br.recuperoGastos"],
    disponibilidades: [
      "br.dBancoFci",
      "br.dEfectivo",
      "br.dDolares",
      "br.dReservaIvaAvianor",
      "br.dChequesEnCartera",
      "br.dChequesNegociados",
      "br.dCobranzaMacro",
      "br.dReservaAguinaldo",
      "br.dAdicionalesComisiones",
      "br.dReservaAporteMs",
      "br.dRecuperoBlanqueo",
    ],
    capital: "br.capital",
  },
  // Havanna: 4 Real manual de Ingresos (Cobranzas locales y Acreditación tarjetas, por el neteo de cobranzas) + 2 de Egresos
  // (Tarjetas y Comisiones, Expensas) + 7 de Disponibilidades (incluye Cheques en cartera).
  havanna: {
    ingresos: ["hv.cobranzasLocales", "hv.acreditacionTarjetas", "hv.resultadoFci", "hv.tarjetaNoIngresada"],
    egresos: ["hv.tarjetasComisiones", "hv.expensas"],
    abajo: [],
    disponibilidades: ["hv.dBancoFci", "hv.dEfectivo", "hv.dDolares", "hv.dChequesEnCartera", "hv.dReservaAguinaldo", "hv.dChequesNegociados", "hv.dIngresoBancoMacro"],
    presupuestoPisable: ["hv.acreditacionTarjetas"],
    capital: "hv.capital",
  },
  // Conexión Logística: 1 Real manual de Ingresos + 3 de Egresos (SAC, Expensas, Proveedores IVA) + 1 de abajo + 11 de Disponibilidades.
  // (El alias de testing «conexion-logistica-spp» tiene el tipeo de flujo pero no ve Disponibilidades: 4 celdas, ver tipeoDirecto.test.ts.)
  "conexion-logistica": {
    ingresos: ["cx.resultadoFci"],
    egresos: ["cx.sac", "cx.expensas", "cx.proveedoresIva"],
    abajo: ["cx.dividendosExpensas"],
    disponibilidades: [
      "cx.dBanco",
      "cx.dEfectivo",
      "cx.dDolares",
      "cx.dChequesEnCartera",
      "cx.dChequesNegociados",
      "cx.dCobranzaTechPack",
      "cx.dReservaAguinaldo",
      "cx.dChequesDespuesDel10",
      "cx.dAdicionalesPendientes",
      "cx.dRecuperoBlanqueo",
      "cx.dGastosJps",
    ],
    capital: "cx.capital",
  },
};

// Filas con `sumarManual` (Real = clasificaciones + valor tipeado): exactamente estas, y ninguna más en ninguna plantilla.
const SUMAR_MANUAL: Record<string, string[]> = { brillante: ["br.sac"], "conexion-logistica": ["cx.sac"], "conexion-logistica-spp": ["cx.sac"] };

test("sumarManual: el conjunto de filas con ese mecanismo es exactamente br.sac y cx.sac (conexion-logistica-spp comparte plantilla)", () => {
  for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
    const filas = plantilla.filas
      .filter((f) => f.tipo === "linea" && f.real.tipo === "clasificaciones" && f.real.sumarManual !== undefined)
      .map((f) => f.clave);
    assert.deepEqual(filas, SUMAR_MANUAL[slug] ?? [], slug);
  }
  assert.equal(PLANTILLAS_POR_SLUG["conexion-logistica-spp"], PLANTILLAS_POR_SLUG["conexion-logistica"]);
});

// Flujo + Disponibilidades (+ Presupuestado pisable + Capital de trabajo): Fredy 3 + 9 + 1, HWC 5 + 8 + 1, Avianor 14 + 1,
// Mantenor 8 + 5 + 1 de P + 1, Radio 3 + 7 + 1, Brillante 8 + 11 + 1, Havanna 6 + 7 + 1 de P + 1, Conexión 5 + 11 + 1.
const CANTIDAD: Record<string, number> = {
  "fredy-publicidad": 13,
  hwc: 14,
  avianor: 15,
  mantenor: 15,
  radio: 11,
  brillante: 20,
  havanna: 15,
  "conexion-logistica": 17,
};

const ABIERTO = { abiertas: 1, cerradas: 0 };

for (const slug of Object.keys(ESPERADO)) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const esperado = ESPERADO[slug];

  test(`${slug}: sus campos tipeables son exactamente los esperados (Real manual de flujo y de Disponibilidades, y Presupuestado pisable)`, () => {
    const campos = camposTipeables(plantilla, slug);
    const reales = campos.filter((c) => c.columna === "REAL");
    assert.equal(campos.length, CANTIDAD[slug]);
    // Del Presupuestado, fuera de Cierre, solo las filas con pisableConManual.
    assert.deepEqual(
      campos.filter((c) => c.columna === "PRESUPUESTADO" && c.bloque !== "CIERRE").map((c) => c.clave),
      esperado.presupuestoPisable ?? []
    );
    assert.deepEqual(reales.filter((c) => c.bloque === "INGRESOS").map((c) => c.clave), esperado.ingresos);
    assert.deepEqual(reales.filter((c) => c.bloque === "EGRESOS").map((c) => c.clave), esperado.egresos);
    assert.deepEqual(reales.filter((c) => c.bloque === "ABAJO").map((c) => c.clave), esperado.abajo);
    assert.deepEqual(reales.filter((c) => c.bloque === "DISPONIBILIDADES").map((c) => c.clave), esperado.disponibilidades);
    // De Cierre solo el Presupuestado del Capital de trabajo (nada si la empresa no tiene).
    assert.deepEqual(
      campos.filter((c) => c.bloque === "CIERRE").map((c) => `${c.clave}|${c.columna}`),
      esperado.capital ? [`${esperado.capital}|PRESUPUESTADO`] : []
    );
    assert.equal(campos.some((c) => c.clave.startsWith("extra.")), false);
  });

  test(`${slug}: el Presupuestado (salvo el pisable) y las filas sin Real manual no se tipean`, () => {
    const conSumarManual = plantilla.filas
      .filter((f) => f.tipo === "linea" && f.real.tipo === "clasificaciones" && f.real.sumarManual !== undefined)
      .map((f) => f.clave);
    assert.deepEqual(conSumarManual, SUMAR_MANUAL[slug] ?? [], `${slug}: filas con sumarManual`);
    const tipeables = new Set(camposTipeables(plantilla, slug).map((c) => `${c.clave}|${c.columna}`));
    for (const f of plantilla.filas) {
      if (f.tipo !== "linea") continue;
      assert.equal(
        tipeables.has(`${f.clave}|PRESUPUESTADO`),
        (esperado.presupuestoPisable ?? []).includes(f.clave),
        `${f.clave} Presupuestado`
      );
      // El SAC de Brillante y Conexión suma su Real tipeado (sumarManual): es la ÚNICA excepción, y el conjunto exacto de las
      // filas con ese mecanismo se verifica más abajo, así que otra fila con sumarManual hace fallar este test.
      const tieneSumarManual = f.real.tipo === "clasificaciones" && f.real.sumarManual !== undefined;
      if (f.real.tipo !== "manual" && f.real.tipo !== "manualDesde" && !tieneSumarManual) {
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

// ---- Presupuestado pisable (pisableConManual) en el tipeo directo del Reporte --------------------------------

const PISABLES: [string, string][] = [
  ["mantenor", "mn.prestamos"],
  ["havanna", "hv.acreditacionTarjetas"],
];

for (const [slug, clave] of PISABLES) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const vista = (extra: Partial<Parameters<typeof armarVistaTipeo>[0]> = {}) =>
    armarVistaTipeo({
      empresaSlug: slug,
      plantilla,
      esAdminOFinanzas: true,
      periodo: "2026-10",
      actual: "2026-10",
      semanas: ABIERTO,
      valoresReales: new Map(),
      ...extra,
    });

  test(`${slug}: ADMIN y FINANZAS reciben la celda de Presupuestado de ${clave}`, () => {
    const celda = vista()!.celdas.find((c) => c.id === `${clave}|PRESUPUESTADO`);
    assert.ok(celda);
    assert.equal(celda.importeInicial, "");
    assert.equal(celda.aviso, null);
  });

  test(`${slug}: el gerente no recibe la celda de Presupuestado de ${clave}`, () => {
    assert.equal(vista({ esAdminOFinanzas: false, valoresPresupuesto: new Map([[clave, 100]]) }), null);
    const args = { empresaSlug: slug, plantilla, esAdminOFinanzas: false };
    assert.match(
      motivoRechazoTipeo({ ...args, entradas: [{ filaClave: clave, columna: "PRESUPUESTADO", texto: "1.000,00" }] })!,
      /ADMIN y FINANZAS/
    );
  });

  test(`${slug}: motivoRechazoTipeo acepta el Presupuestado de ${clave} y rechaza el de otra fila de flujo`, () => {
    const args = { empresaSlug: slug, plantilla, esAdminOFinanzas: true };
    assert.equal(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: clave, columna: "PRESUPUESTADO", texto: "1.000,00" }] }), null);
    const otra = plantilla.filas.find(
      (f) => f.tipo === "linea" && f.clave !== clave && f.presupuesto.tipo === "manual" && ["INGRESOS", "EGRESOS", "ABAJO"].includes(f.bloque)
    )!;
    assert.ok(otra, "sanidad: hay otra fila de flujo con Presupuestado manual");
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: otra.clave, columna: "PRESUPUESTADO", texto: "1.000,00" }] }));
  });

  test(`${slug}: con el Presupuesto VALIDADO el Presupuestado de ${clave} solo se carga una vez`, () => {
    const vacia = vista({ presupuestoValidado: true })!.celdas.find((c) => c.id === `${clave}|PRESUPUESTADO`)!;
    assert.equal(vacia.avisoUnaVez, true);
    assert.equal(vacia.aviso, "Presupuesto validado: solo se puede cargar una vez");
    // Ya cargado, no viaja: nadie lo modifica ni lo borra.
    const cargada = vista({ presupuestoValidado: true, valoresPresupuesto: new Map([[clave, 100]]) })!;
    assert.equal(cargada.celdas.some((c) => c.id === `${clave}|PRESUPUESTADO`), false);
    // Sin validar, el valor cargado sí viaja para editarlo.
    const abierta = vista({ valoresPresupuesto: new Map([[clave, 7181520861]]) })!.celdas.find((c) => c.id === `${clave}|PRESUPUESTADO`)!;
    assert.equal(abierta.importeInicial, "71.815.209");
    assert.equal(abierta.avisoUnaVez, false);
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
