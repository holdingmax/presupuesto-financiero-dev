import type { ReactNode } from "react";
import Link from "next/link";
import { requireUsuarioAlDia, veTodoEjecucion } from "@/lib/auth";
import { esViewer } from "@/lib/permisosViewer";
import AvisoSinAccesoPantalla from "@/components/AvisoSinAccesoPantalla";
import { logout } from "@/app/login/actions";
import { periodosHasta } from "@/lib/reporte/motor";
import { nombreDePeriodo } from "@/lib/ejecucionSemanas";

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

type Props = {
  children: ReactNode;
  params: Promise<{ periodo: string }>;
};

// Ejecución global (docs/ejecucion_global_plan.md §3.4): un solo módulo para todo el holding, fuera
// de [empresa]. Valida el período y que el usuario pueda entrar (ADMIN, FINANZAS o quien opera);
// el resto ve su empresa en la pestaña de solo lectura. Una sola vez para todo lo que cuelga abajo.
export default async function EjecucionGlobalLayout({ children, params }: Props) {
  const { periodo } = await params;

  if (!FORMATO_PERIODO.test(periodo)) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          &quot;{periodo}&quot; no es un período válido (formato esperado: AAAA-MM).
        </p>
      </div>
    );
  }

  // requireUsuarioAlDia() ya redirige a /login (sin sesión) o a /cuenta (si todavía tiene
  // pendiente definir su contraseña).
  const usuario = await requireUsuarioAlDia();
  if (esViewer(usuario)) return <AvisoSinAccesoPantalla />;
  if (!veTodoEjecucion(usuario)) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          No tenés acceso a Ejecución global. Tu empresa muestra sus movimientos en la pestaña
          &quot;Ejecución financiera&quot;.{" "}
          <Link href="/" className="underline underline-offset-2">
            Ver mis empresas
          </Link>
        </p>
      </div>
    );
  }

  // Mes anterior y siguiente, para moverse entre períodos.
  const [anterior] = periodosHasta(periodo, 2);
  const siguiente = periodosHasta(
    (() => {
      const [a, m] = periodo.split("-").map(Number);
      const total = a * 12 + m; // mes siguiente (m ya es 1-indexado)
      return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
    })(),
    1
  )[0];

  return (
    <>
      <div className="border-b border-line-strong">
        <div className="flex items-center justify-end gap-3 px-6 pt-4 pb-2 text-xs text-ink-muted">
          <Link href="/" className="underline underline-offset-2 hover:text-ink-secondary">
            ← Mis empresas
          </Link>
          <span>{usuario.nombre}</span>
          <form action={logout}>
            <button type="submit" className="underline underline-offset-2 hover:text-ink-secondary">
              Cerrar sesión
            </button>
          </form>
        </div>
        <nav className="flex items-center gap-3 px-6 pb-3 text-sm">
          <span className="rounded-md bg-marino px-3 py-1.5 font-medium text-white">Ejecución global</span>
          <Link href={`/ejecucion/${anterior}`} className="text-ink-secondary hover:text-ink">
            ‹ {nombreDePeriodo(anterior)}
          </Link>
          <span className="font-medium">{nombreDePeriodo(periodo)}</span>
          <Link href={`/ejecucion/${siguiente}`} className="text-ink-secondary hover:text-ink">
            {nombreDePeriodo(siguiente)} ›
          </Link>
        </nav>
      </div>
      {children}
    </>
  );
}
