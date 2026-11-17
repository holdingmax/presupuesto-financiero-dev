"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { almacenPrisma } from "@/lib/recuperacionDb";
import { recuperacionActiva, solicitarRecuperacion } from "@/lib/recuperacion";
import { enviarMailRecuperacion } from "@/lib/mailer";
import { ipDelCliente } from "@/lib/ipCliente";

export type ResultadoOlvide = { ok: true };

// La respuesta es SIEMPRE la misma (exista o no el email, se supere o no un límite, salga o no el mail,
// esté o no activa la función). El trabajo real corre con after(): se ejecuta cuando la respuesta ya
// salió, así tampoco el tiempo de respuesta delata si el email existe.
export async function pedirRecuperacion(_estadoPrevio: ResultadoOlvide | null, formData: FormData): Promise<ResultadoOlvide> {
  if (!recuperacionActiva()) return { ok: true };

  const email = String(formData.get("email") ?? "").slice(0, 300);
  const ip = ipDelCliente(await headers());

  after(async () => {
    try {
      await solicitarRecuperacion(email, ip, { almacen: almacenPrisma, enviar: (d) => enviarMailRecuperacion(d) });
    } catch {
      // Aviso genérico: nada del pedido (ni email, ni token) va al log.
      console.warn("[recuperación] No se pudo procesar un pedido.");
    }
  });
  return { ok: true };
}
