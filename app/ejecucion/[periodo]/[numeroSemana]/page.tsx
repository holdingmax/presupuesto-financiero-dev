import Link from "next/link";
import PanelImputacion from "@/app/ejecucion/PanelImputacion";
import TablaMovimientos from "@/app/ejecucion/TablaMovimientos";
import Paginacion from "@/app/ejecucion/Paginacion";
import BarraFiltros from "@/app/ejecucion/BarraFiltros";
import TotalesPorMoneda from "@/app/ejecucion/TotalesPorMoneda";
import { obtenerDatosSemana, calcularChequeosSumaCero, listarSemanasDelPeriodo } from "@/app/ejecucion/actions";
import { AccesoDenegadoError } from "@/lib/auth";
import { textoTrazabilidad } from "@/lib/fecha";
import { aQuery, hayFiltros, hayFiltrosAdemasDeSinClasificar, parsearFiltros, type ParametrosUrl } from "@/lib/filtrosEjecucion";
import { opcionesUnidad } from "@/lib/unidadesNegocio";

type Props = {
  params: Promise<{ periodo: string; numeroSemana: string }>;
  searchParams: Promise<ParametrosUrl>;
};

function parsearPagina(paginaParam: string | undefined) {
  const pagina = Number(paginaParam);
  return Number.isInteger(pagina) && pagina >= 1 ? pagina : 1;
}

// Solo lectura en la consulta: nunca crea una semana (eso lo hace únicamente el índice en
// ../page.tsx). Renderiza editable solo si la semana está ABIERTA Y el usuario puede operar
// Ejecución — cualquier otra combinación (cerrada, o abierta pero sin permiso de operar) cae en
// el mismo bloque de solo lectura. El layout ya dejó pasar solo a ADMIN, FINANZAS y quien opera.
export default async function EjecucionGlobalSemanaPage({ params, searchParams }: Props) {
  const { periodo, numeroSemana: numeroSemanaParam } = await params;
  const parametros = await searchParams;
  const paginaParam = Array.isArray(parametros.pagina) ? parametros.pagina[0] : parametros.pagina;
  const numeroSemana = Number(numeroSemanaParam);
  const filtros = parsearFiltros(parametros);

  if (!Number.isInteger(numeroSemana) || numeroSemana < 1) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          &quot;{numeroSemanaParam}&quot; no es un número de semana válido.
        </p>
      </div>
    );
  }

  let datos;
  let semanas;
  try {
    [datos, semanas] = await Promise.all([
      obtenerDatosSemana(periodo, numeroSemana, parsearPagina(paginaParam), filtros),
      listarSemanasDelPeriodo(periodo),
    ]);
  } catch (error) {
    if (error instanceof AccesoDenegadoError) return null;
    throw error;
  }

  if (!datos) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="text-sm text-ink-muted">No encontré la semana {numeroSemana} de este período.</p>
      </div>
    );
  }

  const selectorDeSemanas =
    semanas.length > 1 ? (
      <nav className="w-full px-4 pt-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-ink-faint">Semanas del período</span>
        {semanas.map((s) => (
          <Link
            key={s.numeroSemana}
            href={`/ejecucion/${periodo}/${s.numeroSemana}`}
            className={`rounded-md px-2.5 py-1 transition ${
              s.numeroSemana === datos.numeroSemana ? "bg-marino text-white" : "text-ink-secondary hover:bg-paper-cool"
            }`}
          >
            Semana {s.numeroSemana} · {s.estado === "CERRADA" ? "cerrada" : "abierta"}
          </Link>
        ))}
      </nav>
    ) : null;

  // Respeta los filtros activos (toda la lista filtrada, no solo la página visible); es un enlace
  // común, la descarga la hace el navegador.
  const queryFiltros = aQuery(filtros);
  const baseSemana = `/ejecucion/${periodo}/${datos.numeroSemana}`;
  const botonExcel = (
    <div className="w-full px-4 pt-4 flex justify-end">
      <a
        href={`${baseSemana}/excel${queryFiltros ? `?${queryFiltros}` : ""}`}
        className="rounded-md px-2.5 py-1 text-sm text-marino border border-marino hover:bg-marino-tint transition"
      >
        Descargar Excel
      </a>
    </div>
  );

  if (datos.estado === "ABIERTA" && datos.veSubida) {
    const chequeos = await calcularChequeosSumaCero(periodo, numeroSemana);
    return (
      <>
        {selectorDeSemanas}
        {botonExcel}
        <PanelImputacion
          puedeCerrar={datos.puedeCerrar}
          verSaldo={datos.verSaldo}
          numeroSemana={datos.numeroSemana}
          estado={datos.estado}
          movimientosIniciales={datos.movimientos}
          clasificacionesDisponibles={datos.clasificacionesDisponibles}
          totalMovimientos={datos.totalMovimientos}
          totalSemana={datos.totalSemana}
          totalesPorMoneda={datos.totalesPorMoneda}
          pagina={datos.pagina}
          totalPaginas={datos.totalPaginas}
          filtros={datos.filtros}
          cuentasDeLaSemana={datos.cuentasDeLaSemana}
          chequeos={chequeos}
          unidadesSugeridas={datos.unidadesSugeridas}
          sinUnidadAsignada={datos.sinUnidadAsignada}
          sugerenciasClasificacion={datos.sugerenciasClasificacion}
          cuentasBancarias={datos.cuentasBancarias}
          puedeCargarMadre={datos.puedeCargarMadre}
          puedeOperar={datos.puedeOperar}
        />
      </>
    );
  }

  return (
    <>
      {selectorDeSemanas}
      {botonExcel}
      <div className="w-full px-4 pb-10 pt-6">
        <div className={`mx-auto w-full ${datos.verSaldo ? "max-w-7xl" : "max-w-5xl"} px-2`}>
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="flex items-center gap-2 text-xs tracking-[0.15em] text-ink-secondary uppercase mb-1">
              <span className="w-2 h-2 bg-plata" />
              Ejecución global · {periodo} · Semana {datos.numeroSemana}
            </p>
            <h1 className="text-4xl font-serif font-semibold tracking-tight">
              {datos.estado === "CERRADA" ? "Historial de ejecución" : "Ejecución (solo lectura)"}
            </h1>
          </div>
          <div className="text-right">
            <span
              className={`text-xs px-2.5 py-1 rounded-md ${
                datos.estado === "CERRADA" ? "bg-terracota-tint text-terracota" : "bg-marino-tint text-marino"
              }`}
            >
              {datos.estado === "CERRADA" ? "Cerrada" : "Abierta"}
            </span>
            {datos.cierre && (
              <p className="mt-2 text-xs text-ink-muted">
                {textoTrazabilidad("Cerrada", datos.cierre.fecha, datos.cierre.por)}
              </p>
            )}
          </div>
        </div>
        </div>

        <div>
          <div className="flex items-start justify-between mb-2">
            <h2 className="pt-1 text-sm font-medium text-ink-secondary">Movimientos ({datos.totalMovimientos})</h2>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint mb-0.5">Total</p>
              <TotalesPorMoneda totales={datos.totalesPorMoneda} />
            </div>
          </div>

          <BarraFiltros
            base={baseSemana}
            filtros={filtros}
            clasificaciones={datos.clasificacionesDisponibles}
            unidades={opcionesUnidad([])}
            cuentas={datos.cuentasDeLaSemana}
          />

          {datos.totalSemana === 0 ? (
            <p className="text-sm text-ink-muted py-6 border-t border-line-strong">
              Esta semana no tiene movimientos cargados.
            </p>
          ) : datos.totalMovimientos === 0 ? (
            <p className="text-sm text-ink-muted py-6 border-t border-line-strong">
              {hayFiltros(filtros) && !hayFiltrosAdemasDeSinClasificar(filtros) ? (
                <>
                  No hay movimientos sin clasificar.{" "}
                  <Link href={baseSemana} className="text-marino hover:underline">
                    Ver todos
                  </Link>
                </>
              ) : (
                <>
                  No hay movimientos que coincidan con los filtros.{" "}
                  <Link href={baseSemana} className="text-marino hover:underline">
                    Limpiar filtros
                  </Link>
                </>
              )}
            </p>
          ) : (
            <>
              <div className="mb-2 empty:hidden [&>div]:mt-0">
                <Paginacion
                  base={baseSemana}
                  pagina={datos.pagina}
                  totalPaginas={datos.totalPaginas}
                  query={queryFiltros}
                />
              </div>
              {/* overflow-auto + alto máximo: el encabezado sticky de la tabla se pega al borde de esta caja. */}
              <div className="max-h-[calc(100vh-12rem)] overflow-auto border-t border-line-strong">
                <TablaMovimientos
                  movimientos={datos.movimientos}
                  numeroSemana={datos.numeroSemana}
                  soloLectura
                  mostrarSaldo={datos.verSaldo}
                />
              </div>
              <Paginacion
                base={baseSemana}
                pagina={datos.pagina}
                totalPaginas={datos.totalPaginas}
                query={queryFiltros}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
