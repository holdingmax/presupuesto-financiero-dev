"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type ResultadoLogin } from "./actions";
import CampoPassword from "@/components/CampoPassword";

const ESTADO_INICIAL: ResultadoLogin | null = null;

export default function LoginForm({ mostrarOlvide = false }: { mostrarOlvide?: boolean }) {
  const [estado, formAction, pendiente] = useActionState(login, ESTADO_INICIAL);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label htmlFor="email" className="block text-sm text-ink-secondary mb-1.5">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Tu email"
          className="w-full h-12 rounded-md border border-line bg-paper-raised px-3.5 text-[15px] outline-none focus:border-marino focus:ring-2 focus:ring-marino/15"
        />
      </div>

      <CampoPassword
        id="password"
        name="password"
        label="Contraseña"
        required
        placeholder="••••••••"
        size="lg"
      />

      {mostrarOlvide && (
        <p className="-mt-2 text-sm">
          <Link href="/olvide" className="text-marino underline underline-offset-2">
            ¿Olvidaste tu contraseña?
          </Link>
        </p>
      )}

      {estado && !estado.ok && (
        <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="w-full h-14 rounded-md bg-marino text-base font-semibold tracking-wide text-white shadow-sm transition hover:bg-marino-dark hover:shadow-md active:scale-[0.99] disabled:opacity-60"
      >
        {pendiente ? "Ingresando..." : "Ingresar"}
      </button>
    </form>
  );
}
