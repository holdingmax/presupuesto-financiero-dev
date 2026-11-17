import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { cargarDatosMeses } from "@/lib/reporte/cargarMeses";
import { armarReporte, periodosHasta, type AccesoReservados, type DatosMes, type Plantilla, type Reporte } from "@/lib/reporte/motor";
import { plantillaDeEmpresaConExtras } from "@/lib/reporte/plantillaConExtras";
import { cantidadDeMeses, type VistaReporte } from "@/lib/reporte/vistaReporte";

// Arma el Reporte de una empresa con plantilla para quien lo mira. Es el ÚNICO camino: lo usan la pantalla
// (reporte/page.tsx) y la descarga en Excel (reporte/excel/route.ts), así que el archivo trae exactamente las
// mismas celdas que se ven. Solo lee: el presupuesto de cada mes se busca sin crearlo.

export type EntradaReporteDePlantilla = {
  // La plantilla ESTÁTICA de la empresa (plantillaDeEmpresa); acá se le suman las filas extra del mes.
  plantilla: Plantilla;
  empresaId: string;
  empresaSlug: string;
  unidadesEmpresa: string[];
  // Mes de la URL: el último de los que se muestran.
  periodo: string;
  vista: VistaReporte;
  esAdminOFinanzas: boolean;
  // ADMIN y FINANZAS (veBloquesReservadosDelReporte): ven Disponibilidades y Cierre. El resto, según los interruptores.
  verBloquesReservados: boolean;
};

export type ReporteDePlantilla = {
  // Con un mes más de contexto al principio (no se muestra): el control de arrastre y los espejos lo necesitan.
  periodos: string[];
  // La del Reporte: la de siempre más las filas extra del mes.
  plantillaReporte: Plantilla;
  acceso: AccesoReservados;
  meses: DatosMes[];
  reporte: Reporte;
};

export async function armarReporteDePlantilla(e: EntradaReporteDePlantilla): Promise<ReporteDePlantilla> {
  // Un mes más de contexto (no se muestra): el control de arrastre y los espejos del mes anterior lo necesitan
  // para el primer mes visible.
  const periodos = periodosHasta(e.periodo, cantidadDeMeses(e.vista, e.periodo, e.esAdminOFinanzas) + 1);
  // Plantilla del REPORTE: la de siempre más las filas extra del mes (sin el interruptor de la empresa, o sin
  // filas, es la MISMA plantilla). La carga del Presupuestado del gerente (planDeCarga) sigue con la
  // estática: con la otra, la fila extra le abriría una celda editable.
  const plantillaReporte = (await plantillaDeEmpresaConExtras(e.empresaId, e.empresaSlug, e.periodo)) ?? e.plantilla;
  // Qué bloques reservados llegan a este usuario: todo (ADMIN/FINANZAS), nada, o lo que prendan los
  // interruptores de su empresa (lib/config.ts).
  const acceso = accesoReservadosDelReporte(e.verBloquesReservados, e.empresaSlug);
  const meses = await cargarDatosMeses(e.empresaId, e.unidadesEmpresa, plantillaReporte, periodos, acceso);
  const reporte = armarReporte(plantillaReporte, meses, 1, { verBloquesReservados: acceso });
  return { periodos, plantillaReporte, acceso, meses, reporte };
}
