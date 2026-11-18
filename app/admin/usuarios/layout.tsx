import type { ReactNode } from "react";
import Link from "next/link";
import { requireUsuarioAlDia } from "@/lib/auth";
import { esViewer } from "@/lib/permisosViewer";
import AvisoSinAccesoPantalla from "@/components/AvisoSinAccesoPantalla";

type Props = { children: ReactNode };

// La gestión de usuarios es SOLO ADMIN. app/admin/layout.tsx deja pasar también
// a FINANZAS (por las pantallas financieras), así que este layout vuelve a
// cerrar /admin/usuarios para cualquier otro rol con el mismo panel de "sin
// permisos". Las páginas y Server Actions de acá siguen con requireAdmin como
// barrera real (el layout solo decide qué se ve).
export default async function UsuariosLayout({ children }: Props) {
  const usuario = await requireUsuarioAlDia();

  if (esViewer(usuario)) return <AvisoSinAccesoPantalla />;
  if (usuario.rol !== "ADMIN") {
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
