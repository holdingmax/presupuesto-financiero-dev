import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin, PermisoDenegadoError } from "@/lib/auth";
import { listarEmpresas } from "@/lib/slug";
import EditarUsuarioForm from "./EditarUsuarioForm";

type Props = { params: Promise<{ id: string }> };

export default async function EditarUsuarioPage({ params }: Props) {
  const { id } = await params;

  let admin, usuario, empresas;
  try {
    admin = await requireAdmin();
    [usuario, empresas] = await Promise.all([
      prisma.usuario.findUnique({ where: { id }, include: { empresas: true } }),
      listarEmpresas(),
    ]);
  } catch (error) {
    // Ver el comentario equivalente en admin/usuarios/page.tsx.
    if (error instanceof PermisoDenegadoError) return null;
    throw error;
  }

  if (!usuario) {
    notFound();
  }

  return (
    <EditarUsuarioForm
      usuario={{
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        activo: usuario.activo,
        operaEjecucion: usuario.operaEjecucion,
        veBloquesReservados: usuario.veBloquesReservados,
        empresaIds: usuario.empresas.map((ue) => ue.empresaId),
        permisos: Object.fromEntries(
          usuario.empresas.map((ue) => [
            ue.empresaId,
            { opera: ue.puedeOperarEjecucion, revisa: ue.puedeRevisarPresupuesto },
          ])
        ),
      }}
      empresas={empresas}
      esPropioUsuario={usuario.id === admin.id}
    />
  );
}
