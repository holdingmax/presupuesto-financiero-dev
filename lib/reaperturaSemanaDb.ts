import type { Prisma, Rol } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bloquearPeriodo } from "@/lib/ejecucion";
import { veReaperturas } from "@/lib/permisosReapertura";
import { decidirOtrasAbiertas, type OtraSemanaAbierta, type ReaperturaVista } from "@/lib/reaperturaSemana";

// Parte con base de datos de "Reabrir semana para corregir". NO es "use server": la importan la acción
// (app/ejecucion/actionsReabrir.ts, que exige requireAdmin ANTES de llamar acá) y la pantalla de Ejecución global.
// Ningún otro lugar del sistema lee ni escribe ReaperturaSemana (lo fija un test estático): el Reporte, el Excel y la
// pestaña de la empresa no la tocan, así gerentes y visualizadores no reciben ningún dato de esto.

export type ResultadoReapertura = { ok: true; semanaVaciaEliminada: number | null } | { ok: false; error: string };

// Todo dentro de UNA transacción del llamador, con el lock del período (el mismo de las cargas y del reparto de la madre):
//   1. la semana tiene que existir y estar CERRADA;
//   2. si hay OTRA semana abierta en el período: vacía (sin movimientos, adjuntos, prorrateos ni historial) => se borra;
//      con algo adentro => se rechaza (no se cambia nada);
//   3. la semana vuelve a ABIERTA (fechaCierre y cerradoPorId vuelven a null: el cierre se vuelve a hacer con el cierre normal);
//   4. se registra quién, cuándo y por qué, más lo que se pisó.
// Si algo falla (incluida la clave foránea, que impide borrar una semana con movimientos), la transacción se deshace entera.
export async function reabrirSemanaEnTx(
  tx: Prisma.TransactionClient,
  datos: { periodo: string; numeroSemana: number; motivo: string; usuario: { id: string; nombre: string } }
): Promise<ResultadoReapertura> {
  const { periodo, numeroSemana, motivo, usuario } = datos;
  // Si otra carga tiene el lock del período, esperar a lo sumo 20 s y fallar (se deshace) en vez de colgarse.
  await tx.$executeRaw`SET LOCAL lock_timeout = '20s'`;
  await bloquearPeriodo(tx, periodo);

  const ejecucion = await tx.ejecucionSemanal.findUnique({
    where: { periodo_numeroSemana: { periodo, numeroSemana } },
  });
  if (!ejecucion) return { ok: false, error: `No encontré la semana ${numeroSemana}.` };
  if (ejecucion.estado !== "CERRADA") return { ok: false, error: "Esta semana no está cerrada: no hay nada que reabrir." };

  const abiertas = await tx.ejecucionSemanal.findMany({
    where: { periodo, estado: "ABIERTA", id: { not: ejecucion.id } },
    select: { id: true, numeroSemana: true },
  });
  const otras: (OtraSemanaAbierta & { id: string })[] = [];
  for (const o of abiertas) {
    // En serie (una sola conexión de la transacción). Se cuenta TODO lo que podría colgar de esa semana antes de borrarla.
    const movimientos = await tx.movimientoBancario.count({ where: { ejecucionId: o.id } });
    const adjuntos = await tx.adjunto.count({ where: { movimiento: { ejecucionId: o.id } } });
    const desgloses = await tx.movimientoBancarioDesglose.count({ where: { movimiento: { ejecucionId: o.id } } });
    const reaperturas = await tx.reaperturaSemana.count({ where: { ejecucionId: o.id } });
    otras.push({ id: o.id, numeroSemana: o.numeroSemana, movimientos, adjuntos, desgloses, reaperturas });
  }

  const decision = decidirOtrasAbiertas(otras, { periodo, numeroReabierta: numeroSemana });
  if (decision.tipo === "rechazar") return { ok: false, error: decision.mensaje };

  let semanaVaciaEliminada: number | null = null;
  if (decision.tipo === "borrar") {
    const ids = otras.filter((o) => decision.numeros.includes(o.numeroSemana)).map((o) => o.id);
    const borradas = await tx.ejecucionSemanal.deleteMany({ where: { id: { in: ids }, estado: "ABIERTA" } });
    if (borradas.count !== ids.length) throw new Error("No se pudo borrar la semana abierta vacía. No se cambió nada.");
    semanaVaciaEliminada = decision.numeros[0];
  }

  const movimientosAlReabrir = await tx.movimientoBancario.count({ where: { ejecucionId: ejecucion.id } });
  // Atómico: solo si sigue CERRADA (dos ADMIN reabriendo a la vez no registran dos veces).
  const reabierta = await tx.ejecucionSemanal.updateMany({
    where: { id: ejecucion.id, estado: "CERRADA" },
    data: { estado: "ABIERTA", fechaCierre: null, cerradoPorId: null },
  });
  if (reabierta.count === 0) return { ok: false, error: "Esta semana ya no estaba cerrada." };

  await tx.reaperturaSemana.create({
    data: {
      ejecucionId: ejecucion.id,
      periodo,
      numeroSemana,
      motivo,
      usuarioId: usuario.id,
      usuarioNombre: usuario.nombre,
      fechaCierreAnterior: ejecucion.fechaCierre,
      cerradoPorIdAnterior: ejecucion.cerradoPorId,
      movimientosAlReabrir,
      semanaVaciaEliminada,
    },
  });
  return { ok: true, semanaVaciaEliminada };
}

// Lectura para la pantalla de Ejecución global. null = el usuario NO es ADMIN: ni se consulta la base (el chequeo va
// ANTES de cualquier prisma.). Más nueva primero.
export async function obtenerReaperturasParaAdmin(
  usuario: { rol: Rol },
  periodo: string,
  numeroSemana: number
): Promise<ReaperturaVista[] | null> {
  if (!veReaperturas(usuario)) return null;
  const filas = await prisma.reaperturaSemana.findMany({
    where: { ejecucion: { periodo, numeroSemana } },
    orderBy: { createdAt: "desc" },
    select: { id: true, usuarioNombre: true, motivo: true, createdAt: true, movimientosAlReabrir: true, semanaVaciaEliminada: true },
  });
  return filas.map((f) => ({
    id: f.id,
    usuarioNombre: f.usuarioNombre,
    motivo: f.motivo,
    creadaEn: f.createdAt.toISOString(),
    movimientosAlReabrir: f.movimientosAlReabrir,
    semanaVaciaEliminada: f.semanaVaciaEliminada,
  }));
}
