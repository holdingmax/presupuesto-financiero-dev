"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validarMotivo } from "@/lib/reaperturaSemana";
import { reabrirSemanaEnTx } from "@/lib/reaperturaSemanaDb";

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

export type ResultadoReabrir = { ok: true } | { ok: false; error: string };

// "Reabrir semana para corregir": SOLO ADMIN (requireAdmin: ni FINANZAS, ni quien opera, ni gerentes, ni VIEWER), con motivo
// obligatorio. Vuelve la semana a ABIERTA y deja registro de quién, cuándo y por qué; se corrige con las herramientas de
// siempre y se cierra de nuevo con el cierre de siempre (cerrarSemana). Las reglas (otra semana abierta del período, etc.)
// están en lib/reaperturaSemanaDb.ts. Un archivo propio a propósito: el guard es lo primero que hace la función.
export async function reabrirSemana(periodo: string, numeroSemana: number, motivo: string): Promise<ResultadoReabrir> {
  const usuario = await requireAdmin();
  if (!FORMATO_PERIODO.test(periodo)) {
    throw new Error(`"${periodo}" no es un período válido (AAAA-MM).`);
  }
  if (!Number.isInteger(numeroSemana) || numeroSemana < 1) {
    throw new Error(`"${numeroSemana}" no es un número de semana válido.`);
  }
  const validado = validarMotivo(motivo);
  if (!validado.ok) return validado;

  const resultado = await prisma.$transaction(
    (tx) =>
      reabrirSemanaEnTx(tx, {
        periodo,
        numeroSemana,
        motivo: validado.motivo,
        usuario: { id: usuario.id, nombre: usuario.nombre },
      }),
    { maxWait: 10_000, timeout: 60_000 }
  );
  if (!resultado.ok) return resultado;

  // Mismas pantallas que refresca el cierre: la semana en el módulo global y en la pestaña de cada empresa.
  revalidatePath(`/ejecucion/${periodo}/${numeroSemana}`);
  revalidatePath("/[empresa]/[periodo]/ejecucion/[numeroSemana]", "page");
  return { ok: true };
}
