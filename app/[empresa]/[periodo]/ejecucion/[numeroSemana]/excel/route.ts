import { prisma } from "@/lib/prisma";
import { resolverEmpresaPorSlug } from "@/lib/slug";
import { AccesoDenegadoError, requireAccesoEmpresa } from "@/lib/auth";
import { obtenerEjecucionPorSemana } from "@/lib/ejecucion";
import { mapearMovimiento } from "@/lib/ejecucionVista";
import { leerClasificacion, whereMovimientosDeEmpresa } from "@/lib/filtroClasificacionEmpresa";
import { construirExcelMovimientos, respuestaExcel } from "@/lib/ejecucionExcel";
import { obtenerValoresOcultos } from "@/lib/ocultasGerenteDb";
import { slugDeEmpresa } from "@/lib/slug";

// Igual que la pantalla de la empresa (datos.ts): solo sus unidades (o porciones de prorrateo),
// sin saldo, mismo orden — pero toda la semana, sin paginar. Respeta el filtro por clasificación.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ empresa: string; periodo: string; numeroSemana: string }> }
) {
  const { empresa: empresaSlug, periodo, numeroSemana: numeroSemanaParam } = await params;
  const numeroSemana = Number(numeroSemanaParam);
  if (!/^\d{4}-\d{2}$/.test(periodo) || !Number.isInteger(numeroSemana) || numeroSemana < 1) {
    return new Response("Período o semana inválidos.", { status: 400 });
  }

  const empresa = await resolverEmpresaPorSlug(empresaSlug);
  if (!empresa) return new Response("No existe la empresa.", { status: 404 });
  let usuario;
  try {
    usuario = await requireAccesoEmpresa(empresa.id);
  } catch (error) {
    if (error instanceof AccesoDenegadoError) return new Response("Sin acceso.", { status: 403 });
    throw error;
  }

  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) return new Response("No existe esa semana.", { status: 404 });

  const unidades = empresa.unidadesNegocio;
  // Mismo filtro que la pantalla (?clasificacion=…, o el viejo ?filtro=sin_clasificar), por AND con
  // las unidades de la empresa.
  const url = new URL(req.url);
  const clasificacion = leerClasificacion({
    clasificacion: url.searchParams.get("clasificacion") ?? undefined,
    filtro: url.searchParams.get("filtro") ?? undefined,
  });
  // Mismas clasificaciones ocultas que la pantalla (config.ts): el Excel nunca trae lo que el gerente no ve.
  const ocultas = await obtenerValoresOcultos(ejecucion.id, slugDeEmpresa(empresa.nombre), usuario);
  const filas = await prisma.movimientoBancario.findMany({
    where: whereMovimientosDeEmpresa(ejecucion.id, unidades, clasificacion, ocultas),
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    include: { desglose: { orderBy: { createdAt: "asc" } } },
  });

  const buffer = await construirExcelMovimientos(
    filas.map((m) => mapearMovimiento(m, unidades)),
    false
  );
  const sufijo = clasificacion ? "-filtrado" : "";
  return respuestaExcel(
    buffer,
    `movimientos-${empresaSlug.replace(/[^\w-]/g, "")}-${periodo}-semana-${numeroSemana}${sufijo}.xlsx`
  );
}
