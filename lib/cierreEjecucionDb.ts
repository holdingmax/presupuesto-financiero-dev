import { prisma } from "@/lib/prisma";
import { obtenerUnidadesConEmpresa, contarSinUnidadEnSemana } from "@/lib/reporte";
import type { ConteosParaCierre } from "@/lib/cierreEjecucion";
import { normalizarMoneda } from "@/lib/moneda";

export type FilaSinUnidad = { id: string; fecha: string; concepto: string; importe: number; moneda: string; unidad: string };

// Los movimientos que bloquean el cierre (para mostrarlos): no ignorados, con una unidad que no
// pertenece a ninguna empresa activa. Un prorrateado aparece por cada porción inválida, con el
// importe de la porción. Hasta `limite` filas, las más recientes primero.
export async function listarMovimientosSinUnidad(
  ejecucionId: string,
  unidadesConEmpresa: string[],
  limite = 100
): Promise<FilaSinUnidad[]> {
  const filas = await prisma.$queryRaw<
    { id: string; fecha: Date; concepto: string; importe: string; moneda: string; unidad: string }[]
  >`
    SELECT x.id, x.fecha, x.concepto, x.importe::text AS importe, x.moneda, x.unidad FROM (
      SELECT mb.id, mb.fecha, mb.concepto, mb.importe, mb.moneda, upper(btrim(mb."unidadNegocio")) AS unidad
      FROM "MovimientoBancario" mb
      WHERE mb."ejecucionId" = ${ejecucionId} AND NOT mb.ignorado
        AND NOT (upper(btrim(mb."unidadNegocio")) = ANY(${unidadesConEmpresa}::text[]))
        AND NOT EXISTS (SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d."movimientoId" = mb.id)
      UNION ALL
      SELECT mb.id, mb.fecha, mb.concepto, d.importe, mb.moneda, upper(btrim(d."unidadNegocio"))
      FROM "MovimientoBancario" mb
      JOIN "MovimientoBancarioDesglose" d ON d."movimientoId" = mb.id
      WHERE mb."ejecucionId" = ${ejecucionId} AND NOT mb.ignorado
        AND NOT (upper(btrim(d."unidadNegocio")) = ANY(${unidadesConEmpresa}::text[]))
    ) x
    ORDER BY x.fecha DESC, x.id
    LIMIT ${limite}
  `;
  return filas.map((f) => ({
    id: f.id,
    fecha: f.fecha.toISOString().slice(0, 10),
    concepto: f.concepto,
    importe: Number(f.importe),
    moneda: normalizarMoneda(f.moneda),
    unidad: f.unidad,
  }));
}

// Conteos de la semana para los chequeos del cierre (reglas puras en lib/cierreEjecucion.ts).
// Todo se cuenta en la base: una semana puede traer ~16.500 filas. "Sin unidad en empresa" usa
// la misma consulta que el aviso de la pantalla (contarSinUnidadEnSemana), con las unidades de
// las empresas ACTIVAS.
export async function contarParaCierreDeSemana(ejecucionId: string): Promise<ConteosParaCierre> {
  const unidadesConEmpresa = await obtenerUnidadesConEmpresa();
  const [sinUnidad, sinClasificar, clasificacionesSugeridas, unidadesSugeridas] = await Promise.all([
    contarSinUnidadEnSemana(ejecucionId, unidadesConEmpresa),
    prisma.movimientoBancario.count({ where: { ejecucionId, ignorado: false, clasificacion: "SIN CLASIFICAR" } }),
    prisma.movimientoBancario.count({ where: { ejecucionId, ignorado: false, sugeridaPorSistema: true } }),
    prisma.movimientoBancario.count({ where: { ejecucionId, ignorado: false, unidadSugeridaPorSistema: true } }),
  ]);
  return { sinUnidad, sinClasificar, clasificacionesSugeridas, unidadesSugeridas };
}
