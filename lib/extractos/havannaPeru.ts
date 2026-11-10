import { claveMovimiento } from "@/lib/conteoMovimientos";
import {
  buscarEncabezado,
  filasDeDatos,
  igual,
  leerCentavos,
  referenciaDeCelda,
  textoDeCelda,
  textoNormalizado,
  type Encabezado,
} from "./bancos/comun";
import { avisoDeRangoLejano, fechaDeCelda } from "./fechas";
import {
  ErrorExtracto,
  type Celda,
  type FilaExtracto,
  type HojaGrilla,
  type LecturaExtracto,
  type OpcionesLectura,
} from "./tipos";

// Lector puro del extracto crudo de Havanna Perú (Etapa 2, paso 1). Es una pestaña "MOVIMIENTOS
// <MES>" de un libro PF: encabezado Moneda · F. Operación · F. Valor · Código · Nº. Doc. ·
// Concepto · Importe · TC · DETALLE, con tablas dinámicas al costado y un pie con saldos.
// NO es un banco de BANCOS_EXTRACTO ni lo toca detectarFormato: se invoca por su propio camino.
// Sin base de datos, sin ExcelJS. Las columnas se ubican por NOMBRE del encabezado.

export type MonedaHavannaPeru = "PEN" | "USD";

export type FilaHavannaPeru = FilaExtracto & { moneda: MonedaHavannaPeru };

export type ControlPieMoneda = {
  moneda: MonedaHavannaPeru;
  inicialCentavos: number | null;
  movimientosCentavos: number; // suma de los Importe de las filas leídas de esa moneda
  finalCentavos: number | null;
  diferenciaCentavos: number | null; // inicial + movimientos − final (0 = cuadra)
  estado: "cuadra" | "no_cuadra" | "sin_pie";
};

// Misma forma que LecturaExtracto salvo `banco` (no es un banco de la lista) y con moneda por fila.
export type LecturaHavannaPeru = Omit<LecturaExtracto, "banco" | "filas"> & {
  filas: FilaHavannaPeru[];
  control: ControlPieMoneda[];
  // true = la pestaña NO trae columna Moneda y se usó la moneda de la cuenta para todas las filas (con aviso).
  // Quien reparte entre varias cuentas por moneda no puede aceptarlo.
  monedaAsumida: boolean;
  // Lo que IMPIDE cargar (p. ej. el pie no cuadra). Quien llama no debe cargar si hay alguno.
  errores: string[];
};

export type OpcionesHavannaPeru = OpcionesLectura & {
  // Moneda de la cuenta elegida: se usa SOLO si la pestaña no trae columna Moneda (con aviso).
  monedaCuenta: MonedaHavannaPeru;
};

export const COLUMNAS_HAVANNA_PERU = {
  fecha: igual("F. OPERACION", "F.OPERACION", "F OPERACION"),
  concepto: igual("CONCEPTO"),
  importe: igual("IMPORTE"),
  // Nº / N° / No / Nro: la º y la ° no son tildes, no las saca la normalización.
  nroDoc: (t: string) => /^(N[º°O]?|NRO)\.? ?(DOC|DOCUMENTO)\.?$/.test(t),
};
export const COLUMNAS_OPCIONALES_HAVANNA_PERU = {
  moneda: igual("MONEDA"),
  codigo: (t: string) => /^COD(IGO)?\.?$/.test(t),
};

export function encabezadoHavannaPeru(filas: Celda[][]): Encabezado | null {
  return buscarEncabezado(filas, COLUMNAS_HAVANNA_PERU, COLUMNAS_OPCIONALES_HAVANNA_PERU);
}

function monedaDeTexto(texto: string): MonedaHavannaPeru | null {
  const t = texto.trim().toUpperCase();
  if (t === "SOLES") return "PEN";
  if (t === "USD") return "USD";
  return null;
}

const PIE_SALDO = /^SALDO (INICIAL|FINAL) ?: ?(\d{1,2})[-/](\d{1,2})[-/](\d{4})/;

function numeroALaDerecha(fila: Celda[], desde: number): Celda {
  for (let c = desde + 1; c < fila.length; c++) {
    if (typeof fila[c] === "number") return fila[c];
  }
  return null;
}

// Pie: "SOLES | Saldo Inicial: 01-10-2026 | 113818,25 | …". La moneda es la celda de texto a la
// izquierda de la leyenda; el valor, el primer número a su derecha (el de la moneda original,
// no el convertido a soles). El "Saldo Inicial" suelto sin fecha (total convertido) no cuenta.
function leerPie(filas: Celda[][], desdeIndice: number, avisos: Set<string>) {
  const inicial = new Map<MonedaHavannaPeru, number>();
  const final = new Map<MonedaHavannaPeru, number>();
  let movimientosPie: number | null = null;
  for (let i = desdeIndice; i < filas.length; i++) {
    const fila = filas[i];
    for (let c = 0; c < fila.length; c++) {
      const t = textoNormalizado(fila[c] ?? null);
      if (t === "MOVIMIENTOS" && movimientosPie === null) {
        const v = numeroALaDerecha(fila, c);
        if (v !== null) movimientosPie = leerCentavos(v, i + 1, "el total de Movimientos del pie", avisos);
        continue;
      }
      const m = PIE_SALDO.exec(t);
      if (!m) continue;
      let moneda: MonedaHavannaPeru | null = null;
      for (let k = c - 1; k >= 0; k--) {
        const izq = textoDeCelda(fila[k] ?? null);
        if (izq === "") continue;
        moneda = monedaDeTexto(izq);
        break;
      }
      const valor = numeroALaDerecha(fila, c);
      if (moneda === null || valor === null) continue;
      const centavos = leerCentavos(valor, i + 1, "el saldo del pie", avisos);
      if (centavos === null) continue;
      const destino = m[1] === "INICIAL" ? inicial : final;
      if (destino.has(moneda)) {
        throw new ErrorExtracto(`Fila ${i + 1}: el pie trae dos veces el saldo ${m[1].toLowerCase()} en ${moneda}.`);
      }
      destino.set(moneda, centavos);
    }
  }
  return { inicial, final, movimientosPie };
}

const fmt = (centavos: number) => (centavos / 100).toFixed(2);

export function leerHavannaPeru(hoja: HojaGrilla, opciones: OpcionesHavannaPeru): LecturaHavannaPeru {
  const enc = encabezadoHavannaPeru(hoja.filas);
  if (!enc) {
    throw new ErrorExtracto(
      `No encontré la fila de encabezados de Havanna Perú (F. Operación, Concepto, Importe, Nº. Doc.) en la pestaña "${hoja.nombre}". ¿Es la pestaña correcta?`
    );
  }
  const avisos = new Set<string>();
  const errores: string[] = [];
  const colMoneda = enc.col.moneda;

  // Fila sin fecha pegada al encabezado (caso MOVIMIENTOS ABRIL 2025): filasDeDatos cortaría ahí
  // y perdería todo en silencio.
  const debajo = hoja.filas.slice(enc.indiceFila + 1);
  if (debajo.some((f) => f.some((c) => textoDeCelda(c) !== ""))) {
    const r = fechaDeCelda(debajo[0]?.[enc.col.fecha] ?? null, { date1904: hoja.date1904 });
    if (r.estado === "vacia") {
      throw new ErrorExtracto(
        `Fila ${enc.indiceFila + 2}: la primera fila debajo del encabezado no tiene fecha en F. Operación. No sé si hay movimientos cortados; completá la fecha o borrá la fila.`
      );
    }
  }

  const crudas = filasDeDatos(hoja, enc, enc.col.fecha, {});

  // Después del corte (primera fila sin fecha) no puede quedar un movimiento sin fecha.
  const finDatos = enc.indiceFila + 1 + crudas.length;
  for (let i = finDatos; i < hoja.filas.length; i++) {
    const f = hoja.filas[i];
    const doc = textoDeCelda(f[enc.col.nroDoc] ?? null);
    const mon = colMoneda === undefined ? null : monedaDeTexto(textoDeCelda(f[colMoneda] ?? null));
    if (/^\d+$/.test(doc) || mon !== null) {
      throw new ErrorExtracto(
        `Fila ${i + 1}: tiene Nº. Doc. o Moneda pero no tiene fecha en F. Operación. No la descarto en silencio: revisala.`
      );
    }
  }

  if (colMoneda === undefined) {
    avisos.add(
      `La pestaña no tiene columna Moneda: se tomó la moneda de la cuenta (${opciones.monedaCuenta}) para todas las filas. Verificá que sea la correcta.`
    );
  }

  const filas: FilaHavannaPeru[] = crudas.map(({ fila, numeroFila, fecha }) => {
    let moneda: MonedaHavannaPeru;
    if (colMoneda === undefined) {
      moneda = opciones.monedaCuenta;
    } else {
      const texto = textoDeCelda(fila[colMoneda] ?? null);
      const m = monedaDeTexto(texto);
      if (m === null) {
        throw new ErrorExtracto(
          texto === ""
            ? `Fila ${numeroFila}: no tiene moneda.`
            : `Fila ${numeroFila}: moneda "${texto}" desconocida (se esperaba Soles o USD).`
        );
      }
      moneda = m;
    }
    const importe = leerCentavos(fila[enc.col.importe] ?? null, numeroFila, "el importe", avisos);
    if (importe === null) throw new ErrorExtracto(`Fila ${numeroFila}: no tiene importe.`);
    const celdaDoc = fila[enc.col.nroDoc] ?? null;
    const referencia = referenciaDeCelda(celdaDoc);
    if (referencia === null) {
      throw new ErrorExtracto(
        `Fila ${numeroFila}: no tiene Nº. Doc. (es obligatorio: es lo que distingue un movimiento de otro igual).`
      );
    }
    if (typeof celdaDoc === "number") {
      avisos.add("Hay Nº. Doc. guardados como número en el archivo: si tenían ceros a la izquierda ya se habían perdido.");
    }
    return {
      numeroFila,
      fecha,
      concepto: textoDeCelda(fila[enc.col.concepto] ?? null) || "(sin concepto)",
      importeCentavos: importe,
      saldoCentavos: null, // las filas no traen saldo
      referencia,
      causal: enc.col.codigo === undefined ? null : referenciaDeCelda(fila[enc.col.codigo] ?? null),
      detalle: null,
      moneda,
    };
  });

  if (filas.length === 0) throw new ErrorExtracto("La pestaña no tiene movimientos.");

  // Control contra el pie, por moneda.
  const pie = leerPie(hoja.filas, finDatos, avisos);
  const control: ControlPieMoneda[] = [];
  for (const moneda of [...new Set(filas.map((f) => f.moneda))].sort()) {
    const movimientos = filas.filter((f) => f.moneda === moneda).reduce((a, f) => a + f.importeCentavos, 0);
    const ini = pie.inicial.get(moneda) ?? null;
    const fin = pie.final.get(moneda) ?? null;
    if (ini === null || fin === null) {
      control.push({
        moneda,
        inicialCentavos: ini,
        movimientosCentavos: movimientos,
        finalCentavos: fin,
        diferenciaCentavos: null,
        estado: "sin_pie",
      });
      avisos.add(`No encontré el Saldo Inicial / Saldo Final en ${moneda} en el pie del archivo: no se pudo controlar.`);
      continue;
    }
    const dif = ini + movimientos - fin;
    control.push({
      moneda,
      inicialCentavos: ini,
      movimientosCentavos: movimientos,
      finalCentavos: fin,
      diferenciaCentavos: dif,
      estado: dif === 0 ? "cuadra" : "no_cuadra",
    });
    if (dif !== 0) {
      errores.push(
        `El pie no cuadra en ${moneda}: saldo inicial ${fmt(ini)} + movimientos ${fmt(movimientos)} no da el saldo final ${fmt(fin)} (diferencia ${fmt(dif)}). Faltan o sobran filas, o el pie está desactualizado.`
      );
    }
  }
  // Total "Movimientos" del pie (suma de los Importe de todas las monedas, tal cual está en el archivo).
  if (pie.movimientosPie !== null) {
    const total = filas.reduce((a, f) => a + f.importeCentavos, 0);
    if (total !== pie.movimientosPie) {
      errores.push(
        `El total "Movimientos" del pie (${fmt(pie.movimientosPie)}) no coincide con la suma de las filas leídas (${fmt(total)}).`
      );
    }
  }

  const lejano = avisoDeRangoLejano(
    filas.map((f) => f.fecha),
    opciones.hoy ?? new Date()
  );
  if (lejano) avisos.add(lejano);

  // Estable: respeta el orden del archivo dentro del mismo día.
  filas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  return { filas, cuentaEnArchivo: null, cuitEnArchivo: null, avisos: [...avisos], control, monedaAsumida: colMoneda === undefined, errores };
}

// Clave de reconocimiento: fecha + importe + cuenta + concepto + Nº Doc (nroReferencia) + moneda.
// Sin saldo (null). La moneda de estas filas (PEN / USD) siempre entra en la clave.
export function claveHavannaPeru(fila: FilaHavannaPeru, bancoYCuenta: string): string {
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
