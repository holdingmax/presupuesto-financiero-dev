import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdmin, PermisoDenegadoError } from "@/lib/auth";

export default async function UsuariosPage() {
  let usuarios;
  try {
    await requireAdmin();
    usuarios = await prisma.usuario.findMany({
      orderBy: { nombre: "asc" },
      include: { empresas: { include: { empresa: true } } },
    });
  } catch (error) {
    // app/admin/layout.tsx ya muestra el panel de "sin permisos" — este
    // chequeo repetido es defensivo (Next arranca a renderizar esta página
    // en paralelo con el layout que la envuelve, ver comentario en
    // lib/auth.ts junto a PermisoDenegadoError). Sin esto, la lista
    // completa de usuarios se llegaría a calcular en el servidor aunque no
    // se muestre.
    if (error instanceof PermisoDenegadoError) return null;
    throw error;
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-14">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs tracking-[0.15em] text-ink-secondary uppercase mb-1">
            <span className="w-2 h-2 bg-plata" />
            Administración
          </p>
          <h1 className="text-4xl font-serif font-semibold tracking-tight">Usuarios</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-ink-secondary underline underline-offset-2 hover:text-ink">
            Mis empresas
          </Link>
          <Link
            href="/admin/usuarios/nuevo"
            className="h-10 px-4 flex items-center rounded-md bg-marino text-white text-sm font-medium hover:bg-marino-dark transition"
          >
            Nuevo usuario
          </Link>
        </div>
      </div>

      <div className="border-t border-line-strong">
        {usuarios.map((usuario) => (
          <Link
            key={usuario.id}
            href={`/admin/usuarios/${usuario.id}`}
            className="flex items-center justify-between gap-4 py-3 border-b border-line-strong hover:bg-paper-raised transition px-2"
          >
            <div>
              <p className={`text-sm font-medium ${!usuario.activo ? "text-ink-muted line-through" : ""}`}>
                {usuario.nombre}
              </p>
              <p className="text-xs text-ink-muted">{usuario.email}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-ink-secondary uppercase tracking-wide">
                {usuario.rol}
                {usuario.veBloquesReservados && usuario.rol === "VIEWER" ? " · ve reservados" : ""}
              </p>
              <p className="text-xs text-ink-muted">
                {usuario.rol === "ADMIN"
                  ? "Todas las empresas"
                  : usuario.empresas.length === 0
                    ? "Sin empresas asignadas"
                    : usuario.empresas.map((ue) => ue.empresa.nombre).join(", ")}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
