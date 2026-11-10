import type { Usuario } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  PermisoDenegadoError,
  esAdminOFinanzas,
  requireAccesoEmpresa,
  requireUsuarioAlDia,
} from "@/lib/auth";
import { ERROR_SIN_PERMISO_DE_CARGAR_REAL, puedeCargarRealConAcceso } from "@/lib/permisosReal";

// Punto central para decidir si un usuario carga el Real de UNA empresa (ver lib/permisosReal.ts).
// ADMIN y FINANZAS: sí, sin consultar nada. GERENTE: según su fila de UsuarioEmpresa de ESA empresa.
export async function puedeCargarRealEmpresa(usuario: Pick<Usuario, "id" | "rol">, empresaId: string): Promise<boolean> {
  if (esAdminOFinanzas(usuario)) return true;
  if (usuario.rol !== "GERENTE") return false;
  const acceso = await prisma.usuarioEmpresa.findUnique({
    where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId } },
    select: { puedeOperarEjecucion: true },
  });
  return puedeCargarRealConAcceso(usuario, acceso);
}

// Guarda de las Server Actions que escriben el Real: sesión al día, acceso a la empresa y permiso de
// cargar su Real. Reemplaza a requireAdminOFinanzas + requireAccesoEmpresa en esas acciones.
export async function requireCargaRealEmpresa(empresaId: string): Promise<Usuario> {
  await requireUsuarioAlDia();
  const usuario = await requireAccesoEmpresa(empresaId);
  if (!(await puedeCargarRealEmpresa(usuario, empresaId))) {
    throw new PermisoDenegadoError(ERROR_SIN_PERMISO_DE_CARGAR_REAL);
  }
  return usuario;
}
