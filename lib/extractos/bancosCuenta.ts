import { normalizarTexto } from "@/lib/texto";
import { BANCOS_EXTRACTO, NOMBRE_BANCO } from "./tipos";

// Bancos que pueden tener una CuentaBancaria. Son los 6 de los lectores de extractos crudos (BANCOS_EXTRACTO,
// que NO cambia: ahí viven detectarFormato y los lectores) MÁS BBVA Perú, que no tiene lector de banco: se
// carga por su propio camino (lib/extractos/havannaPeru.ts) desde el libro PF de Kike. CuentaBancaria.banco
// es un texto libre en la base, así que sumar este banco no necesita migración.
export const BANCO_BBVA_PERU = "BBVA_PERU";
// Chase (Bradenton, en dólares): tampoco es un banco de los lectores; su extracto entra por el camino propio de la
// empresa (lib/extractos/chase.ts). Mismo criterio: banco = texto libre en la base, sin migración.
export const BANCO_CHASE = "CHASE";

export const BANCOS_CUENTA = [...BANCOS_EXTRACTO, BANCO_BBVA_PERU, BANCO_CHASE] as const;
export type BancoCuenta = (typeof BANCOS_CUENTA)[number];

export const NOMBRE_BANCO_CUENTA: Record<BancoCuenta, string> = { ...NOMBRE_BANCO, BBVA_PERU: "BBVA Perú", CHASE: "Chase" };

export function esBancoCuenta(valor: string): valor is BancoCuenta {
  return (BANCOS_CUENTA as readonly string[]).includes(valor);
}

// Las dos cuentas de BBVA Perú (una por moneda). Nombres canónicos con tilde, como los pidió Kike; la
// comparación con lo cargado siempre pasa por normalizarCuenta (sin tildes ni mayúsculas).
export const CUENTAS_BBVA_PERU = { PEN: "BBVA PERÚ SOLES", USD: "BBVA PERÚ USD" } as const;

// La cuenta de Chase de Bradenton (una sola, en dólares). Nombre canónico sin número, como pidió Kike.
export const CUENTAS_CHASE = { USD: "CHASE BRADENTON" } as const;

// Bancos cuyas cuentas son FIJAS (nombre canónico → moneda): cada empresa declara sus monedas acá y en
// CONFIG_EXTRACTO_EMPRESA. La pantalla de cuentas no pide moneda y el default de la base es ARS, que la carga por
// extracto rechazaría; por eso la moneda sale del nombre canónico de la cuenta.
export const CUENTAS_FIJAS_POR_BANCO: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [BANCO_BBVA_PERU]: CUENTAS_BBVA_PERU,
  [BANCO_CHASE]: CUENTAS_CHASE,
};

export function tieneCuentasFijas(banco: string): boolean {
  return Object.prototype.hasOwnProperty.call(CUENTAS_FIJAS_POR_BANCO, banco);
}

// Moneda de una cuenta fija del banco indicado, por su nombre. null = no es una de sus cuentas.
export function monedaDeCuentaFija(banco: string, nombre: string): string | null {
  if (!tieneCuentasFijas(banco)) return null;
  const clave = normalizarTexto(nombre);
  for (const [moneda, canonico] of Object.entries(CUENTAS_FIJAS_POR_BANCO[banco])) {
    if (normalizarTexto(canonico) === clave) return moneda;
  }
  return null;
}

// Moneda de cada cuenta de BBVA Perú, por su nombre (se conserva para quien ya lo usa).
export function monedaDeCuentaBbvaPeru(nombre: string): "PEN" | "USD" | null {
  return monedaDeCuentaFija(BANCO_BBVA_PERU, nombre) as "PEN" | "USD" | null;
}
