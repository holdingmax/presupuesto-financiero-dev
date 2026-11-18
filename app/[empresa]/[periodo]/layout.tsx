import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolverEmpresaPorSlug } from "@/lib/slug";
import { requireUsuarioAlDia, puedeAccederEmpresa, esAdminOFinanzas } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { ocultaPestanaPresupuesto } from "@/lib/navegacionEmpresa";
import NavTabs from "./NavTabs";
import { esViewer } from "@/lib/permisosViewer";

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

type Props = {
  children: ReactNode;
  params: Promise<{ empresa: string; periodo: string }>;
};

// Valida el período (forma, sin pegarle a la base), resuelve la empresa
// (notFound() si el slug no matchea ninguna fila real) y verifica que el
// usuario logueado tenga acceso a ella — una sola vez para todo lo que
// cuelga abajo, /presupuesto y /ejecucion no repiten nada de esto.
export default async function EmpresaPeriodoLayout({ children, params }: Props) {
  const { empresa: slugEmpresa, periodo } = await params;

  if (!FORMATO_PERIODO.test(periodo)) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          &quot;{periodo}&quot; no es un período válido (formato esperado: AAAA-MM).
        </p>
      </div>
    );
  }

  const empresa = await resolverEmpresaPorSlug(slugEmpresa);
  if (!empresa) {
    notFound();
  }

  // requireUsuarioAlDia() ya redirige a /login (sin sesión) o a /cuenta (si
  // todavía tiene pendiente definir su contraseña). Sin acceso a esta
  // empresa puntual, en cambio, no es ninguno de esos casos — se muestra un
  // panel explicándolo en vez de las páginas de esta empresa.
  const usuario = await requireUsuarioAlDia();
  if (!(await puedeAccederEmpresa(usuario, empresa.id))) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          No tenés acceso a {empresa.nombre}.{" "}
          <Link href="/" className="underline underline-offset-2">
            Ver mis empresas
          </Link>
        </p>
      </div>
    );
  }

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
        <NavTabs
          empresaSlug={slugEmpresa}
          periodo={periodo}
          ocultarPresupuesto={esViewer(usuario) || ocultaPestanaPresupuesto(esAdminOFinanzas(usuario), slugEmpresa)}
        />
      </div>
      {children}
    </>
  );
}
