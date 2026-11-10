import { test } from "node:test";
import assert from "node:assert/strict";
import type { Rol } from "@prisma/client";
import { EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE } from "@/lib/config";
import { ERROR_SIN_PERMISO_DE_CARGAR_REAL, puedeCargarRealConAcceso } from "@/lib/permisosReal";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import {
  armarVistaTipeo,
  camposTipeables,
  ERROR_SOLO_REAL,
  motivoRechazoTipeo,
  type InterruptoresTipeo,
} from "@/lib/reporte/tipeoDirecto";
import { camposRealDelGerente } from "@/lib/reporte/camposRealGerente";
import { edicionDelReporte } from "@/lib/reporte/vistaReporte";

// Permiso de cargar el Real por empresa (lib/permisosReal.ts). El lookup a UsuarioEmpresa lo hace
// lib/cargaRealEmpresa.ts (con Prisma): acá se prueba la decisión pura y todo lo que de ella depende en
// el servidor (motivoRechazoTipeo) y en la pantalla (armarVistaTipeo, edicionDelReporte).

const rol = (r: Rol) => ({ rol: r });
const CON_TILDE = { puedeOperarEjecucion: true };
const SIN_TILDE = { puedeOperarEjecucion: false };

// Escenario: un gerente asignado a tres empresas con tilde solo en Bradenton, y una cuarta sin asignar.
const FILAS_DEL_GERENTE: Record<string, { puedeOperarEjecucion: boolean } | null> = {
  bradenton: CON_TILDE,
  "plate-silver": SIN_TILDE,
  brillante: SIN_TILDE,
  hwc: null,
};

test("ADMIN y FINANZAS pueden con o sin fila de acceso", () => {
  for (const r of ["ADMIN", "FINANZAS"] as const) {
    assert.equal(puedeCargarRealConAcceso(rol(r), null), true, r);
    assert.equal(puedeCargarRealConAcceso(rol(r), SIN_TILDE), true, r);
    assert.equal(puedeCargarRealConAcceso(rol(r), CON_TILDE), true, r);
  }
});

test("GERENTE: solo con el tilde de ESA empresa", () => {
  assert.equal(puedeCargarRealConAcceso(rol("GERENTE"), CON_TILDE), true);
  assert.equal(puedeCargarRealConAcceso(rol("GERENTE"), SIN_TILDE), false, "asignada sin tilde");
  assert.equal(puedeCargarRealConAcceso(rol("GERENTE"), null), false, "no asignada");
  assert.equal(puedeCargarRealConAcceso(rol("GERENTE"), undefined), false);
});

test("el tilde de una empresa no vale en otra (mismo gerente, cuatro empresas)", () => {
  const puede = (slug: string) => puedeCargarRealConAcceso(rol("GERENTE"), FILAS_DEL_GERENTE[slug]);
  assert.equal(puede("bradenton"), true);
  assert.equal(puede("plate-silver"), false);
  assert.equal(puede("brillante"), false);
  assert.equal(puede("hwc"), false);
});

// ---- Validación del servidor: motivoRechazoTipeo (lo que corre guardarTipeoDelReporte) ----------------------------

const PLANTILLA = PLANTILLAS_POR_SLUG["bradenton"];
const INTERRUPTORES: InterruptoresTipeo = { tipeo: ["bradenton", "plate-silver"], disponibilidades: EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE };
const celdaReal = camposTipeables(PLANTILLA, "bradenton", INTERRUPTORES).find((c) => c.columna === "REAL" && c.bloque === "INGRESOS")!;

function rechazo(over: Partial<Parameters<typeof motivoRechazoTipeo>[0]>) {
  return motivoRechazoTipeo({
    empresaSlug: "bradenton",
    plantilla: PLANTILLA,
    esAdminOFinanzas: false,
    puedeCargarReal: true,
    entradas: [{ filaClave: celdaReal.clave, columna: "REAL", texto: "100" }],
    interruptores: INTERRUPTORES,
    ...over,
  });
}

test("servidor: gerente con permiso guarda Real; sin permiso se rechaza aunque la interfaz no muestre el botón", () => {
  assert.equal(rechazo({}), null);
  assert.equal(rechazo({ puedeCargarReal: false }), ERROR_SIN_PERMISO_DE_CARGAR_REAL);
  // Sin el parámetro nuevo, un no-admin se rechaza (compatibilidad con los llamadores de antes).
  assert.equal(rechazo({ puedeCargarReal: undefined }), ERROR_SIN_PERMISO_DE_CARGAR_REAL);
});

test("servidor: ADMIN y FINANZAS siguen igual (Real y Presupuestado de lo tipeable)", () => {
  assert.equal(rechazo({ esAdminOFinanzas: true, puedeCargarReal: undefined }), null);
  const conP = camposTipeables(PLANTILLA, "bradenton", INTERRUPTORES).find((c) => c.columna === "PRESUPUESTADO");
  if (conP) {
    assert.equal(
      rechazo({ esAdminOFinanzas: true, entradas: [{ filaClave: conP.clave, columna: "PRESUPUESTADO", texto: "1" }] }),
      null
    );
  }
});

test("servidor: el gerente con permiso no puede cargar Presupuestado", () => {
  const filaP = PLANTILLA.filas.find((f) => f.tipo === "linea")!;
  assert.equal(
    rechazo({ entradas: [{ filaClave: filaP.clave, columna: "PRESUPUESTADO", texto: "1" }] }),
    ERROR_SOLO_REAL
  );
});

test("servidor: sigue rigiendo qué filas son tipeables y el interruptor de la empresa", () => {
  assert.match(rechazo({ entradas: [{ filaClave: "no.existe", columna: "REAL", texto: "1" }] }) ?? "", /no se puede tipear/);
  assert.match(rechazo({ interruptores: { tipeo: [], disponibilidades: [] } }) ?? "", /no está habilitado/);
});

// ---- Qué campos puede cargar el gerente desde /reporte/carga -----------------------------------------------------------

test("camposRealDelGerente: solo Real, nada de Cierre, y Disponibilidades solo si la empresa las ve", () => {
  const conDisp = camposRealDelGerente(PLANTILLA, "bradenton", ["bradenton"]);
  const sinDisp = camposRealDelGerente(PLANTILLA, "bradenton", []);
  for (const c of [...conDisp, ...sinDisp]) {
    assert.equal(c.columna, "REAL");
    assert.notEqual(c.bloque, "CIERRE");
  }
  assert.ok(conDisp.some((c) => c.bloque === "DISPONIBILIDADES"));
  assert.ok(!sinDisp.some((c) => c.bloque === "DISPONIBILIDADES"));
  assert.ok(sinDisp.length > 0 && conDisp.length > sinDisp.length);
});

// ---- Pantalla: lo que viaja al gerente --------------------------------------------------------------------------------

function vista(over: Partial<Parameters<typeof armarVistaTipeo>[0]> = {}) {
  return armarVistaTipeo({
    empresaSlug: "bradenton",
    plantilla: PLANTILLA,
    esAdminOFinanzas: false,
    puedeCargarReal: true,
    periodo: "2026-10",
    actual: "2026-10",
    semanas: { abiertas: 1, cerradas: 0 },
    valoresReales: new Map(),
    interruptores: INTERRUPTORES,
    ...over,
  });
}

test("pantalla: gerente con permiso recibe celdas de Real y ninguna de Presupuestado; sin permiso, null", () => {
  const v = vista();
  assert.ok(v && v.celdas.length > 0);
  assert.ok(v.celdas.every((c) => c.columna === "REAL"));
  assert.equal(vista({ puedeCargarReal: false }), null);
  assert.equal(vista({ puedeCargarReal: undefined }), null);
});

test("pantalla: ADMIN/FINANZAS reciben las mismas celdas que antes del cambio", () => {
  const antes = armarVistaTipeo({
    empresaSlug: "bradenton",
    plantilla: PLANTILLA,
    esAdminOFinanzas: true,
    periodo: "2026-10",
    actual: "2026-10",
    semanas: { abiertas: 1, cerradas: 0 },
    valoresReales: new Map(),
    interruptores: INTERRUPTORES,
  });
  const ahora = vista({ esAdminOFinanzas: true, puedeCargarReal: true });
  assert.deepEqual(ahora, antes);
});

test("bloqueo de octubre: en un mes cerrado el gerente carga una sola vez; lo ya cargado no se ofrece", () => {
  const cerrado = { abiertas: 0, cerradas: 4 };
  const claveCargada = celdaReal.clave;
  const v = vista({ periodo: "2026-10", actual: "2026-11", semanas: cerrado, valoresReales: new Map([[claveCargada, 12300]]) });
  assert.ok(v);
  assert.ok(!v.celdas.some((c) => c.id === `${claveCargada}|REAL`), "valor ya cargado en mes cerrado: no editable");
  const vacia = v.celdas.find((c) => c.id !== `${claveCargada}|REAL`);
  assert.ok(vacia && vacia.avisoUnaVez, "campo vacío de un mes cerrado: se carga una vez, con aviso");
});

test("edicionDelReporte: el gerente con permiso ve tipeo y link de carga, pero no las filas extra", () => {
  const base = { periodo: "2026-10", marca: undefined } as unknown as Parameters<typeof edicionDelReporte>[0];
  const gerenteConTilde = edicionDelReporte({ ...base, esAdminOFinanzas: false, puedeCargarReal: true });
  assert.equal(gerenteConTilde.tipeo, true);
  assert.equal(gerenteConTilde.linkCarga, true);
  assert.equal(gerenteConTilde.filasExtra, false);
  const gerenteSin = edicionDelReporte({ ...base, esAdminOFinanzas: false, puedeCargarReal: false });
  assert.deepEqual([gerenteSin.tipeo, gerenteSin.linkCarga, gerenteSin.filasExtra], [false, false, false]);
  const admin = edicionDelReporte({ ...base, esAdminOFinanzas: true });
  assert.deepEqual([admin.tipeo, admin.linkCarga, admin.filasExtra], [true, true, true]);
});
