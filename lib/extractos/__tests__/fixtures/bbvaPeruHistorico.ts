// Fixtures SINTÉTICOS del «Histórico de Movimientos» de BBVA Perú (HTML disfrazado de .xls). Datos inventados.
export type MovHist = { fecha: string; codigo?: string; doc?: string; concepto: string; importe: string };

// Centavos exactos (sin floats) de un importe con punto decimal.
const aCentavos = (t: string) => Math.round(Number(t) * 100);
const aTexto = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

export function htmlHistorico(o: {
  moneda?: string; // "USD" | "PEN"
  cuenta?: string;
  titular?: string;
  desde?: string;
  hasta?: string;
  inicial: string;
  movs: MovHist[]; // dd-mm-aaaa, en orden de fecha
  saldoFinalForzado?: string; // para armar un archivo que no cuadra
  sinImportesEn?: boolean;
  charset?: "utf8" | "latin1";
  formatoMiles?: boolean; // importes y saldos como los del banco real: «1,234.56»
}): Uint8Array {
  const moneda = o.moneda ?? "USD";
  const cuenta = o.cuenta ?? "0011-9999-0100000001";
  const filas: string[] = [];
  // Importes como el banco real: con coma de miles si se pide.
  const m2 = (t: string) => (o.formatoMiles ? t.replace(/^(-?)(\d+)/, (_, sg: string, n: string) => sg + n.replace(/\B(?=(\d{3})+$)/g, ",")) : t);
  const tr = (...c: string[]) => `<tr>${c.map((x) => `<td>${x}</td>`).join("")}</tr>`;
  filas.push(tr("Hist&oacute;rico de Movimientos"));
  filas.push(tr(`Periodo: de ${o.desde ?? "01-10-2026"} a ${o.hasta ?? "31-10-2026"}`));
  filas.push(tr("Primera Ordenaci&oacute;n: FECHA OPERACI&Oacute;N"));
  filas.push(tr("Importe: Todos") + "</td></tr>"); // el HTML real trae un cierre de más
  filas.push(tr(`Cuenta Actual: ${cuenta} ${moneda} ${o.titular ?? "EMPRESA DE PRUEBA SAC"}`));
  if (!o.sinImportesEn) filas.push(tr(`Importes en: ${moneda}`));
  filas.push(tr("F. Operaci&oacute;n", "F. Valor", "C&oacute;digo", "N&ordm;. Doc.", "Concepto", "Importe", "Oficina"));
  filas.push(tr("", "", "", "", `Saldo Inicial: ${o.desde ?? "01-10-2026"}`, m2(o.inicial), ""));
  let corrido = aCentavos(o.inicial);
  for (let i = 0; i < o.movs.length; i++) {
    const m = o.movs[i];
    filas.push(tr(m.fecha, m.fecha, m.codigo ?? "0100", m.doc ?? "", m.concepto, m2(m.importe), "0001"));
    corrido += aCentavos(m.importe);
    const sigue = o.movs[i + 1];
    if (!sigue || sigue.fecha !== m.fecha) {
      const final = !sigue && o.saldoFinalForzado ? o.saldoFinalForzado : aTexto(corrido);
      filas.push(tr("", "", "", "", `Saldo Final: ${m.fecha}`, m2(final), ""));
    }
  }
  const html = `<html><head><meta charset="${o.charset === "latin1" ? "iso-8859-1" : "utf-8"}"></head><body><table>${filas.join("\n")}</table></body></html>`;
  if (o.charset === "latin1") return Uint8Array.from(Buffer.from(html, "latin1"));
  return new Uint8Array(Buffer.from(html, "utf8"));
}

export const MOVS_USD: MovHist[] = [
  { fecha: "02-10-2026", doc: "000123", concepto: "TRANSF. PROVEEDOR A", importe: "-1500.50" },
  { fecha: "02-10-2026", doc: "000124", concepto: "COBRO CLIENTE B", importe: "3000.00" },
  { fecha: "05-10-2026", concepto: "COMISION MANTENIMIENTO", importe: "-12.30" },
  { fecha: "09-10-2026", doc: "000200", concepto: "PAGO SERVICIO", importe: "-250.00" },
];

// n movimientos sintéticos repartidos en octubre (para volumen).
export function movsSinteticos(n: number): MovHist[] {
  const movs: MovHist[] = [];
  for (let i = 0; i < n; i++) {
    const d = 1 + Math.floor((i * 30) / n);
    const fecha = `${String(d).padStart(2, "0")}-10-2026`;
    const importe = i % 3 === 0 ? `${100 + (i % 97)}.${String(i % 100).padStart(2, "0")}` : `-${10 + (i % 53)}.${String((i * 7) % 100).padStart(2, "0")}`;
    movs.push({ fecha, doc: String(100000 + i), concepto: `MOVIMIENTO SINTETICO ${i}`, importe });
  }
  return movs;
}
