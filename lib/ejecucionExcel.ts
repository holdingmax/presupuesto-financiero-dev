import ExcelJS from "exceljs";
import type { mapearMovimiento } from "@/lib/ejecucionVista";

// Excel de los movimientos de una semana de Ejecución (botón "Descargar Excel"). Recibe lo que ya
// devuelve mapearMovimiento — o sea, lo que el usuario ve en pantalla: sin saldo si no corresponde
// y, en la vista de una empresa, solo sus porciones de prorrateo. Importe y saldo van como números
// y la fecha como fecha de Excel (no texto).

export const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// `semana` solo viaja en la vista "Todo el mes" de la empresa (columna extra con `conSemana`).
type MovimientoVista = ReturnType<typeof mapearMovimiento> & { semana?: number };

export async function construirExcelMovimientos(movimientos: MovimientoVista[], conSaldo: boolean, conSemana = false) {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Movimientos", { views: [{ state: "frozen", ySplit: 1 }] });

  const FORMATO_IMPORTE = "#,##0.00;[Red]-#,##0.00";
  hoja.columns = [
    { header: "Fecha", key: "fecha", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    ...(conSemana ? [{ header: "Semana", key: "semana", width: 9 }] : []),
    { header: "Banco y cuenta", key: "bancoYCuenta", width: 28 },
    { header: "Concepto", key: "concepto", width: 48 },
    { header: "Importe", key: "importe", width: 16, style: { numFmt: FORMATO_IMPORTE } },
    ...(conSaldo ? [{ header: "Saldo", key: "saldo", width: 16, style: { numFmt: FORMATO_IMPORTE } }] : []),
    { header: "Clasificación", key: "clasificacion", width: 26 },
    { header: "Unidad de negocio", key: "unidadNegocio", width: 26 },
    { header: "Prorrateo", key: "prorrateo", width: 11 },
    { header: "Detalle", key: "detalle", width: 40 },
  ];
  hoja.getRow(1).font = { bold: true };

  for (const m of movimientos) {
    const prorrateado = m.desglose.length > 0;
    hoja.addRow({
      // Medianoche UTC: ExcelJS serializa en UTC, así el día no se corre por la zona horaria.
      fecha: new Date(`${m.fecha}T00:00:00Z`),
      semana: m.semana ?? null,
      bancoYCuenta: m.bancoYCuenta,
      concepto: m.concepto,
      importe: m.importe,
      saldo: "saldo" in m ? m.saldo : null,
      clasificacion: m.clasificacion,
      unidadNegocio: prorrateado ? m.desglose.map((d) => d.unidadNegocio).join(" / ") : m.unidadNegocio,
      prorrateo: prorrateado ? "Sí" : "No",
      detalle: m.detalle,
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function respuestaExcel(buffer: Buffer, nombreArchivo: string) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": TIPO_XLSX,
      "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
      "Cache-Control": "no-store",
    },
  });
}
