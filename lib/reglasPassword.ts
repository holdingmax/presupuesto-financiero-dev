// Reglas de la contraseña NUEVA, compartidas por el cambio desde /cuenta y por la recuperación por mail
// (/restablecer): así no pueden divergir. Sin dependencias para poder testearlas.
export const LARGO_MINIMO_PASSWORD = 8;

export function validarPasswordNueva(nueva: string, confirmar: string): { nueva?: string; confirmar?: string } {
  const errores: { nueva?: string; confirmar?: string } = {};
  if (nueva.length < LARGO_MINIMO_PASSWORD) {
    errores.nueva = `La contraseña nueva tiene que tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.`;
  }
  if (nueva !== confirmar) {
    errores.confirmar = "No coincide con la contraseña nueva.";
  }
  return errores;
}
