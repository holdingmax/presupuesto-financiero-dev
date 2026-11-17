"use client";

import { useActionState } from "react";
import Link from "next/link";
import { pedirRecuperacion, type ResultadoOlvide } from "./actions";

const ESTADO_INICIAL: ResultadoOlvide | null = null;

export default function OlvideForm() {
  const [estado, formAction, pendiente] = useActionState(pedirRecuperacion, ESTADO_INICIAL);

  return (
    <>
      {estado?.ok ? (
        <p className="text-sm text-marino bg-marino-tint rounded-md px-3 py-2 mb-6">
          Si el email corresponde a una cuenta, te enviamos un enlace para elegir una contraseña nueva. Vale 30 minutos.
        </p>
      ) : (
        <form action={formAction} className="space-y-5">
          <p className="text-sm text-ink-secondary">Ingresá tu email y te enviamos un enlace para elegir una contraseña nueva.</p>
          <div>
            <label htmlFor="email" className="block text-sm text-ink-secondary mb-1.5">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              maxLength={254}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Tu email"
              className="w-full h-12 rounded-md border border-line bg-paper-raised px-3.5 text-[15px] outline-none focus:border-marino focus:ring-2 focus:ring-marino/15"
            />
          </div>
          <button
            type="submit"
            disabled={pendiente}
            className="w-full h-12 rounded-md bg-marino text-base font-semibold text-white shadow-sm transition hover:bg-marino-dark disabled:opacity-60"
          >
            {pendiente ? "Enviando..." : "Enviar enlace"}
          </button>
        </form>
      )}

      <p className="mt-6 text-xs text-ink-muted">Si no te llega el mail, escribile al administrador.</p>
      <p className="mt-3 text-sm">
        <Link href="/login" className="text-marino underline underline-offset-2">
          Volver a ingresar
        </Link>
      </p>
    </>
  );
}
