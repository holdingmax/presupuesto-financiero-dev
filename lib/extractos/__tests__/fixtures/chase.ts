import * as XLSX from "xlsx";

// Mini-libro SINTÉTICO armado como el PF real de Bradenton (pestaña CHASE del libro de noviembre 2026): título viejo en
// la fila 1, encabezado en la fila 3 con las columnas manuales al costado, fila de saldo inicial (solo Balance), los
// movimientos, una fila de sumas a mano, el bloque RESUMEN y, al lado, las pestañas "Ch deb" y "LOTTERY" que repiten
// movimientos de CHASE sin Balance. Datos inventados. Fechas = número de serie de Excel.

export const SERIAL_1_OCT_2026 = 46296;
export const SERIAL_1_NOV_2026 = 46327;

export type MovChase = { dia: number; details: string; desc: string; importe: number; type: string; etiqueta?: string; serialBase?: number };

export const SALDO_INICIAL_OCT = 67197.91;

export const MOVS_CHASE_OCT: MovChase[] = [
  { dia: 0, details: "CHECK", desc: "CHECK 1780 Midtown", importe: -558.77, type: "CHECK_PAID", etiqueta: "PROVEEDORES" },
  { dia: 0, details: "DEBIT", desc: "RTP/Same Day - Low Value", importe: -91.86, type: "FEE_TRANSACTION", etiqueta: "GASTOS BANCARIOS" },
  { dia: 0, details: "DEBIT", desc: "FACEBK *V3BJM7J5Z4 FACEBOOK.COM              09/30", importe: -5.96, type: "DEBIT_CARD" },
  { dia: 0, details: "DEBIT", desc: "FACEBK *V3BJM7J5Z4 FACEBOOK.COM              09/30", importe: -5.96, type: "DEBIT_CARD" },
  {
    dia: 0,
    details: "CREDIT",
    desc: "ORIG CO NAME:MVNT - NW09963         ORIG ID:0075000051 DESC DATE:260930 CO ENTRY DESCR:DLY SETTLESEC:CCD    TRACE#:051000010659493 EED:261001   IND ID:NW09963                      IND NAME:BRADENTON GAS STATI                                                                                          BRADENTON GAS STATI TRN: 2740659493TC",
    importe: 1.25,
    type: "ACH_CREDIT",
    etiqueta: "REBATE",
  },
  { dia: 5, details: "DSLIP", desc: "DEPOSIT  ID NUMBER 293087", importe: 2372, type: "DEPOSIT", etiqueta: "DEPOSITO" },
  { dia: 29, details: "CHECK", desc: "CHECK 1785 Coca", importe: -1197.33, type: "CHECK_PAID", etiqueta: "PROVEEDORES" },
];

export type OpcionesChase = {
  movimientos?: MovChase[];
  saldoInicial?: number | null; // null = sin la fila de saldo inicial
  tituloViejo?: string;
  descendente?: boolean; // como lo baja Chase: del más nuevo al más viejo
  saldoFinalResumen?: number; // "SALDO FINAL BANK" a mano (por defecto el correcto)
  romperBalanceEnFila?: number; // índice 0-based del movimiento cuyo Balance se pisa
  filaSinFechaConDetails?: boolean; // un movimiento sin fecha después del corte
  sinResumen?: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function hojaChase(o: OpcionesChase = {}): unknown[][] {
  const movs = o.movimientos ?? MOVS_CHASE_OCT;
  const inicial = o.saldoInicial === undefined ? SALDO_INICIAL_OCT : o.saldoInicial;
  const base = inicial ?? 1000;
  let saldo = base;
  const conSaldo = movs.map((m, i) => {
    saldo = r2(saldo + m.importe);
    const balance = o.romperBalanceEnFila === i ? r2(saldo + 7) : saldo;
    return { m, balance };
  });
  const filasMov = conSaldo.map(({ m, balance }) => [
    m.details,
    (m.serialBase ?? SERIAL_1_OCT_2026) + m.dia,
    m.desc,
    m.importe,
    m.type,
    balance,
    m.etiqueta ?? "", // "Check or Slip #" pisada con la etiqueta a mano
    m.etiqueta === "DEPOSITO" ? m.importe : "",
    m.etiqueta === "REBATE" ? m.importe : "",
    m.etiqueta === "PROVEEDORES" ? m.importe : "",
    "",
  ]);
  const filas: unknown[][] = [];
  filas.push([o.tituloViejo ?? "CHASE BANK 08-2026"]);
  filas.push([]);
  filas.push(["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #", "CAJA", "REBATE", "PROV.", "Adm fee/Movilidad y viaticos"]);
  if (inicial !== null) filas.push(["", "", "", "", "", inicial, "", "", "", "", ""]);
  filas.push(...(o.descendente ? [...filasMov].reverse() : filasMov));
  const final = conSaldo.length > 0 ? conSaldo[conSaldo.length - 1].balance : base;
  if (o.filaSinFechaConDetails) filas.push(["DEBIT", "", "SIN FECHA", -5, "DEBIT_CARD", 0, "", "", "", "", ""]);
  filas.push(["", "", "", "", "", "", "", 100, 200, 300, 400]); // sumas a mano
  if (!o.sinResumen) {
    filas.push(["", "", "RESUMEN"]);
    filas.push(["", "", "SALDO INICIO BANK", "", "", inicial ?? base, ""]);
    filas.push(["", "", "COBRANZAS EFT", 29261.15, "ok", "", "eft"]);
    filas.push(["", "", "Cheques Debitados", -7129.13, "ok", "", ""]);
    filas.push(["", "", "SALDO FINAL BANK", "", "", o.saldoFinalResumen ?? final, ""]);
  }
  return filas;
}

// Subconjuntos de CHASE, sin Balance (como "Ch deb" y "LOTTERY" del libro real).
export function hojaChDeb(): unknown[][] {
  return [
    ["CHASE BANK 10-2026"],
    [],
    [],
    ["Details", "Posting Date", "Description", "Amount", "Type", "", ""],
    ["CHECK", SERIAL_1_OCT_2026, "CHECK 1780 Midtown", -558.77, "CHECK_PAID", "", ""],
    ["CHECK", SERIAL_1_OCT_2026 + 29, "CHECK 1785 Coca", -1197.33, "CHECK_PAID", "", ""],
    ["", "", "", -1756.1, "", "", ""],
  ];
}
// Como la real: LOTTERY copia el Balance del banco en cada fila, pero salteado (no encadena porque faltan las demás filas).
export function hojaLottery(): unknown[][] {
  return [
    ["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"],
    ["DEBIT", SERIAL_1_OCT_2026 + 6, "ORIG CO NAME:FLA LOTTERY            ORIG ID:1592859478", -5105.2, "ACH_DEBIT", 57706.49, "LOTTERY"],
    ["DEBIT", SERIAL_1_OCT_2026 + 13, "ORIG CO NAME:FLA LOTTERY            ORIG ID:1592859478", -7069.49, "ACH_DEBIT", 63648.37, "LOTTERY"],
    ["", "", "", -12174.69, "", "", ""],
  ];
}

export function libroChase(pestanas: { nombre: string; filas: unknown[][] }[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const p of pestanas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(p.filas as never), p.nombre);
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// Libro completo como el real: presupuesto, CHASE (octubre), Ch deb y LOTTERY.
export function libroBradenton(o: OpcionesChase = {}): Uint8Array {
  return libroChase([
    { nombre: "PRESUPUESTO MES A MES", filas: [["PRESUPUESTO", "Concepto", "Monto"], ["x", "Alquiler", 100]] },
    { nombre: "CHASE", filas: hojaChase(o) },
    { nombre: "Ch deb", filas: hojaChDeb() },
    { nombre: "LOTTERY", filas: hojaLottery() },
  ]);
}
