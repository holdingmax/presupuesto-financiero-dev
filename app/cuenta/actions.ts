"use server";

import { requireUsuario, verifyPassword, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validarPasswordNueva } from "@/lib/reglasPassword";

export type ResultadoCambiarPassword =
  | { ok: true }
  | { ok: false; errores: Record<string, string> };

export async function cambiarPassword(
  _estadoPrevio: ResultadoCambiarPassword | null,
  formData: FormData
): Promise<ResultadoCambiarPassword> {
  // requireUsuario() (no requireUsuarioAlDia): esta pantalla tiene que
  // seguir siendo alcanzable cuando debeActualizarPassword está prendido —
  // es justamente la salida de ese estado.
  const usuario = await requireUsuario();

  const actual = String(formData.get("actual") ?? "");
  const nueva = String(formData.get("nueva") ?? "");
  const confirmar = String(formData.get("confirmar") ?? "");

  const errores: Record<string, string> = {};

  if (!usuario.passwordHash || !(await verifyPassword(actual, usuario.passwordHash))) {
    errores.actual = "La contraseña actual no es correcta.";
  }
  Object.assign(errores, validarPasswordNueva(nueva, confirmar));

  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const passwordHash = await hashPassword(nueva);
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { passwordHash, debeActualizarPassword: false },
  });

  return { ok: true };
}
