import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clasificacionesPropiasDeEmpresa } from "@/lib/clasificarPorEmpresa";
import {
  calcularSugerenciasParaMovimientos,
  construirIndice,
  construirIndiceDeEmpresa,
  normalizarConcepto,
  type GrupoHistorial,
  type IndiceHistorial,
  type UmbralesSugerencia,
} from "@/lib/clasificacionHistorial";
import { bloquearPeriodo } from "@/lib/ejecucion";
import { unidadesConCargaPropia } from "@/lib/extractos/cargaEmpresa";

// Parte con base de datos del historial de sugerencias (reglas puras en lib/clasificacionHistorial.ts). NO es "use server": lo
// importan las Server Actions de carga (app/ejecucion/actions.ts y actionsExtractoEmpresa.ts) pero no se expone como endpoint.

type Cliente = PrismaClient | Prisma.TransactionClient;

type FilaAgrupada = { concepto: string; signo: number; clasificacion: string; veces: number };

// Índice GLOBAL (extractos de las demás empresas): historial confirmado de TODAS las unidades, agrupado en la base (concepto + signo
// + clasificación) y vuelto a indexar con la normalización del concepto. Solo cuenta lo que una persona dio por bueno: no
// ignorados, con clasificación real y sin sugerencias del sistema pendientes. Quedan AFUERA las unidades de las empresas con
// carga propia (Perú, Bradenton, Plate Silver): tienen su propia lista de clasificaciones y su propio índice.
export async function cargarIndiceGlobal(db: Cliente = prisma): Promise<IndiceHistorial> {
  const propias = unidadesConCargaPropia();
  const filas = await db.$queryRaw<FilaAgrupada[]>`
    SELECT concepto, CASE WHEN importe > 0 THEN 1 ELSE -1 END AS signo, clasificacion, COUNT(*)::int AS veces
    FROM "MovimientoBancario"
    WHERE NOT ignorado AND NOT "sugeridaPorSistema" AND clasificacion <> 'SIN CLASIFICAR'
      AND "unidadNegocio" <> ALL(${propias}::text[])
    GROUP BY 1, 2, 3
  `;
  return construirIndice(
    filas.map((f) => ({
      concepto: f.concepto,
      importe: f.signo,
      clasificacion: f.clasificacion,
      ignorado: false,
      sugeridaPorSistema: false,
      veces: f.veces,
    }))
  );
}

// Índice de UNA empresa: sus movimientos confirmados (por unidad de negocio) más su historial de arranque
// (HistorialClasificacionEmpresa), solo con valores de SU lista de clasificaciones y sin respaldo global. null = la empresa no tiene
// lista propia en lib/config.ts (no hay con qué validar): no se sugiere nada.
export async function cargarIndiceDeEmpresa(db: Cliente, empresaId: string, slug: string, unidad: string): Promise<IndiceHistorial | null> {
  const lista = clasificacionesPropiasDeEmpresa(slug);
  if (lista === null) return null;
  // Una consulta detrás de la otra: dentro de una transacción comparten la misma conexión.
  const movimientos = await db.$queryRaw<FilaAgrupada[]>`
      SELECT concepto, CASE WHEN importe > 0 THEN 1 ELSE -1 END AS signo, clasificacion, COUNT(*)::int AS veces
      FROM "MovimientoBancario"
      WHERE "unidadNegocio" = ${unidad} AND NOT ignorado AND NOT "sugeridaPorSistema" AND clasificacion = ANY(${lista}::text[])
      GROUP BY 1, 2, 3
    `;
  const arranque = await db.historialClasificacionEmpresa.findMany({
    where: { empresaId, clasificacion: { in: lista } },
    select: { concepto: true, signo: true, clasificacion: true, veces: true },
  });
  const grupos: GrupoHistorial[] = [...movimientos, ...arranque];
  return construirIndiceDeEmpresa(grupos, lista);
}

// ---- Aplicar sugerencias a movimientos YA CARGADOS --------------------------------------------------------------------------

export type AlcanceExistentes = { empresaId: string; slug: string; unidad: string; periodo: string; numeroSemana?: number; ingresoPorDefecto?: string | null; umbrales?: UmbralesSugerencia };

export type InformeExistentes = {
  // Contexto del alcance (para ver que lo ya clasificado no se toca).
  totalEnAlcance: number;
  yaClasificados: number;
  sugeridasSinConfirmar: number;
  // Lo que se podía tocar: SIN CLASIFICAR, no sugerido, no ignorado, sin prorrateo, de una semana ABIERTA.
  pendientes: number;
  sugeridasPorHistorial: number;
  sugeridasPorRegla: number;
  sinSugerencia: number;
  aplicadas: number;
  porClasificacion: Record<string, number>;
  conceptosSinSugerencia: { concepto: string; veces: number }[];
};

// Condición ÚNICA de "se puede tocar": la usan la lectura y cada UPDATE. Un movimiento clasificado (a mano, sugerido o confirmado),
// ignorado, prorrateado o de una semana cerrada NO entra, y si cambia mientras se corre, el UPDATE no lo pisa.
function dondePendiente(a: AlcanceExistentes): Prisma.MovimientoBancarioWhereInput {
  return {
    unidadNegocio: a.unidad,
    clasificacion: "SIN CLASIFICAR",
    sugeridaPorSistema: false,
    ignorado: false,
    desglose: { none: {} },
    ejecucion: { estado: "ABIERTA", periodo: a.periodo, ...(a.numeroSemana !== undefined ? { numeroSemana: a.numeroSemana } : {}) },
  };
}

// Sugiere clasificación a lo que ya está cargado SIN CLASIFICAR, con el índice de la empresa y su regla de respaldo. Con
// `aplicar = false` solo informa (no escribe nada). Todo en UNA transacción, con el lock del período (el mismo de las cargas).
export async function sugerirAExistentes(db: PrismaClient, a: AlcanceExistentes, aplicar: boolean): Promise<InformeExistentes> {
  return db.$transaction(
    async (tx) => {
      await bloquearPeriodo(tx, a.periodo);
      const indice = await cargarIndiceDeEmpresa(tx, a.empresaId, a.slug, a.unidad);
      if (indice === null) throw new Error(`La empresa ${a.slug} no tiene lista propia de clasificaciones: no hay con qué sugerir.`);

      const enAlcance = { unidadNegocio: a.unidad, ejecucion: { periodo: a.periodo, ...(a.numeroSemana !== undefined ? { numeroSemana: a.numeroSemana } : {}) } };
      const [totalEnAlcance, yaClasificados, sugeridasSinConfirmar] = await Promise.all([
        tx.movimientoBancario.count({ where: enAlcance }),
        tx.movimientoBancario.count({ where: { ...enAlcance, clasificacion: { not: "SIN CLASIFICAR" } } }),
        tx.movimientoBancario.count({ where: { ...enAlcance, sugeridaPorSistema: true } }),
      ]);

      const filas = await tx.movimientoBancario.findMany({ where: dondePendiente(a), select: { id: true, concepto: true, importe: true } });
      const movimientos = filas.map((f) => ({ id: f.id, concepto: f.concepto, importe: Number(f.importe.toString()) }));
      const { sugerencias, sinSugerencia } = calcularSugerenciasParaMovimientos(movimientos, indice, a.ingresoPorDefecto, a.umbrales);

      // Por clasificación: un UPDATE por valor, con la condición completa repetida (no pisa lo que cambió mientras tanto).
      const porClasificacion: Record<string, number> = {};
      const idsPorClasificacion = new Map<string, string[]>();
      for (const s of sugerencias) idsPorClasificacion.set(s.clasificacion, [...(idsPorClasificacion.get(s.clasificacion) ?? []), s.id]);
      let aplicadas = 0;
      for (const [clasificacion, ids] of idsPorClasificacion) {
        porClasificacion[clasificacion] = ids.length;
        if (!aplicar) continue;
        const r = await tx.movimientoBancario.updateMany({
          where: { ...dondePendiente(a), id: { in: ids } },
          data: { clasificacion, sugeridaPorSistema: true },
        });
        aplicadas += r.count;
      }

      const sinTexto = new Map<string, number>();
      for (const m of sinSugerencia) {
        const k = normalizarConcepto(m.concepto) || m.concepto;
        sinTexto.set(k, (sinTexto.get(k) ?? 0) + 1);
      }
      return {
        totalEnAlcance,
        yaClasificados,
        sugeridasSinConfirmar,
        pendientes: movimientos.length,
        sugeridasPorHistorial: sugerencias.filter((s) => s.origen === "historial").length,
        sugeridasPorRegla: sugerencias.filter((s) => s.origen === "regla").length,
        sinSugerencia: sinSugerencia.length,
        aplicadas,
        porClasificacion,
        conceptosSinSugerencia: [...sinTexto.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([concepto, veces]) => ({ concepto, veces })),
      };
    },
    { maxWait: 10_000, timeout: 120_000 }
  );
}
