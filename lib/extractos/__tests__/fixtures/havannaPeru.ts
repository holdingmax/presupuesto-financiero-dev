import * as XLSX from "xlsx";

// Mini-libro SINTÉTICO armado como el PF real de Havanna Perú: pestañas de presupuesto,
// "Hoja1" de distractor, pestañas MOVIMIENTOS con tablas dinámicas al costado (columnas K-L) y
// pie con saldos. Datos inventados. Fechas = número de serie de Excel; Nº Doc = texto.

export const SERIAL_1_OCT_2026 = 46296;
export const SERIAL_1_NOV_2026 = 46327;

type Mov = { mon?: string; dia: number; cod: number; doc: string | number; concepto: string; importe: number; serialBase?: number };

export const MOVS_OCTUBRE: Mov[] = [
  { mon: "Soles", dia: 0, cod: 612, doc: "0000221444", concepto: "SOLES A DOLARES", importe: -1000.5 },
  { mon: "Soles", dia: 0, cod: 15, doc: "0000221470", concepto: "*C/PV OB PROVEED BXI", importe: -250.25 },
  { mon: "Soles", dia: 1, cod: 456, doc: "0000221499", concepto: "COBRANZA CLIENTE", importe: 3000 },
  { mon: "USD", dia: 1, cod: 507, doc: "0000023134", concepto: "SOLES A DOLARES", importe: 300 },
  { mon: "USD", dia: 2, cod: 527, doc: "0000023138", concepto: "ITF", importe: -0.2 },
];

export type OpcionesLibro = {
  movimientos?: Mov[];
  encabezado?: string[]; // 9 textos de encabezado
  conMoneda?: boolean;
  saldoFinalPen?: number; // si se omite, cuadra
  saldoFinalUsd?: number;
  sinPie?: boolean;
  filaSinFechaPegada?: boolean; // una fila sin fecha justo debajo del encabezado
  fechaInvalida?: unknown; // reemplaza la fecha de la 2ª fila
  filasAntes?: number; // filas vacías antes del encabezado
};

export const ENCABEZADO_ESTANDAR = ["Moneda", "F. Operación", "F. Valor", "Código", "Nº. Doc.", "Concepto", "Importe", "TC", "DETALLE"];

export function hojaMovimientos(o: OpcionesLibro = {}): unknown[][] {
  const movs = o.movimientos ?? MOVS_OCTUBRE;
  const enc = o.encabezado ?? ENCABEZADO_ESTANDAR;
  const conMoneda = o.conMoneda ?? true;
  const col = (fila: unknown[]) => (conMoneda ? fila : fila.slice(1));
  const filas: unknown[][] = [];
  for (let i = 0; i < (o.filasAntes ?? 0); i++) filas.push([]);
  filas.push([...col(enc), null, "Etiquetas de fila", "Suma de TC"]);
  if (o.filaSinFechaPegada) filas.push(col(["Soles", null, null, 15, "0000999999", "SIN FECHA", -5, -5, "X"]));
  movs.forEach((m, i) => {
    const serial = (m.serialBase ?? SERIAL_1_OCT_2026) + m.dia;
    const fecha = i === 1 && o.fechaInvalida !== undefined ? o.fechaInvalida : serial;
    const f = [m.mon ?? "Soles", fecha, serial, m.cod, m.doc, m.concepto, m.importe, m.importe, "DETALLE"];
    // pivot al costado (como el real): K-L
    filas.push([...col(f), null, i === 0 ? "COBRANZAS CLIENTES" : null, i === 0 ? 123 : null]);
  });
  filas.push([], []);
  const suma = (mon: string) => movs.filter((m) => (m.mon ?? "Soles") === mon).reduce((a, m) => a + m.importe, 0);
  const total = movs.reduce((a, m) => a + m.importe, 0);
  if (!o.sinPie) {
    const iniPen = 5000;
    const iniUsd = 1000;
    const finPen = o.saldoFinalPen ?? Math.round((iniPen + suma("Soles")) * 100) / 100;
    const finUsd = o.saldoFinalUsd ?? Math.round((iniUsd + suma("USD")) * 100) / 100;
    filas.push([null, null, null, null, null, "Movimientos", Math.round(total * 100) / 100, total, null]);
    filas.push([]);
    filas.push([null, null, null, null, "SOLES", "Saldo Inicial: 01-10-2026", iniPen, iniPen]);
    filas.push([null, null, null, null, "USD", "Saldo Inicial: 01-10-2026", iniUsd, iniUsd * 3.4]);
    filas.push([null, null, null, null, null, null, "Saldo Inicial", iniPen + iniUsd * 3.4]);
    filas.push([null, null, null, null, "SOLES", "Saldo Final: 31-10-2026", finPen, finPen]);
    filas.push([null, null, null, null, "USD", "Saldo Final: 31-10-2026", finUsd, finUsd * 3.4]);
    filas.push([null, null, null, null, null, null, "Saldo Final", finPen + finUsd * 3.4]);
  }
  return filas;
}

export function libroHavannaPeru(pestanas: { nombre: string; filas: unknown[][] }[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const p of pestanas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(p.filas as never), p.nombre);
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export const HOJA_PRESUPUESTO = [["PRESUPUESTO", "Concepto", "Monto"], ["x", "Alquiler", 100]];

// "Hoja1" de distractor: se llama como la regla de leerXlsx pero NO es la pestaña de movimientos.
export const HOJA1_DISTRACTOR = [["Cliente", "Saldo"], ["Fulano", 10]];

// Libro completo: presupuesto + Hoja1 + movimientos de octubre + movimientos de noviembre.
export function libroCompleto(octubre: OpcionesLibro = {}, noviembre?: OpcionesLibro): Uint8Array {
  const nov: OpcionesLibro = noviembre ?? {
    movimientos: [
      { mon: "Soles", dia: 0, cod: 15, doc: "0000300001", concepto: "OTRO", importe: -10, serialBase: SERIAL_1_NOV_2026 },
    ],
    sinPie: true,
  };
  return libroHavannaPeru([
    { nombre: "PRESUPUESTO MES A MES", filas: HOJA_PRESUPUESTO },
    { nombre: "Hoja1", filas: HOJA1_DISTRACTOR },
    { nombre: "MOVIMIENTOS OCTUBRE 26", filas: hojaMovimientos(octubre) },
    { nombre: "MOVIMIENTOS NOVIEMBRE 26", filas: hojaMovimientos(nov) },
  ]);
}
