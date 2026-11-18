import type { ReactNode } from "react";
import Link from "next/link";
import { requireUsuarioAlDia, esAdminOFinanzas } from "@/lib/auth";
import { esViewer } from "@/lib/permisosViewer";
import AvisoSinAccesoPantalla from "@/components/AvisoSinAccesoPantalla";

type Props = { children: ReactNode };

// Mismo patrón que app/[empresa]/[periodo]/layout.tsx: en vez de un
// redirect o un error, un usuario logueado sin permisos ve un panel
// explicándolo. requireUsuarioAlDia() ya cubre "no hay sesión" (-> /login)
// y "falta definir contraseña propia" (-> /cuenta).
// Deja pasar ADMIN y FINANZAS (decisión 2026-10-07): FINANZAS usa las pantallas
// financieras de /admin. /admin/usuarios tiene su propio layout, solo ADMIN.
export default async function AdminLayout({ children }: Props) {
  const usuario = await requireUsuarioAlDia();

  if (esViewer(usuario)) return <AvisoSinAccesoPantalla />;
  if (!esAdminOFinanzas(usuario)) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          No tenés permisos de administrador.{" "}
          <Link href="/" className="underline underline-offset-2">
            Ver mis empresas
          </Link>
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
