"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, hashPassword } from "@/lib/auth";
import { generarPasswordTemporal } from "@/lib/password";
import { leerDatosUsuario, type DatosUsuario } from "@/lib/usuarioDatos";
import type { Rol } from "@prisma/client";

const ROLES_VALIDOS: Rol[] = ["ADMIN", "GERENTE", "FINANZAS"];
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Comunes a alta y edición. No valida unicidad de email acá (depende de si
// hay que excluir al propio usuario) — eso lo hace cada action llamante.
function validarCampos(datos: DatosUsuario) {
  const errores: Record<string, string> = {};
  if (!datos.nombre.trim()) errores.nombre = "Completá el nombre.";
  if (!datos.email.trim() || !EMAIL_VALIDO.test(datos.email.trim())) {
    errores.email = "Ingresá un email válido.";
  }
  if (!ROLES_VALIDOS.includes(datos.rol as Rol)) {
    errores.rol = "Elegí un rol válido.";
  }
  return errores;
}

// Sin empresas asignadas para un rol no-ADMIN: se permite guardar igual,
// solo se avisa (el resto del sistema ya tolera ese estado sin romperse —
// la landing "Mis empresas" ya maneja 0 empresas con un mensaje vacío).
function advertenciaSinEmpresas(datos: DatosUsuario) {
  return datos.rol !== "ADMIN" && datos.empresaIds.length === 0
    ? "Este usuario no va a poder ver ninguna empresa hasta que le asignes al menos una."
    : undefined;
}

// Permisos por empresa que manda el formulario (EmpresasYPermisos): por cada
// empresa tildada, "Puede cargar Real de esta empresa" (campo puedeOperarEjecucion) / "Revisa presupuesto". Solo se aplican si
// el formulario los incluye (campo permisosIncluidos) — así un envío sin esos
// campos nunca los pone en false de rebote.
function leerPermisos(formData: FormData) {
  const incluidos = formData.get("permisosIncluidos") === "1";
  return (empresaId: string) =>
    incluidos
      ? {
          puedeOperarEjecucion: formData.get(`opera_${empresaId}`) === "on",
          puedeRevisarPresupuesto: formData.get(`revisa_${empresaId}`) === "on",
        }
      : {};
}

export type ResultadoCrear =
  | { ok: true; passwordTemporal: string; advertencia?: string }
  | { ok: false; errores: Record<string, string> };

export async function crearUsuario(
  _estadoPrevio: ResultadoCrear | null,
  formData: FormData
): Promise<ResultadoCrear> {
  await requireAdmin();
  const datos = leerDatosUsuario(formData);

  const errores = validarCampos(datos);
  if (Object.keys(errores).length === 0) {
    // insensitive: también detecta emails viejos guardados con mayúsculas.
    const existe = await prisma.usuario.findFirst({
      where: { email: { equals: datos.email, mode: "insensitive" } },
    });
    if (existe) errores.email = "Ya existe un usuario con ese email.";
  }
  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const passwordTemporal = generarPasswordTemporal();
  const passwordHash = await hashPassword(passwordTemporal);
  const permisosDe = leerPermisos(formData);

  await prisma.usuario.create({
    data: {
      nombre: datos.nombre,
      email: datos.email,
      rol: datos.rol as Rol,
      passwordHash,
      debeActualizarPassword: true,
      empresas:
        datos.rol === "ADMIN"
          ? undefined
          : { create: datos.empresaIds.map((empresaId) => ({ empresaId, ...permisosDe(empresaId) })) },
    },
  });

  revalidatePath("/admin/usuarios");
  return { ok: true, passwordTemporal, advertencia: advertenciaSinEmpresas(datos) };
}

export type ResultadoActualizar =
  | { ok: true; advertencia?: string }
  | { ok: false; errores: Record<string, string> };

export async function actualizarUsuario(
  id: string,
  _estadoPrevio: ResultadoActualizar | null,
  formData: FormData
): Promise<ResultadoActualizar> {
  const admin = await requireAdmin();
  const datos = leerDatosUsuario(formData);
  const activo = formData.get("activo") === "on";

  const errores = validarCampos(datos);
  if (Object.keys(errores).length === 0) {
    const existe = await prisma.usuario.findFirst({
      where: { email: { equals: datos.email, mode: "insensitive" }, NOT: { id } },
    });
    if (existe) errores.email = "Ya existe un usuario con ese email.";
  }
  // No se puede quitar el propio rol de ADMIN: si el único admin se
  // degradara a sí mismo, nadie podría volver a entrar a esta pantalla.
  if (id === admin.id && datos.rol !== "ADMIN") {
    errores.rol = "No podés quitarte tu propio rol de administrador.";
  }
  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  // Filas de UsuarioEmpresa (hallazgo 2026-10-07: antes se borraban TODAS y se
  // recreaban solo con empresaId, así que cualquier guardado ponía en false
  // puedeOperarEjecucion/puedeRevisarPresupuesto). Ahora:
  // - las empresas que siguen tildadas conservan su fila (upsert, no borrar y
  //   recrear); se borran solo las destildadas;
  // - los permisos por empresa se guardan según leerPermisos (sin la marca
  //   permisosIncluidos no se tocan — una empresa nueva sin ellos queda sin permisos).
  // Un ADMIN no necesita filas (ve todo): al pasar a ADMIN se borran todas.
  const permisosDe = leerPermisos(formData);
  // Permiso GLOBAL de operar Ejecución (Usuario.operaEjecucion, D-3): solo se toca si el
  // formulario lo incluye (operaEjecucionIncluida), igual que los permisos por empresa.
  const operaEjecucion =
    formData.get("operaEjecucionIncluida") === "1" ? { operaEjecucion: formData.get("operaEjecucion") === "on" } : {};
  await prisma.$transaction([
    prisma.usuario.update({
      where: { id },
      data: { nombre: datos.nombre, email: datos.email, rol: datos.rol as Rol, activo, ...operaEjecucion },
    }),
    ...(datos.rol === "ADMIN"
      ? [prisma.usuarioEmpresa.deleteMany({ where: { usuarioId: id } })]
      : [
          prisma.usuarioEmpresa.deleteMany({
            where: { usuarioId: id, empresaId: { notIn: datos.empresaIds } },
          }),
          ...datos.empresaIds.map((empresaId) =>
            prisma.usuarioEmpresa.upsert({
              where: { usuarioId_empresaId: { usuarioId: id, empresaId } },
              create: { usuarioId: id, empresaId, ...permisosDe(empresaId) },
              update: permisosDe(empresaId),
            })
          ),
        ]),
  ]);

  revalidatePath("/admin/usuarios");
  revalidatePath(`/admin/usuarios/${id}`);
  return { ok: true, advertencia: advertenciaSinEmpresas(datos) };
}

export type ResultadoReset = { ok: true; passwordTemporal: string } | { ok: false; error: string };

// Restablece la contraseña de OTRO usuario (no la propia — eso es
// cambiarPassword en app/cuenta/actions.ts) y fuerza el cierre de todas sus
// sesiones activas: tiene sentido si se está restableciendo la contraseña
// porque la perdió, o por sospecha de acceso indebido.
export async function restablecerPassword(id: string): Promise<ResultadoReset> {
  await requireAdmin();

  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) {
    return { ok: false, error: "No encontré ese usuario." };
  }

  const passwordTemporal = generarPasswordTemporal();
  const passwordHash = await hashPassword(passwordTemporal);

  await prisma.$transaction([
    prisma.usuario.update({
      where: { id },
      data: { passwordHash, debeActualizarPassword: true },
    }),
    prisma.sesion.deleteMany({ where: { usuarioId: id } }),
  ]);

  revalidatePath(`/admin/usuarios/${id}`);
  return { ok: true, passwordTemporal };
}
