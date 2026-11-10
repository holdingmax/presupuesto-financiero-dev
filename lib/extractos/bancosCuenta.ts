import { BANCOS_EXTRACTO, NOMBRE_BANCO } from "./tipos";

// Bancos que pueden tener una CuentaBancaria. Son los 6 de los lectores de extractos crudos (BANCOS_EXTRACTO,
// que NO cambia: ahí viven detectarFormato y los lectores) MÁS BBVA Perú, que no tiene lector de banco: se
// carga por su propio camino (lib/extractos/havannaPeru.ts) desde el libro PF de Kike. CuentaBancaria.banco
// es un texto libre en la base, así que sumar este banco no necesita migración.
export const BANCO_BBVA_PERU = "BBVA_PERU";

export const BANCOS_CUENTA = [...BANCOS_EXTRACTO, BANCO_BBVA_PERU] as const;
export type BancoCuenta = (typeof BANCOS_CUENTA)[number];

export const NOMBRE_BANCO_CUENTA: Record<BancoCuenta, string> = { ...NOMBRE_BANCO, BBVA_PERU: "BBVA Perú" };

export function esBancoCuenta(valor: string): valor is BancoCuenta {
  return (BANCOS_CUENTA as readonly string[]).includes(valor);
}

// Las dos cuentas de BBVA Perú (una por moneda). Nombres canónicos con tilde, como los pidió Kike; la
// comparación con lo cargado siempre pasa por normalizarCuenta (sin tildes ni mayúsculas).
export const CUENTAS_BBVA_PERU = { PEN: "BBVA PERÚ SOLES", USD: "BBVA PERÚ USD" } as const;
