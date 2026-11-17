import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  ERROR_ENLACE_INVALIDO,
  LIMITE_POR_EMAIL,
  LIMITE_POR_IP,
  VIGENCIA_TOKEN_MS,
  claveEmail,
  claveIp,
  recuperacionActiva,
  restablecerPassword,
  sha256,
  solicitarRecuperacion,
  tokenEsValido,
  type AlmacenRecuperacion,
  type EnviarMail,
} from "@/lib/recuperacion";
import { LARGO_MINIMO_PASSWORD, validarPasswordNueva } from "@/lib/reglasPassword";
import { armarEnlaceRestablecer, enviarMailRecuperacion, mailConfigurado, opcionesTransporte, puertoSmtp, type MensajeMail, type Transporte } from "@/lib/mailer";
import { ORDEN_IP_POR_DEFECTO, ipDelCliente, ordenDesdeEntorno } from "@/lib/ipCliente";

// Almacén en memoria con la MISMA semántica que lib/recuperacionDb.ts (token único de un uso, sesiones
// borradas en el cambio): permite probar la lógica sin base.
type Tok = { id: string; usuarioId: string; tokenHash: string; expiresAt: Date; usadoAt: Date | null };
function crearAlmacen() {
  const usuarios = [
    { id: "u1", email: "ana@x.com", activo: true, passwordHash: "viejo", debeActualizarPassword: true },
    { id: "u2", email: "baja@x.com", activo: false, passwordHash: "viejo2", debeActualizarPassword: false },
    { id: "u3", email: "otro@x.com", activo: true, passwordHash: "viejo3", debeActualizarPassword: false },
  ];
  const tokens: Tok[] = [];
  const intentos: { clave: string; createdAt: Date }[] = [];
  const sesiones = [{ id: "s1", usuarioId: "u1" }, { id: "s2", usuarioId: "u1" }, { id: "s3", usuarioId: "u3" }];
  let n = 0;
  const almacen: AlmacenRecuperacion = {
    async contarIntentos(clave, desde) {
      return intentos.filter((i) => i.clave === clave && i.createdAt >= desde).length;
    },
    async registrarIntento(clave, ahora) {
      intentos.push({ clave, createdAt: ahora });
    },
    async limpiarViejos(antesDe) {
      for (let i = intentos.length - 1; i >= 0; i--) if (intentos[i].createdAt < antesDe) intentos.splice(i, 1);
    },
    async buscarUsuarioPorEmail(email) {
      return usuarios.find((u) => u.email === email) ?? null;
    },
    async reemplazarToken(usuarioId, tokenHash, expiresAt) {
      for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].usuarioId === usuarioId && !tokens[i].usadoAt) tokens.splice(i, 1);
      tokens.push({ id: `t${++n}`, usuarioId, tokenHash, expiresAt, usadoAt: null });
    },
    async buscarTokenVigente(tokenHash, ahora) {
      const t = tokens.find((x) => x.tokenHash === tokenHash);
      if (!t || t.usadoAt || t.expiresAt <= ahora) return null;
      if (!usuarios.find((u) => u.id === t.usuarioId)!.activo) return null;
      return { id: t.id, usuarioId: t.usuarioId };
    },
    async consumirYCambiar(tokenId, usuarioId, passwordHash, ahora) {
      const t = tokens.find((x) => x.id === tokenId);
      if (!t || t.usadoAt) return false;
      t.usadoAt = ahora;
      const u = usuarios.find((x) => x.id === usuarioId)!;
      u.passwordHash = passwordHash;
      u.debeActualizarPassword = false;
      for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].usuarioId === usuarioId && !tokens[i].usadoAt) tokens.splice(i, 1);
      for (let i = sesiones.length - 1; i >= 0; i--) if (sesiones[i].usuarioId === usuarioId) sesiones.splice(i, 1);
      return true;
    },
  };
  return { almacen, usuarios, tokens, intentos, sesiones };
}

function crearMailer() {
  const enviados: { para: string; token: string; vigenciaMinutos: number }[] = [];
  const enviar: EnviarMail = async (d) => {
    enviados.push(d);
    return { ok: true };
  };
  return { enviar, enviados };
}

const T0 = new Date("2026-11-18T12:00:00Z");
const hashear = async (p: string) => `hash(${p})`;

test("el token se guarda solo como SHA-256: el crudo viaja en el mail y no queda en base", async () => {
  const { almacen, tokens, intentos } = crearAlmacen();
  const { enviar, enviados } = crearMailer();
  await solicitarRecuperacion("ana@x.com", "1.1.1.1", { almacen, enviar, ahora: () => T0 });

  assert.equal(enviados.length, 1);
  const crudo = enviados[0].token;
  assert.match(crudo, /^[0-9a-f]{64}$/); // 32 bytes
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].tokenHash, sha256(crudo));
  assert.notEqual(tokens[0].tokenHash, crudo);
  assert.ok(!JSON.stringify([tokens, intentos]).includes(crudo), "el token crudo no está en ningún registro");
  // Los contadores tampoco guardan el email ni la IP en claro.
  const guardado = JSON.stringify(intentos);
  assert.ok(!guardado.includes("ana@x.com") && !guardado.includes("1.1.1.1"));
});

test("tokens distintos en cada pedido", async () => {
  const a = crearAlmacen();
  const m = crearMailer();
  await solicitarRecuperacion("ana@x.com", "1.1.1.1", { almacen: a.almacen, enviar: m.enviar, ahora: () => T0 });
  await solicitarRecuperacion("otro@x.com", "1.1.1.1", { almacen: a.almacen, enviar: m.enviar, ahora: () => T0 });
  assert.notEqual(m.enviados[0].token, m.enviados[1].token);
});

test("vencimiento: vale 30 minutos y después no sirve", async () => {
  const { almacen } = crearAlmacen();
  const { enviar, enviados } = crearMailer();
  await solicitarRecuperacion("ana@x.com", "1.1.1.1", { almacen, enviar, ahora: () => T0 });
  const token = enviados[0].token;
  assert.equal(VIGENCIA_TOKEN_MS, 30 * 60 * 1000);

  const justo = new Date(T0.getTime() + VIGENCIA_TOKEN_MS - 1000);
  assert.equal(await tokenEsValido(token, { almacen, ahora: () => justo }), true);
  const vencido = new Date(T0.getTime() + VIGENCIA_TOKEN_MS + 1000);
  assert.equal(await tokenEsValido(token, { almacen, ahora: () => vencido }), false);
  const r = await restablecerPassword(token, "claveNueva1", "claveNueva1", { almacen, hashear, ahora: () => vencido });
  assert.deepEqual(r, { ok: false, error: ERROR_ENLACE_INVALIDO });
});

test("un solo uso: el segundo intento con el mismo token falla", async () => {
  const { almacen } = crearAlmacen();
  const { enviar, enviados } = crearMailer();
  await solicitarRecuperacion("ana@x.com", "1.1.1.1", { almacen, enviar, ahora: () => T0 });
  const token = enviados[0].token;

  const r1 = await restablecerPassword(token, "claveNueva1", "claveNueva1", { almacen, hashear, ahora: () => T0 });
  assert.deepEqual(r1, { ok: true });
  const r2 = await restablecerPassword(token, "otraClave22", "otraClave22", { almacen, hashear, ahora: () => T0 });
  assert.deepEqual(r2, { ok: false, error: ERROR_ENLACE_INVALIDO });
});

test("un token nuevo invalida los anteriores del mismo usuario (y no toca a otros)", async () => {
  const { almacen } = crearAlmacen();
  const { enviar, enviados } = crearMailer();
  await solicitarRecuperacion("ana@x.com", "1.1.1.1", { almacen, enviar, ahora: () => T0 });
  await solicitarRecuperacion("otro@x.com", "2.2.2.2", { almacen, enviar, ahora: () => T0 });
  await solicitarRecuperacion("ana@x.com", "1.1.1.1", { almacen, enviar, ahora: () => T0 });
  const [viejo, deOtro, nuevo] = enviados.map((e) => e.token);

  assert.equal(await tokenEsValido(viejo, { almacen, ahora: () => T0 }), false);
  assert.equal(await tokenEsValido(nuevo, { almacen, ahora: () => T0 }), true);
  assert.equal(await tokenEsValido(deOtro, { almacen, ahora: () => T0 }), true);
});

test("token con formato raro o inventado se rechaza sin tocar la base", async () => {
  const { almacen } = crearAlmacen();
  for (const t of ["", "abc", "x".repeat(64), "A".repeat(64), "0".repeat(64)]) {
    assert.equal(await tokenEsValido(t, { almacen, ahora: () => T0 }), false);
    const r = await restablecerPassword(t, "claveNueva1", "claveNueva1", { almacen, hashear, ahora: () => T0 });
    assert.deepEqual(r, { ok: false, error: ERROR_ENLACE_INVALIDO });
  }
});

test("respuesta idéntica: existe, no existe, inactivo, inválido o con límite superado → mismo resultado y sin lanzar", async () => {
  const resultados: unknown[] = [];
  const casos = ["ana@x.com", "nadie@x.com", "baja@x.com", "esto no es un email", "", "ANA@X.COM  "];
  for (const email of casos) {
    const { almacen } = crearAlmacen();
    const { enviar } = crearMailer();
    resultados.push(await solicitarRecuperacion(email, "9.9.9.9", { almacen, enviar, ahora: () => T0 }));
  }
  // Con el límite ya superado también.
  const lleno = crearAlmacen();
  for (let i = 0; i < LIMITE_POR_EMAIL; i++) lleno.intentos.push({ clave: claveEmail("ana@x.com"), createdAt: T0 });
  resultados.push(await solicitarRecuperacion("ana@x.com", "9.9.9.9", { almacen: lleno.almacen, enviar: crearMailer().enviar, ahora: () => T0 }));
  assert.ok(resultados.every((r) => r === undefined), "la función no devuelve nada que distinga los casos");
});

test("solo manda mail a usuarios activos que existen; normaliza el email", async () => {
  const { almacen } = crearAlmacen();
  const { enviar, enviados } = crearMailer();
  for (const e of ["nadie@x.com", "baja@x.com", "esto no es un email", ""]) {
    await solicitarRecuperacion(e, "1.1.1.1", { almacen, enviar, ahora: () => T0 });
  }
  assert.equal(enviados.length, 0);
  await solicitarRecuperacion("  ANA@X.com ", "1.1.1.1", { almacen, enviar, ahora: () => T0 });
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].para, "ana@x.com");
});

test("límite por email: 3 por hora; después no se manda ni se crea token; pasada la hora vuelve a andar", async () => {
  const { almacen, tokens } = crearAlmacen();
  const { enviar, enviados } = crearMailer();
  for (let i = 0; i < LIMITE_POR_EMAIL + 2; i++) {
    // IPs distintas: el tope que corta es el del email.
    await solicitarRecuperacion("ana@x.com", `3.3.3.${i}`, { almacen, enviar, ahora: () => new Date(T0.getTime() + i * 1000) });
  }
  assert.equal(LIMITE_POR_EMAIL, 3);
  assert.equal(enviados.length, 3);
  assert.equal(tokens.length, 1);

  const despues = new Date(T0.getTime() + 61 * 60 * 1000);
  await solicitarRecuperacion("ana@x.com", "3.3.3.99", { almacen, enviar, ahora: () => despues });
  assert.equal(enviados.length, 4);
});

test("el límite por email no cuenta contra otro email", async () => {
  const { almacen } = crearAlmacen();
  const { enviar, enviados } = crearMailer();
  for (let i = 0; i < 5; i++) await solicitarRecuperacion("ana@x.com", `4.4.4.${i}`, { almacen, enviar, ahora: () => T0 });
  await solicitarRecuperacion("otro@x.com", "4.4.4.200", { almacen, enviar, ahora: () => T0 });
  assert.equal(enviados.filter((e) => e.para === "otro@x.com").length, 1);
});

test("límite por IP: 10 por hora aunque cambie el email; pedidos bloqueados no alargan el bloqueo", async () => {
  const { almacen, intentos } = crearAlmacen();
  const { enviar, enviados } = crearMailer();
  assert.equal(LIMITE_POR_IP, 10);
  for (let i = 0; i < 15; i++) {
    await solicitarRecuperacion(`nadie${i}@x.com`, "5.5.5.5", { almacen, enviar, ahora: () => T0 });
  }
  assert.equal(intentos.filter((i) => i.clave === claveIp("5.5.5.5")).length, LIMITE_POR_IP);

  // Otra IP no está bloqueada.
  await solicitarRecuperacion("ana@x.com", "6.6.6.6", { almacen, enviar, ahora: () => T0 });
  assert.equal(enviados.length, 1);
  // La IP bloqueada tampoco consigue mail para un email real.
  await solicitarRecuperacion("otro@x.com", "5.5.5.5", { almacen, enviar, ahora: () => T0 });
  assert.equal(enviados.length, 1);
});

test("restablecer: nuevo hash, debeActualizarPassword=false, token usado y se cierran TODAS las sesiones del usuario", async () => {
  const { almacen, usuarios, sesiones, tokens } = crearAlmacen();
  const { enviar, enviados } = crearMailer();
  await solicitarRecuperacion("ana@x.com", "1.1.1.1", { almacen, enviar, ahora: () => T0 });

  const r = await restablecerPassword(enviados[0].token, "claveNueva1", "claveNueva1", { almacen, hashear, ahora: () => T0 });
  assert.deepEqual(r, { ok: true });

  const ana = usuarios.find((u) => u.id === "u1")!;
  assert.equal(ana.passwordHash, "hash(claveNueva1)");
  assert.equal(ana.debeActualizarPassword, false);
  assert.equal(sesiones.filter((s) => s.usuarioId === "u1").length, 0);
  assert.equal(sesiones.filter((s) => s.usuarioId === "u3").length, 1, "las sesiones de otros usuarios siguen");
  assert.equal(tokens.filter((t) => t.usuarioId === "u1" && !t.usadoAt).length, 0);
  assert.equal(usuarios.find((u) => u.id === "u3")!.passwordHash, "viejo3");
});

test("reglas de contraseña: las mismas que /cuenta (mínimo 8 y confirmación) y un error NO gasta el token", async () => {
  assert.equal(LARGO_MINIMO_PASSWORD, 8);
  assert.deepEqual(validarPasswordNueva("12345678", "12345678"), {});
  assert.ok(validarPasswordNueva("1234567", "1234567").nueva);
  assert.ok(validarPasswordNueva("12345678", "12345679").confirmar);
  assert.deepEqual(Object.keys(validarPasswordNueva("abc", "xyz")).sort(), ["confirmar", "nueva"]);

  const { almacen, usuarios } = crearAlmacen();
  const { enviar, enviados } = crearMailer();
  await solicitarRecuperacion("ana@x.com", "1.1.1.1", { almacen, enviar, ahora: () => T0 });
  const token = enviados[0].token;

  const corta = await restablecerPassword(token, "corta", "corta", { almacen, hashear, ahora: () => T0 });
  assert.equal(corta.ok, false);
  const distinta = await restablecerPassword(token, "claveNueva1", "claveNueva2", { almacen, hashear, ahora: () => T0 });
  assert.equal(distinta.ok, false);
  assert.equal(usuarios.find((u) => u.id === "u1")!.passwordHash, "viejo");
  // El token sigue sirviendo después de los errores de validación.
  assert.equal(await tokenEsValido(token, { almacen, ahora: () => T0 }), true);
});

test("un usuario dado de baja después del pedido no puede restablecer", async () => {
  const { almacen, usuarios } = crearAlmacen();
  const { enviar, enviados } = crearMailer();
  await solicitarRecuperacion("ana@x.com", "1.1.1.1", { almacen, enviar, ahora: () => T0 });
  usuarios.find((u) => u.id === "u1")!.activo = false;
  const r = await restablecerPassword(enviados[0].token, "claveNueva1", "claveNueva1", { almacen, hashear, ahora: () => T0 });
  assert.equal(r.ok, false);
});

test("interruptor RECUPERACION_ACTIVA: apagado por defecto, solo 'true' lo prende", () => {
  assert.equal(recuperacionActiva({}), false);
  assert.equal(recuperacionActiva({ RECUPERACION_ACTIVA: "" }), false);
  assert.equal(recuperacionActiva({ RECUPERACION_ACTIVA: "false" }), false);
  assert.equal(recuperacionActiva({ RECUPERACION_ACTIVA: "1" }), false);
  assert.equal(recuperacionActiva({ RECUPERACION_ACTIVA: "true" }), true);
});

// ---------- Mailer simulado (transporte falso, sin red) ----------
// Credenciales generadas en cada corrida: ningún usuario ni contraseña queda escrito en el repo.
const SMTP_USER_FALSO = `u-${randomBytes(6).toString("hex")}`;
const SMTP_PASS_FALSA = `p-${randomBytes(10).toString("hex")}`;
const ENV_OK = {
  SMTP_HOST: "smtp.invalido.test",
  SMTP_PORT: "587",
  SMTP_USER: SMTP_USER_FALSO,
  SMTP_PASS: SMTP_PASS_FALSA,
  MAIL_REMITENTE: "remitente@invalido.test",
  APP_URL_PUBLICA: "https://app.ejemplo.com/",
};
const TOKEN = "a".repeat(64);

test("mailer simulado: arma el mensaje con remitente con nombre y enlace de APP_URL_PUBLICA", async () => {
  const enviados: MensajeMail[] = [];
  const transporte: Transporte = { sendMail: async (m) => void enviados.push(m) };
  const avisos: string[] = [];
  const r = await enviarMailRecuperacion({ para: "ana@x.com", token: TOKEN, vigenciaMinutos: 30 }, { env: ENV_OK, transporte, avisar: (m) => avisos.push(m) });
  assert.deepEqual(r, { ok: true });
  assert.equal(avisos.length, 0);
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].from, { name: "Presupuesto y Ejecución Financiera", address: "remitente@invalido.test" });
  assert.equal(enviados[0].to, "ana@x.com");
  assert.ok(enviados[0].text.includes(`https://app.ejemplo.com/restablecer?token=${TOKEN}`), "sin barra doble");
  assert.ok(enviados[0].html.includes(`/restablecer?token=${TOKEN}`));
  assert.equal(armarEnlaceRestablecer("https://x.com///", "t"), "https://x.com/restablecer?token=t");
});

test("mailer simulado: sin variables NO rompe, no usa el transporte y el log es solo un aviso genérico", async () => {
  let usado = false;
  const transporte: Transporte = { sendMail: async () => void (usado = true) };
  const sin = (k: keyof typeof ENV_OK) => ({ ...ENV_OK, [k]: undefined });
  const casos = [{}, { SMTP_HOST: "h" }, sin("SMTP_HOST"), sin("SMTP_PORT"), sin("SMTP_USER"), sin("SMTP_PASS"), sin("MAIL_REMITENTE"), sin("APP_URL_PUBLICA"), { ...ENV_OK, SMTP_PORT: "abc" }, { ...ENV_OK, SMTP_PORT: "0" }];
  for (const env of casos) {
    const avisos: string[] = [];
    const r = await enviarMailRecuperacion({ para: "ana@x.com", token: TOKEN, vigenciaMinutos: 30 }, { env, transporte, avisar: (m) => avisos.push(m) });
    assert.deepEqual(r, { ok: false });
    assert.equal(avisos.length, 1);
    assert.ok(!avisos[0].includes(TOKEN) && !avisos[0].includes("ana@x.com") && !avisos[0].includes("restablecer"));
  }
  assert.equal(usado, false);
  assert.equal(mailConfigurado({}), false);
  assert.equal(mailConfigurado(ENV_OK), true);
});

test("mailer simulado: si el transporte falla no lanza y el log no filtra token, enlace, email, usuario ni contraseña", async () => {
  const transporte: Transporte = {
    sendMail: async () => {
      throw new Error(`535 auth fallida para ${SMTP_USER_FALSO} / ${SMTP_PASS_FALSA} enviando a ana@x.com con ${TOKEN}`);
    },
  };
  const avisos: string[] = [];
  const r = await enviarMailRecuperacion({ para: "ana@x.com", token: TOKEN, vigenciaMinutos: 30 }, { env: ENV_OK, transporte, avisar: (m) => avisos.push(m) });
  assert.deepEqual(r, { ok: false });
  assert.equal(avisos.length, 1);
  const log = avisos.join(" | ");
  for (const secreto of [TOKEN, "ana@x.com", SMTP_USER_FALSO, SMTP_PASS_FALSA, "restablecer"]) assert.ok(!log.includes(secreto));
});

test("mailer: seguridad según el puerto (465 TLS directo, 587 STARTTLS exigido) y esperas cortas", () => {
  const o465 = opcionesTransporte({ ...ENV_OK, SMTP_PORT: "465" });
  assert.equal(o465.secure, true);
  assert.equal(o465.requireTLS, false);
  assert.equal(o465.port, 465);
  const o587 = opcionesTransporte({ ...ENV_OK, SMTP_PORT: "587" });
  assert.equal(o587.secure, false);
  assert.equal(o587.requireTLS, true, "STARTTLS obligatorio: no cae a texto plano");
  assert.equal(o587.host, "smtp.invalido.test");
  assert.ok(o587.connectionTimeout <= 10_000 && o587.socketTimeout <= 15_000 && o587.greetingTimeout <= 10_000);
  assert.equal(puertoSmtp({ SMTP_PORT: "587" }), 587);
  assert.equal(puertoSmtp({ SMTP_PORT: "" }), null);
  assert.equal(puertoSmtp({ SMTP_PORT: "70000" }), null);
});

// ---------- IP ----------
const cab = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });

test("IP: se prefiere cf-connecting-ip aunque x-forwarded-for traiga otra cosa", () => {
  assert.equal(ipDelCliente(cab({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9, 8.8.8.8" })), "1.2.3.4");
});

test("IP: si llegan cf-connecting-ip y true-client-ip distintos, gana cf-connecting-ip (el otro lo puede mandar el cliente)", () => {
  assert.equal(ipDelCliente(cab({ "cf-connecting-ip": "1.2.3.4", "true-client-ip": "6.6.6.6", "x-forwarded-for": "7.7.7.7" })), "1.2.3.4");
});

test("IP: sin cf-connecting-ip se usa true-client-ip, antes que x-forwarded-for", () => {
  assert.equal(ipDelCliente(cab({ "true-client-ip": "5.5.5.5", "x-forwarded-for": "9.9.9.9, 172.70.0.1" })), "5.5.5.5");
});

test("IP: un x-forwarded-for falsificado no cambia el resultado cuando existe cf-connecting-ip", () => {
  const real = { "cf-connecting-ip": "1.2.3.4" };
  const base = ipDelCliente(cab({ ...real, "x-forwarded-for": "172.70.0.1" }));
  for (const falso of ["6.6.6.6", "6.6.6.6, 172.70.0.1", "1.1.1.1, 2.2.2.2, 3.3.3.3", "basura"]) {
    assert.equal(ipDelCliente(cab({ ...real, "x-forwarded-for": falso })), base);
  }
  assert.equal(base, "1.2.3.4");
});

test("IP: fallback a x-forwarded-for (la última entrada) solo si no hay encabezados de Cloudflare", () => {
  assert.equal(ipDelCliente(cab({ "x-forwarded-for": "9.9.9.9, 1.2.3.4" })), "1.2.3.4");
  assert.equal(ipDelCliente(cab({ "x-forwarded-for": "1.2.3.4" })), "1.2.3.4");
  assert.equal(ipDelCliente(cab({ "x-forwarded-for": "falsa, otra, 1.2.3.4" })), "1.2.3.4");
  assert.equal(ipDelCliente(cab({ "x-forwarded-for": "9.9.9.9, 1.2.3.4, 10.0.0.1" }), ["x-forwarded-for"], 2), "1.2.3.4");
  assert.equal(ipDelCliente(cab({})), "desconocida");
  // Un valor que no parece IP se salta y se pasa al siguiente encabezado.
  assert.equal(ipDelCliente(cab({ "cf-connecting-ip": "<script>", "true-client-ip": "5.5.5.5" })), "5.5.5.5");
  assert.equal(ipDelCliente(cab({ "cf-connecting-ip": "<script>" })), "desconocida");
});

test("IP: el orden es configurable con IP_CLIENTE_ENCABEZADOS; lo desconocido se ignora y vacío vuelve al defecto", () => {
  assert.deepEqual(ORDEN_IP_POR_DEFECTO, ["cf-connecting-ip", "true-client-ip", "x-forwarded-for"]);
  assert.deepEqual(ordenDesdeEntorno(undefined), ORDEN_IP_POR_DEFECTO);
  assert.deepEqual(ordenDesdeEntorno(""), ORDEN_IP_POR_DEFECTO);
  assert.deepEqual(ordenDesdeEntorno("cosa-rara, otra"), ORDEN_IP_POR_DEFECTO);
  assert.deepEqual(ordenDesdeEntorno(" CF-Connecting-IP , x-forwarded-for,cf-connecting-ip"), ["cf-connecting-ip", "x-forwarded-for"]);

  const todos = cab({ "true-client-ip": "1.1.1.1", "cf-connecting-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" });
  assert.equal(ipDelCliente(todos, ordenDesdeEntorno("true-client-ip,cf-connecting-ip")), "1.1.1.1");
  assert.equal(ipDelCliente(todos, ordenDesdeEntorno("x-forwarded-for")), "3.3.3.3");
  assert.equal(ipDelCliente(todos), "2.2.2.2", "por defecto gana cf-connecting-ip");
  assert.equal(ipDelCliente(todos, ordenDesdeEntorno("x-real-ip")), "desconocida");
});

test("IP: dos clientes distintos detrás de la misma IP de Cloudflare generan claves distintas", () => {
  const a = ipDelCliente(cab({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "172.70.0.1" }));
  const b = ipDelCliente(cab({ "cf-connecting-ip": "5.6.7.8", "x-forwarded-for": "172.70.0.1" }));
  assert.notEqual(claveIp(a), claveIp(b));
});
