-- Moneda por movimiento y moneda por defecto de la cuenta. SOLO ADITIVA: no cambia ni borra nada.
-- Todo lo ya cargado queda en pesos argentinos ('ARS') por el default; ninguna fila se reescribe a mano.
-- NOT NULL con un default constante: en Postgres 11+ es un cambio de catálogo, sin reescribir la tabla.

-- AlterTable
ALTER TABLE "MovimientoBancario" ADD COLUMN     "moneda" TEXT NOT NULL DEFAULT 'ARS';

-- AlterTable
ALTER TABLE "CuentaBancaria" ADD COLUMN     "moneda" TEXT NOT NULL DEFAULT 'ARS';
