"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { restablecer } from "./actions";
import type { ResultadoRestablecer } from "@/lib/recuperacion";
import CampoPassword from "@/components/CampoPassword";

const ESTADO_INICIAL: ResultadoRestablecer | null = null;

export default function RestablecerForm({ token }: { token: string }) {
  const [estado, formAction, pendiente] = useActionState(restablecer, ESTADO_INICIAL);
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const coincide = confirmar.length > 0 ? confirmar === nueva : null;

  if (estado?.ok) {
    return (
      <div>
        <p className="text-sm text-marino bg-marino-tint rounded-md px-3 py-2 mb-6">
          Contraseña actualizada. Ya podés ingresar con la nueva.
        </p>
        <Link href="/login" className="text-sm text-marino underline underline-offset-2">
          Ir a ingresar
        </Link>
      </div>
    );
  }

  const errores = estado && !estado.ok ? (estado.errores ?? {}) : {};
  const errorGeneral = estado && !estado.ok ? estado.error : undefined;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <CampoPassword id="nueva" name="nueva" label="Contraseña nueva" error={errores.nueva} onChange={setNueva} size="lg" />
      <div>
        <CampoPassword id="confirmar" name="confirmar" label="Confirmar contraseña nueva" error={errores.confirmar} onChange={setConfirmar} size="lg" />
        {coincide === true && <p className="mt-1 text-xs font-medium text-verde">✓ Coinciden</p>}
        {coincide === false && <p className="mt-1 text-xs text-ink-muted">No coinciden todavía</p>}
      </div>

      {errorGeneral && (
        <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          {errorGeneral}{" "}
          <Link href="/olvide" className="underline underline-offset-2">
            Pedir un enlace nuevo
          </Link>
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="w-full h-12 rounded-md bg-marino text-base font-semibold text-white shadow-sm transition hover:bg-marino-dark disabled:opacity-60"
      >
        {pendiente ? "Guardando..." : "Cambiar contraseña"}
      </button>
    </form>
  );
}
