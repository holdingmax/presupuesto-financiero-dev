import { createHash, randomBytes } from "crypto";
import { normalizarEmail } from "@/lib/email";
import { validarPasswordNueva } from "@/lib/reglasPassword";

// Lógica de la recuperación de contraseña, sin next ni prisma (el almacenamiento y el mailer se
// inyectan) para poder testearla. El almacenamiento real está en lib/recuperacionDb.ts.

export const VIGENCIA_TOKEN_MS = 30 * 60 * 1000;
export const VIGENCIA_TOKEN_MINUTOS = 30;
export const VENTANA_LIMITE_MS = 60 * 60 * 1000;
export const LIMITE_POR_EMAIL = 3;
export const LIMITE_POR_IP = 10;
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORMATO_TOKEN = /^[0-9a-f]{64}$/;

export const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

// Token crudo: 32 bytes aleatorios. Solo viaja en el mail; en base queda únicamente su SHA-256.
export function generarToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: sha256(token) };
}

export const claveEmail = (emailNormalizado: string) => `email:${sha256(emailNormalizado)}`;
export const claveIp = (ip: string) => `ip:${sha256(ip)}`;

export type UsuarioRecuperable = { id: string; email: string; activo: boolean };

export interface AlmacenRecuperacion {
  contarIntentos(clave: string, desde: Date): Promise<number>;
  registrarIntento(clave: string, ahora: Date): Promise<void>;
  limpiarViejos(antesDe: Date): Promise<void>;
  buscarUsuarioPorEmail(emailNormalizado: string): Promise<UsuarioRecuperable | null>;
  // Borra los tokens sin usar del usuario y guarda el nuevo (invalida los anteriores).
  reemplazarToken(usuarioId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  // Un token vigente (sin usar, no vencido, de un usuario activo), o null.
  buscarTokenVigente(tokenHash: string, ahora: Date): Promise<{ id: string; usuarioId: string } | null>;
  // UNA transacción: marca el token usado (solo si seguía sin usar), cambia la contraseña
  // (debeActualizarPassword=false), invalida los demás tokens del usuario y borra TODAS sus sesiones.
  // Devuelve false si el token ya se había usado (carrera) y no hizo nada.
  consumirYCambiar(tokenId: string, usuarioId: string, passwordHash: string, ahora: Date): Promise<boolean>;
}

export type EnviarMail = (datos: { para: string; token: string; vigenciaMinutos: number }) => Promise<{ ok: boolean }>;

// Pedido de recuperación. No devuelve nada que dependa de si el email existe, de si se superó un
// límite o de si el mail salió: la respuesta al usuario la decide quien llama y es siempre la misma.
export async function solicitarRecuperacion(
  emailTipeado: string,
  ip: string,
  deps: { almacen: AlmacenRecuperacion; enviar: EnviarMail; ahora?: () => Date }
): Promise<void> {
  const { almacen, enviar } = deps;
  const ahora = (deps.ahora ?? (() => new Date()))();
  const email = normalizarEmail(emailTipeado);
  if (!EMAIL_VALIDO.test(email) || email.length > 254) return;

  const kEmail = claveEmail(email);
  const kIp = claveIp(ip);
  const desde = new Date(ahora.getTime() - VENTANA_LIMITE_MS);

  await almacen.limpiarViejos(new Date(ahora.getTime() - 24 * VENTANA_LIMITE_MS));

  // Se cuenta ANTES de registrar y solo se registra un pedido permitido: quien insiste no alarga el
  // bloqueo más allá de la hora.
  const [porEmail, porIp] = await Promise.all([almacen.contarIntentos(kEmail, desde), almacen.contarIntentos(kIp, desde)]);
  if (porEmail >= LIMITE_POR_EMAIL || porIp >= LIMITE_POR_IP) return;
  await almacen.registrarIntento(kEmail, ahora);
  await almacen.registrarIntento(kIp, ahora);

  const usuario = await almacen.buscarUsuarioPorEmail(email);
  if (!usuario || !usuario.activo) return;

  const { token, tokenHash } = generarToken();
  await almacen.reemplazarToken(usuario.id, tokenHash, new Date(ahora.getTime() + VIGENCIA_TOKEN_MS));
  await enviar({ para: usuario.email, token, vigenciaMinutos: VIGENCIA_TOKEN_MINUTOS });
}

export async function tokenEsValido(token: string, deps: { almacen: AlmacenRecuperacion; ahora?: () => Date }): Promise<boolean> {
  if (!FORMATO_TOKEN.test(token)) return false;
  const ahora = (deps.ahora ?? (() => new Date()))();
  return (await deps.almacen.buscarTokenVigente(sha256(token), ahora)) !== null;
}

export type ResultadoRestablecer =
  | { ok: true }
  | { ok: false; errores?: { nueva?: string; confirmar?: string }; error?: string };

export const ERROR_ENLACE_INVALIDO = "El enlace no es válido o ya venció. Pedí uno nuevo.";

export async function restablecerPassword(
  token: string,
  nueva: string,
  confirmar: string,
  deps: { almacen: AlmacenRecuperacion; hashear: (p: string) => Promise<string>; ahora?: () => Date }
): Promise<ResultadoRestablecer> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  // Primero las reglas de la contraseña: si falla, el token NO se gasta.
  const errores = validarPasswordNueva(nueva, confirmar);
  if (errores.nueva || errores.confirmar) return { ok: false, errores };

  if (!FORMATO_TOKEN.test(token)) return { ok: false, error: ERROR_ENLACE_INVALIDO };
  const vigente = await deps.almacen.buscarTokenVigente(sha256(token), ahora);
  if (!vigente) return { ok: false, error: ERROR_ENLACE_INVALIDO };

  const passwordHash = await deps.hashear(nueva);
  const hecho = await deps.almacen.consumirYCambiar(vigente.id, vigente.usuarioId, passwordHash, ahora);
  return hecho ? { ok: true } : { ok: false, error: ERROR_ENLACE_INVALIDO };
}

// Interruptor general: apagado salvo que RECUPERACION_ACTIVA valga exactamente "true". Apagado, el
// enlace del login no se muestra y /olvide y /restablecer no existen (404).
export function recuperacionActiva(env: { RECUPERACION_ACTIVA?: string | undefined } = process.env as { RECUPERACION_ACTIVA?: string }): boolean {
  return env.RECUPERACION_ACTIVA === "true";
}
