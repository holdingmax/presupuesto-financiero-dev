import { normalizarTexto } from "@/lib/texto";
import { separarNuevasDosPasadas } from "@/lib/conteoMovimientos";
import type { FilaMadre } from "./madre";

// Piezas puras de la carga del archivo madre por la web (subirMadre, app/ejecucion/actions.ts).
// Sin base de datos ni ExcelJS. No cambian lib/extractos/madre.ts (que fija madre.test.ts).

// Valor de la opción "Archivo madre" del selector de cuenta (no es una cuenta).
export const OPCION_ARCHIVO_MADRE = "__ARCHIVO_MADRE__";

export const CLASIFICACION_VACIA = "SIN CLASIFICAR";
export const UNIDAD_VACIA = "SIN ASIGNAR";
const SIN_BANCO = "(sin banco)";

// Clasificación que trae el archivo (no la propuso el sistema ni quedó vacía): se respeta, y en la
// web los cruces con las planillas de referencia NO la pisan.
export function esClasificacionExplicita(f: { clasificacion: string; sugeridaPorSistema: boolean }): boolean {
  return !f.sugeridaPorSistema && f.clasificacion !== CLASIFICACION_VACIA;
}

// De lo ya cargado en el rango de fechas, solo lo de las cuentas del archivo. Se compara con
// normalizarCuenta (= normalizarTexto: saca tildes y mayúsculas) de los DOS lados: filtrar en SQL con
// upper(trim()) dejaba afuera 'DÓLAR' (la base) contra 'DOLAR' (el archivo normalizado) y esa cuenta
// se recargaba entera.
export function existentesDeLasCuentas<T extends { bancoYCuenta: string }>(
  existentes: T[],
  cuentasNormalizadas: Set<string>
): T[] {
  return existentes.filter((m) => cuentasNormalizadas.has(normalizarTexto(m.bancoYCuenta)));
}

export type FilaParaCotejo = { cuenta: string; clave: string; claveBase: string; claveFIC: string };

// "Una cuenta por un solo camino", por cuenta: una cuenta del archivo parece cargada por el OTRO
// camino (extracto crudo) cuando ya tiene movimientos en las fechas del archivo, ninguna fila del
// archivo coincide exactamente con ellos, pero sí hay filas con la misma fecha e importe. Es la
// misma regla que subirExtracto aplica al extracto crudo, evaluada cuenta por cuenta (con
// varias cuentas el "ya cargadas = 0" tiene que ser de cada una, no del archivo entero).
// `cuenta` va normalizada (normalizarCuenta); claveFIC = cuenta + fecha + importe.
export function cuentasCargadasPorOtroCamino(filas: FilaParaCotejo[], existentes: FilaParaCotejo[]): Set<string> {
  const existentesPorCuenta = new Map<string, FilaParaCotejo[]>();
  for (const e of existentes) {
    const grupo = existentesPorCuenta.get(e.cuenta);
    if (grupo) grupo.push(e);
    else existentesPorCuenta.set(e.cuenta, [e]);
  }
  const filasPorCuenta = new Map<string, FilaParaCotejo[]>();
  for (const f of filas) {
    const grupo = filasPorCuenta.get(f.cuenta);
    if (grupo) grupo.push(f);
    else filasPorCuenta.set(f.cuenta, [f]);
  }

  const omitidas = new Set<string>();
  for (const [cuenta, delArchivo] of filasPorCuenta) {
    const deLaBase = existentesPorCuenta.get(cuenta);
    if (!deLaBase || deLaBase.length === 0) continue;
    // Dos pasadas (clave completa, después clave base sin saldo ni referencia): si Kike recalculó los
    // saldos o completó las referencias de una cuenta, sus filas ya cargadas igual se reconocen y la
    // cuenta no se descarta entera.
    const { nuevas, cantidadYaCargadas } = separarNuevasDosPasadas(
      delArchivo,
      (f) => ({ conSaldo: f.clave, base: f.claveBase }),
      deLaBase.map((e) => ({ conSaldo: e.clave, base: e.claveBase }))
    );
    const parecidas = new Set(deLaBase.map((e) => e.claveFIC));
    if (cantidadYaCargadas === 0 && nuevas.some((n) => parecidas.has(n.claveFIC))) omitidas.add(cuenta);
  }
  return omitidas;
}

export type ResumenMadre = {
  filas: number;
  cuentas: { cuenta: string; filas: number }[];
  // Cuentas del archivo que no están en el catálogo (Administración → Cuentas bancarias).
  cuentasFueraDelCatalogo: string[];
  filasSinBanco: number;
  // Clasificaciones explícitas del archivo que no están en la lista ni en uso (¿typo?).
  clasificacionesNuevas: { nombre: string; cantidad: number }[];
  sinClasificar: number;
  sinUnidad: number;
};

function ordenarPorCantidad<T extends { cantidad: number; nombre: string }>(a: T, b: T) {
  return b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, "es");
}

export function resumirMadre(
  filas: FilaMadre[],
  conocidas: { cuentasDelCatalogo: string[]; clasificaciones: string[] }
): ResumenMadre {
  const catalogo = new Set(conocidas.cuentasDelCatalogo.map(normalizarTexto));
  const clasificacionesConocidas = new Set(conocidas.clasificaciones.map(normalizarTexto));

  const porCuenta = new Map<string, { cuenta: string; filas: number }>();
  const nuevas = new Map<string, { nombre: string; cantidad: number }>();
  let filasSinBanco = 0;
  let sinClasificar = 0;
  let sinUnidad = 0;

  for (const f of filas) {
    const claveCuenta = normalizarTexto(f.bancoYCuenta);
    if (claveCuenta === normalizarTexto(SIN_BANCO)) filasSinBanco++;
    const cuenta = porCuenta.get(claveCuenta);
    if (cuenta) cuenta.filas++;
    else porCuenta.set(claveCuenta, { cuenta: f.bancoYCuenta, filas: 1 });

    if (f.clasificacion === CLASIFICACION_VACIA) sinClasificar++;
    if (f.unidadNegocio === UNIDAD_VACIA) sinUnidad++;

    if (esClasificacionExplicita(f)) {
      const clave = normalizarTexto(f.clasificacion);
      if (!clasificacionesConocidas.has(clave)) {
        const previa = nuevas.get(clave);
        if (previa) previa.cantidad++;
        else nuevas.set(clave, { nombre: f.clasificacion.trim(), cantidad: 1 });
      }
    }
  }

  const cuentas = [...porCuenta.values()].sort(
    (a, b) => b.filas - a.filas || a.cuenta.localeCompare(b.cuenta, "es")
  );
  return {
    filas: filas.length,
    cuentas,
    cuentasFueraDelCatalogo: cuentas
      .map((c) => c.cuenta)
      .filter((c) => normalizarTexto(c) !== normalizarTexto(SIN_BANCO) && !catalogo.has(normalizarTexto(c))),
    filasSinBanco,
    clasificacionesNuevas: [...nuevas.values()].sort(ordenarPorCantidad),
    sinClasificar,
    sinUnidad,
  };
}
