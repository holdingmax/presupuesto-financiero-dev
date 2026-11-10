import { prisma } from "@/lib/prisma";
import { resolverEmpresaPorSlug } from "@/lib/slug";
import { AccesoDenegadoError, requireAccesoEmpresa } from "@/lib/auth";
import { mapearMovimiento } from "@/lib/ejecucionVista";
import { leerClasificacion } from "@/lib/filtroClasificacionEmpresa";
import { whereMovimientosDelMes } from "@/lib/ejecucionMes";
import { construirExcelMovimientos, respuestaExcel } from "@/lib/ejecucionExcel";
import { obtenerValoresOcultos } from "@/lib/ocultasGerenteDb";
import { slugDeEmpresa } from "@/lib/slug";

// Igual que la pantalla "Todo el mes" (datos.ts, obtenerDatosMesDeEmpresa): las unidades de la empresa,
// sin saldo, sin ignorados, con las mismas ocultas y el mismo filtro — todo el mes, sin paginar, y con
// la columna Semana.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ empresa: string; periodo: string }> }
) {
  const { empresa: empresaSlug, periodo } = await params;
  if (!/^\d{4}-\d{2}$/.test(periodo)) return new Response("Período inválido.", { status: 400 });

  const empresa = await resolverEmpresaPorSlug(empresaSlug);
  if (!empresa) return new Response("No existe la empresa.", { status: 404 });
  let usuario;
  try {
    usuario = await requireAccesoEmpresa(empresa.id);
  } catch (error) {
    if (error instanceof AccesoDenegadoError) return new Response("Sin acceso.", { status: 403 });
    throw error;
  }

  const semanas = await prisma.ejecucionSemanal.findMany({
    where: { periodo },
    orderBy: { numeroSemana: "asc" },
    select: { id: true, numeroSemana: true },
  });
  if (semanas.length === 0) return new Response("El período no tiene semanas.", { status: 404 });

  const unidades = empresa.unidadesNegocio;
  const url = new URL(req.url);
  const clasificacion = leerClasificacion({
    clasificacion: url.searchParams.get("clasificacion") ?? undefined,
    filtro: url.searchParams.get("filtro") ?? undefined,
  });
  const ocultasPorSemana = await Promise.all(
    semanas.map((s) => obtenerValoresOcultos(s.id, slugDeEmpresa(empresa.nombre), usuario))
  );
  const ocultas = Array.from(new Set(ocultasPorSemana.flat()));
  const filas = await prisma.movimientoBancario.findMany({
    where: whereMovimientosDelMes(
      semanas.map((s) => s.id),
      unidades,
      clasificacion,
      ocultas
    ),
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    include: { desglose: { orderBy: { createdAt: "asc" } } },
  });
  const semanaDe = new Map(semanas.map((s) => [s.id, s.numeroSemana]));

  const buffer = await construirExcelMovimientos(
    filas.map((m) => ({ ...mapearMovimiento(m, unidades), semana: semanaDe.get(m.ejecucionId) })),
    false,
    true
  );
  const sufijo = clasificacion ? "-filtrado" : "";
  return respuestaExcel(buffer, `movimientos-${empresaSlug.replace(/[^\w-]/g, "")}-${periodo}-mes${sufijo}.xlsx`);
}
