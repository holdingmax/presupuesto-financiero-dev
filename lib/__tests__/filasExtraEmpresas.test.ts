import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPRESAS_CON_FILAS_EXTRA, EMPRESAS_CON_TIPEO_DIRECTO, EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE } from "@/lib/config";
import {
  armarReporte,
  clavesCalculables,
  validarPlantilla,
  type DatosMes,
  type Fila,
  type Plantilla,
  type Reporte,
} from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { planDeCarga, vistaDeCarga } from "@/lib/reporte/cargaGerente";
import { admiteFilasExtra, conFilasExtra, type FilaExtra } from "@/lib/reporte/filasExtra";
import { plantillaDeEmpresaConExtras, type LectorFilasExtra } from "@/lib/reporte/plantillaConExtras";
import { armarVistaFilasExtra, ERROR_NO_HABILITADO, validarCreacionFilaExtra } from "@/lib/reporte/accionesFilasExtra";
import { camposTipeables, motivoRechazoTipeo } from "@/lib/reporte/tipeoDirecto";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";
import { CON_FILAS_EXTRA_HOY } from "./filasExtraEmpresasLista";

// Filas extra del Reporte, parametrizado por empresa: Fredy Publicidad, HWC, Avianor, Mantenor, Radio, Havanna y Conexión Logística (Brillante tiene sus tests en
// filasExtra.test.ts y filasExtraAcciones.test.ts). Sumar una empresa es una entrada más en ESPERADO. Las claves y los
// importes están escritos a mano, a propósito. Usan la configuración REAL de lib/config.ts y la lista fijada de
// filasExtraEmpresasLista.ts.
//
// Ojo con el Capital de trabajo: en Fredy y HWC sale de un total de Egresos (Fredy 50% de TOTAL EGRESOS OPERATIVOS,
// HWC 100% del SUBTOTAL ESTRUCTURA), así que una fila extra de EGRESOS lo mueve — decisión confirmada, se deja la
// fórmula como está. Una fila «de abajo» no lo mueve. Avianor no tiene Capital ni Disponible (capital: null): una
// fila extra solo mueve los totales, Disponible antes de gastos y Saldo.

type Esperado = {
  ingresos: string;
  operativos: string;
  egresos: string;
  saldo: string;
  disponibleAntes: string;
  // null = sin Capital de trabajo por fórmula (Avianor no tiene Capital; Mantenor lo tiene manual: ver capitalManual).
  capital: {
    capital: string;
    disponible: string;
    // Parte del Total egresos operativos que entra en el Capital, en centésimos (50% = 50, 100% = 100).
    porcentaje: number;
  } | null;
  // Capital de trabajo MANUAL (Mantenor): no depende de ningún total, las filas extra no lo tocan.
  capitalManual?: { capital: string; disponible: string };
  // Capital de trabajo por FÓRMULA que NO sale de un total de Egresos (Havanna: Sueldos + Expensas + Proveedores/4 +
  // Inversiones/3): las filas extra no lo mueven ni mueven el Disponible.
  capitalIndependiente?: { capital: string; disponible: string };
  // Una fila de la plantilla con ese texto: un nombre así tiene que rechazarse.
  textoExistente: string;
};

const ESPERADO: Record<string, Esperado> = {
  havanna: {
    ingresos: "hv.totalIngresos",
    operativos: "hv.totalEgresosOperativos",
    egresos: "hv.totalEgresos",
    saldo: "hv.saldo",
    disponibleAntes: "hv.disponibleAntes",
    capital: null,
    capitalIndependiente: { capital: "hv.capital", disponible: "hv.disponible" },
    textoExistente: "Proveedores",
  },
  "conexion-logistica": {
    ingresos: "cx.totalIngresos",
    operativos: "cx.totalEgresosOperativos",
    egresos: "cx.totalEgresos",
    saldo: "cx.saldo",
    disponibleAntes: "cx.disponibleAntes",
    capital: { capital: "cx.capital", disponible: "cx.disponible", porcentaje: 50 },
    textoExistente: "Proveedores",
  },
  "conexion-logistica-spp": {
    ingresos: "cx.totalIngresos",
    operativos: "cx.totalEgresosOperativos",
    egresos: "cx.totalEgresos",
    saldo: "cx.saldo",
    disponibleAntes: "cx.disponibleAntes",
    capital: { capital: "cx.capital", disponible: "cx.disponible", porcentaje: 50 },
    textoExistente: "Proveedores",
  },
  "fredy-publicidad": {
    ingresos: "fr.totalIngresos",
    operativos: "fr.totalEgresosOperativos",
    egresos: "fr.totalEgresos",
    saldo: "fr.saldo",
    disponibleAntes: "fr.disponibleAntes",
    capital: { capital: "fr.capital", disponible: "fr.disponible", porcentaje: 50 },
    textoExistente: "COMPRA DE IVA",
  },
  hwc: {
    ingresos: "hw.totalIngresos",
    operativos: "hw.subtotalEstructura",
    egresos: "hw.totalPagado",
    saldo: "hw.saldo",
    disponibleAntes: "hw.disponibleAntes",
    capital: { capital: "hw.capital", disponible: "hw.disponible", porcentaje: 100 },
    textoExistente: "EXPENSAS",
  },
  avianor: {
    ingresos: "av.totalIngresos",
    operativos: "av.totalEgresosOperativos",
    egresos: "av.totalEgresos",
    saldo: "av.saldo",
    disponibleAntes: "av.disponibleAntes",
    capital: null,
    textoExistente: "CUENTA PARTICULAR",
  },
  mantenor: {
    ingresos: "mn.totalIngresos",
    operativos: "mn.totalGastosOperativos",
    egresos: "mn.totalGastos",
    saldo: "mn.saldo",
    disponibleAntes: "mn.disponibleAntes",
    capital: null,
    capitalManual: { capital: "mn.capital", disponible: "mn.disponible" },
    textoExistente: "Proveedores",
  },
  radio: {
    ingresos: "ra.totalIngresos",
    operativos: "ra.totalEgresosOperativos",
    egresos: "ra.totalEgresos",
    saldo: "ra.saldo",
    disponibleAntes: "ra.disponibleAntes",
    capital: { capital: "ra.capital", disponible: "ra.disponible", porcentaje: 50 },
    textoExistente: "Proveedores",
  },
};

const SLUGS = Object.keys(ESPERADO);
const ABIERTO = { abiertas: 1, cerradas: 0 };
const CERRADO = { abiertas: 0, cerradas: 4 };

const ING: FilaExtra = { id: "i1", bloque: "INGRESOS", nombre: "PRÉSTAMO COCOS", desdePeriodo: "2026-10", hastaPeriodo: null };
const EGR: FilaExtra = { id: "e1", bloque: "EGRESOS", nombre: "PAGOS ESPECIALES", desdePeriodo: "2026-10", hastaPeriodo: null };
const ABA: FilaExtra = { id: "a1", bloque: "ABAJO", nombre: "RETIRO SOCIOS", desdePeriodo: "2026-10", hastaPeriodo: null };
const TRES = [ING, EGR, ABA];

const noDebeLeer: LectorFilasExtra = async () => {
  throw new Error("No tiene que consultar la base.");
};

const ROLES_DE_FLUJO = ["totalIngresos", "totalEgresosOperativos", "totalEgresos"];

// La plantilla de ANTES de agregar los roles: la misma, sin los tres roles de flujo.
function sinRolesDeFlujo(p: Plantilla): Plantilla {
  return {
    ...p,
    filas: p.filas.map((f): Fila => {
      if (f.tipo === "total" && f.rol && ROLES_DE_FLUJO.includes(f.rol)) {
        const { rol: _rol, ...resto } = f;
        void _rol;
        return resto;
      }
      return f;
    }),
  };
}

// Todo el Reporte menos el objeto `fila` de la plantilla (que es justo lo que difiere: lleva el rol del total):
// la clave de cada fila y todas sus celdas, el arrastre, los avisos y las listas de meses.
function proyeccion(r: Reporte) {
  return JSON.parse(JSON.stringify({ ...r, filas: r.filas.map((f) => [f.fila.clave, f.fila.tipo, f.celdas]) }));
}

// Datos de dos meses con el Capital por FÓRMULA (sin Capital tipeado, que lo reemplazaría) y sin filas extra. Sin
// Capital en la empresa (Avianor), los datos de prueba tal cual.
function mesesSinCapitalManual(slug: string): DatosMes[] {
  const meses = mesesDePrueba(PLANTILLAS_POR_SLUG[slug]);
  const cap = ESPERADO[slug].capital ?? ESPERADO[slug].capitalIndependiente;
  if (!cap) return meses;
  const presupuesto = new Map(meses[1].manuales!.presupuesto);
  presupuesto.delete(cap.capital);
  return [meses[0], { ...meses[1], manuales: { presupuesto, real: meses[1].manuales!.real } }];
}

// Real: ingreso 5.000, egreso 2.000, de abajo −700 (un recupero: baja los egresos). Presupuestado: 3.000 / 1.500 / −400.
function conImportesExtra(meses: DatosMes[], cuales: string[]): DatosMes[] {
  const real = new Map(meses[1].manuales!.real);
  const presupuesto = new Map(meses[1].manuales!.presupuesto);
  const todos: [string, number, number][] = [["extra.i1", 5000, 3000], ["extra.e1", 2000, 1500], ["extra.a1", -700, -400]];
  for (const [k, r, p] of todos.filter(([k]) => cuales.includes(k))) {
    real.set(k, r);
    presupuesto.set(k, p);
  }
  return [meses[0], { ...meses[1], manuales: { presupuesto, real } }];
}

const celda = (r: Reporte, clave: string) => r.filas.find((f) => f.fila.clave === clave)!.celdas[0];

// ---- Configuración -------------------------------------------------------------------------------

test("config: las empresas de este archivo están en filas extra y en tipeo directo; las demás, afuera", () => {
  // La lista fijada es Brillante + las de ESPERADO: ninguna queda sin probar acá ni sobra una entrada.
  assert.deepEqual([...CON_FILAS_EXTRA_HOY].filter((s) => s !== "brillante").sort(), [...SLUGS].sort());
  assert.deepEqual([...EMPRESAS_CON_FILAS_EXTRA], [...CON_FILAS_EXTRA_HOY]);
  for (const slug of SLUGS) {
    assert.ok(EMPRESAS_CON_FILAS_EXTRA.includes(slug), slug);
    assert.ok(EMPRESAS_CON_TIPEO_DIRECTO.includes(slug), slug);
  }
  // «Afuera» se deriva del interruptor: todas las demás plantillas, sin una lista a mano.
  const fuera = Object.keys(PLANTILLAS_POR_SLUG).filter((s) => !EMPRESAS_CON_FILAS_EXTRA.includes(s));
  assert.ok(fuera.length > 0, "sanidad: el recorrido no está vacío");
  for (const slug of fuera) assert.equal(EMPRESAS_CON_FILAS_EXTRA.includes(slug), false, slug);
});

// ---- Antes / después de agregar los roles, sin filas extra ---------------------------------------

for (const slug of SLUGS) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const esperado = ESPERADO[slug];
  const cap = esperado.capital;
  const antes = sinRolesDeFlujo(plantilla);

  test(`${slug}: la plantilla solo difiere de la de antes en los tres roles de total`, () => {
    const conRol = plantilla.filas.filter((f) => f.tipo === "total" && f.rol && ROLES_DE_FLUJO.includes(f.rol));
    assert.deepEqual(
      conRol.map((f) => [f.clave, (f as { rol: string }).rol]),
      [
        [esperado.ingresos, "totalIngresos"],
        [esperado.operativos, "totalEgresosOperativos"],
        [esperado.egresos, "totalEgresos"],
      ]
    );
    assert.equal(antes.filas.some((f) => f.tipo === "total" && f.rol && ROLES_DE_FLUJO.includes(f.rol)), false);
    assert.deepEqual(validarPlantilla(plantilla), []);
    assert.equal(admiteFilasExtra(plantilla), true);
    assert.equal(admiteFilasExtra(antes), false, "sin los roles no admitía filas extra");
  });

  test(`${slug}: SIN filas extra el Reporte es idéntico al de antes de agregar los roles (ADMIN, gerente y carga)`, () => {
    const juegos: DatosMes[][] = [mesesDePrueba(plantilla), mesesSinCapitalManual(slug)];
    // Y un par de meses sin ningún valor manual.
    juegos.push(juegos[0].map((m) => ({ ...m, manuales: { presupuesto: new Map(), real: new Map() } })));
    for (const meses of juegos) {
      for (const acceso of [true, accesoReservadosDelReporte(false, slug), false] as const) {
        assert.deepEqual(
          proyeccion(armarReporte(plantilla, meses, 1, { verBloquesReservados: acceso })),
          proyeccion(armarReporte(antes, meses, 1, { verBloquesReservados: acceso })),
          `${slug} acceso=${JSON.stringify(acceso)}`
        );
      }
    }
    // Con tabla vacía el resolver devuelve la MISMA plantilla (misma referencia).
    assert.equal(conFilasExtra(plantilla, []), plantilla);
    // La carga del Presupuestado del gerente tampoco cambia.
    assert.deepEqual(vistaDeCarga(planDeCarga(plantilla, [], [])), vistaDeCarga(planDeCarga(antes, [], [])));
  });

  test(`${slug}: el arrastre y el «cuadra» no cambian sin filas extra`, () => {
    const meses = mesesDePrueba(plantilla);
    assert.deepEqual(armarReporte(plantilla, meses, 1).arrastre, armarReporte(antes, meses, 1).arrastre);
  });

  // ---- Con filas extra ---------------------------------------------------------------------------

  test(`${slug}: cada fila extra va antes del total de su bloque y el total la suma`, () => {
    const p = conFilasExtra(plantilla, TRES);
    assert.deepEqual(validarPlantilla(p), []);
    assert.equal(new Set(p.filas.map((f) => f.clave)).size, p.filas.length);
    const idx = (clave: string) => p.filas.findIndex((f) => f.clave === clave);
    assert.equal(idx("extra.i1") + 1, idx(esperado.ingresos));
    assert.equal(idx("extra.e1") + 1, idx(esperado.operativos));
    assert.equal(idx("extra.a1") + 1, idx(esperado.egresos));
    const suma = (clave: string) => (p.filas[idx(clave)] as { suma: string[] }).suma;
    assert.ok(suma(esperado.ingresos).includes("extra.i1"));
    assert.ok(suma(esperado.operativos).includes("extra.e1") && !suma(esperado.operativos).includes("extra.a1"));
    assert.ok(suma(esperado.egresos).includes("extra.a1") && suma(esperado.egresos).includes(esperado.operativos));
    // La plantilla estática no se tocó.
    assert.equal(plantilla.filas.some((f) => f.clave.startsWith("extra.")), false);
  });

  test(`${slug}: los totales suman las filas extra con el signo del bloque`, () => {
    const sin = mesesSinCapitalManual(slug);
    const con = conImportesExtra(sin, ["extra.i1", "extra.e1", "extra.a1"]);
    const antesR = armarReporte(plantilla, sin, 1);
    const despuesR = armarReporte(conFilasExtra(plantilla, TRES), con, 1);
    // [ingreso, egreso, de abajo] por columna.
    const importes = { real: [5000, 2000, -700], presupuestado: [3000, 1500, -400] } as const;
    for (const col of ["real", "presupuestado"] as const) {
      const [i, e, a] = importes[col];
      assert.equal(celda(despuesR, esperado.ingresos)[col]! - celda(antesR, esperado.ingresos)[col]!, i, `ingresos ${col}`);
      assert.equal(celda(despuesR, esperado.operativos)[col]! - celda(antesR, esperado.operativos)[col]!, e, `operativos ${col}`);
      assert.equal(celda(despuesR, esperado.egresos)[col]! - celda(antesR, esperado.egresos)[col]!, e + a, `egresos ${col}`);
      assert.equal(celda(despuesR, esperado.disponibleAntes)[col]! - celda(antesR, esperado.disponibleAntes)[col]!, i, `antes de gastos ${col}`);
      assert.equal(celda(despuesR, esperado.saldo)[col]! - celda(antesR, esperado.saldo)[col]!, i - (e + a), `saldo ${col}`);
    }
    // Un negativo en «de abajo» se muestra tal cual y baja los egresos.
    assert.equal(celda(despuesR, "extra.a1").real, -700);
  });

  if (cap) test(`${slug}: una fila extra de EGRESOS mueve el Capital (${cap.porcentaje}%) y el Disponible; una «de abajo» no`, () => {
    const sin = mesesSinCapitalManual(slug);
    const antesR = armarReporte(plantilla, sin, 1);
    // Presupuestado del egreso extra: 1.500 → el Capital sube 1.500 × porcentaje, el Disponible baja lo mismo.
    const conEgreso = armarReporte(conFilasExtra(plantilla, [EGR]), conImportesExtra(sin, ["extra.e1"]), 1);
    const subida = (1500 * cap.porcentaje) / 100;
    assert.equal(celda(conEgreso, cap.capital).presupuestado! - celda(antesR, cap.capital).presupuestado!, subida, "capital");
    assert.equal(celda(antesR, cap.disponible).presupuestado! - celda(conEgreso, cap.disponible).presupuestado!, subida, "disponible");
    // El Capital no tiene Real.
    assert.equal(celda(conEgreso, cap.capital).real, null);
    // Una fila «de abajo» o de ingresos no toca ni el Capital ni el Disponible.
    for (const extra of [ABA, ING]) {
      const k = extra.bloque === "ABAJO" ? "extra.a1" : "extra.i1";
      const r = armarReporte(conFilasExtra(plantilla, [extra]), conImportesExtra(sin, [k]), 1);
      assert.deepEqual(celda(r, cap.capital), celda(antesR, cap.capital), `${k} capital`);
      assert.deepEqual(celda(r, cap.disponible), celda(antesR, cap.disponible), `${k} disponible`);
    }
    // Un Capital tipeado a mano reemplaza la fórmula: no se mueve con las filas extra.
    const manual = mesesDePrueba(plantilla);
    const valorManual = manual[1].manuales!.presupuesto.get(cap.capital)!;
    const r = armarReporte(conFilasExtra(plantilla, [EGR]), conImportesExtra(manual, ["extra.e1"]), 1);
    assert.equal(celda(r, cap.capital).presupuestado, valorManual);
  });

  if (esperado.capitalIndependiente) test(`${slug}: Capital por fórmula que no sale de un total de Egresos: las filas extra no lo mueven ni mueven el Disponible`, () => {
    const ci = esperado.capitalIndependiente!;
    const sin = mesesSinCapitalManual(slug);
    const antesR = armarReporte(plantilla, sin, 1);
    assert.ok(celda(antesR, ci.capital).presupuestado !== null, "sanidad: el Capital por fórmula tiene valor");
    const conExtras = armarReporte(conFilasExtra(plantilla, TRES), conImportesExtra(sin, ["extra.i1", "extra.e1", "extra.a1"]), 1);
    assert.deepEqual(celda(conExtras, ci.capital), celda(antesR, ci.capital), "capital");
    assert.deepEqual(celda(conExtras, ci.disponible), celda(antesR, ci.disponible), "disponible");
    assert.equal(celda(conExtras, esperado.ingresos).real! - celda(antesR, esperado.ingresos).real!, 5000);
  });

  // Sin Capital ni Disponible: las filas extra no los crean ni mueven las Disponibilidades.
  if (esperado.capitalManual) test(`${slug}: Capital manual: las filas extra no mueven ni el Capital ni el Disponible, con o sin Capital tipeado`, () => {
    const cm = esperado.capitalManual!;
    const TODAS = ["extra.i1", "extra.e1", "extra.a1"];
    const base = mesesDePrueba(plantilla);
    const presupuestoSin = new Map(base[1].manuales!.presupuesto);
    presupuestoSin.delete(cm.capital);
    const sin = [base[0], { ...base[1], manuales: { presupuesto: presupuestoSin, real: base[1].manuales!.real } }];
    // Con Capital tipeado a mano (6.000) y sin él.
    const conCapital = [sin[0], { ...sin[1], manuales: { presupuesto: new Map(sin[1].manuales!.presupuesto).set(cm.capital, 600000), real: sin[1].manuales!.real } }];
    for (const meses of [sin, conCapital]) {
      const antesR = armarReporte(plantilla, meses, 1);
      const conExtras = armarReporte(conFilasExtra(plantilla, TRES), conImportesExtra(meses, TODAS), 1);
      assert.deepEqual(celda(conExtras, cm.capital), celda(antesR, cm.capital), "capital");
      assert.deepEqual(celda(conExtras, cm.disponible), celda(antesR, cm.disponible), "disponible");
      assert.equal(celda(conExtras, cm.capital).presupuestado, meses === sin ? null : 600000);
      assert.equal(celda(conExtras, cm.capital).real, null);
      // Las Disponibilidades tampoco se mueven.
      for (const f of plantilla.filas.filter((x) => x.bloque === "DISPONIBILIDADES" && x.tipo !== "titulo")) {
        assert.deepEqual(celda(conExtras, f.clave), celda(antesR, f.clave), f.clave);
      }
    }
    // Los totales de flujo y el Saldo SÍ se mueven (las filas suman).
    const antesR = armarReporte(plantilla, conCapital, 1);
    const conExtras = armarReporte(conFilasExtra(plantilla, TRES), conImportesExtra(conCapital, TODAS), 1);
    assert.equal(celda(conExtras, esperado.ingresos).real! - celda(antesR, esperado.ingresos).real!, 5000);
  });

  if (!cap && !esperado.capitalManual && !esperado.capitalIndependiente) test(`${slug}: sin Capital ni Disponible: las filas extra no los crean y las Disponibilidades no se mueven`, () => {
    const sin = mesesSinCapitalManual(slug);
    const antesR = armarReporte(plantilla, sin, 1);
    const conExtras = armarReporte(conFilasExtra(plantilla, TRES), conImportesExtra(sin, ["extra.i1", "extra.e1", "extra.a1"]), 1);
    const sinCapital = (r: Reporte) => r.filas.every((f) => f.fila.tipo !== "capital" && f.fila.tipo !== "disponible");
    assert.equal(sinCapital(antesR) && sinCapital(conExtras), true);
    assert.ok(conExtras.arrastre.every((x) => x === null), "sin control de arrastre");
    // Las filas de Disponibilidades quedan idénticas.
    const dispo = plantilla.filas.filter((x) => x.bloque === "DISPONIBILIDADES" && x.tipo === "linea");
    assert.ok(dispo.length > 0, "sanidad: hay filas de Disponibilidades");
    for (const f of dispo) assert.deepEqual(celda(conExtras, f.clave), celda(antesR, f.clave), f.clave);
  });

  test(`${slug}: el gerente ve las filas extra en solo lectura, con sus totales y con el Cierre en solo lectura`, () => {
    const p = conFilasExtra(plantilla, TRES);
    const acceso = accesoReservadosDelReporte(false, slug);
    for (const k of ["extra.i1", "extra.e1", "extra.a1"]) assert.equal(clavesCalculables(p, acceso).has(k), true, k);
    const r = armarReporte(p, conImportesExtra(mesesDePrueba(plantilla), ["extra.i1", "extra.e1", "extra.a1"]), 1, { verBloquesReservados: acceso });
    assert.equal(celda(r, "extra.i1").real, 5000);
    assert.equal(celda(r, "extra.i1").presupuestado, 3000);
    // Del Cierre trae al menos el Saldo y nunca «Disponible antes de gastos».
    const cierre = r.filas.filter((f) => f.fila.bloque === "CIERRE").map((f) => f.fila.clave);
    // (El alias de testing «conexion-logistica-spp» no está en los interruptores de Cierre: su gerente no ve ninguna fila de Cierre.)
    assert.ok(EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE.includes(slug) ? cierre.length > 0 : cierre.length === 0, cierre.join());
    assert.ok(cierre.every((k) => !k.endsWith("disponibleAntes")), cierre.join());
    assert.ok(r.arrastre.every((a) => a === null));
    // La vista de pantalla de las filas extra es solo para ADMIN y FINANZAS.
    const vista = (esAdminOFinanzas: boolean) =>
      armarVistaFilasExtra({
        empresaSlug: slug,
        plantillaEstatica: plantilla,
        plantillaReporte: p,
        esAdminOFinanzas,
        periodo: "2026-10",
        actual: "2026-10",
        semanas: ABIERTO,
        clavesConValores: new Set(),
      });
    assert.equal(vista(false), null);
    assert.deepEqual(vista(true), { bloques: ["INGRESOS", "EGRESOS", "ABAJO"], borrables: ["extra.i1", "extra.e1", "extra.a1"] });
    // En un mes bloqueado no hay botones de agregar.
    const cerrado = armarVistaFilasExtra({
      empresaSlug: slug,
      plantillaEstatica: plantilla,
      plantillaReporte: p,
      esAdminOFinanzas: true,
      periodo: "2026-08",
      actual: "2026-10",
      semanas: CERRADO,
      clavesConValores: new Set(),
    })!;
    assert.deepEqual(cerrado.bloques, []);
  });

  test(`${slug}: crear una fila funciona con la configuración real; el nombre de una fila existente se rechaza`, () => {
    const crear = (nombre: string, bloque = "INGRESOS") =>
      validarCreacionFilaExtra({
        empresaSlug: slug,
        plantilla,
        esAdminOFinanzas: true,
        bloque,
        nombre,
        extras: [],
        periodo: "2026-10",
        actual: "2026-10",
        semanas: ABIERTO,
      });
    for (const bloque of ["INGRESOS", "EGRESOS", "ABAJO"]) {
      assert.deepEqual(crear("  préstamo   cocos ", bloque), { ok: true, bloque, nombre: "PRÉSTAMO COCOS", nombreClave: "PRESTAMO COCOS" });
    }
    assert.equal(crear(esperado.textoExistente).ok, false);
    assert.equal(crear("otros").ok, false, "nombre genérico");
    assert.equal(
      validarCreacionFilaExtra({ empresaSlug: slug, plantilla, esAdminOFinanzas: false, bloque: "INGRESOS", nombre: "PRÉSTAMO COCOS", extras: [], periodo: "2026-10", actual: "2026-10", semanas: ABIERTO }).ok,
      false,
      "el gerente no crea"
    );
  });

  test(`${slug}: el tipeo directo acepta Presupuestado y Real de sus filas extra y rechaza lo demás`, () => {
    const p = conFilasExtra(plantilla, TRES);
    const campos = camposTipeables(p, slug).map((c) => `${c.clave}|${c.columna}`);
    for (const k of ["extra.i1", "extra.e1", "extra.a1"]) {
      assert.ok(campos.includes(`${k}|REAL`) && campos.includes(`${k}|PRESUPUESTADO`), k);
    }
    // El Presupuestado de las filas de la plantilla no se tipea desde acá.
    assert.equal(campos.some((k) => !k.startsWith("extra.") && k.endsWith("|PRESUPUESTADO")), false);
    const args = { empresaSlug: slug, plantilla: p, esAdminOFinanzas: true };
    for (const columna of ["REAL", "PRESUPUESTADO"] as const) {
      assert.equal(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: "extra.e1", columna, texto: "1.000,00" }] }), null);
    }
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: "extra.zzz", columna: "REAL", texto: "1" }] }), "fila extra que no existe");
    assert.ok(motivoRechazoTipeo({ ...args, entradas: [{ filaClave: esperado.ingresos, columna: "REAL", texto: "1" }] }), "total");
    assert.match(motivoRechazoTipeo({ ...args, esAdminOFinanzas: false, entradas: [] })!, /ADMIN y FINANZAS/);
  });
}

// ---- Las que siguen afuera -----------------------------------------------------------------------

test("las empresas fuera del interruptor de filas extra no consultan la base ni pueden crear filas", async () => {
  const fuera = Object.keys(PLANTILLAS_POR_SLUG).filter((s) => !EMPRESAS_CON_FILAS_EXTRA.includes(s));
  assert.ok(fuera.length > 0, "sanidad: el recorrido no está vacío");
  for (const slug of fuera) {
    assert.equal(await plantillaDeEmpresaConExtras("e", slug, "2026-10", { leer: noDebeLeer }), PLANTILLAS_POR_SLUG[slug], slug);
    const alta = validarCreacionFilaExtra({
      empresaSlug: slug,
      plantilla: PLANTILLAS_POR_SLUG[slug],
      esAdminOFinanzas: true,
      bloque: "INGRESOS",
      nombre: "PRÉSTAMO COCOS",
      extras: [],
      periodo: "2026-10",
      actual: "2026-10",
      semanas: ABIERTO,
    });
    assert.deepEqual(alta, { ok: false, error: ERROR_NO_HABILITADO }, slug);
  }
});

test("con el interruptor prendido y la tabla vacía, estas empresas devuelven la MISMA plantilla; con filas, solo las que ya empezaron", async () => {
  for (const slug of SLUGS) {
    const base = PLANTILLAS_POR_SLUG[slug];
    assert.equal(await plantillaDeEmpresaConExtras("e", slug, "2026-10", { leer: async () => [] }), base);
    const futura: FilaExtra = { ...ING, id: "f1", desdePeriodo: "2026-11" };
    const p = await plantillaDeEmpresaConExtras("e", slug, "2026-10", { leer: async () => [ING, futura] });
    assert.equal(p!.filas.some((f) => f.clave === "extra.i1"), true);
    assert.equal(p!.filas.some((f) => f.clave === "extra.f1"), false);
  }
});
