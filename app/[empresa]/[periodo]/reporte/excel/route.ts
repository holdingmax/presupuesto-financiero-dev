import { AccesoDenegadoError, esAdminOFinanzas, requireAccesoEmpresa, veBloquesReservadosDelReporte } from "@/lib/auth";
import { EMPRESAS_EN_DOLARES } from "@/lib/config";
import { bloquesReservadosDelUsuario } from "@/lib/permisosViewer";
import { respuestaExcel } from "@/lib/ejecucionExcel";
import { armarReporteDePlantilla } from "@/lib/reporte/armarReporteDePlantilla";
import { leerContextoExcelReporte } from "@/lib/reporte/contextoExcelReporte";
import {
  leerParametro,
  nombreArchivoReporte,
  rechazoPorEmpresa,
  rechazoPorPeriodo,
  vistaDeDescarga,
} from "@/lib/reporte/descargaExcel";
import { plantillaDeEmpresa } from "@/lib/reporte/plantillas";
import { construirExcelReporte } from "@/lib/reporte/reporteExcel";
import { resolverEmpresaPorSlug } from "@/lib/slug";

// Descarga del Reporte (botón «Descargar Excel»): el MISMO Reporte que ve quien descarga, armado con la misma función
// que la pantalla (armarReporteDePlantilla). De la URL solo salen ?vista= y ?modo= (qué columnas); qué bloques ve cada
// rol (Disponibilidades, Cierre) se decide siempre acá, desde la sesión, nunca por parámetro.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ empresa: string; periodo: string }> }
) {
  const { empresa: empresaSlug, periodo } = await params;
  const malPeriodo = rechazoPorPeriodo(periodo);
  if (malPeriodo) return new Response(malPeriodo.mensaje, { status: malPeriodo.status });

  const empresa = await resolverEmpresaPorSlug(empresaSlug);
  if (!empresa) return new Response("No existe la empresa.", { status: 404 });
  let usuario;
  try {
    usuario = await requireAccesoEmpresa(empresa.id);
  } catch (error) {
    if (error instanceof AccesoDenegadoError) return new Response("Sin acceso.", { status: 403 });
    throw error;
  }

  const plantilla = plantillaDeEmpresa(empresaSlug);
  const rechazo = rechazoPorEmpresa({ tienePlantilla: plantilla !== null, periodo });
  if (rechazo || !plantilla) return new Response(rechazo?.mensaje ?? "", { status: rechazo?.status ?? 404 });

  const adminOFinanzas = esAdminOFinanzas(usuario);
  const url = new URL(req.url);
  const modo = leerParametro(url.searchParams, "modo");
  const vista = vistaDeDescarga(leerParametro(url.searchParams, "vista"), modo, periodo, adminOFinanzas);

  const { plantillaReporte, meses, reporte } = await armarReporteDePlantilla({
    plantilla,
    empresaId: empresa.id,
    empresaSlug,
    unidadesEmpresa: empresa.unidadesNegocio,
    periodo,
    vista,
    esAdminOFinanzas: adminOFinanzas,
    // Mismo objeto que la pantalla del Reporte: { verBloquesReservados, sinBloquesReservados }. El VIEWER sin casilla va
    // SIN Disponibilidades ni Cierre, aunque los interruptores de la empresa se los darían a un gerente; con casilla, igual
    // que ADMIN y FINANZAS.
    ...bloquesReservadosDelUsuario(usuario, veBloquesReservadosDelReporte(usuario)),
  });
  const contexto = await leerContextoExcelReporte({
    usuario,
    empresaId: empresa.id,
    empresaSlug,
    plantillaReporte,
    periodo,
    marcaModo: modo,
    meses,
    reporte,
  });

  const ahora = new Date();
  const buffer = await construirExcelReporte({
    empresaNombre: empresa.nombre,
    enDolares: EMPRESAS_EN_DOLARES.includes(empresaSlug),
    reporte,
    dispComoSaldo: contexto.dispComoSaldo,
    estadoPresupuesto: contexto.estado,
    descargadoEn: ahora,
  });
  return respuestaExcel(buffer, nombreArchivoReporte(empresaSlug, periodo, ahora));
}
