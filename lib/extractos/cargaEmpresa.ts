import { EMPRESAS_CON_EXTRACTO_POR_EMPRESA } from "@/lib/config";
import {
  centavosDeDecimalTexto,
  claveMovimiento,
  contarPorClave,
  decimalTextoDeCentavos,
  monedaParaClave,
  separarNuevas,
} from "@/lib/conteoMovimientos";
import { periodoDeFecha } from "@/lib/ejecucionSemanas";
import { normalizarCuenta } from "@/lib/unidadesNegocio";
import { BANCO_BBVA_PERU, CUENTAS_BBVA_PERU } from "./bancosCuenta";
import { claveHavannaPeru, type FilaHavannaPeru, type LecturaHavannaPeru, type MonedaHavannaPeru } from "./havannaPeru";

// Decisiones PURAS de la acción subirExtractoEmpresa (app/ejecucion/actionsExtractoEmpresa.ts), sin base de datos
// ni sesión: cuál es la empresa configurada, qué cuentas y qué unidad se fuerzan, cómo se arman las filas y qué
// se carga (reconocimiento N − M, igual que subirExtracto). La acción solo lee la base, llama a esto y escribe.

export type ConfigExtractoEmpresa = {
  // Unidad de negocio FIJA de todos los movimientos: el archivo no puede cambiarla.
  unidad: string;
  banco: string;
  // Cuenta (nombre canónico) a la que va cada moneda.
  cuentaPorMoneda: Record<MonedaHavannaPeru, string>;
};

// Una entrada por slug de EMPRESAS_CON_EXTRACTO_POR_EMPRESA (lib/config.ts).
export const CONFIG_EXTRACTO_EMPRESA: Record<string, ConfigExtractoEmpresa> = {
  "havanna-peru": {
    unidad: "HAVANNA PERU",
    banco: BANCO_BBVA_PERU,
    cuentaPorMoneda: { PEN: CUENTAS_BBVA_PERU.PEN, USD: CUENTAS_BBVA_PERU.USD },
  },
};

export const CLASIFICACION_SIN_CLASIFICAR = "SIN CLASIFICAR";

export const ERROR_EMPRESA_SIN_EXTRACTO = "Esta empresa no carga su Real por extracto: no está habilitada para este camino.";

// null = la empresa no está en la lista de config (o falta su entrada de configuración).
export function configDeEmpresa(slug: string): ConfigExtractoEmpresa | null {
  if (!EMPRESAS_CON_EXTRACTO_POR_EMPRESA.includes(slug)) return null;
  return CONFIG_EXTRACTO_EMPRESA[slug] ?? null;
}

// ---- Cuentas forzadas ---------------------------------------------------------------------------

export type CuentaDeLaBase = { id: string; nombre: string; banco: string; activa: boolean; empresaId: string | null; moneda: string };

const MONEDAS: MonedaHavannaPeru[] = ["PEN", "USD"];
const MONEDA_ISO: Record<MonedaHavannaPeru, string> = { PEN: "PEN", USD: "USD" };

export type ResultadoCuentas =
  | { ok: true; cuentas: Record<MonedaHavannaPeru, CuentaDeLaBase> }
  | { ok: false; error: string };

// Las cuentas de cada moneda tienen que existir, estar activas, ser de ESTA empresa, ser del banco configurado y
// tener la moneda que corresponde. Si falta algo se rechaza con un mensaje que dice qué.
export function resolverCuentasForzadas(
  config: ConfigExtractoEmpresa,
  empresaId: string,
  cuentasDeLaBase: readonly CuentaDeLaBase[]
): ResultadoCuentas {
  const problemas: string[] = [];
  const cuentas: Partial<Record<MonedaHavannaPeru, CuentaDeLaBase>> = {};
  for (const moneda of MONEDAS) {
    const nombre = config.cuentaPorMoneda[moneda];
    const c = cuentasDeLaBase.find((x) => normalizarCuenta(x.nombre) === normalizarCuenta(nombre));
    if (!c) {
      problemas.push(`no existe la cuenta ${nombre} (cargala en Administración → Cuentas bancarias, banco BBVA Perú, de esta empresa)`);
    } else if (!c.activa) {
      problemas.push(`la cuenta ${nombre} está inactiva`);
    } else if (c.empresaId !== empresaId) {
      problemas.push(`la cuenta ${nombre} no es de esta empresa`);
    } else if (c.banco !== config.banco) {
      problemas.push(`la cuenta ${nombre} no es del banco BBVA Perú`);
    } else if (c.moneda.trim().toUpperCase() !== MONEDA_ISO[moneda]) {
      problemas.push(`la cuenta ${nombre} tiene moneda ${c.moneda} y tiene que ser ${MONEDA_ISO[moneda]}`);
    } else {
      cuentas[moneda] = c;
    }
  }
  if (problemas.length > 0) {
    return { ok: false, error: `No puedo cargar el extracto: ${problemas.join("; ")}. No se cargó nada.` };
  }
  return { ok: true, cuentas: cuentas as Record<MonedaHavannaPeru, CuentaDeLaBase> };
}

// ---- Regla dura de la lectura -------------------------------------------------------------------

// null = se puede seguir. Si el lector marcó ALGÚN error (incluye el pie que no cuadra) no se carga nada, y sin
// columna Moneda no se puede repartir entre las dos cuentas (no se asume en silencio).
export function errorDeLectura(
  lectura: Pick<LecturaHavannaPeru, "errores" | "monedaAsumida">,
  config: ConfigExtractoEmpresa,
  nombrePestana: string
): string | null {
  if (lectura.errores.length > 0) return `${lectura.errores.join(" ")} No se cargó nada.`;
  if (lectura.monedaAsumida) {
    return `La pestaña "${nombrePestana}" no tiene columna Moneda: no puedo repartir los movimientos entre ${config.cuentaPorMoneda.PEN} y ${config.cuentaPorMoneda.USD}. No se cargó nada.`;
  }
  return null;
}

// ---- Filas a cargar -----------------------------------------------------------------------------

export type FilaACargar = {
  numeroFila: number;
  fecha: Date;
  nroReferencia: string;
  causal: string | null;
  concepto: string;
  importeCentavos: number;
  saldoCentavos: null;
  bancoYCuenta: string;
  moneda: MonedaHavannaPeru;
  clasificacion: string;
  clasificacion2: null;
  unidadNegocio: string;
  detalle: null;
  detalle2: null;
  sugeridaPorSistema: false;
  chequeIvaAmbiguo: false;
  // La unidad es EXPLÍCITA (fijada por la configuración), no una sugerencia a confirmar.
  unidadSugeridaPorSistema: false;
  clave: string;
};

// Cada fila va a la cuenta de SU moneda; la unidad es siempre la de la configuración; todo SIN CLASIFICAR
// (el diccionario del DETALLE viene en otra etapa).
export function armarFilasACargar(
  lectura: Pick<LecturaHavannaPeru, "filas">,
  config: ConfigExtractoEmpresa,
  cuentas: Record<MonedaHavannaPeru, { nombre: string }>
): FilaACargar[] {
  return lectura.filas.map((f: FilaHavannaPeru) => {
    const bancoYCuenta = cuentas[f.moneda].nombre;
    return {
      numeroFila: f.numeroFila,
      fecha: f.fecha,
      nroReferencia: f.referencia ?? "",
      causal: f.causal,
      concepto: f.concepto,
      importeCentavos: f.importeCentavos,
      saldoCentavos: null,
      bancoYCuenta,
      moneda: f.moneda,
      clasificacion: CLASIFICACION_SIN_CLASIFICAR,
      clasificacion2: null,
      unidadNegocio: config.unidad,
      detalle: null,
      detalle2: null,
      sugeridaPorSistema: false,
      chequeIvaAmbiguo: false,
      unidadSugeridaPorSistema: false,
      clave: claveHavannaPeru(f, bancoYCuenta),
    };
  });
}

// Todas las fechas tienen que caer en el período de la semana: este camino no reparte entre meses.
export function errorFechasFueraDelPeriodo(filas: readonly { fecha: Date; numeroFila: number }[], periodo: string): string | null {
  const fuera = filas.filter((f) => periodoDeFecha(f.fecha) !== periodo);
  if (fuera.length === 0) return null;
  const ejemplo = fuera[0];
  return `${fuera.length} movimientos tienen fecha fuera de ${periodo} (por ejemplo la fila ${ejemplo.numeroFila}, ${ejemplo.fecha.toISOString().slice(0, 10)}). Esta carga es de un solo mes; revisá la pestaña. No se cargó nada.`;
}

// ---- Reconocimiento de lo ya cargado ------------------------------------------------------------

// Lo que se lee de la base (importe y saldo como texto decimal exacto).
export type FilaExistente = {
  fecha: Date;
  importe: string;
  bancoYCuenta: string;
  concepto: string;
  nroReferencia: string | null;
  saldo: string | null;
  moneda: string;
};

export function claveDeExistente(m: FilaExistente): string {
  return claveMovimiento({
    fecha: m.fecha,
    importeCentavos: centavosDeDecimalTexto(m.importe),
    bancoYCuenta: m.bancoYCuenta,
    concepto: m.concepto,
    nroReferencia: m.nroReferencia,
    saldoCentavos: m.saldo === null ? null : centavosDeDecimalTexto(m.saldo),
    moneda: m.moneda,
  });
}

function claveFechaImporteCuenta(fecha: Date, importeCentavos: number, bancoYCuenta: string, moneda: string) {
  return JSON.stringify([fecha.toISOString().slice(0, 10), importeCentavos, normalizarCuenta(bancoYCuenta), ...monedaParaClave(moneda)]);
}

export type PlanDeCarga = {
  nuevas: FilaACargar[];
  cantidadYaCargadas: number;
  // Movimientos que YA hay en las dos cuentas dentro del rango de fechas del archivo.
  existentesEnRango: number;
  // Hay movimientos de esas cuentas en el rango, ninguno coincide exacto, pero sí misma fecha+importe: casi seguro
  // entraron por otro camino y cargar duplicaría (misma regla que subirExtracto).
  bloqueo: string | null;
  avisos: string[];
};

// De cada clave se cargan N − M (N en el archivo, M ya cargadas). Lo ya cargado no se toca. Resubir el mismo mes
// da 0 nuevas. Un mismo archivo con Nº Doc distinto da claves distintas, así que no se pisan.
export function planificarCarga(filas: readonly FilaACargar[], existentes: readonly FilaExistente[]): PlanDeCarga {
  const yaCargadas = contarPorClave(existentes.map(claveDeExistente));
  const { nuevas, cantidadYaCargadas } = separarNuevas([...filas], (f) => f.clave, yaCargadas);

  const avisos: string[] = [];
  let bloqueo: string | null = null;
  if (existentes.length > 0) {
    avisos.push(
      cantidadYaCargadas === filas.length
        ? `Este mes ya está cargado: las ${filas.length} filas del archivo ya estaban en las cuentas de Perú. No se carga nada nuevo.`
        : `Ya hay ${existentes.length} movimientos en las cuentas de Perú entre las fechas del archivo: ${cantidadYaCargadas} de las ${filas.length} filas del archivo ya estaban y se reconocen (no se duplican); se cargan ${nuevas.length} nuevas.`
    );
    if (existentes.length > cantidadYaCargadas) {
      avisos.push(
        `Hay ${existentes.length - cantidadYaCargadas} movimientos ya cargados en esas cuentas y fechas que NO vienen en este archivo (cargados antes, a mano o por otro camino). No se tocan.`
      );
    }
    const vistos = new Set(existentes.map((m) => claveFechaImporteCuenta(m.fecha, centavosDeDecimalTexto(m.importe), m.bancoYCuenta, m.moneda)));
    const parecidas = nuevas.filter((n) => vistos.has(claveFechaImporteCuenta(n.fecha, n.importeCentavos, n.bancoYCuenta, n.moneda))).length;
    if (cantidadYaCargadas === 0 && parecidas > 0) {
      bloqueo = `Las cuentas de Perú ya tienen movimientos cargados en las fechas de este archivo por otro camino, y ${parecidas} de las filas tienen la misma fecha e importe que algunos de ellos. Cargar el archivo los duplicaría. No se cargó nada.`;
    }
  }
  return { nuevas, cantidadYaCargadas, existentesEnRango: existentes.length, bloqueo, avisos };
}

export function datosParaCrear(f: FilaACargar, ejecucionId: string) {
  return {
    ejecucionId,
    fecha: f.fecha,
    nroReferencia: f.nroReferencia,
    causal: f.causal,
    concepto: f.concepto,
    importe: decimalTextoDeCentavos(f.importeCentavos),
    saldo: null,
    bancoYCuenta: f.bancoYCuenta,
    moneda: f.moneda,
    clasificacion: f.clasificacion,
    clasificacion2: f.clasificacion2,
    unidadNegocio: f.unidadNegocio,
    detalle: f.detalle,
    detalle2: f.detalle2,
    sugeridaPorSistema: f.sugeridaPorSistema,
    chequeIvaAmbiguo: f.chequeIvaAmbiguo,
    unidadSugeridaPorSistema: f.unidadSugeridaPorSistema,
  };
}

// Rango [desde, hasta] (medianoche UTC) de un período AAAA-MM.
export function rangoDelPeriodo(periodo: string): { desde: Date; hasta: Date } {
  const [a, m] = periodo.split("-").map(Number);
  return { desde: new Date(Date.UTC(a, m - 1, 1)), hasta: new Date(Date.UTC(a, m, 0)) };
}
