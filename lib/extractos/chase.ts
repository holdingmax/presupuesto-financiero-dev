import { claveMovimiento } from "@/lib/conteoMovimientos";
import {
  buscarEncabezado,
  filasDeDatos,
  igual,
  leerCentavos,
  textoDeCelda,
  textoNormalizado,
  type Encabezado,
} from "./bancos/comun";
import { avisoDeRangoLejano, fechaDeCelda } from "./fechas";
import type { ControlPieMoneda, FilaHavannaPeru, LecturaHavannaPeru } from "./havannaPeru";
import { ErrorExtracto, type Celda, type HojaGrilla, type OpcionesLectura } from "./tipos";

// Lector puro del extracto de Chase de Bradenton (todo en USD). Es la pestaña "CHASE" de un libro PF: el extracto
// crudo del banco (Details · Posting Date · Description · Amount · Type · Balance · Check or Slip #) con columnas de
// clasificación manuales al costado y un bloque RESUMEN armado a mano debajo. NO es un banco de BANCOS_EXTRACTO ni lo
// toca detectarFormato: se invoca por su propio camino, como Havanna Perú. Sin base de datos, sin ExcelJS.
//
// Lo que se lee es SOLO lo del banco (columnas A-F). La columna G ("Check or Slip #") en el libro de Kike está pisada
// con la etiqueta de clasificación a mano y las columnas de más a la derecha son sus sumas: no se leen (todo entra SIN
// CLASIFICAR). Las pestañas "Ch deb" y "LOTTERY" son subconjuntos de CHASE: no traen Balance en sus filas, así que no
// cuentan como pestaña de movimientos (ver `pestanaChaseValida`).
//
// CONTROL: el Balance corrido de cada fila. Saldo inicial (fila sin fecha debajo del encabezado, solo con Balance) +
// importes = saldo final (Balance de la última fila), y cada fila tiene que cerrar con la anterior. Si el archivo viene
// del más nuevo al más viejo (así lo baja Chase) se invierte con la misma cadena.

export const MONEDA_CHASE = "USD" as const;

export const COLUMNAS_CHASE = {
  fecha: igual("POSTING DATE"),
  concepto: igual("DESCRIPTION"),
  importe: igual("AMOUNT"),
  saldo: igual("BALANCE"),
};
export const COLUMNAS_OPCIONALES_CHASE = {
  tipo: igual("TYPE"),
  detalle: igual("DETAILS"),
};

export function encabezadoChase(filas: Celda[][]): Encabezado | null {
  return buscarEncabezado(filas, COLUMNAS_CHASE, COLUMNAS_OPCIONALES_CHASE);
}

// ¿La pestaña es un extracto completo de Chase? Su Balance ENCADENA: cada fila es el Balance de la anterior más su
// Amount (o al revés si viene del más nuevo al más viejo). "Ch deb" y "LOTTERY" repiten movimientos de CHASE (LOTTERY
// hasta copia los Balance del banco, pero salteados): su cadena no cierra, y cargarlas duplicaría. Hace falta una
// cadena de al menos 2 filas, o la fila de saldo inicial pegada al encabezado que cierra con la primera.
export function pestanaChaseValida(filas: Celda[][], enc: Encabezado, date1904: boolean): boolean {
  const datos: { importe: number; saldo: number }[] = [];
  let inicial: number | null = null;
  for (let i = enc.indiceFila + 1; i < filas.length; i++) {
    const fila = filas[i];
    const r = fechaDeCelda(fila[enc.col.fecha] ?? null, { date1904 });
    if (r.estado !== "ok") {
      const balance = fila[enc.col.saldo];
      if (datos.length === 0 && i === enc.indiceFila + 1 && typeof balance === "number") inicial = Math.round(balance * 100);
      continue;
    }
    const importe = fila[enc.col.importe];
    const saldo = fila[enc.col.saldo];
    if (typeof importe !== "number" || typeof saldo !== "number") return false;
    datos.push({ importe: Math.round(importe * 100), saldo: Math.round(saldo * 100) });
  }
  if (datos.length === 0) return false;
  const filasCadena = datos.map((d, i) => ({ numeroFila: i, importe: d.importe, saldo: d.saldo }));
  const cierra = (x: typeof filasCadena) => cortesDeCadena(x, "asc").cortes === 0 || cortesDeCadena(x, "desc").cortes === 0;
  if (datos.length >= 2) return cierra(filasCadena);
  return inicial !== null && inicial + datos[0].importe === datos[0].saldo;
}

// El Nº que distingue un movimiento de otro igual, sacado de la descripción (Chase no tiene una columna de referencia
// utilizable). Prioridad: TRN de la ACH, número de cheque, ID del depósito, TRACE#. null si no hay ninguno (compras con
// tarjeta, comisiones): en ese caso distingue el saldo corrido, que SÍ entra en la clave.
export function referenciaDeChase(descripcion: string): string | null {
  const trn = /\bTRN: ?(\d{6,})/i.exec(descripcion);
  if (trn) return `TRN ${trn[1]}`;
  const cheque = /^CHECK (\d+)\b/i.exec(descripcion.trim());
  if (cheque) return `CHECK ${cheque[1]}`;
  const deposito = /\bDEPOSIT\s+ID NUMBER (\d+)/i.exec(descripcion);
  if (deposito) return `DEPOSIT ${deposito[1]}`;
  const trace = /\bTRACE#: ?(\d{6,})/i.exec(descripcion);
  if (trace) return `TRACE ${trace[1]}`;
  return null;
}

const fmt = (centavos: number) => (centavos / 100).toFixed(2);

type FilaLeida = { numeroFila: number; fecha: Date; concepto: string; importe: number; saldo: number; tipo: string | null };

// Cuántas filas NO cierran con la anterior, mirando el archivo en el orden dado y suponiendo que el saldo de cada fila
// es "después del movimiento" (ascendente) o "antes" de la siguiente en el archivo (descendente).
function cortesDeCadena(filas: readonly { numeroFila: number; importe: number; saldo: number }[], sentido: "asc" | "desc"): { cortes: number; primeraFila: number | null } {
  let cortes = 0;
  let primeraFila: number | null = null;
  for (let i = 1; i < filas.length; i++) {
    const cierra = sentido === "asc" ? filas[i - 1].saldo + filas[i].importe === filas[i].saldo : filas[i].saldo + filas[i - 1].importe === filas[i - 1].saldo;
    if (!cierra) {
      cortes++;
      if (primeraFila === null) primeraFila = filas[i].numeroFila;
    }
  }
  return { cortes, primeraFila };
}

// "SALDO INICIO BANK" / "SALDO FINAL BANK" del bloque RESUMEN hecho a mano: solo para avisar si no coinciden.
function saldosDelResumen(filas: Celda[][], desde: number, enc: Encabezado): { inicio: number | null; final: number | null } {
  let inicio: number | null = null;
  let final: number | null = null;
  for (let i = desde; i < filas.length; i++) {
    const etiqueta = textoNormalizado(filas[i][enc.col.concepto] ?? null);
    const valor = filas[i][enc.col.saldo];
    if (typeof valor !== "number") continue;
    if (etiqueta === "SALDO INICIO BANK") inicio = Math.round(valor * 100);
    else if (etiqueta === "SALDO FINAL BANK") final = Math.round(valor * 100);
  }
  return { inicio, final };
}

export function leerChase(hoja: HojaGrilla, opciones: OpcionesLectura = {}): LecturaHavannaPeru {
  const enc = encabezadoChase(hoja.filas);
  if (!enc) {
    throw new ErrorExtracto(
      `No encontré la fila de encabezados de Chase (Posting Date, Description, Amount, Balance) en la pestaña "${hoja.nombre}". ¿Es la pestaña correcta?`
    );
  }
  const avisos = new Set<string>();
  const errores: string[] = [];
  const { saldo: colSaldo, importe: colImporte, fecha: colFecha, concepto: colConcepto } = enc.col;

  // Fila de saldo inicial: sin fecha, con Balance y sin Amount. Sin ella, la primera fila de datos va pegada al
  // encabezado y el saldo inicial se deriva de ella (con aviso).
  let saldoInicial: number | null = null;
  let encDatos = enc;
  const debajo = hoja.filas[enc.indiceFila + 1];
  if (debajo !== undefined) {
    const f = fechaDeCelda(debajo[colFecha] ?? null, { date1904: hoja.date1904 });
    if (f.estado === "vacia") {
      const balance = debajo[colSaldo] ?? null;
      const tieneImporte = textoDeCelda(debajo[colImporte] ?? null) !== "";
      if (typeof balance === "number" && !tieneImporte) {
        saldoInicial = leerCentavos(balance, enc.indiceFila + 2, "el saldo inicial", avisos);
        encDatos = { ...enc, indiceFila: enc.indiceFila + 1 };
      } else {
        throw new ErrorExtracto(
          `Fila ${enc.indiceFila + 2}: la primera fila debajo del encabezado no tiene fecha ni es la del saldo inicial. No sé si hay movimientos cortados; completá la fecha o borrá la fila.`
        );
      }
    }
  }

  const crudas = filasDeDatos(hoja, encDatos, colFecha, {});
  const finDatos = encDatos.indiceFila + 1 + crudas.length;

  // Después del corte (primera fila sin fecha) no puede quedar un movimiento sin fecha: tendría Details (CHECK,
  // DEBIT, CREDIT, DSLIP…). El bloque RESUMEN no tiene Details.
  if (enc.col.detalle !== undefined) {
    for (let i = finDatos; i < hoja.filas.length; i++) {
      const detalle = textoDeCelda(hoja.filas[i][enc.col.detalle] ?? null);
      if (detalle !== "" && typeof hoja.filas[i][colImporte] === "number") {
        throw new ErrorExtracto(`Fila ${i + 1}: tiene "${detalle}" e importe pero no tiene fecha en Posting Date. No la descarto en silencio: revisala.`);
      }
    }
  }

  const leidas: FilaLeida[] = crudas.map(({ fila, numeroFila, fecha }) => {
    const importe = leerCentavos(fila[colImporte] ?? null, numeroFila, "el importe", avisos);
    if (importe === null) throw new ErrorExtracto(`Fila ${numeroFila}: no tiene importe.`);
    const saldo = leerCentavos(fila[colSaldo] ?? null, numeroFila, "el balance", avisos);
    if (saldo === null) {
      throw new ErrorExtracto(`Fila ${numeroFila}: no tiene Balance (es lo que permite controlar que no falte ni sobre ningún movimiento).`);
    }
    const tipo = enc.col.tipo === undefined ? "" : textoDeCelda(fila[enc.col.tipo] ?? null);
    return {
      numeroFila,
      fecha,
      concepto: textoDeCelda(fila[colConcepto] ?? null).replace(/\s+/g, " ") || "(sin concepto)",
      importe,
      saldo,
      tipo: tipo === "" ? null : tipo,
    };
  });
  if (leidas.length === 0) throw new ErrorExtracto("La pestaña no tiene movimientos.");

  // Orden cronológico por la cadena del Balance: la que cierra sin cortes gana; si ninguna cierra, queda el orden del
  // archivo (el de las fechas) y el corte se informa como error.
  let ordenadas = leidas;
  const asc = cortesDeCadena(leidas, "asc");
  if (asc.cortes > 0) {
    const desc = cortesDeCadena(leidas, "desc");
    if (desc.cortes === 0) {
      ordenadas = [...leidas].reverse();
      avisos.add("El extracto venía del más nuevo al más viejo: se ordenó cronológicamente por el Balance.");
    } else {
      errores.push(
        `El Balance no cierra con el movimiento anterior en ${asc.cortes} filas (la primera es la fila ${asc.primeraFila}): faltan o sobran movimientos, o están fuera de orden.`
      );
    }
  }

  // Saldo inicial: el de la fila de apertura, o derivado de la primera fila.
  const primera = ordenadas[0];
  if (saldoInicial === null) {
    saldoInicial = primera.saldo - primera.importe;
    avisos.add("El extracto no trae la fila de saldo inicial: se derivó del Balance de la primera fila.");
  } else if (saldoInicial + primera.importe !== primera.saldo && errores.length === 0) {
    errores.push(
      `El saldo inicial (${fmt(saldoInicial)}) más el primer movimiento (${fmt(primera.importe)}) no da el Balance de la primera fila (${fmt(primera.saldo)}).`
    );
  }

  // Control contra el saldo final (Balance de la última fila).
  const movimientos = ordenadas.reduce((a, f) => a + f.importe, 0);
  const final = ordenadas[ordenadas.length - 1].saldo;
  const dif = saldoInicial + movimientos - final;
  const control: ControlPieMoneda[] = [
    {
      moneda: MONEDA_CHASE,
      inicialCentavos: saldoInicial,
      movimientosCentavos: movimientos,
      finalCentavos: final,
      diferenciaCentavos: dif,
      estado: dif === 0 ? "cuadra" : "no_cuadra",
    },
  ];
  if (dif !== 0) {
    errores.push(
      `El pie no cuadra en ${MONEDA_CHASE}: saldo inicial ${fmt(saldoInicial)} + movimientos ${fmt(movimientos)} no da el saldo final ${fmt(final)} (diferencia ${fmt(dif)}). Faltan o sobran filas.`
    );
  }

  // El RESUMEN de abajo está hecho a mano: si no coincide con el Balance del banco solo se avisa.
  const resumen = saldosDelResumen(hoja.filas, finDatos, enc);
  if (resumen.inicio !== null && resumen.inicio !== saldoInicial) {
    avisos.add(`El "SALDO INICIO BANK" del resumen (${fmt(resumen.inicio)}) no coincide con el saldo inicial del extracto (${fmt(saldoInicial)}).`);
  }
  if (resumen.final !== null && resumen.final !== final) {
    avisos.add(`El "SALDO FINAL BANK" del resumen (${fmt(resumen.final)}) no coincide con el Balance final del extracto (${fmt(final)}).`);
  }

  const lejano = avisoDeRangoLejano(
    ordenadas.map((f) => f.fecha),
    opciones.hoy ?? new Date()
  );
  if (lejano) avisos.add(lejano);

  const filas: FilaHavannaPeru[] = ordenadas.map((f) => ({
    numeroFila: f.numeroFila,
    fecha: f.fecha,
    concepto: f.concepto,
    importeCentavos: f.importe,
    saldoCentavos: f.saldo,
    referencia: referenciaDeChase(f.concepto),
    causal: f.tipo,
    detalle: null,
    moneda: MONEDA_CHASE,
  }));
  return { filas, cuentaEnArchivo: null, cuitEnArchivo: null, avisos: [...avisos], control, monedaAsumida: false, errores };
}

// Clave de reconocimiento: fecha + importe + cuenta + concepto + referencia + SALDO + moneda. Acá el saldo corrido SÍ
// entra (Chase lo trae en cada fila): distingue dos movimientos iguales del mismo día (p. ej. dos compras con
// tarjeta idénticas) y es lo que reconoce lo ya cargado si se vuelve a subir el mes.
export function claveChase(fila: FilaHavannaPeru, bancoYCuenta: string): string {
  return claveMovimiento({
    fecha: fila.fecha,
    importeCentavos: fila.importeCentavos,
    bancoYCuenta,
    concepto: fila.concepto,
    nroReferencia: fila.referencia,
    saldoCentavos: fila.saldoCentavos,
    moneda: fila.moneda,
  });
}
