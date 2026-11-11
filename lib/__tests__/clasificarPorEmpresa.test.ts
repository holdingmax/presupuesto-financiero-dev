/* eslint-disable @typescript-eslint/no-explicit-any -- arnés: base en memoria que imita las llamadas de Prisma */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { CLASIFICACIONES_POR_EMPRESA } from "@/lib/config";
import { CLASIFICACIONES_SUGERIDAS } from "@/lib/clasificaciones";
import { normalizarClasificacion } from "@/lib/clasificacionesOcultas";
import { puedeCerrarEjecucion, puedeOperarEjecucionGlobal } from "@/lib/permisosEjecucion";
import {
  ERROR_CAMBIO_CONCURRENTE,
  ERROR_MOVIMIENTO_NO_ENCONTRADO,
  ERROR_MOVIMIENTO_NO_ES_DE_LA_EMPRESA,
  ERROR_MOVIMIENTO_PRORRATEADO,
  ERROR_SEMANA_CERRADA,
  ERROR_SIN_PERMISO_DE_CLASIFICAR,
  clasificacionesPropiasDeEmpresa,
  puedeClasificarEnEmpresa,
  validarEdicionEmpresa,
} from "@/lib/clasificarPorEmpresa";
import { clasificacionesParaEditar, confirmarSugerenciasDeEmpresa, contarSugerenciasDeEmpresa, editarMovimientoDeEmpresa, type UsuarioParaClasificar } from "@/lib/clasificarPorEmpresaDb";

// Clasificar los movimientos de la propia empresa (gerente con la casilla). Se prueba contra una base EN MEMORIA que interpreta
// los `where` que realmente arma el código (id, ejecucionId, unidadNegocio in, desglose none, estado de la semana, notIn de
// clasificaciones ocultas, marcas de sugerencia): así se ve qué filas se tocan y cuáles NO.

const leer = (...partes: string[]) => readFileSync(partes.join("/"), "utf8");

// ---------- datos de prueba ----------
const BRADENTON = { id: "emp-brad", nombre: "Bradenton", activo: true, unidadesNegocio: ["BRADENTON"] };
const CONEXION = { id: "emp-con", nombre: "Conexión Logística", activo: true, unidadesNegocio: ["LOGISTICA", "SPP"] };
const BRILLANTE = { id: "emp-bri", nombre: "Brillante", activo: true, unidadesNegocio: ["BRILLANTE"] };
const PLATE_SILVER = { id: "emp-ps", nombre: "Plate Silver", activo: true, unidadesNegocio: ["PLATE SILVER"] };

const ROMINA: UsuarioParaClasificar = { id: "u-romina", rol: "GERENTE", operaEjecucion: false };

type Mov = {
  id: string;
  ejecucionId: string;
  unidadNegocio: string;
  clasificacion: string;
  ignorado: boolean;
  sugeridaPorSistema: boolean;
  unidadSugeridaPorSistema: boolean;
  chequeIvaAmbiguo: boolean;
  desglose: number;
  // Campos que este camino NUNCA debe tocar:
  importe: number;
  concepto: string;
  bancoYCuenta: string;
};

const mov = (id: string, o: Partial<Mov> = {}): Mov => ({
  id,
  ejecucionId: "ej-abierta",
  unidadNegocio: "BRADENTON",
  clasificacion: "SIN CLASIFICAR",
  ignorado: false,
  sugeridaPorSistema: false,
  unidadSugeridaPorSistema: false,
  chequeIvaAmbiguo: false,
  desglose: 0,
  importe: -100,
  concepto: "CHECK 1780",
  bancoYCuenta: "CHASE BRADENTON",
  ...o,
});

type Mundo = {
  empresas: (typeof BRADENTON)[];
  // usuarioId|empresaId → casilla
  accesos: Record<string, boolean>;
  semanas: { id: string; periodo: string; numeroSemana: number; estado: string }[];
  movs: Mov[];
  escrituras: number;
};

function mundoBase(): Mundo {
  return {
    empresas: [BRADENTON, CONEXION, BRILLANTE],
    accesos: { "u-romina|emp-brad": true },
    semanas: [
      { id: "ej-abierta", periodo: "2026-10", numeroSemana: 5, estado: "ABIERTA" },
      { id: "ej-cerrada", periodo: "2026-10", numeroSemana: 3, estado: "CERRADA" },
    ],
    movs: [],
    escrituras: 0,
  };
}

// Intérprete mínimo de los where que arma lib/clasificarPorEmpresaDb.ts.
function coincide(m: Mov, w: Record<string, unknown>, mundo: Mundo): boolean {
  for (const [k, v] of Object.entries(w)) {
    if (k === "id" || k === "ejecucionId") {
      if ((m as unknown as Record<string, unknown>)[k] !== v) return false;
    } else if (k === "unidadNegocio") {
      const f = v as { in: string[] } | string;
      if (typeof f === "string" ? m.unidadNegocio !== f : !f.in.includes(m.unidadNegocio)) return false;
    } else if (k === "desglose") {
      if ((v as { none: object }).none && m.desglose > 0) return false;
    } else if (k === "ejecucion") {
      const sem = mundo.semanas.find((s) => s.id === m.ejecucionId);
      if (!sem || sem.estado !== (v as { estado: string }).estado) return false;
    } else if (k === "clasificacion") {
      const f = v as { notIn: string[] };
      if (f.notIn.includes(m.clasificacion)) return false;
    } else if (["sugeridaPorSistema", "unidadSugeridaPorSistema", "chequeIvaAmbiguo"].includes(k)) {
      if ((m as unknown as Record<string, unknown>)[k] !== v) return false;
    } else {
      throw new Error(`el intérprete de prueba no conoce el filtro "${k}"`);
    }
  }
  return true;
}

async function conMundo(mundo: Mundo, fn: () => Promise<void>) {
  const p = prisma as unknown as Record<string, any>;
  const guardado = {
    usuarioEmpresa: p.usuarioEmpresa,
    empresa: p.empresa,
    ejecucionSemanal: p.ejecucionSemanal,
    movimientoBancario: p.movimientoBancario,
    $queryRaw: p.$queryRaw,
  };
  p.usuarioEmpresa = {
    findUnique: async ({ where }: any) => {
      const { usuarioId, empresaId } = where.usuarioId_empresaId;
      const clave = `${usuarioId}|${empresaId}`;
      return clave in mundo.accesos ? { puedeOperarEjecucion: mundo.accesos[clave] } : null;
    },
  };
  p.empresa = { findUnique: async ({ where }: any) => mundo.empresas.find((e) => e.id === where.id) ?? null };
  p.ejecucionSemanal = {
    findUnique: async ({ where }: any) => {
      const { periodo, numeroSemana } = where.periodo_numeroSemana;
      // Una COPIA (como una consulta real): un cambio posterior en la base no altera lo ya leído.
      const sem = mundo.semanas.find((x) => x.periodo === periodo && x.numeroSemana === numeroSemana);
      return sem ? { ...sem } : null;
    },
  };
  p.movimientoBancario = {
    findFirst: async ({ where }: any) => {
      const m = mundo.movs.find((x) => coincide(x, where, mundo));
      return m ? { unidadNegocio: m.unidadNegocio, clasificacion: m.clasificacion, _count: { desglose: m.desglose } } : null;
    },
    updateMany: async ({ where, data }: any) => {
      const tocadas = mundo.movs.filter((m) => coincide(m, where, mundo));
      for (const m of tocadas) Object.assign(m, data);
      if (tocadas.length > 0) mundo.escrituras++;
      return { count: tocadas.length };
    },
    count: async ({ where }: any) => mundo.movs.filter((m) => coincide(m, where, mundo)).length,
    groupBy: async ({ where }: any) => {
      const filas = mundo.movs.filter(
        (m) => (where.ejecucionId === undefined || m.ejecucionId === where.ejecucionId) && (where.unidadNegocio === undefined || where.unidadNegocio.in.includes(m.unidadNegocio))
      );
      return Array.from(new Set(filas.map((m) => m.clasificacion))).map((clasificacion) => ({ clasificacion }));
    },
  };
  // La consulta GLOBAL de clasificaciones no se usa en este camino: si algo la llamara, el test fallaría.
  p.$queryRaw = async () => {
    throw new Error("no se debe usar la lista global de clasificaciones");
  };
  try {
    await fn();
  } finally {
    Object.assign(p, guardado);
  }
}

const editar = (u: UsuarioParaClasificar, empresaId: string, id: string, datos: unknown, periodo = "2026-10", semana = 5) =>
  editarMovimientoDeEmpresa(u, empresaId, periodo, semana, id, datos);

// ---------- permiso (puro) ----------

test("permiso: solo un GERENTE con la casilla de ESA empresa; sin casilla, sin fila o con la de otra empresa, no", () => {
  assert.equal(puedeClasificarEnEmpresa({ rol: "GERENTE" }, { puedeOperarEjecucion: true }), true);
  assert.equal(puedeClasificarEnEmpresa({ rol: "GERENTE" }, { puedeOperarEjecucion: false }), false, "sin la casilla");
  assert.equal(puedeClasificarEnEmpresa({ rol: "GERENTE" }, null), false, "sin fila de esa empresa (la casilla es por empresa)");
  assert.equal(puedeClasificarEnEmpresa({ rol: "GERENTE" }, undefined), false);
});

test("permiso: ADMIN y FINANZAS NO pasan por este camino (siguen por Ejecución global, sin cambios)", () => {
  assert.equal(puedeClasificarEnEmpresa({ rol: "ADMIN" }, { puedeOperarEjecucion: true }), false);
  assert.equal(puedeClasificarEnEmpresa({ rol: "FINANZAS" }, { puedeOperarEjecucion: true }), false);
  // Y las reglas de Ejecución global no cambiaron:
  assert.equal(puedeOperarEjecucionGlobal({ rol: "ADMIN", operaEjecucion: false }), true);
  assert.equal(puedeOperarEjecucionGlobal({ rol: "FINANZAS", operaEjecucion: false }), false, "FINANZAS sin «Opera Ejecución» sigue sin operar");
  assert.equal(puedeOperarEjecucionGlobal({ rol: "GERENTE", operaEjecucion: false }), false);
  assert.equal(puedeOperarEjecucionGlobal({ rol: "GERENTE", operaEjecucion: true }), true, "quien opera (Flavia) igual que siempre");
});

test("CERRAR la semana: un gerente con la casilla NO puede (solo ADMIN y FINANZAS), y este camino ni lo ofrece", () => {
  assert.equal(puedeCerrarEjecucion({ rol: "GERENTE" }), false);
  assert.equal(puedeCerrarEjecucion({ rol: "ADMIN" }), true);
  assert.equal(puedeCerrarEjecucion({ rol: "FINANZAS" }), true);
  const global = leer("app", "ejecucion", "actions.ts");
  const cierre = global.slice(global.indexOf("export async function cerrarSemana"));
  assert.match(cierre, /await requireCierreEjecucion\(\)/);
  const nuevas = leer("app", "[empresa]", "[periodo]", "ejecucion", "actionsClasificar.ts");
  const exportadas = [...nuevas.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exportadas.sort(), ["clasificarMovimientoEmpresa", "confirmarSugerenciasEmpresa"], "solo clasificar y confirmar sugerencias");
  for (const prohibida of [/cerrar/i, /eliminar/i, /delete/i, /desglose/i, /subirExtracto/i, /subirMadre/i]) {
    assert.equal(prohibida.test(nuevas.replace(/\/\/.*$/gm, "")), false, `las acciones nuevas no mencionan ${prohibida}`);
  }
  const db = leer("lib", "clasificarPorEmpresaDb.ts").replace(/\/\/.*$/gm, "");
  assert.equal(/\.delete\(|\.deleteMany\(|estado:\s*"CERRADA"\s*,\s*fechaCierre/.test(db), false, "no borra ni cierra");
});

// ---------- editar un movimiento ----------

test("gerente con casilla: clasifica un movimiento de SU empresa (y confirma la sugerida)", async () => {
  const m = mundoBase();
  m.movs = [mov("a", { sugeridaPorSistema: true }), mov("b")];
  await conMundo(m, async () => {
    const r = await editar(ROMINA, "emp-brad", "a", { clasificacion: "COBRANZAS" });
    assert.deepEqual(r, { ok: true });
  });
  assert.equal(m.movs[0].clasificacion, "COBRANZAS");
  assert.equal(m.movs[0].sugeridaPorSistema, false, "tocar la clasificación confirma la sugerida, como en Ejecución global");
  assert.equal(m.movs[1].clasificacion, "SIN CLASIFICAR", "las demás filas no se tocan");
});

test("gerente con casilla: ignora y des-ignora un movimiento propio", async () => {
  const m = mundoBase();
  m.movs = [mov("a")];
  await conMundo(m, async () => {
    assert.deepEqual(await editar(ROMINA, "emp-brad", "a", { ignorado: true }), { ok: true });
    assert.equal(m.movs[0].ignorado, true);
    assert.deepEqual(await editar(ROMINA, "emp-brad", "a", { ignorado: false }), { ok: true });
    assert.equal(m.movs[0].ignorado, false);
  });
});

test("no puede los movimientos de OTRA empresa (aunque conozca el id): error y sin escritura", async () => {
  const m = mundoBase();
  m.movs = [mov("ajena", { unidadNegocio: "BRILLANTE", bancoYCuenta: "MACRO 599" })];
  await conMundo(m, async () => {
    const r = await editar(ROMINA, "emp-brad", "ajena", { clasificacion: "COBRANZAS" });
    assert.deepEqual(r, { ok: false, error: ERROR_MOVIMIENTO_NO_ES_DE_LA_EMPRESA });
    assert.deepEqual(await editar(ROMINA, "emp-brad", "ajena", { ignorado: true }), { ok: false, error: ERROR_MOVIMIENTO_NO_ES_DE_LA_EMPRESA });
  });
  assert.equal(m.movs[0].clasificacion, "SIN CLASIFICAR");
  assert.equal(m.movs[0].ignorado, false);
  assert.equal(m.escrituras, 0);
});

test("no puede pasarle a otra empresa un movimiento propio: la unidad solo cambia entre las de su empresa", async () => {
  const m = mundoBase();
  m.movs = [mov("a")];
  await conMundo(m, async () => {
    const r = await editar(ROMINA, "emp-brad", "a", { unidadNegocio: "BRILLANTE" });
    assert.deepEqual(r, { ok: false, error: '"BRILLANTE" no es una unidad de esta empresa.' });
  });
  assert.equal(m.movs[0].unidadNegocio, "BRADENTON");
});

test("empresa con dos unidades (Conexión): cambia entre LOGISTICA y SPP, nunca a una ajena", async () => {
  const m = mundoBase();
  m.accesos["u-nadina|emp-con"] = true;
  const nadina: UsuarioParaClasificar = { id: "u-nadina", rol: "GERENTE", operaEjecucion: false };
  m.movs = [mov("a", { unidadNegocio: "LOGISTICA", unidadSugeridaPorSistema: true })];
  await conMundo(m, async () => {
    assert.deepEqual(await editar(nadina, "emp-con", "a", { unidadNegocio: "SPP" }), { ok: true });
    assert.equal(m.movs[0].unidadNegocio, "SPP");
    assert.equal(m.movs[0].unidadSugeridaPorSistema, false, "cambiar de verdad la unidad confirma la sugerida");
    assert.equal((await editar(nadina, "emp-con", "a", { unidadNegocio: "HWC" })).ok, false);
  });
  assert.equal(m.movs[0].unidadNegocio, "SPP");
});

test("elegir la misma unidad que ya tenía no es un cambio (no escribe)", async () => {
  const m = mundoBase();
  m.movs = [mov("a")];
  await conMundo(m, async () => {
    assert.deepEqual(await editar(ROMINA, "emp-brad", "a", { unidadNegocio: "BRADENTON" }), { ok: false, error: "No hay nada para cambiar." });
  });
  assert.equal(m.escrituras, 0);
});

test("SEMANA CERRADA: no puede editar ni ignorar, ni aunque el movimiento sea suyo", async () => {
  const m = mundoBase();
  m.movs = [mov("vieja", { ejecucionId: "ej-cerrada" })];
  await conMundo(m, async () => {
    for (const datos of [{ clasificacion: "COBRANZAS" }, { ignorado: true }, { unidadNegocio: "BRADENTON" }]) {
      assert.deepEqual(await editar(ROMINA, "emp-brad", "vieja", datos, "2026-10", 3), { ok: false, error: ERROR_SEMANA_CERRADA });
    }
  });
  assert.equal(m.movs[0].clasificacion, "SIN CLASIFICAR");
  assert.equal(m.escrituras, 0);
});

test("SEMANA CERRADA en el medio: si se cierra entre la validación y la escritura, la escritura atómica no actualiza nada", async () => {
  const m = mundoBase();
  m.movs = [mov("a")];
  await conMundo(m, async () => {
    const p = prisma as unknown as { movimientoBancario: { findFirst: (a: unknown) => Promise<unknown> } };
    const original = p.movimientoBancario.findFirst;
    // Entre el findFirst (semana abierta) y el updateMany, alguien cierra la semana.
    p.movimientoBancario.findFirst = async (a: unknown) => {
      const r = await original(a);
      m.semanas[0].estado = "CERRADA";
      return r;
    };
    const r = await editar(ROMINA, "emp-brad", "a", { clasificacion: "COBRANZAS" });
    assert.deepEqual(r, { ok: false, error: ERROR_CAMBIO_CONCURRENTE });
  });
  assert.equal(m.movs[0].clasificacion, "SIN CLASIFICAR");
});

test("un movimiento de OTRA semana no se edita desde esta (se busca dentro de la semana pedida)", async () => {
  const m = mundoBase();
  m.movs = [mov("vieja", { ejecucionId: "ej-cerrada" })];
  await conMundo(m, async () => {
    assert.deepEqual(await editar(ROMINA, "emp-brad", "vieja", { clasificacion: "COBRANZAS" }, "2026-10", 5), { ok: false, error: ERROR_MOVIMIENTO_NO_ENCONTRADO });
  });
  assert.equal(m.escrituras, 0);
});

test("un movimiento prorrateado no se toca desde acá (el prorrateo es de Finanzas)", async () => {
  const m = mundoBase();
  m.movs = [mov("p", { desglose: 2 })];
  await conMundo(m, async () => {
    assert.deepEqual(await editar(ROMINA, "emp-brad", "p", { clasificacion: "COBRANZAS" }), { ok: false, error: ERROR_MOVIMIENTO_PRORRATEADO });
  });
  assert.equal(m.movs[0].clasificacion, "SIN CLASIFICAR");
});

test("solo se pueden escribir clasificacion, unidadNegocio e ignorado: importe, concepto, cuenta o semana se rechazan", async () => {
  const m = mundoBase();
  m.movs = [mov("a")];
  await conMundo(m, async () => {
    for (const campo of ["importe", "concepto", "bancoYCuenta", "ejecucionId", "moneda", "saldo", "detalle", "id"]) {
      const r = await editar(ROMINA, "emp-brad", "a", { clasificacion: "COBRANZAS", [campo]: "x" });
      assert.deepEqual(r, { ok: false, error: `No se puede cambiar "${campo}" desde acá.` });
    }
    assert.equal((await editar(ROMINA, "emp-brad", "a", {})).ok, false);
    assert.equal((await editar(ROMINA, "emp-brad", "a", null)).ok, false);
    assert.equal((await editar(ROMINA, "emp-brad", "a", { clasificacion: "" })).ok, false);
    assert.equal((await editar(ROMINA, "emp-brad", "a", { ignorado: "si" })).ok, false);
  });
  assert.deepEqual({ importe: m.movs[0].importe, concepto: m.movs[0].concepto, bancoYCuenta: m.movs[0].bancoYCuenta, ejecucionId: m.movs[0].ejecucionId }, { importe: -100, concepto: "CHECK 1780", bancoYCuenta: "CHASE BRADENTON", ejecucionId: "ej-abierta" });
  assert.equal(m.movs[0].clasificacion, "SIN CLASIFICAR");
});

test("la lista que se ofrece y se acepta es la de la EMPRESA: canónicas + las suyas; no las propias de otra empresa", async () => {
  const m = mundoBase();
  m.movs = [mov("a"), mov("de-otra", { unidadNegocio: "BRILLANTE", clasificacion: "SOLO DE BRILLANTE" })];
  await conMundo(m, async () => {
    assert.deepEqual(await editar(ROMINA, "emp-brad", "a", { clasificacion: "SOLO DE BRILLANTE" }), { ok: false, error: '"SOLO DE BRILLANTE" no es una clasificación de la lista.' });
    assert.deepEqual(await editar(ROMINA, "emp-brad", "a", { clasificacion: "COBRANZAS" }), { ok: true });
    const lista = await clasificacionesParaEditar(["BRADENTON"], []);
    assert.ok(lista.includes("COBRANZAS") && lista.includes("SIN CLASIFICAR"));
    assert.equal(lista.includes("SOLO DE BRILLANTE"), false);
  });
});

test("la clasificación tiene que ser de la lista", async () => {
  const m = mundoBase();
  m.movs = [mov("a")];
  await conMundo(m, async () => {
    assert.deepEqual(await editar(ROMINA, "emp-brad", "a", { clasificacion: "INVENTADA XYZ" }), { ok: false, error: '"INVENTADA XYZ" no es una clasificación de la lista.' });
    assert.deepEqual(await editar(ROMINA, "emp-brad", "a", { clasificacion: "SUELDOS" }), { ok: true });
  });
});

test("clasificaciones OCULTAS para el gerente (Conexión: AVION, MS, PRESTAMO MS): no las elige ni toca filas que ya las tienen", async () => {
  const m = mundoBase();
  m.accesos["u-nadina|emp-con"] = true;
  const nadina: UsuarioParaClasificar = { id: "u-nadina", rol: "GERENTE", operaEjecucion: false };
  m.movs = [mov("a", { unidadNegocio: "LOGISTICA" }), mov("oculta", { unidadNegocio: "LOGISTICA", clasificacion: "AVION" }), mov("otra", { unidadNegocio: "LOGISTICA", clasificacion: "MS" })];
  await conMundo(m, async () => {
    assert.equal((await editar(nadina, "emp-con", "a", { clasificacion: "AVION" })).ok, false, "no puede elegir una oculta");
    assert.equal((await editar(nadina, "emp-con", "a", { clasificacion: " ms" })).ok, false);
    assert.equal((await editar(nadina, "emp-con", "oculta", { clasificacion: "COBRANZAS" })).ok, false, "tampoco tocar una fila con clasificación oculta");
  });
  assert.equal(m.movs[1].clasificacion, "AVION");
  assert.equal(m.movs[0].clasificacion, "SIN CLASIFICAR");
});

// ---------- sin casilla, no puede nada ----------

test("SIN la casilla (casilla en false o sin fila de esa empresa): no puede clasificar ni confirmar nada", async () => {
  const m = mundoBase();
  m.accesos["u-sin|emp-brad"] = false;
  m.movs = [mov("a", { sugeridaPorSistema: true, unidadSugeridaPorSistema: true })];
  const sinCasilla: UsuarioParaClasificar = { id: "u-sin", rol: "GERENTE", operaEjecucion: false };
  const sinFila: UsuarioParaClasificar = { id: "u-nadie", rol: "GERENTE", operaEjecucion: false };
  await conMundo(m, async () => {
    for (const u of [sinCasilla, sinFila]) {
      assert.deepEqual(await editar(u, "emp-brad", "a", { clasificacion: "COBRANZAS" }), { ok: false, error: ERROR_SIN_PERMISO_DE_CLASIFICAR });
      assert.deepEqual(await editar(u, "emp-brad", "a", { ignorado: true }), { ok: false, error: ERROR_SIN_PERMISO_DE_CLASIFICAR });
      assert.deepEqual(await confirmarSugerenciasDeEmpresa(u, "emp-brad", "2026-10", 5, "clasificacion"), { ok: false, error: ERROR_SIN_PERMISO_DE_CLASIFICAR });
      assert.deepEqual(await confirmarSugerenciasDeEmpresa(u, "emp-brad", "2026-10", 5, "unidad"), { ok: false, error: ERROR_SIN_PERMISO_DE_CLASIFICAR });
    }
  });
  assert.equal(m.movs[0].clasificacion, "SIN CLASIFICAR");
  assert.equal(m.movs[0].sugeridaPorSistema, true);
  assert.equal(m.escrituras, 0);
});

test("la casilla de UNA empresa no vale en otra: con casilla en Bradenton no toca Conexión", async () => {
  const m = mundoBase();
  m.movs = [mov("c", { unidadNegocio: "LOGISTICA", sugeridaPorSistema: true })];
  await conMundo(m, async () => {
    assert.deepEqual(await editar(ROMINA, "emp-con", "c", { clasificacion: "COBRANZAS" }), { ok: false, error: ERROR_SIN_PERMISO_DE_CLASIFICAR });
    assert.deepEqual(await confirmarSugerenciasDeEmpresa(ROMINA, "emp-con", "2026-10", 5, "clasificacion"), { ok: false, error: ERROR_SIN_PERMISO_DE_CLASIFICAR });
  });
  assert.equal(m.movs[0].sugeridaPorSistema, true);
});

test("ADMIN, FINANZAS y quien opera NO entran por este camino aunque tengan la casilla (no se les cambia nada)", async () => {
  const m = mundoBase();
  m.accesos["u-adm|emp-brad"] = true;
  m.movs = [mov("a")];
  await conMundo(m, async () => {
    for (const rol of ["ADMIN", "FINANZAS"] as const) {
      const u: UsuarioParaClasificar = { id: "u-adm", rol, operaEjecucion: true };
      assert.deepEqual(await editar(u, "emp-brad", "a", { clasificacion: "COBRANZAS" }), { ok: false, error: ERROR_SIN_PERMISO_DE_CLASIFICAR });
    }
  });
  assert.equal(m.escrituras, 0);
});

// ---------- lotes ----------

function mundoConSugerencias(): Mundo {
  const m = mundoBase();
  m.accesos["u-nadina|emp-con"] = true;
  m.movs = [
    mov("brad1", { sugeridaPorSistema: true, unidadSugeridaPorSistema: true }),
    mov("brad2", { sugeridaPorSistema: true }),
    mov("brad-ambiguo", { sugeridaPorSistema: true, chequeIvaAmbiguo: true }),
    mov("brad-prorrateado", { sugeridaPorSistema: true, desglose: 2 }),
    mov("brad-cerrada", { ejecucionId: "ej-cerrada", sugeridaPorSistema: true }),
    mov("bri1", { unidadNegocio: "BRILLANTE", sugeridaPorSistema: true, unidadSugeridaPorSistema: true }),
    mov("con1", { unidadNegocio: "LOGISTICA", sugeridaPorSistema: true, clasificacion: "AVION" }),
  ];
  return m;
}

test("LOTE: confirma solo las sugerencias de SU empresa; las de otra empresa, las ambiguas, las prorrateadas y las de otra semana quedan igual", async () => {
  const m = mundoConSugerencias();
  await conMundo(m, async () => {
    const r = await confirmarSugerenciasDeEmpresa(ROMINA, "emp-brad", "2026-10", 5, "clasificacion");
    assert.deepEqual(r, { ok: true, cantidad: 2 });
  });
  const porId = (id: string) => m.movs.find((x) => x.id === id)!;
  assert.equal(porId("brad1").sugeridaPorSistema, false);
  assert.equal(porId("brad2").sugeridaPorSistema, false);
  assert.equal(porId("brad-ambiguo").sugeridaPorSistema, true, "un cheque de IVA ambiguo se revisa de a uno");
  assert.equal(porId("brad-prorrateado").sugeridaPorSistema, true);
  assert.equal(porId("brad-cerrada").sugeridaPorSistema, true, "otra semana (cerrada)");
  assert.equal(porId("bri1").sugeridaPorSistema, true, "OTRA EMPRESA: intacta");
  assert.equal(porId("con1").sugeridaPorSistema, true, "OTRA EMPRESA: intacta");
  // No cambió ninguna clasificación ni unidad: solo apagó la marca.
  assert.equal(porId("brad1").clasificacion, "SIN CLASIFICAR");
  assert.equal(porId("brad1").unidadNegocio, "BRADENTON");
});

test("LOTE de unidades: solo las de SU empresa", async () => {
  const m = mundoConSugerencias();
  await conMundo(m, async () => {
    assert.deepEqual(await confirmarSugerenciasDeEmpresa(ROMINA, "emp-brad", "2026-10", 5, "unidad"), { ok: true, cantidad: 1 });
  });
  assert.equal(m.movs.find((x) => x.id === "brad1")!.unidadSugeridaPorSistema, false);
  assert.equal(m.movs.find((x) => x.id === "bri1")!.unidadSugeridaPorSistema, true, "OTRA EMPRESA: intacta");
});

test("LOTE: un gerente con casilla en una empresa NO puede confirmar el lote de OTRA empresa (aunque sea de la misma semana)", async () => {
  const m = mundoConSugerencias();
  await conMundo(m, async () => {
    // Romina solo tiene casilla en Bradenton: el lote de Conexión y el de Brillante se rechazan sin tocar nada.
    for (const empresa of ["emp-con", "emp-bri"]) {
      for (const tipo of ["clasificacion", "unidad"] as const) {
        assert.deepEqual(await confirmarSugerenciasDeEmpresa(ROMINA, empresa, "2026-10", 5, tipo), { ok: false, error: ERROR_SIN_PERMISO_DE_CLASIFICAR });
      }
    }
  });
  assert.equal(m.escrituras, 0);
  assert.ok(m.movs.filter((x) => x.id !== "brad-cerrada").every((x) => x.sugeridaPorSistema === true));
});

test("LOTE en SEMANA CERRADA: no confirma nada", async () => {
  const m = mundoConSugerencias();
  await conMundo(m, async () => {
    assert.deepEqual(await confirmarSugerenciasDeEmpresa(ROMINA, "emp-brad", "2026-10", 3, "clasificacion"), { ok: false, error: ERROR_SEMANA_CERRADA });
    assert.deepEqual(await confirmarSugerenciasDeEmpresa(ROMINA, "emp-brad", "2026-10", 3, "unidad"), { ok: false, error: ERROR_SEMANA_CERRADA });
  });
  assert.equal(m.escrituras, 0);
  assert.equal(m.movs.find((x) => x.id === "brad-cerrada")!.sugeridaPorSistema, true);
});

test("LOTE: respeta las clasificaciones ocultas del gerente (no confirma las que no ve) y rechaza tipos raros", async () => {
  const m = mundoConSugerencias();
  const nadina: UsuarioParaClasificar = { id: "u-nadina", rol: "GERENTE", operaEjecucion: false };
  m.movs.push(mov("con2", { unidadNegocio: "SPP", sugeridaPorSistema: true, clasificacion: "COBRANZAS" }));
  await conMundo(m, async () => {
    assert.deepEqual(await confirmarSugerenciasDeEmpresa(nadina, "emp-con", "2026-10", 5, "clasificacion"), { ok: true, cantidad: 1 });
    assert.equal((await confirmarSugerenciasDeEmpresa(nadina, "emp-con", "2026-10", 5, "otra" as never)).ok, false);
  });
  assert.equal(m.movs.find((x) => x.id === "con1")!.sugeridaPorSistema, true, "AVION está oculta para ella: no se confirma");
  assert.equal(m.movs.find((x) => x.id === "con2")!.sugeridaPorSistema, false);
});

test("contarSugerenciasDeEmpresa: cuenta con las mismas condiciones que el lote (para el cartel de la pantalla)", async () => {
  const m = mundoConSugerencias();
  await conMundo(m, async () => {
    assert.deepEqual(await contarSugerenciasDeEmpresa("ej-abierta", ["BRADENTON"], []), { clasificacion: 2, unidad: 1 });
    assert.deepEqual(await contarSugerenciasDeEmpresa("ej-abierta", [], []), { clasificacion: 0, unidad: 0 });
  });
});

// ---------- validación pura ----------

test("validarEdicionEmpresa: datos que no son un objeto, o campos repetidos con tipos raros, se rechazan", () => {
  const base = {
    movimiento: { unidadNegocio: "BRADENTON", clasificacion: "SIN CLASIFICAR", cantidadDesglose: 0 },
    unidadesEmpresa: ["BRADENTON"],
    estadoSemana: "ABIERTA",
    clasificacionesValidas: ["COBRANZAS", "SIN CLASIFICAR"],
    ocultasNormalizadas: [],
  };
  assert.equal(validarEdicionEmpresa({ ...base, datos: "COBRANZAS" }).ok, false);
  assert.equal(validarEdicionEmpresa({ ...base, datos: ["COBRANZAS"] }).ok, false);
  assert.equal(validarEdicionEmpresa({ ...base, datos: { clasificacion: 5 } }).ok, false);
  assert.equal(validarEdicionEmpresa({ ...base, datos: { unidadNegocio: 5 } }).ok, false);
  assert.deepEqual(validarEdicionEmpresa({ ...base, datos: { clasificacion: "COBRANZAS" } }), { ok: true, data: { clasificacion: "COBRANZAS", sugeridaPorSistema: false } });
  assert.equal(validarEdicionEmpresa({ ...base, estadoSemana: "CERRADA", datos: { clasificacion: "COBRANZAS" } }).ok, false);
});

// ---------- lo que NO cambió ----------

test("Ejecución global no se tocó: sus acciones siguen exigiendo operar y no conocen este camino", () => {
  const global = leer("app", "ejecucion", "actions.ts");
  assert.equal(/clasificarPorEmpresa|actionsClasificar|puedeClasificarEnEmpresa/.test(global), false);
  assert.match(global, /return requireOperadorEjecucionGlobal\(\);/);
  const auth = leer("lib", "auth.ts");
  assert.equal(/clasificarPorEmpresa/.test(auth), false);
});

test("la pantalla de la empresa: editable SOLO si el servidor trae `edicion` (gerente con casilla + semana ABIERTA); si no, solo lectura como siempre", () => {
  const pagina = leer("app", "[empresa]", "[periodo]", "ejecucion", "[numeroSemana]", "page.tsx");
  assert.match(pagina, /datos\.edicion \? \(\s*<MovimientosEditablesEmpresa/);
  assert.match(pagina, /<TablaMovimientos\s+movimientos=\{datos\.movimientos\}\s+numeroSemana=\{datos\.numeroSemana\}\s+soloLectura\s*\/>/);
  const datos = leer("app", "[empresa]", "[periodo]", "ejecucion", "datos.ts");
  assert.match(datos, /ejecucion\.estado === "ABIERTA" && unidades\.length > 0/);
  assert.match(datos, /if \(puedeClasificarEnEmpresa\(usuario, acceso\)\)/);
  // La vista "Todo el mes" no se hizo editable.
  assert.equal(/MovimientosEditablesEmpresa/.test(leer("app", "[empresa]", "[periodo]", "ejecucion", "mes", "page.tsx")), false);
});

test("TablaMovimientos: las dos opciones nuevas son aditivas (sin ellas, el comportamiento es el de siempre)", () => {
  const t = leer("app", "ejecucion", "TablaMovimientos.tsx");
  assert.match(t, /unidadesPermitidas\?: string\[\];/);
  assert.match(t, /sinProrrateo = false,/);
  assert.match(t, /: opcionesUnidad\(\[m\.unidadNegocio\]\)/, "sin unidadesPermitidas usa la lista global");
  assert.match(t, /!soloLectura && !deshabilitado && !sinProrrateo/);
  // Quien no pasa onQuitar no ve «Eliminar»: el componente editable de la empresa no lo pasa.
  const editable = leer("app", "[empresa]", "[periodo]", "ejecucion", "[numeroSemana]", "MovimientosEditablesEmpresa.tsx");
  assert.equal(/onQuitar/.test(editable), false);
  assert.match(editable, /sinProrrateo/);
});

// ---------- lista PROPIA de clasificaciones (Bradenton) ----------

// Los 17 nombres tal cual los pasó Kike/Romina (pestañas "Presup 11-2026" y "Ejecutado 10-2026"), en el orden del libro, y
// después OTROS (agregada a pedido de Romina): 18 en total.
const LISTA_BRADENTON = [
  "COBRANZAS",
  "DEP EFECTIVO",
  "COBRO FOOD TRUCK",
  "VENTA ICE MACHINE-TC",
  "REBATE",
  "DIVIDENDOS",
  "CHEQ EMITIDOS (DEBITADOS)",
  "COM Y GTOS BRIOS",
  "HONORARIOS + ABONOS MENSUALES",
  "TAX",
  "LOTTERY",
  "COMPRA MERCS C-STORE",
  "COMPRA C-STORE-CASH",
  "SERVICIOS",
  "MANTENIMIENTO Y REPARACIONES",
  "SUELDOS",
  "EXPENSAS",
  "OTROS",
];

test("config: la lista de Bradenton son los 17 nombres del libro en su orden y OTROS al final (18), sin repetidos", () => {
  assert.deepEqual(CLASIFICACIONES_POR_EMPRESA.bradenton, LISTA_BRADENTON);
  assert.equal(LISTA_BRADENTON.length, 18);
  assert.equal(LISTA_BRADENTON[16], "EXPENSAS", "las 17 del libro no cambian de lugar");
  assert.equal(LISTA_BRADENTON[17], "OTROS");
  assert.equal(new Set(LISTA_BRADENTON.map(normalizarClasificacion)).size, 18, "ninguno repetido (ni siquiera sin mayúsculas/tildes)");
  assert.ok(LISTA_BRADENTON.every((c) => c === c.trim() && c !== ""));
  // Solo Bradenton y Plate Silver tienen lista propia: Havanna Perú y las demás siguen con la general.
  assert.deepEqual(Object.keys(CLASIFICACIONES_POR_EMPRESA), ["bradenton", "plate-silver"]);
});

// Los 29 nombres que confirmó Romina para Plate Silver, en su orden, y OTROS al final (pedido por ella): 30 en total.
const LISTA_PLATE_SILVER = [
  "COBRANZA DE CLIENTE",
  "IMPUESTO PERCEPCION IVA (UI)",
  "COMISION BANCARIA",
  "DIVIDENDOS",
  "INVERSION PROYECTO USA",
  "REPOSICION FONDO FIJO",
  "DEVOLUCION DE INGRESO POR ERROR",
  "TRANSFERENCIA ENTRE CUENTAS",
  "IMPUESTO IVA",
  "IMPUESTOS ANTICIPOS IRAE",
  "IMPUESTO ANTICIPOS PERSONA JURIDICA",
  "IMPUESTO A LAS SOCIEDADES - ICOSA",
  "AG. DE RETENCION IRNR",
  "ARRIENDO DE EQUIPO MULTIFUNCION/IMPRESOR",
  "HONORARIOS MILTON GONZALEZ",
  "HONORARIOS PROFESIONALES - ESTUDIO CONTABLE",
  "SERVICIOS DE ALQUILER DE OFICINAS Y GASTOS",
  "ALQUILER DE VEHICULO MVD UY",
  "LIMPIEZA",
  "WI-FI / TELEFONO",
  "SERVICIOS DE SOFTWARE CARGAS",
  "BPS",
  "LIBRERIA Y OTROS",
  "COSTO POR CUENTA Y ORDEN",
  "POLIZA DE SEGUROS ARIEL",
  "POLIZA SEGURO ACCIDENTES DE TRABAJO",
  "PASAJE AEP - MVD - AEP",
  "SUELDO",
  "AGUINALDO",
  "OTROS",
];

test("config: la lista de Plate Silver son los 29 nombres de Romina en su orden y OTROS al final (30), sin repetidos", () => {
  assert.deepEqual(CLASIFICACIONES_POR_EMPRESA["plate-silver"], LISTA_PLATE_SILVER);
  assert.equal(LISTA_PLATE_SILVER.length, 30);
  assert.equal(LISTA_PLATE_SILVER[0], "COBRANZA DE CLIENTE");
  assert.equal(LISTA_PLATE_SILVER[28], "AGUINALDO", "el último de los 29 de Romina");
  assert.equal(LISTA_PLATE_SILVER[29], "OTROS");
  assert.equal(LISTA_PLATE_SILVER.filter((c) => c === "OTROS").length, 1, "OTROS una sola vez");
  assert.equal(new Set(LISTA_PLATE_SILVER.map(normalizarClasificacion)).size, 30, "ninguno repetido (ni sin mayúsculas/tildes)");
  assert.ok(LISTA_PLATE_SILVER.every((c) => c === c.trim() && c !== ""));
  assert.ok(!LISTA_PLATE_SILVER.includes("SIN CLASIFICAR"), "SIN CLASIFICAR no se escribe en la lista: se agrega siempre, primero");
});

test("clasificacionesPropiasDeEmpresa: null si la empresa no tiene lista; devuelve una copia; no confunde claves heredadas", () => {
  assert.deepEqual(clasificacionesPropiasDeEmpresa("bradenton"), LISTA_BRADENTON);
  assert.deepEqual(clasificacionesPropiasDeEmpresa("plate-silver"), LISTA_PLATE_SILVER);
  assert.equal(clasificacionesPropiasDeEmpresa("havanna-peru"), null);
  assert.equal(clasificacionesPropiasDeEmpresa("constructor"), null);
  assert.equal(clasificacionesPropiasDeEmpresa("toString"), null);
  const copia = clasificacionesPropiasDeEmpresa("bradenton")!;
  copia.push("INVENTADA");
  assert.deepEqual(CLASIFICACIONES_POR_EMPRESA.bradenton, LISTA_BRADENTON, "modificar la copia no toca la config");
  assert.deepEqual(clasificacionesPropiasDeEmpresa("x", { x: ["A", "B"] }), ["A", "B"]);
});

test("Bradenton: se ofrece SIN CLASIFICAR primero y después las 18 (las 17 del libro y OTROS), sin consultar la base ni traer lo global", async () => {
  const m = mundoBase();
  m.movs = [mov("a", { clasificacion: "PROV Y SERV" }), mov("b", { unidadNegocio: "BRILLANTE", clasificacion: "SOLO DE BRILLANTE" })];
  await conMundo(m, async () => {
    const p = prisma as unknown as { movimientoBancario: { groupBy: () => Promise<never> } };
    p.movimientoBancario.groupBy = async () => {
      throw new Error("la lista propia no debe consultar la base");
    };
    const lista = await clasificacionesParaEditar(["BRADENTON"], [], "bradenton");
    assert.deepEqual(lista, ["SIN CLASIFICAR", ...LISTA_BRADENTON]);
    assert.equal(lista.length, 19);
    assert.equal(lista[lista.length - 1], "OTROS");
    for (const ajena of ["PROV Y SERV", "IMP Y PREVISIONALES", "Gastos bancarios", "SOLO DE BRILLANTE", "AVION"]) {
      assert.equal(lista.includes(ajena), false, `${ajena} no se ofrece en Bradenton`);
    }
  });
});

test("Romina (Bradenton) puede poner cada una de las 18 (OTROS incluida) y volver a SIN CLASIFICAR", async () => {
  const m = mundoBase();
  m.movs = [mov("a")];
  await conMundo(m, async () => {
    for (const c of LISTA_BRADENTON) {
      assert.deepEqual(await editar(ROMINA, "emp-brad", "a", { clasificacion: c }), { ok: true }, c);
      assert.equal(m.movs[0].clasificacion, c);
    }
    assert.deepEqual(await editar(ROMINA, "emp-brad", "a", { clasificacion: "SIN CLASIFICAR" }), { ok: true });
    assert.equal(m.movs[0].clasificacion, "SIN CLASIFICAR");
  });
});

test("Romina NO puede poner un valor de la lista general que no está en la de Bradenton (ni uno inventado)", async () => {
  const m = mundoBase();
  m.movs = [mov("a")];
  await conMundo(m, async () => {
    for (const c of ["PROV Y SERV", "IMP Y PREVISIONALES", "Gastos bancarios", "SAC", "AVION", "INVENTADA XYZ", "cobranzas ", "Cobranzas"]) {
      const r = await editar(ROMINA, "emp-brad", "a", { clasificacion: c });
      assert.equal(r.ok, false, c);
    }
  });
  assert.equal(m.movs[0].clasificacion, "SIN CLASIFICAR");
  assert.equal(m.escrituras, 0);
});

test("una fila de Bradenton con un valor viejo fuera de la lista: se puede corregir a uno de la lista, pero no volver a ese valor", async () => {
  const m = mundoBase();
  m.movs = [mov("vieja", { clasificacion: "PROV Y SERV" })];
  await conMundo(m, async () => {
    assert.equal((await editar(ROMINA, "emp-brad", "vieja", { clasificacion: "PROV Y SERV" })).ok, false, "no se vuelve a elegir");
    assert.deepEqual(await editar(ROMINA, "emp-brad", "vieja", { clasificacion: "COMPRA MERCS C-STORE" }), { ok: true });
    assert.equal(m.movs[0].clasificacion, "COMPRA MERCS C-STORE");
    assert.equal((await editar(ROMINA, "emp-brad", "vieja", { clasificacion: "PROV Y SERV" })).ok, false);
  });
});

test("las demás empresas NO cambian: Conexión, Havanna Perú y Brillante siguen con la lista general (canónicas + las suyas + SIN CLASIFICAR)", async () => {
  const m = mundoBase();
  m.movs = [mov("c", { unidadNegocio: "LOGISTICA", clasificacion: "UNA PROPIA DE CONEXION" }), mov("b", { unidadNegocio: "BRILLANTE", clasificacion: "SOLO DE BRILLANTE" })];
  await conMundo(m, async () => {
    const conexion = await clasificacionesParaEditar(["LOGISTICA", "SPP"], ["AVION", "MS", "PRESTAMO MS"], "conexion-logistica");
    for (const c of CLASIFICACIONES_SUGERIDAS.filter((x) => !["AVION"].includes(x))) assert.ok(conexion.includes(c), `Conexión sigue ofreciendo ${c}`);
    assert.ok(conexion.includes("UNA PROPIA DE CONEXION") && conexion.includes("SIN CLASIFICAR"));
    assert.equal(conexion.includes("AVION"), false, "las ocultas para el gerente siguen ocultas");
    assert.equal(conexion.includes("SOLO DE BRILLANTE"), false);
    assert.equal(conexion.includes("DEP EFECTIVO"), false, "lo de Bradenton no se filtra a las demás");
    for (const slug of ["havanna-peru", "brillante"]) {
      const lista = await clasificacionesParaEditar(["X"], [], slug);
      for (const c of CLASIFICACIONES_SUGERIDAS) assert.ok(lista.includes(c), `${slug} sigue ofreciendo ${c}`);
      assert.equal(lista.includes("LOTTERY"), false);
    }
    // Sin slug (como antes de este cambio) también es la lista general.
    assert.ok((await clasificacionesParaEditar(["LOGISTICA"], [])).includes("PROV Y SERV"));
  });
});

test("las clasificaciones ocultas para el gerente se siguen aplicando también sobre una lista propia", async () => {
  const m = mundoBase();
  await conMundo(m, async () => {
    assert.deepEqual(await clasificacionesParaEditar(["BRADENTON"], ["LOTTERY", "TAX"], "bradenton"), ["SIN CLASIFICAR", ...LISTA_BRADENTON.filter((c) => c !== "LOTTERY" && c !== "TAX")]);
  });
});

test("Ejecución global, el Reporte y las equivalencias NO se tocaron: nadie más lee la lista propia", () => {
  const usan = ["app/ejecucion/actions.ts", "lib/rubros.ts", "lib/reporte.ts", "lib/clasificaciones.ts", "lib/reporte/motor.ts", "lib/reporte/cargarMeses.ts"];
  for (const ruta of usan) assert.equal(/CLASIFICACIONES_POR_EMPRESA|clasificacionesPropiasDeEmpresa/.test(leer(...ruta.split("/"))), false, ruta);
  // La pantalla de la empresa y la acción le pasan el slug a la función; solo eso la activa.
  assert.match(leer("app", "[empresa]", "[periodo]", "ejecucion", "datos.ts"), /clasificacionesParaEditar\(unidades, clasificacionesOcultasParaUsuario\(slugDeEmpresa\(empresa\.nombre\), usuario\), slugDeEmpresa\(empresa\.nombre\)\)/);
  assert.match(leer("lib", "clasificarPorEmpresaDb.ts"), /clasificacionesParaEditar\(empresa\.unidadesNegocio, ocultasNormalizadas, slugDeEmpresa\(empresa\.nombre\)\)/);
  // Ejecución global sigue ofreciendo la lista global de siempre.
  assert.match(leer("app", "ejecucion", "actions.ts"), /const clasificacionesPromise = calcularClasificacionesDisponibles\(\);/);
});

// ---------- lista PROPIA de Plate Silver ----------

function mundoPlate(): Mundo {
  const m = mundoBase();
  m.empresas = [BRADENTON, CONEXION, BRILLANTE, PLATE_SILVER];
  m.accesos = { "u-romina|emp-brad": true, "u-romina|emp-ps": true };
  return m;
}
const movPlate = (id: string, o: Partial<Mov> = {}) => mov(id, { unidadNegocio: "PLATE SILVER", bancoYCuenta: "BROU USD", concepto: "SPI - COMISIÓN", ...o });

test("Plate Silver: se ofrece SIN CLASIFICAR primero, después los 29 de Romina en su orden y OTROS una sola vez, al final (31), sin consultar la base", async () => {
  const m = mundoPlate();
  m.movs = [movPlate("a", { clasificacion: "PROV Y SERV" }), movPlate("b", { clasificacion: "UNA VIEJA" })];
  await conMundo(m, async () => {
    const p = prisma as unknown as { movimientoBancario: { groupBy: () => Promise<never> } };
    p.movimientoBancario.groupBy = async () => {
      throw new Error("la lista propia no debe consultar la base");
    };
    const lista = await clasificacionesParaEditar(["PLATE SILVER"], [], "plate-silver");
    assert.deepEqual(lista, ["SIN CLASIFICAR", ...LISTA_PLATE_SILVER]);
    assert.equal(lista.length, 31);
    assert.equal(lista[0], "SIN CLASIFICAR");
    assert.equal(lista[lista.length - 1], "OTROS");
    assert.equal(lista.filter((c) => c === "OTROS").length, 1, "el sistema no agrega OTROS por su cuenta");
    for (const ajena of ["PROV Y SERV", "IMP Y PREVISIONALES", "Gastos bancarios", "UNA VIEJA", "DEP EFECTIVO", "LOTTERY", "SUELDOS"]) {
      assert.equal(lista.includes(ajena), false, `${ajena} no se ofrece en Plate Silver`);
    }
  });
});

test("Romina (Plate Silver) puede poner cada una de las 30 (OTROS incluida) y volver a SIN CLASIFICAR", async () => {
  const m = mundoPlate();
  m.movs = [movPlate("a")];
  await conMundo(m, async () => {
    for (const c of LISTA_PLATE_SILVER) {
      assert.deepEqual(await editar(ROMINA, "emp-ps", "a", { clasificacion: c }), { ok: true }, c);
      assert.equal(m.movs[0].clasificacion, c);
    }
    assert.deepEqual(await editar(ROMINA, "emp-ps", "a", { clasificacion: "SIN CLASIFICAR" }), { ok: true });
    assert.equal(m.movs[0].clasificacion, "SIN CLASIFICAR");
  });
});

test("Romina NO puede poner en Plate Silver un valor de la lista general, de Bradenton o inventado", async () => {
  const m = mundoPlate();
  m.movs = [movPlate("a")];
  await conMundo(m, async () => {
    for (const c of ["PROV Y SERV", "Gastos bancarios", "AVION", "LOTTERY", "COBRANZAS", "SUELDOS", "INVENTADA XYZ", "cobranza de cliente", "COBRANZA DE CLIENTE "]) {
      assert.equal((await editar(ROMINA, "emp-ps", "a", { clasificacion: c })).ok, false, c);
    }
  });
  assert.equal(m.movs[0].clasificacion, "SIN CLASIFICAR");
  assert.equal(m.escrituras, 0);
});

test("Bradenton y las demás NO cambian al sumar la lista de Plate Silver", async () => {
  const m = mundoPlate();
  m.movs = [mov("b"), mov("c", { unidadNegocio: "BRILLANTE" })];
  await conMundo(m, async () => {
    // Bradenton: exactamente la suya (SIN CLASIFICAR + 18), sin nada de Plate Silver.
    const brad = await clasificacionesParaEditar(["BRADENTON"], [], "bradenton");
    assert.deepEqual(brad, ["SIN CLASIFICAR", ...LISTA_BRADENTON]);
    assert.equal(brad.length, 19);
    for (const ps of ["COBRANZA DE CLIENTE", "SUELDO", "AGUINALDO", "TRANSFERENCIA ENTRE CUENTAS"]) assert.equal(brad.includes(ps), false, `${ps} no es de Bradenton`);
    // Y Romina sigue clasificando Bradenton con la suya.
    assert.deepEqual(await editar(ROMINA, "emp-brad", "b", { clasificacion: "COBRANZAS" }), { ok: true });
    assert.equal((await editar(ROMINA, "emp-brad", "b", { clasificacion: "COBRANZA DE CLIENTE" })).ok, false);
    // Las demás: lista general, sin lo de Plate Silver.
    for (const slug of ["havanna-peru", "brillante", "conexion-logistica"]) {
      const lista = await clasificacionesParaEditar(["X"], [], slug);
      for (const c of CLASIFICACIONES_SUGERIDAS) assert.ok(lista.includes(c), `${slug} sigue ofreciendo ${c}`);
      assert.equal(lista.includes("COBRANZA DE CLIENTE"), false, `${slug} no recibe lo de Plate Silver`);
    }
  });
});
