import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPRESAS_CON_FILAS_EXTRA, EMPRESAS_CON_TIPEO_DIRECTO } from "@/lib/config";
import { armarReporte, camposManuales, esBloqueReservado, type DatosMes, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { planDeCarga, vistaDeCarga } from "@/lib/reporte/cargaGerente";
import { AVISO_UNA_VEZ } from "@/lib/reporte/bloqueo";
import { admiteFilasExtra, conFilasExtra, type FilaExtra } from "@/lib/reporte/filasExtra";
import { plantillaDeEmpresaConExtras } from "@/lib/reporte/plantillaConExtras";
import {
  armarVistaFilasExtra,
  decidirBorradoFilaExtra,
  ERROR_FILA_CON_VALORES,
  ERROR_NO_HABILITADO,
  ERROR_SOLO_ADMIN,
  validarCreacionFilaExtra,
  type InterruptoresFilasExtra,
} from "@/lib/reporte/accionesFilasExtra";
import {
  armarVistaTipeo,
  AVISO_PRESUPUESTO_VALIDADO,
  camposTipeables,
  motivoRechazoTipeo,
  type InterruptoresTipeo,
} from "@/lib/reporte/tipeoDirecto";
import { CENTINELA, clavesDeCierre, mesesDePrueba, sinCierre } from "@/lib/reporte/__tests__/fixtures/datosGerente";
import { CON_FILAS_EXTRA_HOY } from "./filasExtraEmpresasLista";

// Tanda 2 de las filas extra: crear y borrar (reglas puras de las acciones), tipeo directo de Presupuestado y Real
// en las filas extra, y lo que recibe la pantalla. La base y el render no se prueban acá: las acciones consultan
// la base y le pasan lo leído a estas funciones, que son las que deciden.

const SLUGS = Object.keys(PLANTILLAS_POR_SLUG);
const BRILLANTE = PLANTILLAS_POR_SLUG["brillante"];
// Una plantilla que NO marca los totales de flujo (Plate Silver): no admite filas extra.
const SIN_ROLES = PLANTILLAS_POR_SLUG["plate-silver"];

const ING: FilaExtra = { id: "i1", bloque: "INGRESOS", nombre: "PRÉSTAMO COCOS", desdePeriodo: "2026-10", hastaPeriodo: null };
const EGR: FilaExtra = { id: "e1", bloque: "EGRESOS", nombre: "PAGOS ESPECIALES", desdePeriodo: "2026-10", hastaPeriodo: null };
const ABA: FilaExtra = { id: "a1", bloque: "ABAJO", nombre: "RETIRO SOCIOS", desdePeriodo: "2026-10", hastaPeriodo: null };
const CON_EXTRAS = conFilasExtra(BRILLANTE, [ING, EGR, ABA]);

const ABIERTO = { abiertas: 1, cerradas: 0 };
const CERRADO = { abiertas: 0, cerradas: 4 };
const ENCENDIDO: InterruptoresFilasExtra = { filasExtra: ["brillante"], tipeo: ["brillante"] };
const APAGADO: InterruptoresFilasExtra = { filasExtra: [], tipeo: ["brillante"] };
const TIPEO: InterruptoresTipeo = { tipeo: ["brillante"], disponibilidades: ["brillante"], filasExtra: ["brillante"] };
const TIPEO_SIN_EXTRAS: InterruptoresTipeo = { ...TIPEO, filasExtra: [] };

// ---- Interruptor ------------------------------------------------------------------------------------

test("interruptor: la lista fijada, subconjunto del tipeo directo y con los totales marcados en su plantilla", () => {
  assert.ok(EMPRESAS_CON_FILAS_EXTRA.includes("brillante"));
  assert.deepEqual([...EMPRESAS_CON_FILAS_EXTRA], [...CON_FILAS_EXTRA_HOY]);
  for (const slug of EMPRESAS_CON_FILAS_EXTRA) {
    assert.ok(EMPRESAS_CON_TIPEO_DIRECTO.includes(slug), slug);
    assert.equal(admiteFilasExtra(PLANTILLAS_POR_SLUG[slug]), true, slug);
  }
});

// ---- Crear ------------------------------------------------------------------------------------------

function crear(over: Partial<Parameters<typeof validarCreacionFilaExtra>[0]> = {}) {
  return validarCreacionFilaExtra({
    empresaSlug: "brillante",
    plantilla: BRILLANTE,
    esAdminOFinanzas: true,
    bloque: "INGRESOS",
    nombre: "  préstamo   cocos ",
    extras: [],
    periodo: "2026-10",
    actual: "2026-10",
    semanas: ABIERTO,
    interruptores: ENCENDIDO,
    ...over,
  });
}

test("crear: ADMIN o FINANZAS, empresa del interruptor, mes abierto y nombre bueno — queda normalizado", () => {
  assert.deepEqual(crear(), { ok: true, bloque: "INGRESOS", nombre: "PRÉSTAMO COCOS", nombreClave: "PRESTAMO COCOS" });
  for (const bloque of ["INGRESOS", "EGRESOS", "ABAJO"]) assert.equal(crear({ bloque }).ok, true, bloque);
});

test("crear: el gerente es rechazado, con cualquier dato", () => {
  assert.deepEqual(crear({ esAdminOFinanzas: false }), { ok: false, error: ERROR_SOLO_ADMIN });
  assert.equal(crear({ esAdminOFinanzas: false, bloque: "nada", nombre: 3 }).ok, false);
});

test("crear: empresa fuera del interruptor, sin tipeo directo o sin totales marcados", () => {
  assert.deepEqual(crear({ interruptores: APAGADO }), { ok: false, error: ERROR_NO_HABILITADO });
  assert.deepEqual(crear({ interruptores: { filasExtra: ["brillante"], tipeo: [] } }), { ok: false, error: ERROR_NO_HABILITADO });
  assert.deepEqual(
    crear({ empresaSlug: "plate-silver", plantilla: SIN_ROLES, interruptores: { filasExtra: ["plate-silver"], tipeo: ["plate-silver"] } }),
    { ok: false, error: ERROR_NO_HABILITADO }
  );
});

test("crear: bloque que no es uno de los tres, o período inválido", () => {
  for (const bloque of ["", "CIERRE", "DISPONIBILIDADES", "ingresos", null, undefined, 1]) {
    assert.equal(crear({ bloque }).ok, false, String(bloque));
  }
  for (const periodo of ["", "2026-13", "2026-1", "abc", "2026-10-01"]) assert.equal(crear({ periodo }).ok, false, periodo);
});

test("crear: solo en un mes con el flujo no bloqueado (sin override)", () => {
  const cerrado = crear({ periodo: "2026-08", actual: "2026-10", semanas: CERRADO });
  assert.equal(cerrado.ok, false);
  assert.match((cerrado as { error: string }).error, /No se pueden agregar filas en este mes/);
  // Un mes pasado con semanas abiertas, el actual y los futuros sí.
  assert.equal(crear({ periodo: "2026-08", semanas: { abiertas: 2, cerradas: 1 } }).ok, true);
  assert.equal(crear({ periodo: "2026-10", semanas: CERRADO }).ok, true);
  assert.equal(crear({ periodo: "2026-12", semanas: { abiertas: 0, cerradas: 0 } }).ok, true);
});

test("crear: nombres genéricos, de una fila que ya existe y de otra fila extra se rechazan; categorías sin fila, no", () => {
  for (const nombre of ["otro", "OTROS", "varios", "Sueldos", "Resultado FCI", "gastos bancarios"]) {
    assert.equal(crear({ nombre }).ok, false, nombre);
  }
  assert.equal(crear({ nombre: "préstamo cocos", extras: [ING] }).ok, false);
  assert.equal(crear({ bloque: "ABAJO", nombre: "retiro socios", extras: [ING, ABA] }).ok, false);
  for (const nombre of ["Préstamo Cocos", "Pagos especiales"]) assert.equal(crear({ nombre }).ok, true, nombre);
  assert.equal(crear({ nombre: "" }).ok, false);
  assert.equal(crear({ nombre: 12 }).ok, false);
});

// ---- Borrar -----------------------------------------------------------------------------------------

function borrar(over: Partial<Parameters<typeof decidirBorradoFilaExtra>[0]> = {}) {
  return decidirBorradoFilaExtra({
    empresaSlug: "brillante",
    plantilla: BRILLANTE,
    esAdminOFinanzas: true,
    existe: true,
    cantidadDeValores: 0,
    interruptores: ENCENDIDO,
    ...over,
  });
}

test("borrar: solo si la fila existe y no tiene ningún valor", () => {
  assert.deepEqual(borrar(), { ok: true });
  assert.deepEqual(borrar({ cantidadDeValores: 1 }), { ok: false, error: ERROR_FILA_CON_VALORES });
  assert.deepEqual(borrar({ cantidadDeValores: 40 }), { ok: false, error: ERROR_FILA_CON_VALORES });
  assert.equal(borrar({ existe: false }).ok, false);
});

test("borrar: el gerente y las empresas fuera del interruptor son rechazados", () => {
  assert.deepEqual(borrar({ esAdminOFinanzas: false }), { ok: false, error: ERROR_SOLO_ADMIN });
  assert.deepEqual(borrar({ interruptores: APAGADO }), { ok: false, error: ERROR_NO_HABILITADO });
});

// ---- Qué recibe la pantalla (botones y borrado) ------------------------------------------------------

function vistaFilas(over: Partial<Parameters<typeof armarVistaFilasExtra>[0]> = {}) {
  return armarVistaFilasExtra({
    empresaSlug: "brillante",
    plantillaEstatica: BRILLANTE,
    plantillaReporte: CON_EXTRAS,
    esAdminOFinanzas: true,
    periodo: "2026-10",
    actual: "2026-10",
    semanas: ABIERTO,
    clavesConValores: new Set(),
    interruptores: ENCENDIDO,
    ...over,
  });
}

test("pantalla: ADMIN ve «Agregar una fila» en los tres bloques y puede borrar las filas sin valores", () => {
  assert.deepEqual(vistaFilas(), { bloques: ["INGRESOS", "EGRESOS", "ABAJO"], borrables: ["extra.i1", "extra.e1", "extra.a1"] });
});

test("pantalla: una fila con algún valor (en cualquier mes) no se puede borrar", () => {
  assert.deepEqual(vistaFilas({ clavesConValores: new Set(["extra.e1"]) })!.borrables, ["extra.i1", "extra.a1"]);
});

test("pantalla: en un mes bloqueado no hay botones de agregar, pero las filas sin valores se pueden borrar", () => {
  const v = vistaFilas({ periodo: "2026-08", semanas: CERRADO })!;
  assert.deepEqual(v.bloques, []);
  assert.equal(v.borrables.length, 3);
});

test("pantalla: el gerente recibe null SIEMPRE; también si el interruptor está vacío o la empresa no es de la lista", () => {
  assert.equal(vistaFilas({ esAdminOFinanzas: false }), null);
  assert.equal(vistaFilas({ interruptores: APAGADO }), null);
  assert.equal(vistaFilas({ interruptores: { filasExtra: [], tipeo: [] } }), null);
  assert.equal(vistaFilas({ empresaSlug: "plate-silver", plantillaEstatica: SIN_ROLES, plantillaReporte: SIN_ROLES }), null);
});

// ---- Tipeo directo de Presupuestado y Real en las filas extra ---------------------------------------

test("tipeo: las filas extra aceptan Presupuestado y Real; las demás filas de la plantilla, solo el Real", () => {
  const campos = camposTipeables(CON_EXTRAS, "brillante", TIPEO).map((c) => `${c.clave}|${c.columna}`);
  for (const k of ["extra.i1", "extra.e1", "extra.a1"]) {
    assert.ok(campos.includes(`${k}|REAL`) && campos.includes(`${k}|PRESUPUESTADO`), k);
  }
  // 11 de Disponibilidades + 8 de flujo (Real) + el Capital de trabajo (Presupuestado) + 6 de las filas extra.
  assert.equal(campos.length, 11 + 8 + 1 + 6);
  // El Presupuestado de las filas de la plantilla no se tipea desde acá, salvo el del Capital de trabajo.
  assert.deepEqual(
    campos.filter((k) => !k.startsWith("extra.") && k.endsWith("|PRESUPUESTADO")),
    ["br.capital|PRESUPUESTADO"]
  );
});

test("tipeo: sin el interruptor de filas extra, ni una celda de ellas; sin tipeo directo, ninguna", () => {
  const sin = camposTipeables(CON_EXTRAS, "brillante", TIPEO_SIN_EXTRAS);
  assert.equal(sin.some((c) => c.clave.startsWith("extra.")), false);
  assert.equal(sin.length, 19 + 1);
  assert.deepEqual(camposTipeables(CON_EXTRAS, "brillante", { ...TIPEO, tipeo: [] }), []);
});

function vistaTipeo(over: Partial<Parameters<typeof armarVistaTipeo>[0]> = {}) {
  return armarVistaTipeo({
    empresaSlug: "brillante",
    plantilla: CON_EXTRAS,
    esAdminOFinanzas: true,
    periodo: "2026-10",
    actual: "2026-10",
    semanas: ABIERTO,
    valoresReales: new Map(),
    valoresPresupuesto: new Map(),
    interruptores: TIPEO,
    ...over,
  });
}
const ids = (v: ReturnType<typeof vistaTipeo>) => v!.celdas.map((c) => c.id);

test("tipeo: en un mes abierto las seis celdas de las filas extra son editables, sin aviso", () => {
  const v = vistaTipeo()!;
  const extras = v.celdas.filter((c) => c.clave.startsWith("extra."));
  assert.equal(extras.length, 6);
  assert.ok(extras.every((c) => c.importeInicial === "" && !c.avisoUnaVez && c.aviso === null));
  assert.equal(new Set(v.celdas.map((c) => c.id)).size, v.celdas.length);
});

test("tipeo: Presupuesto VALIDADO bloquea la columna P — lo cargado queda sin input, lo vacío se carga una sola vez", () => {
  const pres = new Map([["extra.i1", 300_000]]);
  const v = vistaTipeo({ presupuestoValidado: true, valoresPresupuesto: pres })!;
  assert.equal(ids(v).includes("extra.i1|PRESUPUESTADO"), false);
  const vacia = v.celdas.find((c) => c.id === "extra.e1|PRESUPUESTADO")!;
  assert.equal(vacia.avisoUnaVez, true);
  assert.equal(vacia.aviso, AVISO_PRESUPUESTO_VALIDADO);
  // El Real no depende del Presupuesto validado.
  assert.ok(ids(v).includes("extra.i1|REAL"));
  // Sin validar, la misma celda cargada sí se puede corregir.
  assert.ok(ids(vistaTipeo({ valoresPresupuesto: pres })).includes("extra.i1|PRESUPUESTADO"));
});

test("tipeo: carga única en un mes cerrado — el Real cargado no se toca (sin override), el vacío se carga una vez", () => {
  const reales = new Map([["extra.a1", -70_000]]);
  const v = vistaTipeo({ periodo: "2026-08", semanas: CERRADO, valoresReales: reales })!;
  assert.equal(ids(v).includes("extra.a1|REAL"), false);
  const vacia = v.celdas.find((c) => c.id === "extra.i1|REAL")!;
  assert.equal(vacia.aviso, AVISO_UNA_VEZ);
  // La columna P solo la bloquea el Presupuesto validado, no que el mes haya cerrado.
  assert.ok(ids(v).includes("extra.i1|PRESUPUESTADO"));
});

test("tipeo: el valor guardado viaja en formato argentino y la huella cambia", () => {
  const a = vistaTipeo()!;
  const b = vistaTipeo({ valoresPresupuesto: new Map([["extra.i1", 123_456_789]]) })!;
  assert.equal(b.celdas.find((c) => c.id === "extra.i1|PRESUPUESTADO")!.importeInicial, "1.234.568");
  assert.notEqual(a.huella, b.huella);
});

test("servidor del tipeo: acepta Presupuestado y Real de una fila extra; rechaza todo lo demás", () => {
  const base = { empresaSlug: "brillante", plantilla: CON_EXTRAS, esAdminOFinanzas: true, interruptores: TIPEO };
  const e = (filaClave: string, columna: "PRESUPUESTADO" | "REAL") => ({ filaClave, columna, texto: "1.000" });
  assert.equal(motivoRechazoTipeo({ ...base, entradas: [e("extra.i1", "PRESUPUESTADO"), e("extra.i1", "REAL")] }), null);
  // Presupuestado de una fila de la plantilla: no desde acá.
  assert.ok(motivoRechazoTipeo({ ...base, entradas: [e("br.otroMsnt", "PRESUPUESTADO")] }));
  assert.equal(motivoRechazoTipeo({ ...base, entradas: [e("br.otroMsnt", "REAL")] }), null);
  // Una fila extra que el mes no tiene (la plantilla del mes no la trae) o que no existe.
  assert.ok(motivoRechazoTipeo({ ...base, plantilla: BRILLANTE, entradas: [e("extra.i1", "REAL")] }));
  assert.ok(motivoRechazoTipeo({ ...base, entradas: [e("extra.nadie", "REAL")] }));
  // Sin el interruptor de filas extra, aunque la plantilla las traiga.
  assert.ok(motivoRechazoTipeo({ ...base, interruptores: TIPEO_SIN_EXTRAS, entradas: [e("extra.i1", "REAL")] }));
  // El gerente.
  assert.match(motivoRechazoTipeo({ ...base, esAdminOFinanzas: false, entradas: [e("extra.i1", "REAL")] })!, /ADMIN y FINANZAS/);
});

// ---- El gerente: las ve en solo lectura, sin nada que se pueda tocar --------------------------------

function datosConExtras(valorExtra: number): DatosMes[] {
  const meses = mesesDePrueba(BRILLANTE);
  const real = new Map(meses[1].manuales!.real);
  const pres = new Map(meses[1].manuales!.presupuesto);
  for (const k of ["extra.i1", "extra.e1", "extra.a1"]) {
    real.set(k, valorExtra);
    pres.set(k, valorExtra);
  }
  return [meses[0], { ...meses[1], manuales: { presupuesto: pres, real } }];
}

test("centinela: el gerente no recibe NADA del armado de filas extra — ni vistas, ni claves, ni celdas, ni la acción", () => {
  const meses = datosConExtras(CENTINELA);
  const real = meses[1].manuales!.real;
  const presupuesto = meses[1].manuales!.presupuesto;
  const comunes = { empresaSlug: "brillante", periodo: "2026-10", actual: "2026-10" };

  // Para ADMIN las celdas sí llevan los valores (si no, la prueba no detectaría una fuga).
  const admin = armarVistaTipeo({
    ...comunes, plantilla: CON_EXTRAS, esAdminOFinanzas: true, semanas: ABIERTO,
    valoresReales: real, valoresPresupuesto: presupuesto, interruptores: TIPEO,
  });
  assert.match(JSON.stringify(admin), /70\.000\.000\.000,/);

  for (const semanas of [ABIERTO, CERRADO]) {
    const tipeo = armarVistaTipeo({
      ...comunes, plantilla: CON_EXTRAS, esAdminOFinanzas: false, semanas,
      valoresReales: real, valoresPresupuesto: presupuesto, interruptores: TIPEO,
    });
    const filas = armarVistaFilasExtra({
      empresaSlug: "brillante", plantillaEstatica: BRILLANTE, plantillaReporte: CON_EXTRAS, esAdminOFinanzas: false,
      periodo: "2026-10", actual: "2026-10", semanas, clavesConValores: new Set(["extra.i1"]), interruptores: ENCENDIDO,
    });
    assert.equal(tipeo, null);
    assert.equal(filas, null);
    const json = JSON.stringify({ tipeo, filas });
    assert.equal(json, '{"tipeo":null,"filas":null}');
    assert.equal(/extra\.|7000000000|70\.000\.000\.000/.test(json), false);
  }
  // Rechazo del servidor.
  assert.ok(
    motivoRechazoTipeo({
      empresaSlug: "brillante", plantilla: CON_EXTRAS, esAdminOFinanzas: false,
      entradas: [{ filaClave: "extra.i1", columna: "REAL", texto: "7.000.000.000.000" }], interruptores: TIPEO,
    })
  );
  assert.equal(crear({ esAdminOFinanzas: false }).ok, false);
  assert.equal(borrar({ esAdminOFinanzas: false }).ok, false);
});

test("gerente: la carga del Presupuestado (planDeCarga) sigue sin saber de las filas extra: ninguna celda editable nueva", () => {
  const vista = vistaDeCarga(planDeCarga(BRILLANTE, [], []));
  assert.equal(JSON.stringify(vista).includes("extra."), false);
  // 39: las 40 de antes menos el Capital de trabajo, que el gerente ya no carga (lo carga ADMIN en /reporte/carga).
  assert.equal(vista.celdas.length, 39);
});

test("gerente: ve las filas extra en solo lectura, con sus valores; los centinelas reservados siguen sin aparecer fuera de Disponibilidades", () => {
  const acceso = accesoReservadosDelReporte(false, "brillante");
  const r: Reporte = armarReporte(CON_EXTRAS, datosConExtras(5_000), 1, { verBloquesReservados: acceso });
  const celda = (clave: string) => r.filas.find((f) => f.fila.clave === clave)!.celdas[0];
  for (const k of ["extra.i1", "extra.e1", "extra.a1"]) {
    assert.equal(celda(k).real, 5_000, k);
    assert.equal(celda(k).presupuestado, 5_000, k);
  }
  assert.deepEqual(clavesDeCierre(r), ["br.saldo", "br.capital", "br.disponible"]);
  // Fuera de Disponibilidades y del Cierre (que se calcula con ellas) no se cuela ningún centinela.
  const sinDisponibilidades = JSON.stringify(r.filas.filter((f) => f.fila.bloque !== "DISPONIBILIDADES" && f.fila.bloque !== "CIERRE"));
  assert.equal(/7000000000\d{3}/.test(sinDisponibilidades), false);
  // Y con el centinela en los valores reservados de Disponibilidades, tampoco se cuela en las filas extra.
  const r2 = armarReporte(CON_EXTRAS, datosConExtras(5_000), 1, { verBloquesReservados: false });
  assert.equal(r2.filas.some((f) => esBloqueReservado(f.fila.bloque)), false);
});

// ---- Interruptor vacío: nada cambia para nadie ------------------------------------------------------

// Excepción explícita: Expensas pasó de «Sin Real» a Real manual, y una celda de Real manual vacía ya no se marca como
// incompleta (realIncompleto) como la de una fila «Sin Real». Es la ÚNICA diferencia con la foto gerenteBrillante.json (ver brillanteRealManual.test.ts)
// (tomada antes del cambio, que no se toca): se pone en la foto ese único campo de esa única fila y se compara el resto.
function conExpensasManual(foto: { filas: [string, unknown[][]][] }) {
  const copia = JSON.parse(JSON.stringify(foto)) as typeof foto;
  const celda = copia.filas.find(([clave]) => clave === "br.expensas")![1][0];
  assert.equal(celda[5], true, "la foto de antes tiene Expensas con el Real incompleto");
  celda[5] = false;
  // Gold Salta también pasó de «Sin Real» a Real manual (neteo de cobranzas, desde 2026-10): mismo motivo.
  const gold = copia.filas.find(([clave]) => clave === "br.goldSalta")![1][0];
  assert.equal(gold[5], true, "la foto de antes tiene Gold Salta con el Real incompleto");
  gold[5] = false;
  return copia;
}

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

// Datos de Brillante numerados como cuando se tomó la foto (sin contar las tres celdas de Real que se sumaron después: Jujuy, Recupero Gastos y Expensas):
// el mismo armado que brillanteRealManual.test.ts.
function datosDeLaFoto(): DatosMes[] {
  const meses = mesesDePrueba(BRILLANTE);
  const real = new Map<string, number>();
  const presupuesto = new Map<string, number>();
  let n = 0;
  for (const c of camposManuales(BRILLANTE)) {
    if (c.columna === "REAL" && (c.clave === "br.otrasOperacionesJujuy" || c.clave === "br.recuperoGastos" || c.clave === "br.expensas" || c.clave === "br.goldSalta" || c.clave === "br.sac")) continue;
    const valor = esBloqueReservado(c.bloque) ? CENTINELA + n++ : 1000 + n++;
    (c.columna === "REAL" ? real : presupuesto).set(c.clave, valor);
  }
  return [meses[0], { ...meses[1], manuales: { presupuesto, real } }];
}

test("interruptor VACÍO: nadie recibe vistas, el resolver no cambia la plantilla y el gerente de Brillante da idéntico a su foto", async () => {
  const foto = JSON.parse(readFileSync(new URL("../reporte/__tests__/fixtures/gerenteBrillante.json", import.meta.url), "utf-8"));
  const vacio: InterruptoresFilasExtra = { filasExtra: [], tipeo: EMPRESAS_CON_TIPEO_DIRECTO };
  for (const slug of SLUGS) {
    const p = PLANTILLAS_POR_SLUG[slug];
    // Resolver: la MISMA plantilla, sin consultar la base.
    const resuelta = await plantillaDeEmpresaConExtras("e", slug, "2026-10", {
      interruptores: [],
      leer: async () => {
        throw new Error("no debería consultar la base");
      },
    });
    assert.equal(resuelta, p, slug);
    for (const esAdminOFinanzas of [true, false]) {
      assert.equal(
        armarVistaFilasExtra({
          empresaSlug: slug, plantillaEstatica: p, plantillaReporte: p, esAdminOFinanzas,
          periodo: "2026-10", actual: "2026-10", semanas: ABIERTO, clavesConValores: new Set(), interruptores: vacio,
        }),
        null,
        `${slug} admin=${esAdminOFinanzas}`
      );
    }
  }
  // Foto del gerente de Brillante con el interruptor vacío: idéntica a la anterior a las filas extra.
  const resuelta = (await plantillaDeEmpresaConExtras("e", "brillante", "2026-10", { interruptores: [] }))!;
  const gerente = armarReporte(resuelta, datosDeLaFoto(), 1, { verBloquesReservados: accesoReservadosDelReporte(false, "brillante") });
  assert.deepEqual(proyeccion(sinCierre(gerente)), conExpensasManual(foto));
});

test("la foto del gerente de Brillante tampoco cambia con el interruptor prendido y la tabla vacía", async () => {
  const foto = JSON.parse(readFileSync(new URL("../reporte/__tests__/fixtures/gerenteBrillante.json", import.meta.url), "utf-8"));
  const resuelta = (await plantillaDeEmpresaConExtras("e", "brillante", "2026-10", {
    interruptores: ["brillante"],
    leer: async () => [],
  }))!;
  assert.equal(resuelta, BRILLANTE);
  const gerente = armarReporte(resuelta, datosDeLaFoto(), 1, { verBloquesReservados: accesoReservadosDelReporte(false, "brillante") });
  assert.deepEqual(proyeccion(sinCierre(gerente)), conExpensasManual(foto));
});

// ---- Las acciones y la pantalla, leídas del código --------------------------------------------------
// No se pueden ejecutar sin sesión ni base: se comprueba el orden de las guardas.

const leerFuente = (ruta: string) => readFileSync(new URL(`../../app/[empresa]/[periodo]/reporte/${ruta}`, import.meta.url), "utf-8");

test("acciones de crear y borrar: cada una pide ADMIN/FINANZAS ANTES de tocar la base", () => {
  const fuente = leerFuente("actionsFilasExtra.ts");
  for (const nombre of ["crearFilaExtra", "borrarFilaExtra"]) {
    const desde = fuente.indexOf(`export async function ${nombre}`);
    const cuerpo = fuente.slice(desde, fuente.indexOf("export async function", desde + 10) === -1 ? undefined : fuente.indexOf("export async function", desde + 10));
    const exige = cuerpo.indexOf("await requireAdminOFinanzas()");
    const prisma = cuerpo.indexOf("prisma.");
    assert.ok(exige > 0 && prisma > exige, nombre);
    assert.ok(cuerpo.indexOf("requireAccesoEmpresa(empresa.id)") > exige, `${nombre}: acceso a la empresa`);
  }
  // Las reglas son las puras (probadas arriba), no copias.
  assert.match(fuente, /validarCreacionFilaExtra\(/);
  assert.match(fuente, /decidirBorradoFilaExtra\(/);
});

test("borrar: el conteo de valores y el borrado van en la MISMA transacción serializable, y se borra solo si la decisión es ok", () => {
  const fuente = leerFuente("actionsFilasExtra.ts");
  const desde = fuente.indexOf("export async function borrarFilaExtra");
  const cuerpo = fuente.slice(desde);
  const tx = cuerpo.indexOf("prisma.$transaction(");
  const conteo = cuerpo.indexOf("tx.valorManualReporte.count(");
  const decision = cuerpo.indexOf("decidirBorradoFilaExtra(");
  const borrado = cuerpo.indexOf("tx.filaExtraReporte.delete(");
  assert.ok(tx > 0 && conteo > tx && decision > conteo && borrado > decision);
  assert.match(cuerpo, /if \(d\.ok\) await tx\.filaExtraReporte\.delete/);
  assert.match(cuerpo, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
  // El borrado es de UNA fila de la empresa, por id.
  assert.match(cuerpo, /findFirst\(\{ where: \{ id, empresaId: empresa\.id \}/);
});

test("crear: la fila nace con el mes de la URL como «desde», sin «hasta» y atribuida a quien la crea", () => {
  const fuente = leerFuente("actionsFilasExtra.ts");
  assert.match(fuente, /desdePeriodo: periodo/);
  assert.equal(fuente.includes("hastaPeriodo"), false, "hastaPeriodo queda en el modelo, sin interfaz ni acción");
  assert.match(fuente, /creadoPorId: usuario\.id/);
  assert.equal(readFileSync(new URL("../../app/[empresa]/[periodo]/reporte/FilasExtra.tsx", import.meta.url), "utf-8").includes("hastaPeriodo"), false);
});

test("guardado del tipeo: la acción usa la plantilla del mes con las filas extra y sigue pidiendo ADMIN/FINANZAS primero", () => {
  const fuente = leerFuente("actionsTipeo.ts");
  const exige = fuente.indexOf("await requireAdminOFinanzas()");
  const resuelve = fuente.indexOf("plantillaDeEmpresaConExtras(empresa.id, empresaSlug, periodo)");
  const motivo = fuente.indexOf("motivoRechazoTipeo(");
  const guarda = fuente.indexOf("return guardarValoresManuales(");
  assert.ok(exige > 0 && resuelve > exige && motivo > resuelve && guarda > motivo);
});

test("pantalla: los botones y el borrado solo se arman para ADMIN/FINANZAS; al componente le llega null para el gerente", () => {
  const page = leerFuente("page.tsx").replace(/\r\n/g, "\n");
  // Las dos vistas nacen null y solo se asignan dentro del if de tipeo directo, que exige `edicion.tipeo`
  // (lib/reporte/vistaReporte.ts, edicionDelReporte: ADMIN/FINANZAS y fuera de la vista histórica del mes en curso).
  const nace = page.indexOf("let filasExtra: VistaFilasExtra | null = null;");
  const si = page.indexOf("if (edicion.tipeo && tipeoDirectoActivo(empresaSlug)) {");
  const asigna = page.indexOf("filasExtra = armarVistaFilasExtra(");
  assert.ok(nace > 0 && si > nace && asigna > si);
  // El rol sigue entrando por ese helper: `edicion` se arma con el rol del usuario.
  assert.match(page, /edicionDelReporte\(\{ periodo, marca: marcaModo, esAdminOFinanzas: esAdminOFinanzas\(usuario\) \}\)/);
  assert.match(page, /filasExtra=\{filasExtra\}/);
  // El componente muestra el botón y la «×» solo con la vista.
  const tabla = leerFuente("ReportePlantilla.tsx");
  assert.match(tabla, /filasExtra\?\.bloques\.includes\(bloqueParaAgregar\)/);
  assert.match(tabla, /borrable=\{filasExtra !== null && filasExtra\.borrables\.includes\(fila\.clave\)\}/);
  assert.match(tabla, /\{borrable && \(/);
  // La carga del gerente sigue con la plantilla estática.
  assert.match(page, /planDeCarga\(plantilla,/);
});
