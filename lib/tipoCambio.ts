// Tipo de cambio por período (Etapa 2, Havanna Perú). Funciones PURAS (sin base de datos): la tabla es
// TipoCambio (periodo + moneda + valor = soles por 1 unidad de moneda); la lectura con base está en
// lib/tipoCambioDb.ts. El importe ORIGINAL en dólares se conserva siempre; la conversión se hace al armar
// el Reporte, con el TC del mes. Si falta, se AVISA y no se inventa ninguno.

export const MONEDA_BASE_PERU = "PEN"; // el Reporte de Havanna Perú está en soles
export const MONEDAS_CON_TIPO_DE_CAMBIO: readonly string[] = ["USD"];

const FORMATO_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;
const ESCALA = 6; // decimales del valor guardado (Decimal(18,6))

export type FilaTipoCambio = { periodo: string; moneda: string; valor: string };

export type ResultadoTipoCambio =
  | { ok: true; valor: string; esBase: boolean }
  | { ok: false; aviso: string };

export function avisoTipoCambioFaltante(periodo: string, moneda: string): string {
  return `Falta el tipo de cambio ${moneda} → ${MONEDA_BASE_PERU} de ${periodo}: no se convirtieron los importes en ${moneda} (ADMIN o FINANZAS lo tienen que cargar).`;
}

// La moneda base (soles) vale 1 y no necesita fila. Cualquier otra moneda sin fila: aviso, no un valor inventado.
export function buscarTipoCambio(filas: readonly FilaTipoCambio[], periodo: string, moneda: string): ResultadoTipoCambio {
  const m = moneda.trim().toUpperCase();
  if (m === MONEDA_BASE_PERU) return { ok: true, valor: "1", esBase: true };
  const fila = filas.find((f) => f.periodo === periodo && f.moneda.trim().toUpperCase() === m);
  if (!fila || !esValorValido(fila.valor)) return { ok: false, aviso: avisoTipoCambioFaltante(periodo, m) };
  return { ok: true, valor: fila.valor, esBase: false };
}

function esValorValido(valor: string): boolean {
  return /^\d+(\.\d+)?$/.test(valor) && Number(valor) > 0;
}

export type ResultadoValidacionTC =
  | { ok: true; periodo: string; moneda: string; valor: string }
  | { ok: false; error: string };

// Lo que escribe la persona ("3,467" o "3.467") → valor canónico con punto, máximo 6 decimales, mayor que 0.
// Con coma Y punto a la vez es ambiguo ("1.234,56"): se rechaza, no se adivina.
export function validarTipoCambio(periodo: string, moneda: string, texto: string): ResultadoValidacionTC {
  if (!FORMATO_PERIODO.test(periodo)) return { ok: false, error: `"${periodo}" no es un período válido (AAAA-MM).` };
  const m = moneda.trim().toUpperCase();
  if (!MONEDAS_CON_TIPO_DE_CAMBIO.includes(m)) {
    return { ok: false, error: `El tipo de cambio es solo para ${MONEDAS_CON_TIPO_DE_CAMBIO.join(", ")}.` };
  }
  const t = texto.trim();
  if (t.includes(",") && t.includes(".")) {
    return { ok: false, error: `"${t}" es ambiguo: escribilo con un solo separador decimal (3,467).` };
  }
  const canonico = t.replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(canonico)) {
    return { ok: false, error: `"${t}" no es un tipo de cambio válido (número con hasta ${ESCALA} decimales).` };
  }
  if (!(Number(canonico) > 0)) return { ok: false, error: "El tipo de cambio tiene que ser mayor que cero." };
  return { ok: true, periodo, moneda: m, valor: canonico };
}

// centavos (entero, con signo) × valor decimal exacto → centavos en soles, redondeo mitad lejos del cero, sin float.
export function convertirCentavos(centavos: number, valor: string): number {
  if (!esValorValido(valor)) throw new Error(`Tipo de cambio inválido: "${valor}"`);
  const [entero, dec = ""] = valor.split(".");
  const escalado = BigInt(entero + (dec + "0".repeat(ESCALA)).slice(0, ESCALA)); // valor × 10^6
  const UNO = BigInt(1);
  const DOS = BigInt(2);
  const signo = centavos < 0 ? -UNO : UNO;
  const producto = BigInt(Math.abs(centavos)) * escalado;
  const base = BigInt(10 ** ESCALA);
  let q = producto / base;
  if ((producto % base) * DOS >= base) q += UNO;
  return Number(signo * q);
}

// ¿Quién carga el TC? ADMIN y FINANZAS (mismo criterio que esAdminOFinanzas de lib/auth.ts).
export function puedeCargarTipoCambio(usuario: { rol: string }): boolean {
  return usuario.rol === "ADMIN" || usuario.rol === "FINANZAS";
}
