"use server";

import { prisma } from "@/lib/prisma";
import { requireAdminOFinanzas } from "@/lib/auth";
import { validarTipoCambio } from "@/lib/tipoCambio";

// Carga (o corrige) el tipo de cambio de un período. ADMIN o FINANZAS. Sin pantalla todavía (Etapa 2).
// Guarda quién y cuándo (cargadoPorId + updatedAt). El importe original en USD nunca se toca.
export async function guardarTipoCambio(
  periodo: string,
  moneda: string,
  valorTexto: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const usuario = await requireAdminOFinanzas();
  const v = validarTipoCambio(periodo, moneda, valorTexto);
  if (!v.ok) return v;
  await prisma.tipoCambio.upsert({
    where: { periodo_moneda: { periodo: v.periodo, moneda: v.moneda } },
    create: { periodo: v.periodo, moneda: v.moneda, valor: v.valor, cargadoPorId: usuario.id },
    update: { valor: v.valor, cargadoPorId: usuario.id },
  });
  return { ok: true };
}
