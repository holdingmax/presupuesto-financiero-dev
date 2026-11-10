"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { esAdminOFinanzas, requireAdminOFinanzas } from "@/lib/auth";
import { slugDeEmpresa } from "@/lib/slug";
import { centavosDeDecimalTexto, decimalTextoDeCentavos } from "@/lib/conteoMovimientos";
import { periodoActual } from "@/lib/reporte/bloqueo";
import { semanasDelPeriodo } from "@/lib/reporte/valoresManuales";
import { empresasConExpensas, planificarReparto, type PlanReparto } from "@/lib/reporte/repartoExpensas";

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

export type ResultadoRepartoExpensas =
  | { ok: true; guardados: number }
  | Extract<PlanReparto, { ok: false }>;

// Guarda el reparto de Expensas de un mes: upsert del Real (columna REAL) de la fila «Expensas» de cada empresa con
// porcentaje, en ValorManualReporte. Solo ADMIN y FINANZAS. El servidor vuelve a calcular todo desde el TEXTO que
// llega (total y porcentajes); no confía en montos del navegador. La lista de empresas y la fila de cada una salen de
// las plantillas (empresasConExpensas). Todo o nada, en una transacción, y el bloqueo y los valores ya cargados se
// leen DENTRO de ella. Sin `confirmarReemplazo`, no pisa ningún valor existente.
export async function guardarRepartoExpensas(
  periodo: string,
  totalTexto: string,
  porcentajes: { empresaId: string; porcentajeTexto: string }[],
  confirmarReemplazo: boolean
): Promise<ResultadoRepartoExpensas> {
  const usuario = await requireAdminOFinanzas();
  if (!FORMATO_PERIODO.test(periodo)) return { ok: false, error: "Período inválido." };

  const empresasBase = await prisma.empresa.findMany({
    where: { activo: true },
    select: { id: true, nombre: true },
  });
  const lista = empresasConExpensas(empresasBase.map((e) => ({ ...e, slug: slugDeEmpresa(e.nombre) })));
  const porId = new Map(lista.map((e) => [e.id, e]));

  const vistas = new Set<string>();
  for (const p of porcentajes) {
    if (!porId.has(p.empresaId)) return { ok: false, error: "Hay una empresa que no tiene fila de Expensas manual." };
    if (vistas.has(p.empresaId)) return { ok: false, error: "Empresa repetida." };
    vistas.add(p.empresaId);
  }
  const textoDe = new Map(porcentajes.map((p) => [p.empresaId, p.porcentajeTexto]));
  const hoy = periodoActual();

  const resultado = await prisma.$transaction(async (tx) => {
    // Dos personas guardando a la vez se serializan: la segunda lee lo que dejó la primera y pide confirmación.
    // "SELECT 1 FROM": pg_advisory_xact_lock devuelve void, que Prisma no deserializa.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('reparto-expensas'))`;
    const existentes = await tx.valorManualReporte.findMany({
      where: {
        periodo,
        columna: "REAL",
        OR: lista.map((e) => ({ empresaId: e.id, filaClave: e.fila.clave })),
      },
      select: { empresaId: true, filaClave: true, importe: true },
    });
    const existente = new Map(
      existentes.map((v) => [`${v.empresaId}|${v.filaClave}`, centavosDeDecimalTexto(v.importe.toFixed(2))])
    );
    const semanas = (await semanasDelPeriodo([periodo])).get(periodo)!;

    const plan = planificarReparto({
      esAdminOFinanzas: esAdminOFinanzas(usuario),
      periodo,
      actual: hoy,
      semanas,
      totalTexto,
      empresas: lista.map((e) => ({
        empresaId: e.id,
        nombre: e.nombre,
        filaClave: e.fila.clave,
        bloque: e.fila.bloque,
        porcentajeTexto: textoDe.get(e.id) ?? "",
        existenteCentavos: existente.get(`${e.id}|${e.fila.clave}`) ?? null,
      })),
      confirmarReemplazo,
    });
    if (!plan.ok) return plan;

    for (const esc of plan.escrituras) {
      const importe = decimalTextoDeCentavos(esc.centavos);
      await tx.valorManualReporte.upsert({
        where: {
          empresaId_periodo_filaClave_columna: {
            empresaId: esc.empresaId,
            periodo,
            filaClave: esc.filaClave,
            columna: "REAL",
          },
        },
        create: {
          empresaId: esc.empresaId,
          periodo,
          filaClave: esc.filaClave,
          columna: "REAL",
          importe,
          nota: esc.nota,
          cargadoPorId: usuario.id,
        },
        update: { importe, nota: esc.nota, cargadoPorId: usuario.id },
      });
    }
    return plan;
  });
  if (!resultado.ok) return resultado;

  revalidatePath("/admin/reparto-expensas");
  for (const esc of resultado.escrituras) {
    const slug = porId.get(esc.empresaId)!.slug;
    revalidatePath(`/${slug}/${periodo}/reporte`);
    revalidatePath(`/${slug}/${periodo}/reporte/carga`);
  }
  return { ok: true, guardados: resultado.escrituras.length };
}
