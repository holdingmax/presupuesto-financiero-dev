import type { ReactNode } from "react";

// Marco visual de las pantallas de acceso sin sesión (/olvide, /restablecer): mismo fondo y tarjeta
// que /login, en versión de una sola columna.
export default function MarcoAcceso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="relative min-h-screen w-full">
      <div aria-hidden className="login-backdrop-solido absolute inset-0 -z-10" />
      <div className="mx-auto flex min-h-screen w-full max-w-[1400px] items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <p className="mb-3 text-xs tracking-wide text-paper/70 uppercase">HoldingMax</p>
          <div className="rounded-lg border border-line-strong border-l-4 border-l-marino bg-paper-cool px-6 py-8 login-card-shadow sm:px-8 sm:py-10">
            <p className="mb-3 flex items-center gap-2 text-xs tracking-[0.15em] text-marino uppercase">
              <span className="w-2 h-2 bg-plata" />
              Acceso
            </p>
            <h1 className="mb-6 text-3xl font-serif font-semibold tracking-tight">{titulo}</h1>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
