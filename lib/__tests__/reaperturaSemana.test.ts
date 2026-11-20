import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Prisma, Rol } from "@prisma/client";
import { puedeReabrirSemana, veReaperturas } from "@/lib/permisosReapertura";
import {
  MOTIVO_MAXIMO,
  MOTIVO_MINIMO,
  avisosDeReapertura,
  decidirOtrasAbiertas,
  reaperturaVigente,
  textoReapertura,
  validarMotivo,
  type ReaperturaVista,
} from "@/lib/reaperturaSemana";

// "Reabrir semana para corregir" (solo ADMIN). Cubre: reglas puras, permisos por rol, el núcleo con una base falsa en memoria
// (con deshacer de transacción), la acción con el guard mockeado, y tests estáticos (guard, aislamiento del dato, migración).
// No toca ninguna base ni forja ninguna sesión.

const ROLES: Rol[] = ["ADMIN", "FINANZAS", "GERENTE", "VIEWER"];

// ---------------------------------------------------------------------------------------------------------------------
// Permisos: SOLO ADMIN, con cualquier combinación de casillas.

test("permisos: solo ADMIN reabre y ve el indicador; FINANZAS, GERENTE y VIEWER no, tengan las casillas que tengan", () => {
  for (const rol of ROLES) {
    const esperado = rol === "ADMIN";
    for (const operaEjecucion of [false, true]) {
      for (const veBloquesReservados of [false, true]) {
        const u = { rol, operaEjecucion, veBloquesReservados };
        assert.equal(puedeReabrirSemana(u), esperado, `reabrir: ${rol}`);
        assert.equal(veReaperturas(u), esperado, `indicador: ${rol}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Reglas puras.

test("motivo: obligatorio, mínimo 10 caracteres sin contar espacios de los bordes, máximo 500", () => {
  for (const malo of ["", "   ", "corto", "         123456789  ", undefined, null, 42]) {
    assert.equal(validarMotivo(malo).ok, false, String(malo));
  }
  const bien = validarMotivo("  Faltó cargar un archivo del 18/11  ");
  assert.deepEqual(bien, { ok: true, motivo: "Faltó cargar un archivo del 18/11" });
  assert.equal(validarMotivo("x".repeat(MOTIVO_MINIMO)).ok, true);
  assert.equal(validarMotivo("x".repeat(MOTIVO_MAXIMO)).ok, true);
  assert.equal(validarMotivo("x".repeat(MOTIVO_MAXIMO + 1)).ok, false);
  assert.equal(MOTIVO_MINIMO, 10);
});

const CTX = { periodo: "2026-11", numeroReabierta: 1 };
const vacia = (numeroSemana: number) => ({ numeroSemana, movimientos: 0, adjuntos: 0, desgloses: 0, reaperturas: 0 });

test("otra semana abierta: ninguna => sigue; vacía => se borra; con algo adentro => se rechaza nombrándola", () => {
  assert.deepEqual(decidirOtrasAbiertas([], CTX), { tipo: "ninguna" });
  assert.deepEqual(decidirOtrasAbiertas([vacia(2)], CTX), { tipo: "borrar", numeros: [2] });

  const conMovimientos = decidirOtrasAbiertas([{ ...vacia(2), movimientos: 7 }], CTX);
  assert.equal(conMovimientos.tipo, "rechazar");
  if (conMovimientos.tipo === "rechazar") {
    assert.equal(conMovimientos.numeroSemana, 2);
    assert.match(conMovimientos.mensaje, /semana 2/);
    assert.match(conMovimientos.mensaje, /7 movimientos/);
    assert.match(conMovimientos.mensaje, /noviembre 2026/);
    assert.match(conMovimientos.mensaje, /Cerrala primero con el cierre normal y después reabrí la semana 1/);
  }
  const uno = decidirOtrasAbiertas([{ ...vacia(2), movimientos: 1 }], CTX);
  if (uno.tipo === "rechazar") assert.match(uno.mensaje, /1 movimiento,|1 movimiento\b(?!s)/);
});

test("otra semana abierta: adjuntos, prorrateos o historial de reaperturas también impiden borrarla", () => {
  for (const campo of ["adjuntos", "desgloses", "reaperturas"] as const) {
    const r = decidirOtrasAbiertas([{ ...vacia(3), [campo]: 1 }], CTX);
    assert.equal(r.tipo, "rechazar", campo);
  }
  // Una vacía y otra con contenido: se rechaza (no se borra nada) y se nombra la que tiene contenido.
  const mezcla = decidirOtrasAbiertas([vacia(2), { ...vacia(4), movimientos: 3 }], CTX);
  assert.equal(mezcla.tipo, "rechazar");
  if (mezcla.tipo === "rechazar") assert.equal(mezcla.numeroSemana, 4);
  // Dos vacías: se borran las dos.
  assert.deepEqual(decidirOtrasAbiertas([vacia(4), vacia(2)], CTX), { tipo: "borrar", numeros: [2, 4] });
});

test("cuadro de confirmación: avisa las tres cosas, y una cuarta si el mes ya pasó", () => {
  const actual = avisosDeReapertura("2026-11", 2, "2026-11");
  assert.equal(actual.length, 3, "mes en curso: solo las tres");
  assert.match(actual[0], /deja de contar en el Reporte/);
  assert.match(actual[0], /semana 2/);
  assert.match(actual[1], /valores manuales/);
  assert.match(actual[2], /archivo madre o extracto/);
  assert.match(actual[2], /noviembre 2026/);
  assert.match(actual[2], /semana 2/);

  const viejo = avisosDeReapertura("2026-09", 1, "2026-11");
  assert.equal(viejo.length, 4);
  assert.match(viejo[3], /septiembre 2026 ya terminó/);
});

const R = (id: string, extra: Partial<ReaperturaVista> = {}): ReaperturaVista => ({
  id,
  usuarioNombre: "Leticia Araoz",
  motivo: "Faltó un archivo",
  creadaEn: "2026-11-20T15:00:00.000Z",
  movimientosAlReabrir: 10,
  semanaVaciaEliminada: null,
  ...extra,
});

test("indicador: 'Reabierta por X el dd/mm. Motivo: …' y solo está vigente si la semana está ABIERTA y tiene reaperturas", () => {
  assert.equal(textoReapertura(R("a")), "Reabierta por Leticia Araoz el 20/11. Motivo: Faltó un archivo");
  const lista = [R("nueva"), R("vieja")];
  assert.equal(reaperturaVigente("ABIERTA", lista)?.id, "nueva");
  assert.equal(reaperturaVigente("CERRADA", lista), null, "cerrada de nuevo: queda el historial, no el indicador");
  assert.equal(reaperturaVigente("ABIERTA", []), null, "semana nunca reabierta");
});

// ---------------------------------------------------------------------------------------------------------------------
// Base falsa en memoria (solo lo que usa el núcleo), con deshacer de transacción.

type Semana = { id: string; periodo: string; numeroSemana: number; estado: "ABIERTA" | "CERRADA"; fechaCierre: Date | null; cerradoPorId: string | null };
type Estado = {
  semanas: Semana[];
  movimientos: { id: string; ejecucionId: string }[];
  adjuntos: { movimientoId: string }[];
  desgloses: { movimientoId: string }[];
  reaperturas: Record<string, unknown>[];
};

function cierre(id: string, periodo: string, numeroSemana: number): Semana {
  return { id, periodo, numeroSemana, estado: "CERRADA", fechaCierre: new Date("2026-11-10T12:00:00Z"), cerradoPorId: "u-fin" };
}
function abierta(id: string, periodo: string, numeroSemana: number): Semana {
  return { id, periodo, numeroSemana, estado: "ABIERTA", fechaCierre: null, cerradoPorId: null };
}

function baseFalsa(inicial: Estado) {
  let estado: Estado = structuredClone(inicial);
  const log: string[] = [];
  const idsDeMovimientosDe = (ejecucionId: string) => estado.movimientos.filter((m) => m.ejecucionId === ejecucionId).map((m) => m.id);
  const tx = {
    $executeRaw: async () => {
      log.push("set-timeout");
      return 0;
    },
    $queryRaw: async () => {
      log.push("lock");
      return [];
    },
    ejecucionSemanal: {
      // Una COPIA, como hace Prisma: lo leído no cambia cuando después se actualiza la fila.
      findUnique: async ({ where }: { where: { periodo_numeroSemana: { periodo: string; numeroSemana: number } } }) => {
        const s = estado.semanas.find((x) => x.periodo === where.periodo_numeroSemana.periodo && x.numeroSemana === where.periodo_numeroSemana.numeroSemana);
        return s ? { ...s } : null;
      },
      findMany: async ({ where }: { where: { periodo: string; estado: string; id: { not: string } } }) =>
        estado.semanas.filter((s) => s.periodo === where.periodo && s.estado === where.estado && s.id !== where.id.not).map((s) => ({ id: s.id, numeroSemana: s.numeroSemana })),
      deleteMany: async ({ where }: { where: { id: { in: string[] }; estado: string } }) => {
        const borrar = estado.semanas.filter((s) => where.id.in.includes(s.id) && s.estado === where.estado);
        // Igual que la clave foránea (RESTRICT) de MovimientoBancario: no se borra una semana con movimientos.
        for (const s of borrar) if (idsDeMovimientosDe(s.id).length > 0) throw new Error("FK RESTRICT: la semana tiene movimientos");
        estado.semanas = estado.semanas.filter((s) => !borrar.includes(s));
        log.push(`delete:${borrar.map((s) => s.numeroSemana).join(",")}`);
        return { count: borrar.length };
      },
      updateMany: async ({ where, data }: { where: { id: string; estado: string }; data: Partial<Semana> }) => {
        const s = estado.semanas.find((x) => x.id === where.id && x.estado === where.estado);
        if (!s) return { count: 0 };
        Object.assign(s, data);
        log.push(`update:${s.numeroSemana}`);
        return { count: 1 };
      },
    },
    movimientoBancario: { count: async ({ where }: { where: { ejecucionId: string } }) => idsDeMovimientosDe(where.ejecucionId).length },
    adjunto: {
      count: async ({ where }: { where: { movimiento: { ejecucionId: string } } }) => {
        const ids = idsDeMovimientosDe(where.movimiento.ejecucionId);
        return estado.adjuntos.filter((a) => ids.includes(a.movimientoId)).length;
      },
    },
    movimientoBancarioDesglose: {
      count: async ({ where }: { where: { movimiento: { ejecucionId: string } } }) => {
        const ids = idsDeMovimientosDe(where.movimiento.ejecucionId);
        return estado.desgloses.filter((d) => ids.includes(d.movimientoId)).length;
      },
    },
    reaperturaSemana: {
      count: async ({ where }: { where: { ejecucionId: string } }) => estado.reaperturas.filter((r) => r.ejecucionId === where.ejecucionId).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        estado.reaperturas.push(data);
        log.push("registro");
        return data;
      },
    },
  };
  // Como prisma.$transaction: si la función tira, se deshace todo.
  const transaccion = async <T>(fn: (t: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
    const copia = structuredClone(estado);
    try {
      return await fn(tx as unknown as Prisma.TransactionClient);
    } catch (e) {
      estado = copia;
      throw e;
    }
  };
  return { tx: tx as unknown as Prisma.TransactionClient, transaccion, log, leer: () => estado };
}

const mov = (id: string, ejecucionId: string) => ({ id, ejecucionId });
const DATOS = { periodo: "2026-11", numeroSemana: 1, motivo: "Faltó cargar un archivo", usuario: { id: "u-admin", nombre: "Leticia Araoz" } };
const vacioEstado = (): Estado => ({ semanas: [], movimientos: [], adjuntos: [], desgloses: [], reaperturas: [] });

// El núcleo se carga con el stub de prisma que se arma más abajo (el módulo importa "@/lib/prisma").
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Mod = Module as any;
const cargarOriginal = Mod._load;
const ESPIA = {
  guardLlamadas: 0,
  orden: [] as string[],
  rolActual: "ADMIN" as Rol,
  transacciones: 0,
  consultasReaperturas: 0,
  revalidadas: [] as string[],
  baseActual: null as ReturnType<typeof baseFalsa> | null,
  filasReaperturas: [] as { id: string; usuarioNombre: string; motivo: string; createdAt: Date; movimientosAlReabrir: number; semanaVaciaEliminada: number | null }[],
};

class PermisoDenegadoFalso extends Error {}
Mod._load = function (request: string, ...resto: unknown[]) {
  if (request === "@/lib/prisma") {
    return {
      prisma: {
        $transaction: async (fn: (t: Prisma.TransactionClient) => Promise<unknown>) => {
          ESPIA.transacciones++;
          ESPIA.orden.push("transaccion");
          return ESPIA.baseActual!.transaccion(fn);
        },
        reaperturaSemana: {
          findMany: async () => {
            ESPIA.consultasReaperturas++;
            return ESPIA.filasReaperturas;
          },
        },
      },
    };
  }
  if (request === "@/lib/auth") {
    // Misma regla que el requireAdmin real (lib/auth.ts): solo rol ADMIN; si no, tira. Lo demás de la acción corre de verdad.
    return {
      requireAdmin: async () => {
        ESPIA.guardLlamadas++;
        ESPIA.orden.push("guard");
        if (ESPIA.rolActual !== "ADMIN") throw new PermisoDenegadoFalso("No tenés permisos de administrador.");
        return { id: "u-admin", nombre: "Leticia Araoz", rol: "ADMIN" };
      },
    };
  }
  if (request === "next/cache") {
    return { revalidatePath: (ruta: string) => ESPIA.revalidadas.push(ruta) };
  }
  return cargarOriginal.call(this, request, ...resto);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { reabrirSemanaEnTx, obtenerReaperturasParaAdmin } = require("@/lib/reaperturaSemanaDb") as typeof import("@/lib/reaperturaSemanaDb");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { reabrirSemana } = require("@/app/ejecucion/actionsReabrir") as typeof import("@/app/ejecucion/actionsReabrir");
Mod._load = cargarOriginal;

function reiniciarEspia(rol: Rol, inicial: Estado = vacioEstado()) {
  ESPIA.guardLlamadas = 0;
  ESPIA.orden = [];
  ESPIA.rolActual = rol;
  ESPIA.transacciones = 0;
  ESPIA.consultasReaperturas = 0;
  ESPIA.revalidadas = [];
  ESPIA.baseActual = baseFalsa(inicial);
  return ESPIA.baseActual;
}

// ---------------------------------------------------------------------------------------------------------------------
// Núcleo con base falsa.

test("reabre una semana cerrada: vuelve a ABIERTA, se limpia el cierre y queda el registro con quién, cuándo (createdAt) y por qué", async () => {
  const base = baseFalsa({ ...vacioEstado(), semanas: [cierre("s1", "2026-11", 1)], movimientos: [mov("m1", "s1"), mov("m2", "s1")] });
  const r = await base.transaccion((tx) => reabrirSemanaEnTx(tx, DATOS));
  assert.deepEqual(r, { ok: true, semanaVaciaEliminada: null });
  const s = base.leer().semanas[0];
  assert.equal(s.estado, "ABIERTA");
  assert.equal(s.fechaCierre, null);
  assert.equal(s.cerradoPorId, null);
  const [reg] = base.leer().reaperturas;
  assert.equal(reg.ejecucionId, "s1");
  assert.equal(reg.motivo, "Faltó cargar un archivo");
  assert.equal(reg.usuarioId, "u-admin");
  assert.equal(reg.usuarioNombre, "Leticia Araoz");
  assert.equal(reg.movimientosAlReabrir, 2);
  assert.equal(reg.cerradoPorIdAnterior, "u-fin", "se guarda quién había cerrado");
  assert.deepEqual(reg.fechaCierreAnterior, new Date("2026-11-10T12:00:00Z"), "se guarda cuándo se había cerrado");
  assert.equal(reg.semanaVaciaEliminada, null);
  assert.deepEqual(base.log.slice(0, 2), ["set-timeout", "lock"], "primero el lock del período");
});

test("no hay nada que reabrir: semana inexistente o que no está cerrada (no se escribe nada)", async () => {
  const base = baseFalsa({ ...vacioEstado(), semanas: [abierta("s1", "2026-11", 1)] });
  const noCerrada = await base.transaccion((tx) => reabrirSemanaEnTx(tx, DATOS));
  assert.equal(noCerrada.ok, false);
  const noExiste = await base.transaccion((tx) => reabrirSemanaEnTx(tx, { ...DATOS, numeroSemana: 9 }));
  assert.equal(noExiste.ok, false);
  assert.deepEqual(base.leer().reaperturas, []);
  assert.equal(base.leer().semanas.length, 1);
});

test("otra semana abierta CON movimientos: se rechaza nombrándola y no cambia nada (ni la reabierta, ni registro)", async () => {
  const base = baseFalsa({
    ...vacioEstado(),
    semanas: [cierre("s1", "2026-11", 1), abierta("s2", "2026-11", 2)],
    movimientos: [mov("m1", "s1"), mov("m2", "s2")],
  });
  const r = await base.transaccion((tx) => reabrirSemanaEnTx(tx, DATOS));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.error, /semana 2/);
    assert.match(r.error, /1 movimiento/);
    assert.match(r.error, /cierre normal/);
  }
  const e = base.leer();
  assert.equal(e.semanas.find((s) => s.id === "s1")!.estado, "CERRADA");
  assert.equal(e.semanas.length, 2);
  assert.deepEqual(e.reaperturas, []);
});

test("otra semana abierta VACÍA: se borra en la misma transacción, la reabierta queda ABIERTA y se registra cuál se borró", async () => {
  const base = baseFalsa({
    ...vacioEstado(),
    semanas: [cierre("s1", "2026-11", 1), abierta("s2", "2026-11", 2), cierre("o1", "2026-10", 1), abierta("o2", "2026-10", 2)],
    movimientos: [mov("m1", "s1")],
  });
  const r = await base.transaccion((tx) => reabrirSemanaEnTx(tx, DATOS));
  assert.deepEqual(r, { ok: true, semanaVaciaEliminada: 2 });
  const e = base.leer();
  assert.deepEqual(e.semanas.map((s) => s.id).sort(), ["o1", "o2", "s1"], "solo se borró la vacía de ESTE período");
  assert.equal(e.semanas.find((s) => s.id === "s1")!.estado, "ABIERTA");
  assert.equal(e.reaperturas[0].semanaVaciaEliminada, 2);
  assert.ok(base.log.indexOf("delete:2") < base.log.indexOf("update:1"), "se borra antes de reabrir");
});

test("otra semana abierta sin movimientos pero con adjuntos, prorrateos o historial: NO se borra, se rechaza", async () => {
  const casos: { nombre: string; estado: Estado }[] = [
    {
      nombre: "historial de reaperturas",
      estado: { ...vacioEstado(), semanas: [cierre("s1", "2026-11", 1), abierta("s2", "2026-11", 2)], reaperturas: [{ ejecucionId: "s2" }] },
    },
    {
      // Estado imposible de lograr con la FK (no hay adjuntos sin movimiento) pero el chequeo cuenta igual: se prueba la cuenta.
      nombre: "adjunto huérfano",
      estado: { ...vacioEstado(), semanas: [cierre("s1", "2026-11", 1), abierta("s2", "2026-11", 2)], movimientos: [mov("m9", "s2")], adjuntos: [{ movimientoId: "m9" }] },
    },
    {
      nombre: "prorrateo",
      estado: { ...vacioEstado(), semanas: [cierre("s1", "2026-11", 1), abierta("s2", "2026-11", 2)], movimientos: [mov("m9", "s2")], desgloses: [{ movimientoId: "m9" }] },
    },
  ];
  for (const c of casos) {
    const base = baseFalsa(c.estado);
    const r = await base.transaccion((tx) => reabrirSemanaEnTx(tx, DATOS));
    assert.equal(r.ok, false, c.nombre);
    assert.equal(base.leer().semanas.length, 2, c.nombre);
    assert.equal(base.leer().semanas.find((s) => s.id === "s1")!.estado, "CERRADA", c.nombre);
  }
});

test("si el borrado falla (clave foránea), la transacción se deshace entera: la semana sigue CERRADA y sin registro", async () => {
  // La decisión es "borrar" (al contar estaba vacía) pero una carga entra antes del borrado: la base (RESTRICT) lo rechaza.
  const base = baseFalsa({ ...vacioEstado(), semanas: [cierre("s1", "2026-11", 1), abierta("s2", "2026-11", 2)] });
  const conCarrera = {
    ...(base.tx as object),
    movimientoBancario: {
      count: async () => {
        base.leer().movimientos.push(mov("tarde", "s2")); // aparece justo después de contar
        return 0;
      },
    },
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(() => base.transaccion(() => reabrirSemanaEnTx(conCarrera, DATOS)), /FK RESTRICT/);
  const e = base.leer();
  assert.equal(e.semanas.find((s) => s.id === "s1")!.estado, "CERRADA");
  assert.equal(e.semanas.length, 2);
  assert.deepEqual(e.reaperturas, []);
  assert.equal(e.movimientos.length, 0, "el estado volvió al de antes de la transacción");
});

test("una semana reabierta se puede volver a reabrir después de cerrarla de nuevo: queda un registro por cada vez, la más nueva primero en la lectura", async () => {
  const base = baseFalsa({ ...vacioEstado(), semanas: [cierre("s1", "2026-11", 1)] });
  await base.transaccion((tx) => reabrirSemanaEnTx(tx, DATOS));
  // El cierre normal (cerrarSemana) la vuelve a cerrar:
  Object.assign(base.leer().semanas[0], { estado: "CERRADA", fechaCierre: new Date(), cerradoPorId: "u-fin" });
  await base.transaccion((tx) => reabrirSemanaEnTx(tx, { ...DATOS, motivo: "Otra corrección más" }));
  assert.equal(base.leer().reaperturas.length, 2);
});

// ---------------------------------------------------------------------------------------------------------------------
// La acción con el guard mockeado (el resto de la acción y el núcleo corren de verdad).

test("acción: con ADMIN reabre, y el guard corre ANTES de abrir la transacción; revalida la semana", async () => {
  reiniciarEspia("ADMIN", { ...vacioEstado(), semanas: [cierre("s1", "2026-11", 1)], movimientos: [mov("m1", "s1")] });
  const r = await reabrirSemana("2026-11", 1, "Faltó cargar un archivo");
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(ESPIA.orden, ["guard", "transaccion"]);
  assert.equal(ESPIA.baseActual!.leer().semanas[0].estado, "ABIERTA");
  assert.equal(ESPIA.baseActual!.leer().reaperturas.length, 1);
  assert.ok(ESPIA.revalidadas.includes("/ejecucion/2026-11/1"));
});

test("acción: FINANZAS, GERENTE y VIEWER son rechazados por el guard y NO se toca la base (ni transacción)", async () => {
  for (const rol of ["FINANZAS", "GERENTE", "VIEWER"] as Rol[]) {
    const base = reiniciarEspia(rol, { ...vacioEstado(), semanas: [cierre("s1", "2026-11", 1)] });
    await assert.rejects(() => reabrirSemana("2026-11", 1, "Faltó cargar un archivo"), PermisoDenegadoFalso, rol);
    assert.equal(ESPIA.guardLlamadas, 1, rol);
    assert.equal(ESPIA.transacciones, 0, `${rol}: no abrió transacción`);
    assert.equal(base.leer().semanas[0].estado, "CERRADA", rol);
    assert.deepEqual(base.leer().reaperturas, [], rol);
    assert.deepEqual(ESPIA.revalidadas, [], rol);
  }
});

test("acción: motivo inválido o semana/período inválidos no abren transacción (el guard igual corre primero)", async () => {
  reiniciarEspia("ADMIN", { ...vacioEstado(), semanas: [cierre("s1", "2026-11", 1)] });
  const corto = await reabrirSemana("2026-11", 1, "corto");
  assert.equal(corto.ok, false);
  await assert.rejects(() => reabrirSemana("noviembre", 1, "Faltó cargar un archivo"), /período válido/);
  await assert.rejects(() => reabrirSemana("2026-11", 0, "Faltó cargar un archivo"), /semana válido/);
  await assert.rejects(() => reabrirSemana("2026-11", 1.5, "Faltó cargar un archivo"), /semana válido/);
  assert.equal(ESPIA.transacciones, 0);
  assert.equal(ESPIA.guardLlamadas, 4);
  assert.equal(ESPIA.baseActual!.leer().semanas[0].estado, "CERRADA");
});

test("acción: si el núcleo rechaza (otra semana abierta con movimientos), devuelve el mensaje y no revalida", async () => {
  reiniciarEspia("ADMIN", {
    ...vacioEstado(),
    semanas: [cierre("s1", "2026-11", 1), abierta("s2", "2026-11", 2)],
    movimientos: [mov("m2", "s2")],
  });
  const r = await reabrirSemana("2026-11", 1, "Faltó cargar un archivo");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /semana 2/);
  assert.deepEqual(ESPIA.revalidadas, []);
});

// ---------------------------------------------------------------------------------------------------------------------
// Indicador e historial: SOLO ADMIN (el dato ni se consulta para el resto).

test("indicador/historial: para ADMIN trae las reaperturas; para FINANZAS, GERENTE y VIEWER devuelve null SIN consultar la base", async () => {
  ESPIA.filasReaperturas = [
    { id: "r1", usuarioNombre: "Leticia Araoz", motivo: "Faltó un archivo", createdAt: new Date("2026-11-20T15:00:00Z"), movimientosAlReabrir: 5, semanaVaciaEliminada: null },
  ];
  for (const rol of ROLES) {
    ESPIA.consultasReaperturas = 0;
    const r = await obtenerReaperturasParaAdmin({ rol }, "2026-11", 1);
    if (rol === "ADMIN") {
      assert.equal(ESPIA.consultasReaperturas, 1);
      assert.deepEqual(r, [{ id: "r1", usuarioNombre: "Leticia Araoz", motivo: "Faltó un archivo", creadaEn: "2026-11-20T15:00:00.000Z", movimientosAlReabrir: 5, semanaVaciaEliminada: null }]);
    } else {
      assert.equal(r, null, `${rol} no ve el indicador`);
      assert.equal(ESPIA.consultasReaperturas, 0, `${rol}: no se consultó la base`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Estáticos.

const RAIZ = join(__dirname, "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function archivos(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next" || nombre === ".git" || nombre === "__tests__") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}
const rel = (f: string) => relative(RAIZ, f).replace(/\\/g, "/");

test("estático: la acción vive en su propio archivo 'use server', exporta solo reabrirSemana y llama a requireAdmin como PRIMERA sentencia", () => {
  const fuente = leer("app/ejecucion/actionsReabrir.ts");
  assert.match(fuente.replace(/^(\s|\/\/[^\n]*\n)*/, ""), /^["']use server["']/);
  const exportadas = [...sinComentarios(fuente).matchAll(/^export\s+(async\s+function\s+(\w+)|type\s+(\w+))/gm)].map((m) => m[2] ?? `type:${m[3]}`);
  assert.deepEqual([...exportadas].sort(), ["reabrirSemana", "type:ResultadoReabrir"]);
  const cuerpo = sinComentarios(fuente).split(/export async function reabrirSemana\([^)]*\)[^{]*\{\n/)[1];
  assert.ok(cuerpo, "no encontré el cuerpo de reabrirSemana");
  assert.match(cuerpo.trimStart(), /^const usuario = await requireAdmin\(\);/);
});

test("estático: la acción NO usa requireCierreEjecucion, requireAdminOFinanzas ni requireOperador (esos dejan pasar a FINANZAS o a quien opera) y el guard va antes de prisma.", () => {
  const codigo = sinComentarios(leer("app/ejecucion/actionsReabrir.ts"));
  for (const prohibido of ["requireCierreEjecucion", "requireAdminOFinanzas", "requireOperador", "requireCargaMadreEjecucion", "requireVerEjecucionGlobal", "requireUsuario", "requireAccesoEmpresa"]) {
    assert.equal(codigo.includes(prohibido), false, `no puede usar ${prohibido}`);
  }
  assert.ok(codigo.indexOf("requireAdmin(") >= 0 && codigo.indexOf("requireAdmin(") < codigo.indexOf("prisma."));
  // requireAdmin real: solo ADMIN (lib/auth.ts no se toca).
  assert.match(sinComentarios(leer("lib/auth.ts")), /export const requireAdmin = cache\(async \(\): Promise<Usuario> => \{\s*const usuario = await requireUsuarioAlDia\(\);\s*if \(usuario\.rol !== "ADMIN"\) \{\s*throw new PermisoDenegadoError/);
});

test("estático: la lectura del indicador chequea veReaperturas ANTES de cualquier prisma.", () => {
  const codigo = sinComentarios(leer("lib/reaperturaSemanaDb.ts"));
  const inicio = codigo.indexOf("export async function obtenerReaperturasParaAdmin");
  const cuerpo = codigo.slice(inicio);
  assert.ok(cuerpo.indexOf("veReaperturas(") > 0);
  assert.ok(cuerpo.indexOf("veReaperturas(") < cuerpo.indexOf("prisma."));
});

test("estático: ReaperturaSemana, su lectura y sus componentes solo aparecen donde corresponde (nada en el Reporte, el Excel ni la pestaña de la empresa)", () => {
  const PERMITIDOS_MODELO = new Set(["lib/reaperturaSemanaDb.ts"]);
  const PERMITIDOS_DB = new Set(["app/ejecucion/actionsReabrir.ts", "app/ejecucion/[periodo]/[numeroSemana]/page.tsx", "lib/reaperturaSemanaDb.ts"]);
  const PERMITIDOS_COMPONENTES = new Set([
    "app/ejecucion/ReabrirSemana.tsx",
    "app/ejecucion/IndicadorReaperturas.tsx",
    "app/ejecucion/[periodo]/[numeroSemana]/page.tsx",
  ]);
  const PERMITIDOS_PERMISO = new Set([
    "lib/permisosReapertura.ts",
    "lib/reaperturaSemanaDb.ts",
    "app/ejecucion/[periodo]/[numeroSemana]/page.tsx",
  ]);
  const fuera: string[] = [];
  for (const f of [...archivos(join(RAIZ, "app")), ...archivos(join(RAIZ, "lib")), ...archivos(join(RAIZ, "components"))]) {
    const r = rel(f);
    const c = sinComentarios(readFileSync(f, "utf8"));
    if (/\breaperturaSemana\s*\./.test(c) && !PERMITIDOS_MODELO.has(r)) fuera.push(`${r}: usa el modelo`);
    if (/reaperturaSemanaDb/.test(c) && !PERMITIDOS_DB.has(r)) fuera.push(`${r}: importa la lectura`);
    if (/IndicadorReaperturas|<ReabrirSemana|\/ReabrirSemana["']/.test(c) && !PERMITIDOS_COMPONENTES.has(r)) fuera.push(`${r}: usa los componentes`);
    if (/permisosReapertura|puedeReabrirSemana|veReaperturas/.test(c) && !PERMITIDOS_PERMISO.has(r)) fuera.push(`${r}: usa el permiso`);
  }
  assert.deepEqual(fuera, []);
  // Y puntualmente: ni el Reporte, ni el Excel, ni la pestaña de la empresa.
  for (const f of archivos(join(RAIZ, "app", "[empresa]")).concat(archivos(join(RAIZ, "lib", "reporte")))) {
    assert.equal(/reaperturaSemana|ReaperturaSemana|Reapertura/i.test(readFileSync(f, "utf8")), false, rel(f));
  }
});

test("estático: la pantalla solo muestra el indicador si hubo datos (ADMIN) y el botón solo si puedeReabrirSemana y la semana está CERRADA", () => {
  const p = sinComentarios(leer("app/ejecucion/[periodo]/[numeroSemana]/page.tsx"));
  assert.match(p, /obtenerReaperturasParaAdmin\(usuario, periodo, numeroSemana\)/);
  assert.match(p, /reaperturas \? <IndicadorReaperturas/);
  assert.match(p, /datos\.estado === "CERRADA" && puedeReabrirSemana\(usuario\) && \(\s*<ReabrirSemana/);
  assert.equal((p.match(/<IndicadorReaperturas/g) ?? []).length, 1);
  assert.equal((p.match(/<ReabrirSemana/g) ?? []).length, 1);
});

test("estático: la migración es ADITIVA (solo crea ReaperturaSemana), es posterior a 20261119120000 y la clave foránea es RESTRICT", () => {
  const dir = join(RAIZ, "prisma", "migrations");
  const nombre = readdirSync(dir).find((n) => /_reaperturas_semana$/.test(n))!;
  assert.ok(nombre && nombre > "20261119120000", "timestamp posterior a la última migración");
  const sql = sinComentarios(readFileSync(join(dir, nombre, "migration.sql"), "utf8").replace(/^--.*$/gm, ""));
  const sentencias = sql.split(";").map((s) => s.trim()).filter(Boolean);
  assert.equal(sentencias.length, 3);
  assert.match(sentencias[0], /^CREATE TABLE "ReaperturaSemana"/);
  assert.match(sentencias[1], /^CREATE INDEX "ReaperturaSemana_ejecucionId_idx"/);
  assert.match(sentencias[2], /^ALTER TABLE "ReaperturaSemana" ADD CONSTRAINT [\s\S]* ON DELETE RESTRICT ON UPDATE CASCADE$/);
  // "ON DELETE RESTRICT ON UPDATE CASCADE" es parte de la clave foránea; lo que no puede haber son sentencias que borren o cambien datos.
  assert.equal(/\b(DROP|TRUNCATE|ALTER COLUMN|RENAME)\b|(^|;)\s*(DELETE|UPDATE|INSERT)\b/i.test(sql), false, "solo CREATE y ADD CONSTRAINT");
  // Ninguna otra tabla se toca (el único ALTER es sobre la tabla nueva).
  assert.deepEqual([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]), ["ReaperturaSemana"]);
  const schema = leer("prisma/schema.prisma");
  assert.match(schema, /model ReaperturaSemana \{[\s\S]*?onDelete: Restrict\)/);
  assert.match(schema, /reaperturas ReaperturaSemana\[\]/);
});

test("estático: cerrarSemana no cambió (el cierre de siempre sigue siendo el único que cierra) y ninguna otra acción reabre", () => {
  const acciones = leer("app/ejecucion/actions.ts");
  assert.match(acciones, /data: \{ estado: "CERRADA", fechaCierre: new Date\(\), cerradoPorId: usuario\.id \}/);
  for (const f of archivos(join(RAIZ, "app")).concat(archivos(join(RAIZ, "lib")))) {
    const c = sinComentarios(readFileSync(f, "utf8"));
    if (/estado:\s*"ABIERTA",\s*fechaCierre:\s*null/.test(c)) assert.equal(rel(f), "lib/reaperturaSemanaDb.ts", "solo el núcleo reabre");
  }
});
