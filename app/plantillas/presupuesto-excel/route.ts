import ExcelJS from "exceljs";
import { requireUsuario } from "@/lib/auth";
import { esViewer } from "@/lib/permisosViewer";

// Route Handler (no Server Action): hace falta poder devolver un Response
// con Content-Type/Content-Disposition de archivo adjunto para que el
// navegador dispare la descarga nativa — una Server Action solo puede
// devolver datos serializables, no controlar los headers de la respuesta.
// El contenido no depende de ninguna empresa puntual, por eso no vive bajo
// [empresa]/[periodo] ni pide requireAccesoEmpresa — solo requireUsuario().
export async function GET() {
  // VIEWER: la plantilla es de Presupuesto, que no es para él.
  if (esViewer(await requireUsuario())) return new Response("Sin acceso.", { status: 403 });

  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Presupuesto");

  hoja.addRow(["Concepto", "Detalle", "Importe", "Clasificacion"]);
  hoja.addRow(["Sueldo administrativo", "cheque legajo 1526 - Gomez Mariano", 150000, "Sueldos"]);
  hoja.getRow(1).font = { bold: true };
  hoja.columns.forEach((columna) => {
    columna.width = 28;
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-presupuesto.xlsx"',
    },
  });
}
