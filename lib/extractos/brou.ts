import { claveMovimiento } from "@/lib/conteoMovimientos";
import { buscarEncabezado, filasDeDatos, igual, leerCentavos, referenciaDeCelda, textoDeCelda, textoNormalizado, type Encabezado } from "./bancos/comun";
import { grillasDeSheetJs, tipoContenedor } from "./contenedor";
import { avisoDeRangoLejano } from "./fechas";
import type { ControlPieMoneda, FilaHavannaPeru, LecturaHavannaPeru, MonedaHavannaPeru } from "./havannaPeru";
import { ErrorExtracto, type Celda, type HojaGrilla, type OpcionesLectura } from "./tipos";

// Lector puro del extracto del BROU (Banco de la República Oriental del Uruguay) de Plate Silver: el "Detalle de
// Movimiento de Cuenta" que baja el home banking, en .xls (BIFF). UN archivo = UNA cuenta y UNA moneda; Plate Silver
// tiene dos (caja de ahorro en pesos uruguayos y en dólares) y se suben por separado.
//
// Forma del archivo (hoja "Hoja1 - Table 1"): arriba, metadata ("Nº de Cuenta\nCA 110509829-00001", "Moneda\n$" o
// "U$S"); después la tabla Fecha · Descripción · (columna vacía) · Número de documento · Asunto · Dependencia ·
// Débito · Crédito, del más nuevo al más viejo, con la fecha como número de Excel; al final una leyenda a ignorar.
// NO trae saldo corrido ni totales: el "Saldo contable" de la metadata es el de la HORA DE LA DESCARGA (incluye lo
// posterior al período), así que no sirve para controlar. El control es informativo: cantidad de filas y totales de
// débito y crédito, para compararlos con los del banco (ControlPieMoneda.estado = "sin_pie").
//
// NO es un banco de BANCOS_EXTRACTO ni lo toca detectarFormato: se invoca por su propio camino, como Chase.

export const COLUMNAS_BROU = {
  fecha: igual("FECHA"),
  concepto: igual("DESCRIPCION"),
  nroDoc: igual("NUMERO DE DOCUMENTO"),
  debito: igual("DEBITO"),
  credito: igual("CREDITO"),
};
export const COLUMNAS_OPCIONALES_BROU = {
  asunto: igual("ASUNTO"),
};

export function encabezadoBrou(filas: Celda[][]): Encabezado | null {
  return buscarEncabezado(filas, COLUMNAS_BROU, COLUMNAS_OPCIONALES_BROU);
}

export type OpcionesBrou = OpcionesLectura & {
  // Cuentas que la empresa tiene dadas de alta: moneda → número de cuenta tal cual lo muestra el banco. El archivo
  // tiene que ser de una de ellas, y su moneda tiene que ser la de esa cuenta.
  cuentaPorMoneda: Partial<Record<MonedaHavannaPeru, string>>;
};

const FILAS_DE_METADATA = 32;

// Texto de la moneda del encabezado → moneda. "$" son pesos uruguayos; "U$S" dólares.
function monedaDeTexto(texto: string): MonedaHavannaPeru | null {
  const t = texto.trim().toUpperCase();
  if (t === "$" || t === "$U" || t === "UYU") return "UYU";
  if (t === "U$S" || t === "US$" || t === "USD") return "USD";
  return null;
}

export type MetadataBrou = { numeroCuenta: string | null; monedaTexto: string | null };

// Busca por TEXTO (no por posición) el número de cuenta y la moneda en la metadata de arriba. «N° de Cuenta anterior»
// es otra celda (la cuenta vieja) y no se confunde: el patrón es exacto.
export function metadataBrou(filas: Celda[][], hasta = FILAS_DE_METADATA): MetadataBrou {
  let numeroCuenta: string | null = null;
  let monedaTexto: string | null = null;
  const sueltas = new Set<string>();
  for (let i = 0; i < Math.min(filas.length, hasta); i++) {
    for (const celda of filas[i]) {
      const t = textoNormalizado(celda);
      const cuenta = /^N[º°O]? DE CUENTA (?:[A-Z]{1,3} )?(\d+-\d+)$/.exec(t);
      if (cuenta && numeroCuenta === null) numeroCuenta = cuenta[1];
      const moneda = /^MONEDA (\S+)$/.exec(t);
      if (moneda && monedaTexto === null) monedaTexto = moneda[1];
      if (/^\d+-\d+$/.test(t)) sueltas.add(t);
    }
  }
  // El número suelto de arriba (sin etiqueta) es el mismo: si discrepan algo anda mal y no se adivina.
  if (numeroCuenta !== null && sueltas.size > 0 && !sueltas.has(numeroCuenta)) {
    throw new ErrorExtracto(`El número de cuenta del encabezado (${numeroCuenta}) no coincide con el que figura arriba del archivo (${[...sueltas].join(", ")}). No sé de qué cuenta es.`);
  }
  return { numeroCuenta, monedaTexto };
}

const fmt = (centavos: number) => (centavos / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Bytes de un .xls del BROU → su grilla (la hoja que tiene el encabezado). Se decide por contenido, no por la extensión.
export function hojaDeBytesBrou(bytes: Uint8Array): HojaGrilla {
  if (tipoContenedor(bytes) !== "xls") {
    throw new ErrorExtracto("El archivo tiene que ser el .xls que baja el BROU («Detalle de Movimiento de Cuenta»), tal cual se descargó.");
  }
  const hojas = grillasDeSheetJs(bytes);
  const hoja = hojas.find((h) => encabezadoBrou(h.filas) !== null);
  if (!hoja) {
    throw new ErrorExtracto("No encontré la tabla de movimientos del BROU (Fecha, Descripción, Número de documento, Débito, Crédito). ¿Es el archivo correcto?");
  }
  return hoja;
}

export function leerBrou(hoja: HojaGrilla, opciones: OpcionesBrou): LecturaHavannaPeru {
  const enc = encabezadoBrou(hoja.filas);
  if (!enc) {
    throw new ErrorExtracto(`No encontré la tabla de movimientos del BROU (Fecha, Descripción, Número de documento, Débito, Crédito) en la hoja "${hoja.nombre}".`);
  }

  // Cuenta y moneda salen del ENCABEZADO del archivo.
  const meta = metadataBrou(hoja.filas.slice(0, enc.indiceFila));
  if (meta.numeroCuenta === null) throw new ErrorExtracto('No encontré el «Nº de Cuenta» en el encabezado del archivo. No sé de qué cuenta es.');
  if (meta.monedaTexto === null) throw new ErrorExtracto("No encontré la «Moneda» en el encabezado del archivo. No sé en qué moneda está.");
  const moneda = monedaDeTexto(meta.monedaTexto);
  if (moneda === null) throw new ErrorExtracto(`No reconozco la moneda «${meta.monedaTexto}» del encabezado (esperaba $ o U$S).`);

  const conocidas = Object.entries(opciones.cuentaPorMoneda) as [MonedaHavannaPeru, string][];
  const dueña = conocidas.find(([, numero]) => numero === meta.numeroCuenta);
  if (!dueña) {
    throw new ErrorExtracto(
      `La cuenta ${meta.numeroCuenta} del archivo no es una de las cuentas dadas de alta (${conocidas.map(([, n]) => n).join(" y ")}). No se cargó nada.`
    );
  }
  if (dueña[0] !== moneda) {
    throw new ErrorExtracto(
      `La cuenta ${meta.numeroCuenta} es en ${dueña[0]} pero el encabezado del archivo dice moneda «${meta.monedaTexto}» (${moneda}). No se cargó nada.`
    );
  }

  const avisos = new Set<string>();
  const crudas = filasDeDatos(hoja, enc, enc.col.fecha, {});
  if (crudas.length === 0) throw new ErrorExtracto("La tabla no tiene movimientos.");

  let debitos = 0;
  let creditos = 0;
  const leidas: FilaHavannaPeru[] = crudas.map(({ fila, numeroFila, fecha }) => {
    const debito = leerCentavos(fila[enc.col.debito] ?? null, numeroFila, "el débito", avisos);
    const credito = leerCentavos(fila[enc.col.credito] ?? null, numeroFila, "el crédito", avisos);
    if (debito === null && credito === null) throw new ErrorExtracto(`Fila ${numeroFila}: no tiene débito ni crédito.`);
    if (debito !== null && credito !== null && debito !== 0 && credito !== 0) {
      throw new ErrorExtracto(`Fila ${numeroFila}: tiene débito y crédito a la vez. No sé cuál es el importe; revisala.`);
    }
    if ((debito ?? 0) < 0 || (credito ?? 0) < 0) {
      throw new ErrorExtracto(`Fila ${numeroFila}: el débito o el crédito es negativo (el banco los informa en positivo).`);
    }
    debitos += debito ?? 0;
    creditos += credito ?? 0;
    const descripcion = textoDeCelda(fila[enc.col.concepto] ?? null).replace(/\s+/g, " ");
    const asunto = enc.col.asunto === undefined ? "" : textoDeCelda(fila[enc.col.asunto] ?? null).replace(/\s+/g, " ");
    // Descripción — Asunto: el asunto distingue movimientos que de otro modo son idénticos (p. ej. las comisiones SPI
    // del mismo día, que no traen número de documento) y es lo que ayuda a clasificar (beneficiario, factura).
    const concepto = [descripcion, asunto].filter((x) => x !== "").join(" — ") || "(sin concepto)";
    return {
      numeroFila,
      fecha,
      concepto,
      importeCentavos: (credito ?? 0) - (debito ?? 0),
      saldoCentavos: null,
      // Texto, conserva ceros a la izquierda ("000000130773625"). Sin número = null.
      referencia: referenciaDeCelda(fila[enc.col.nroDoc] ?? null),
      causal: null,
      detalle: null,
      moneda,
    };
  });

  // El banco lo baja del más nuevo al más viejo: se ordena cronológicamente (mismo criterio que los demás lectores).
  const primera = leidas[0].fecha.getTime();
  const ultima = leidas[leidas.length - 1].fecha.getTime();
  const filas = primera > ultima ? [...leidas].reverse() : leidas;

  const fechas = filas.map((f) => f.fecha);
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  const control: ControlPieMoneda[] = [
    {
      moneda,
      inicialCentavos: null,
      movimientosCentavos: creditos - debitos,
      finalCentavos: null,
      diferenciaCentavos: null,
      estado: "sin_pie",
      cantidad: filas.length,
      debitoCentavos: debitos,
      creditoCentavos: creditos,
      desde: dia(new Date(Math.min(...fechas.map((f) => f.getTime())))),
      hasta: dia(new Date(Math.max(...fechas.map((f) => f.getTime())))),
    },
  ];

  const lejano = avisoDeRangoLejano(fechas, opciones.hoy ?? new Date());
  if (lejano) avisos.add(lejano);

  return { filas, cuentaEnArchivo: meta.numeroCuenta, cuitEnArchivo: null, avisos: [...avisos], control, monedaAsumida: false, errores: [] };
}

// Texto de una línea del control, para mensajes: «19 movimientos · débitos 989.012,77 · créditos 990.000,00 · neto +987,23».
export function resumenControlBrou(c: ControlPieMoneda): string {
  const neto = c.movimientosCentavos;
  return `${c.cantidad} movimientos · débitos ${fmt(c.debitoCentavos ?? 0)} · créditos ${fmt(c.creditoCentavos ?? 0)} · neto ${neto >= 0 ? "+" : "-"}${fmt(Math.abs(neto))}`;
}

// Clave de reconocimiento: fecha + importe + cuenta + «Descripción — Asunto» + Nº de documento + moneda (sin saldo: BROU
// no lo trae). Las filas que aun así repiten TODO se distinguen por el conteo N − M de planificarCarga, igual que en los
// demás caminos: se cargan las que faltan y resubir el mismo archivo da 0.
export function claveBrou(fila: FilaHavannaPeru, bancoYCuenta: string): string {
  return claveMovimiento({
    fecha: fila.fecha,
    importeCentavos: fila.importeCentavos,
    bancoYCuenta,
    concepto: fila.concepto,
    nroReferencia: fila.referencia,
    saldoCentavos: null,
    moneda: fila.moneda,
  });
}
