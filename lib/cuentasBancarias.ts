import { normalizarCuenta } from "@/lib/unidadesNegocio";
import { BANCOS_EXTRACTO, esBancoExtracto, NOMBRE_BANCO, type BancoExtracto } from "@/lib/extractos/tipos";
import { BANCO_BBVA_PERU, BANCOS_CUENTA, CUENTAS_BBVA_PERU, monedaDeCuentaBbvaPeru, type BancoCuenta } from "@/lib/extractos/bancosCuenta";

// Reglas de la lista de cuentas bancarias por empresa (plan docs/lector_bancos_plan.md
// §4.1). Funciones puras, sin base de datos: las usa la pantalla /admin/cuentas-bancarias
// (en el servidor, el cliente solo ayuda) y el selector de "Subir extracto".
//
// El nombre canónico es EXACTAMENTE el del madre de Kike: "MACRO 599", "GALICIA 731",
// "FRANCES 891" (BBVA), "BSE 560", "BNA 241", "SANT 099". El código del banco es la
// primera palabra del nombre.

export type CuentaExistente = { id: string; nombre: string; activa: boolean };

export type DatosCuenta = { nombre: string; banco: string; terminacion: string };

// moneda: solo la fijan las cuentas de BBVA Perú (por su nombre); en los demás bancos no viene y queda el default.
export type CuentaValidada = { nombre: string; banco: BancoCuenta; terminacion: string; moneda?: "PEN" | "USD" };

export type ResultadoValidacionCuenta =
  | { ok: true; cuenta: CuentaValidada }
  // reactivarId: ya existe una cuenta INACTIVA con ese nombre; se ofrece reactivarla.
  | { ok: false; error: string; reactivarId?: string };

const FORMA_NOMBRE = /^([A-Z]+) (\d+)$/;

// `existentes`: TODAS las cuentas del holding (activas e inactivas): el nombre es único global
// (Ejecución global, plan §3.2). `editandoId`: la cuenta que se está editando, para que no
// choque consigo misma.
export function validarCuenta(
  datos: DatosCuenta,
  existentes: CuentaExistente[],
  editandoId?: string
): ResultadoValidacionCuenta {
  if (datos.banco === BANCO_BBVA_PERU) return validarCuentaBbvaPeru(datos, existentes, editandoId);

  const nombre = normalizarCuenta(datos.nombre);
  const forma = FORMA_NOMBRE.exec(nombre);
  if (!forma) {
    return { ok: false, error: 'El nombre tiene que ser el banco y el número, por ejemplo "MACRO 599".' };
  }
  const [, palabraBanco, numero] = forma;

  if (!esBancoExtracto(datos.banco)) {
    return { ok: false, error: `Banco no válido. Los bancos son: ${BANCOS_CUENTA.join(", ")}.` };
  }
  if (palabraBanco !== datos.banco) {
    return {
      ok: false,
      error: `El nombre empieza con ${palabraBanco} pero elegiste el banco ${datos.banco} (${NOMBRE_BANCO[datos.banco]}).`,
    };
  }

  const terminacion = datos.terminacion.trim();
  if (!/^\d{3,6}$/.test(terminacion)) {
    return { ok: false, error: "La terminación son entre 3 y 6 dígitos, sin otros caracteres." };
  }
  if (!numero.endsWith(terminacion)) {
    return {
      ok: false,
      error: `La terminación (${terminacion}) tiene que ser los últimos dígitos del número del nombre (${numero}).`,
    };
  }

  // Repetido en el holding, contando también las inactivas.
  const repetida = existentes.find((c) => c.id !== editandoId && normalizarCuenta(c.nombre) === nombre);
  if (repetida) {
    return repetida.activa
      ? { ok: false, error: `Ya existe la cuenta ${nombre}.` }
      : {
          ok: false,
          error: `Ya existe la cuenta ${nombre}, pero está inactiva. Reactivala en vez de crear otra.`,
          reactivarId: repetida.id,
        };
  }

  return { ok: true, cuenta: { nombre, banco: datos.banco, terminacion } };
}

// BBVA Perú: no es un banco de los lectores y sus cuentas no llevan número en el nombre. Solo valen sus dos
// nombres canónicos (soles y dólares); se guardan con el nombre canónico (con tilde). El archivo de Perú no
// trae número de cuenta, así que la terminación es opcional (si se pone, 3 a 6 dígitos).
function validarCuentaBbvaPeru(datos: DatosCuenta, existentes: CuentaExistente[], editandoId?: string): ResultadoValidacionCuenta {
  const clave = normalizarCuenta(datos.nombre);
  const canonico = Object.values(CUENTAS_BBVA_PERU).find((n) => normalizarCuenta(n) === clave);
  if (!canonico) {
    return { ok: false, error: `Las cuentas de BBVA Perú son: ${Object.values(CUENTAS_BBVA_PERU).join(" y ")}.` };
  }
  const terminacion = datos.terminacion.trim();
  if (terminacion !== "" && !/^[0-9]{3,6}$/.test(terminacion)) {
    return { ok: false, error: "La terminación son entre 3 y 6 dígitos, sin otros caracteres (o dejala vacía)." };
  }
  const repetida = existentes.find((c) => c.id !== editandoId && normalizarCuenta(c.nombre) === clave);
  if (repetida) {
    return repetida.activa
      ? { ok: false, error: `Ya existe la cuenta ${canonico}.` }
      : { ok: false, error: `Ya existe la cuenta ${canonico}, pero está inactiva. Reactivala en vez de crear otra.`, reactivarId: repetida.id };
  }
  return { ok: true, cuenta: { nombre: canonico, banco: BANCO_BBVA_PERU, terminacion, moneda: monedaDeCuentaBbvaPeru(canonico) ?? undefined } };
}

// El selector de subida muestra solo las activas; las inactivas siguen existiendo (no se
// borran) para el historial. No modifica la lista que recibe.
export function cuentasActivas<T extends { activa: boolean }>(cuentas: T[]): T[] {
  return cuentas.filter((c) => c.activa);
}

// --- Validaciones al subir un extracto crudo -------------------------------------------

export type CuentaElegida = { nombre: string; banco: string; terminacion: string };

export type ResultadoControlCuentaArchivo = { ok: true; avisos: string[] } | { ok: false; error: string };

// 3 y 4 del plan §3.2: el banco detectado tiene que ser el de la cuenta elegida, y el número
// de cuenta del archivo tiene que terminar en la terminación de la cuenta elegida. Bloquea:
// cargar un extracto en la cuenta equivocada es el error más caro y silencioso. Galicia y
// Nación no traen número: se avisa que no se pudo verificar.
export function controlarCuentaDelArchivo(
  cuenta: CuentaElegida,
  bancoDetectado: BancoExtracto,
  cuentaEnArchivo: string | null
): ResultadoControlCuentaArchivo {
  if (bancoDetectado !== cuenta.banco) {
    const esperado = esBancoExtracto(cuenta.banco) ? NOMBRE_BANCO[cuenta.banco] : cuenta.banco;
    return {
      ok: false,
      error: `El archivo es de ${NOMBRE_BANCO[bancoDetectado]} pero elegiste ${cuenta.nombre} (${esperado}). No se cargó nada.`,
    };
  }
  if (cuentaEnArchivo === null) {
    return {
      ok: true,
      avisos: [`Este formato no trae el número de cuenta: no se pudo verificar que sea ${cuenta.nombre}.`],
    };
  }
  if (!cuentaEnArchivo.endsWith(cuenta.terminacion)) {
    return {
      ok: false,
      error: `El número de cuenta del archivo (termina en ${cuentaEnArchivo.slice(-4)}) no coincide con ${cuenta.nombre} (termina en ${cuenta.terminacion}). No se cargó nada.`,
    };
  }
  return { ok: true, avisos: [] };
}

// ¿Se puede verificar que el extracto es de la cuenta elegida? Solo si el archivo trae su número de
// cuenta (Macro, BBVA, Santander, Santiago del Estero). Galicia y Nación no lo traen: ahí lo único
// que respalda la cuenta es lo que eligió la persona.
export function cuentaEsVerificable(cuentaEnArchivo: string | null): boolean {
  return cuentaEnArchivo !== null;
}

// Antes de CARGAR (no al previsualizar): un extracto cuya cuenta no se puede verificar solo se carga
// si la persona confirmó expresamente que es de esa cuenta. Lo valida el servidor; el tilde de la
// pantalla es solo la forma de pedirlo.
export function exigirConfirmacionDeCuenta(
  cuentaEnArchivo: string | null,
  confirmoCuenta: boolean,
  nombreCuenta: string
): { ok: true } | { ok: false; error: string } {
  if (cuentaEsVerificable(cuentaEnArchivo) || confirmoCuenta) return { ok: true };
  return {
    ok: false,
    error: `Este formato no trae el número de cuenta: confirmá que el extracto es de la cuenta ${nombreCuenta} para poder cargarlo. No se cargó nada.`,
  };
}

// Si el archivo trae número de cuenta y no se eligió cuenta, la que coincide (banco +
// terminación) entre las activas — solo si es única.
export function sugerirCuenta<T extends { nombre: string; banco: string; terminacion: string; activa: boolean }>(
  cuentas: T[],
  bancoDetectado: BancoExtracto,
  cuentaEnArchivo: string | null
): T | null {
  if (cuentaEnArchivo === null) return null;
  const candidatas = cuentasActivas(cuentas).filter(
    (c) => c.banco === bancoDetectado && cuentaEnArchivo.endsWith(c.terminacion)
  );
  return candidatas.length === 1 ? candidatas[0] : null;
}
