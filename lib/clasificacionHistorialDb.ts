import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clasificacionesPropiasDeEmpresa } from "@/lib/clasificarPorEmpresa";
import { construirIndice, construirIndiceDeEmpresa, type GrupoHistorial, type IndiceHistorial } from "@/lib/clasificacionHistorial";
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
