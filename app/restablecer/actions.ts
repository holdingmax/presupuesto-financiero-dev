"use server";

import { almacenPrisma } from "@/lib/recuperacionDb";
import { recuperacionActiva, restablecerPassword, ERROR_ENLACE_INVALIDO, type ResultadoRestablecer } from "@/lib/recuperacion";
import { hashPassword } from "@/lib/password";

// No crea sesión: tras cambiarla, la persona entra por /login con la contraseña nueva. En la misma
// transacción se cierran todas las sesiones del usuario (ver almacenPrisma.consumirYCambiar).
export async function restablecer(_estadoPrevio: ResultadoRestablecer | null, formData: FormData): Promise<ResultadoRestablecer> {
  if (!recuperacionActiva()) return { ok: false, error: ERROR_ENLACE_INVALIDO };
  return restablecerPassword(
    String(formData.get("token") ?? ""),
    String(formData.get("nueva") ?? ""),
    String(formData.get("confirmar") ?? ""),
    { almacen: almacenPrisma, hashear: hashPassword }
  );
}
