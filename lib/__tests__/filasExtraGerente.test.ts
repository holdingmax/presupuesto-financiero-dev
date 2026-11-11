import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPRESAS_CON_FILAS_EXTRA, EMPRESAS_CON_FILAS_EXTRA_GERENTE, EMPRESAS_CON_TIPEO_DIRECTO } from "@/lib/config";
import { ERROR_SIN_PERMISO_DE_CARGAR_REAL } from "@/lib/permisosReal";
import { armarReporte, validarPlantilla, type DatosMes, type Fila, type Plantilla, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { admiteFilasExtra, conFilasExtra, type FilaExtra } from "@/lib/reporte/filasExtra";
import {
  armarVistaFilasExtra,
  decidirBorradoFilaExtra,
  ERROR_FILA_CON_VALORES,
  ERROR_SOLO_ADMIN,
  motivoSinPermisoFilasExtra,
  validarCreacionFilaExtra,
} from "@/lib/reporte/accionesFilasExtra";
import { armarVistaTipeo, ERROR_SOLO_REAL, motivoRechazoTipeo } from "@/lib/reporte/tipeoDirecto";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";
import { planDeCarga, vistaDeCarga } from "@/lib/reporte/cargaGerente";

// Filas extra para el GERENTE de Bradenton, Plate Silver y Havanna Perú (Romina y Nadina): un gerente con la casilla «Puede cargar
// Real de esta empresa» de ESA empresa agrega y borra filas solo en esas tres empresas; ADMIN y FINANZAS siguen como siempre; las
// demás empresas no cambian. El estado del Presupuesto (En revisión) NO cuenta; el mes bloqueado sí. El Presupuestado de esas filas
// lo carga solo ADMIN/FINANZAS (el gerente tipea Real). Usan la configuración REAL de lib/config.ts.

const TRES = ["bradenton", "plate-silver", "havanna-peru"] as const;
const PREFIJO: Record<string, string> = { bradenton: "bd", "plate-silver": "ps", "havanna-peru": "hp" };
const ABIERTO = { abiertas: 1, cerradas: 0 };
const CERRADO = { abiertas: 0, cerradas: 4 };

const ING: FilaExtra = { id: "i1", bloque: "INGRESOS", nombre: "PRÉSTAMO COCOS", desdePeriodo: "2026-10", hastaPeriodo: null };
const EGR: FilaExtra = { id: "e1", bloque: "EGRESOS", nombre: "PAGOS ESPECIALES", desdePeriodo: "2026-10", hastaPeriodo: null };
const ABA: FilaExtra = { id: "a1", bloque: "ABAJO", nombre: "RETIRO SOCIOS", desdePeriodo: "2026-10", hastaPeriodo: null };
const EXTRAS = [ING, EGR, ABA];

const ROLES_DE_FLUJO = ["totalIngresos", "totalEgresosOperativos", "totalEgresos"];

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

const proyeccion = (r: Reporte) => JSON.parse(JSON.stringify({ ...r, filas: r.filas.map((f) => [f.fila.clave, f.fila.tipo, f.celdas]) }));
const celdaFinal = (r: Reporte, clave: string) => r.filas.find((f) => f.fila.clave === clave)!.celdas.at(-1);

// ---- Configuración ---------------------------------------------------------------------------------------

test("config: la lista del gerente es exactamente Bradenton, Plate Silver y Havanna Perú, y es subconjunto de las que tienen filas extra", () => {
  assert.deepEqual([...EMPRESAS_CON_FILAS_EXTRA_GERENTE], [...TRES]);
  assert.equal(new Set(EMPRESAS_CON_FILAS_EXTRA_GERENTE).size, EMPRESAS_CON_FILAS_EXTRA_GERENTE.length);
  for (const slug of EMPRESAS_CON_FILAS_EXTRA_GERENTE) {
    assert.ok(EMPRESAS_CON_FILAS_EXTRA.includes(slug), `${slug} tiene que tener filas extra`);
    assert.ok(EMPRESAS_CON_TIPEO_DIRECTO.includes(slug), `${slug} tiene que tener tipeo directo`);
  }
  // Las demás empresas con filas extra no abren el permiso al gerente.
  for (const slug of EMPRESAS_CON_FILAS_EXTRA.filter((s) => !TRES.includes(s as (typeof TRES)[number]))) {
    assert.equal(EMPRESAS_CON_FILAS_EXTRA_GERENTE.includes(slug), false, slug);
  }
});

for (const slug of TRES) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const p = PREFIJO[slug];

  // ---- Plantillas: roles de totales, sin cambiar el Reporte -----------------------------------------------

  test(`${slug}: los tres totales de flujo marcados (admite filas extra) y el Reporte sin filas extra no cambia`, () => {
    const conRol = plantilla.filas.filter((f) => f.tipo === "total" && f.rol && ROLES_DE_FLUJO.includes(f.rol));
    assert.deepEqual(
      conRol.map((f) => [f.clave, (f as { rol: string }).rol]),
      [
        [`${p}.totalIngresos`, "totalIngresos"],
        [`${p}.totalGastosOperativos`, "totalEgresosOperativos"],
        [`${p}.totalGastos`, "totalEgresos"],
      ]
    );
    assert.equal(admiteFilasExtra(plantilla), true);
    assert.equal(admiteFilasExtra(sinRolesDeFlujo(plantilla)), false);
    assert.deepEqual(validarPlantilla(plantilla), []);
    const antes = sinRolesDeFlujo(plantilla);
    const meses = mesesDePrueba(plantilla);
    const vacios = meses.map((m) => ({ ...m, manuales: { presupuesto: new Map(), real: new Map() } }));
    for (const juego of [meses, vacios]) {
      for (const acceso of [true, accesoReservadosDelReporte(false, slug), false] as const) {
        assert.deepEqual(
          proyeccion(armarReporte(plantilla, juego, 1, { verBloquesReservados: acceso })),
          proyeccion(armarReporte(antes, juego, 1, { verBloquesReservados: acceso })),
          `${slug} acceso=${JSON.stringify(acceso)}`
        );
      }
    }
    assert.equal(conFilasExtra(plantilla, []), plantilla, "sin filas, la MISMA plantilla");
    assert.deepEqual(vistaDeCarga(planDeCarga(plantilla, [], [])), vistaDeCarga(planDeCarga(antes, [], [])));
  });

  // ---- Qué mueve una fila nueva -----------------------------------------------------------------------------

  test(`${slug}: qué totales mueve una fila extra en cada bloque (Disponibilidades nunca)`, () => {
    const meses0 = mesesDePrueba(plantilla);
    const base = armarReporte(plantilla, meses0, 1, { verBloquesReservados: true });
    const celdas = (r: Reporte) => new Map(r.filas.map((f) => [f.fila.clave, JSON.stringify(f.celdas.at(-1))]));
    const c0 = celdas(base);
    const esperado: Record<string, string[]> = {
      INGRESOS: ["totalIngresos", "disponibleAntes", "saldo"],
      // Plate Silver: el Capital sale del 100% de TOTAL GASTOS OPERATIVOS, así que una fila de Egresos lo sube y baja el Excedente (como
      // HWC). PENDIENTE DE CONFIRMAR CON ROMINA. En Bradenton y Havanna Perú el Capital es una línea manual: no se mueve.
      EGRESOS: ["totalGastosOperativos", "totalGastos", "saldo", ...(slug === "plate-silver" ? ["capital", "excedente"] : [])],
      ABAJO: ["totalGastos", "saldo"],
    };
    for (const [extra, real, pres] of [[ING, 5000, 3000], [EGR, 2000, 1500], [ABA, -700, -400]] as const) {
      const real2 = new Map(meses0[1].manuales!.real).set(`extra.${extra.id}`, real);
      const pres2 = new Map(meses0[1].manuales!.presupuesto).set(`extra.${extra.id}`, pres);
      const meses: DatosMes[] = [meses0[0], { ...meses0[1], manuales: { presupuesto: pres2, real: real2 } }];
      const r = armarReporte(conFilasExtra(plantilla, [extra]), meses, 1, { verBloquesReservados: true });
      const cambian = [...celdas(r).entries()].filter(([k, v]) => !k.startsWith("extra.") && c0.get(k) !== v).map(([k]) => k).sort();
      assert.deepEqual(cambian, esperado[extra.bloque].map((k) => `${p}.${k}`).sort(), `${slug} ${extra.bloque}`);
      assert.equal(cambian.some((k) => /isponibilidades|\.dBanco|\.dEfectivo/.test(k)), false, "Disponibilidades no se mueve");
    }
  });

  // ---- Permisos (reglas puras) ----------------------------------------------------------------------------------

  const crear = (over: Partial<Parameters<typeof validarCreacionFilaExtra>[0]> = {}) =>
    validarCreacionFilaExtra({
      empresaSlug: slug,
      plantilla,
      esAdminOFinanzas: false,
      puedeCargarReal: true,
      bloque: "EGRESOS",
      nombre: "pagos   especiales",
      extras: [],
      periodo: "2026-10",
      actual: "2026-10",
      semanas: ABIERTO,
      ...over,
    });
  const borrar = (over: Partial<Parameters<typeof decidirBorradoFilaExtra>[0]> = {}) =>
    decidirBorradoFilaExtra({ empresaSlug: slug, plantilla, esAdminOFinanzas: false, puedeCargarReal: true, existe: true, cantidadDeValores: 0, ...over });
  const vista = (over: Partial<Parameters<typeof armarVistaFilasExtra>[0]> = {}) =>
    armarVistaFilasExtra({
      empresaSlug: slug,
      plantillaEstatica: plantilla,
      plantillaReporte: conFilasExtra(plantilla, EXTRAS),
      esAdminOFinanzas: false,
      puedeCargarReal: true,
      periodo: "2026-10",
      actual: "2026-10",
      semanas: ABIERTO,
      clavesConValores: new Set(),
      ...over,
    });

  test(`${slug}: el gerente con la casilla de ESTA empresa agrega y borra filas; sin la casilla no`, () => {
    assert.deepEqual(crear(), { ok: true, bloque: "EGRESOS", nombre: "PAGOS ESPECIALES", nombreClave: "PAGOS ESPECIALES" });
    for (const bloque of ["INGRESOS", "EGRESOS", "ABAJO"]) assert.equal(crear({ bloque }).ok, true, bloque);
    assert.deepEqual(borrar(), { ok: true });
    // Sin la casilla (o sin dato): rechazado, con el motivo del permiso de Real.
    for (const puedeCargarReal of [false, undefined]) {
      assert.deepEqual(crear({ puedeCargarReal }), { ok: false, error: ERROR_SIN_PERMISO_DE_CARGAR_REAL });
      assert.deepEqual(borrar({ puedeCargarReal }), { ok: false, error: ERROR_SIN_PERMISO_DE_CARGAR_REAL });
      assert.equal(vista({ puedeCargarReal }), null);
    }
    // ADMIN y FINANZAS, como siempre (con o sin «puedeCargarReal»).
    assert.equal(crear({ esAdminOFinanzas: true, puedeCargarReal: undefined }).ok, true);
    assert.deepEqual(borrar({ esAdminOFinanzas: true, puedeCargarReal: undefined }), { ok: true });
  });

  test(`${slug}: las mismas reglas del resto — nombre genérico o repetido, bloque inválido, mes bloqueado y fila con valores`, () => {
    assert.equal(crear({ nombre: "otros" }).ok, false);
    assert.equal(crear({ nombre: "ab" }).ok, false);
    assert.equal(crear({ bloque: "CIERRE" }).ok, false);
    assert.equal(crear({ bloque: "DISPONIBILIDADES" }).ok, false);
    assert.equal(crear({ extras: [{ nombre: "PAGOS ESPECIALES" }] }).ok, false);
    // Mes bloqueado: un mes pasado sin semanas abiertas no admite altas, tampoco para el gerente; con semanas abiertas, sí.
    const cerrado = crear({ periodo: "2026-08", actual: "2026-10", semanas: CERRADO });
    assert.equal(cerrado.ok, false);
    assert.match((cerrado as { error: string }).error, /No se pueden agregar filas en este mes/);
    assert.equal(crear({ periodo: "2026-08", semanas: { abiertas: 2, cerradas: 1 } }).ok, true);
    assert.deepEqual(vista({ periodo: "2026-08", semanas: CERRADO })!.bloques, []);
    // Una fila con algún valor, en cualquier mes, no se borra (tampoco el gerente).
    assert.deepEqual(borrar({ cantidadDeValores: 1 }), { ok: false, error: ERROR_FILA_CON_VALORES });
    assert.equal(borrar({ existe: false }).ok, false);
  });

  test(`${slug}: la pantalla del gerente con la casilla trae «Agregar una fila» en los tres bloques y borrado de las filas sin valores`, () => {
    assert.deepEqual(vista(), { bloques: ["INGRESOS", "EGRESOS", "ABAJO"], borrables: ["extra.i1", "extra.e1", "extra.a1"] });
    assert.deepEqual(vista({ clavesConValores: new Set(["extra.e1"]) })!.borrables, ["extra.i1", "extra.a1"]);
    assert.deepEqual(vista({ esAdminOFinanzas: true, puedeCargarReal: undefined }), vista());
  });

  // ---- Presupuestado solo ADMIN/FINANZAS; el Real lo tipea también el gerente ---------------------------------

  test(`${slug}: el gerente tipea el Real de las filas extra pero NO el Presupuestado; ADMIN tipea los dos`, () => {
    const conExtras = conFilasExtra(plantilla, EXTRAS);
    const entrada = (columna: "REAL" | "PRESUPUESTADO") => [{ filaClave: "extra.e1", columna, texto: "100" }];
    assert.equal(motivoRechazoTipeo({ empresaSlug: slug, plantilla: conExtras, esAdminOFinanzas: false, puedeCargarReal: true, entradas: entrada("REAL") }), null);
    assert.equal(motivoRechazoTipeo({ empresaSlug: slug, plantilla: conExtras, esAdminOFinanzas: false, puedeCargarReal: true, entradas: entrada("PRESUPUESTADO") }), ERROR_SOLO_REAL);
    assert.equal(motivoRechazoTipeo({ empresaSlug: slug, plantilla: conExtras, esAdminOFinanzas: true, entradas: entrada("PRESUPUESTADO") }), null);
    const celdas = (esAdminOFinanzas: boolean) =>
      armarVistaTipeo({
        empresaSlug: slug, plantilla: conExtras, esAdminOFinanzas, puedeCargarReal: true,
        periodo: "2026-10", actual: "2026-10", semanas: ABIERTO, valoresReales: new Map(), valoresPresupuesto: new Map(),
      })!.celdas.filter((c) => c.clave === "extra.e1").map((c) => c.columna).sort();
    assert.deepEqual(celdas(false), ["REAL"]);
    assert.deepEqual(celdas(true), ["PRESUPUESTADO", "REAL"]);
  });

  // ---- La fila se ve igual para todos ---------------------------------------------------------------------------

  test(`${slug}: una fila agregada se ve igual para ADMIN, el gerente con la casilla y el gerente sin ella (mismo lugar, mismos valores)`, () => {
    const plantillaConExtras = conFilasExtra(plantilla, EXTRAS);
    const meses0 = mesesDePrueba(plantilla);
    const real = new Map(meses0[1].manuales!.real).set("extra.e1", 2000);
    const pres = new Map(meses0[1].manuales!.presupuesto).set("extra.e1", 1500);
    const meses: DatosMes[] = [meses0[0], { ...meses0[1], manuales: { presupuesto: pres, real } }];
    const admin = armarReporte(plantillaConExtras, meses, 1, { verBloquesReservados: true });
    const gerente = armarReporte(plantillaConExtras, meses, 1, { verBloquesReservados: accesoReservadosDelReporte(false, slug) });
    // El gerente no recibe los bloques reservados (Disponibilidades), así que el índice absoluto difiere; lo que tiene que coincidir es
    // el lugar: justo antes del total de su bloque.
    const siguiente = (r: Reporte) => { const claves = r.filas.map((f) => f.fila.clave); return claves[claves.indexOf("extra.e1") + 1]; };
    assert.ok(admin.filas.some((f) => f.fila.clave === "extra.e1") && gerente.filas.some((f) => f.fila.clave === "extra.e1"));
    assert.equal(siguiente(admin), `${p}.totalGastosOperativos`);
    assert.equal(siguiente(gerente), `${p}.totalGastosOperativos`);
    assert.deepEqual(celdaFinal(gerente, "extra.e1"), celdaFinal(admin, "extra.e1"));
    assert.equal(celdaFinal(gerente, "extra.e1")!.real, 2000);
    assert.equal(celdaFinal(gerente, "extra.e1")!.presupuestado, 1500);
    assert.deepEqual(celdaFinal(gerente, `${p}.totalGastosOperativos`), celdaFinal(admin, `${p}.totalGastosOperativos`));
  });
}

// ---- Las demás empresas no cambian --------------------------------------------------------------------------

test("las demás empresas: el gerente, tenga o no la casilla, sigue rechazado y sin botones; ADMIN y FINANZAS siguen como siempre", () => {
  const otras = EMPRESAS_CON_FILAS_EXTRA.filter((s) => !TRES.includes(s as (typeof TRES)[number]));
  assert.ok(otras.length >= 8, "Brillante, Fredy, HWC, Avianor, Mantenor, Radio, Havanna y Conexión (x2)");
  for (const slug of otras) {
    const plantilla = PLANTILLAS_POR_SLUG[slug];
    for (const puedeCargarReal of [true, false, undefined]) {
      assert.equal(motivoSinPermisoFilasExtra({ empresaSlug: slug, esAdminOFinanzas: false, puedeCargarReal }), ERROR_SOLO_ADMIN, slug);
      assert.deepEqual(
        validarCreacionFilaExtra({ empresaSlug: slug, plantilla, esAdminOFinanzas: false, puedeCargarReal, bloque: "EGRESOS", nombre: "GASTO EXTRAORDINARIO DE PRUEBA", extras: [], periodo: "2026-10", actual: "2026-10", semanas: ABIERTO }),
        { ok: false, error: ERROR_SOLO_ADMIN },
        slug
      );
      assert.deepEqual(decidirBorradoFilaExtra({ empresaSlug: slug, plantilla, esAdminOFinanzas: false, puedeCargarReal, existe: true, cantidadDeValores: 0 }), { ok: false, error: ERROR_SOLO_ADMIN }, slug);
      assert.equal(
        armarVistaFilasExtra({ empresaSlug: slug, plantillaEstatica: plantilla, plantillaReporte: plantilla, esAdminOFinanzas: false, puedeCargarReal, periodo: "2026-10", actual: "2026-10", semanas: ABIERTO, clavesConValores: new Set() }),
        null,
        slug
      );
    }
    assert.equal(motivoSinPermisoFilasExtra({ empresaSlug: slug, esAdminOFinanzas: true }), null, slug);
    assert.equal(
      validarCreacionFilaExtra({ empresaSlug: slug, plantilla, esAdminOFinanzas: true, bloque: "EGRESOS", nombre: "GASTO EXTRAORDINARIO DE PRUEBA", extras: [], periodo: "2026-10", actual: "2026-10", semanas: ABIERTO }).ok,
      true,
      slug
    );
  }
});

test("el gerente con la casilla de OTRA empresa no puede en estas tres: el permiso es por empresa (puedeCargarReal de ESA empresa)", () => {
  // La acción le pasa `puedeCargarReal` calculado para la empresa de la URL (lib/cargaRealEmpresa.ts): sin la casilla de ESA, es false.
  for (const slug of TRES) assert.deepEqual(motivoSinPermisoFilasExtra({ empresaSlug: slug, esAdminOFinanzas: false, puedeCargarReal: false }), ERROR_SIN_PERMISO_DE_CARGAR_REAL);
});

// ---- Servidor: guards y estado del Presupuesto --------------------------------------------------------------

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

test("estado del Presupuesto: ni las reglas ni las acciones lo miran (el gerente puede aunque esté En revisión); el mes bloqueado sí", () => {
  const acciones = leer("../../app/[empresa]/[periodo]/reporte/actionsFilasExtra.ts");
  const reglas = leer("../reporte/accionesFilasExtra.ts");
  for (const fuente of [acciones, reglas]) {
    assert.equal(/EN_REVISION|puedeEditarPresupuestoAhora|obtenerEstadoFlujo|presupuestoMensual|estadoPresupuesto/.test(fuente), false);
  }
  assert.match(reglas, /motivoBloqueo\(\{ periodo, actual, columna: "REAL", bloque, presupuestoValidado: false, semanas \}\)/);
});

test("servidor: el permiso del gerente es el de cargar el Real de ESA empresa, validado en las dos acciones, y la fila nace atribuida a quien la crea", () => {
  const acciones = leer("../../app/[empresa]/[periodo]/reporte/actionsFilasExtra.ts");
  assert.match(acciones, /await requireCargaRealEmpresa\(empresa\.id\)/);
  assert.match(acciones, /puedeCargarReal: await puedeCargarRealEmpresa\(usuario, empresa\.id\)/);
  assert.equal((acciones.match(/await autorizarFilasExtra\(/g) ?? []).length, 2, "crear y borrar");
  assert.equal((acciones.match(/puedeCargarReal: auth\.puedeCargarReal/g) ?? []).length, 2, "se lo pasa a las dos reglas");
  assert.match(acciones, /creadoPorId: usuario\.id/);
});
