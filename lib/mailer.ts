import nodemailer from "nodemailer";

// Envío de mails por SMTP (nodemailer) desde la casilla del remitente. Nunca tira: si faltan variables
// o el envío falla, devuelve { ok: false } y deja UN aviso genérico en el log — sin el token, el enlace,
// el email, el usuario ni la contraseña SMTP (el mensaje de error de la librería puede repetirlos, así
// que nunca se loguea).

export const NOMBRE_REMITENTE = "Presupuesto y Ejecución Financiera";

// Esperas cortas: el pedido de recuperación corre en segundo plano y no debe colgarse si el servidor
// SMTP no contesta.
export const TIEMPO_CONEXION_MS = 10_000;
export const TIEMPO_SOCKET_MS = 15_000;
export const TIEMPO_TOTAL_MS = 20_000;

export type EntornoMail = Partial<
  Record<"SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASS" | "MAIL_REMITENTE" | "APP_URL_PUBLICA", string | undefined>
>;
export type MensajeMail = {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  html: string;
};
// Lo único que el mailer necesita del transporte: así el test inyecta uno simulado, sin red.
export type Transporte = { sendMail(mensaje: MensajeMail): Promise<unknown> };
export type Avisar = (mensaje: string) => void;

export function puertoSmtp(env: EntornoMail): number | null {
  const n = Number(env.SMTP_PORT);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

export function mailConfigurado(env: EntornoMail): boolean {
  return Boolean(
    env.SMTP_HOST && puertoSmtp(env) !== null && env.SMTP_USER && env.SMTP_PASS && env.MAIL_REMITENTE && env.APP_URL_PUBLICA
  );
}

// Seguridad según el puerto: 465 = TLS directo (secure); cualquier otro (587) = STARTTLS, que se EXIGE
// (requireTLS) para que no pueda caer a texto plano si el servidor no lo ofrece.
export function opcionesTransporte(env: EntornoMail) {
  const port = puertoSmtp(env)!;
  const secure = port === 465;
  return {
    host: env.SMTP_HOST!,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
    connectionTimeout: TIEMPO_CONEXION_MS,
    greetingTimeout: TIEMPO_CONEXION_MS,
    socketTimeout: TIEMPO_SOCKET_MS,
  };
}

export function crearTransporteSmtp(env: EntornoMail): Transporte {
  return nodemailer.createTransport(opcionesTransporte(env)) as unknown as Transporte;
}

// El enlace se arma SOLO con APP_URL_PUBLICA (nunca con el Host del pedido: sería inyectable).
export function armarEnlaceRestablecer(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/restablecer?token=${encodeURIComponent(token)}`;
}

export function armarMailRecuperacion(enlace: string, vigenciaMinutos: number) {
  const subject = "Recuperar tu contraseña";
  const text =
    `Recibimos un pedido para restablecer tu contraseña en ${NOMBRE_REMITENTE}.\n\n` +
    `Entrá a este enlace para elegir una nueva (vale ${vigenciaMinutos} minutos y se puede usar una sola vez):\n${enlace}\n\n` +
    `Si no lo pediste vos, ignorá este mail: tu contraseña no cambia.`;
  const html =
    `<p>Recibimos un pedido para restablecer tu contraseña en ${NOMBRE_REMITENTE}.</p>` +
    `<p><a href="${enlace}">Elegir una contraseña nueva</a></p>` +
    `<p>El enlace vale ${vigenciaMinutos} minutos y se puede usar una sola vez.</p>` +
    `<p>Si no lo pediste vos, ignorá este mail: tu contraseña no cambia.</p>`;
  return { subject, text, html };
}

export async function enviarMailRecuperacion(
  datos: { para: string; token: string; vigenciaMinutos: number },
  deps: { env?: EntornoMail; transporte?: Transporte; avisar?: Avisar } = {}
): Promise<{ ok: boolean }> {
  const env: EntornoMail = deps.env ?? (process.env as EntornoMail);
  const avisar = deps.avisar ?? ((m: string) => console.warn(m));

  if (!mailConfigurado(env)) {
    avisar("[recuperación] El envío de mail no está configurado: no se envió el mail.");
    return { ok: false };
  }
  try {
    const transporte = deps.transporte ?? crearTransporteSmtp(env);
    const { subject, text, html } = armarMailRecuperacion(armarEnlaceRestablecer(env.APP_URL_PUBLICA!, datos.token), datos.vigenciaMinutos);
    // Tope duro además de los tiempos del socket.
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const tiempo = new Promise<never>((_, rechazar) => {
      reloj = setTimeout(() => rechazar(new Error("tiempo")), TIEMPO_TOTAL_MS);
    });
    try {
      await Promise.race([
        transporte.sendMail({ from: { name: NOMBRE_REMITENTE, address: env.MAIL_REMITENTE! }, to: datos.para, subject, text, html }),
        tiempo,
      ]);
    } finally {
      clearTimeout(reloj);
    }
    return { ok: true };
  } catch {
    avisar("[recuperación] No se pudo enviar el mail.");
    return { ok: false };
  }
}
