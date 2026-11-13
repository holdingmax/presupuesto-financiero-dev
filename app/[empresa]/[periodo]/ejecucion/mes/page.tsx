import Link from "next/link";
import TablaMovimientos from "@/app/ejecucion/TablaMovimientos";
import Paginacion from "@/app/ejecucion/Paginacion";
import TotalesPorMoneda from "@/app/ejecucion/TotalesPorMoneda";
import { obtenerDatosMesDeEmpresa } from "../datos";
import NavSemanas from "../NavSemanas";
import SelectorMes from "../SelectorMes";
import { opcionesDeMes } from "@/lib/mesesEjecucion";
import { AccesoDenegadoError } from "@/lib/auth";
import { hrefConFiltro, leerClasificacion, queryClasificacion } from "@/lib/filtroClasificacionEmpresa";
import { nombreParaMostrar } from "@/lib/clasificaciones";

type Props = {
  params: Promise<{ empresa: string; periodo: string }>;
  searchParams: Promise<{ pagina?: string; filtro?: string; clasificacion?: string }>;
};

function parsearPagina(paginaParam: string | undefined) {
  const pagina = Number(paginaParam);
  return Number.isInteger(pagina) && pagina >= 1 ? pagina : 1;
}

// "Todo el mes" de la pestaña Ejecución de la empresa: SOLO LECTURA, las mismas reglas que la vista por
// semana (ver datos.ts), con todas las semanas del período juntas y una columna Semana.
export default async function EjecucionMesPage({ params, searchParams }: Props) {
  const { empresa, periodo } = await params;
  const { pagina: paginaParam, filtro, clasificacion: clasificacionParam } = await searchParams;
  const clasificacion = leerClasificacion({ clasificacion: clasificacionParam, filtro });
  const queryFiltro = queryClasificacion(clasificacion);
  const base = `/${empresa}/${periodo}/ejecucion/mes`;

  let datos;
  try {
    datos = await obtenerDatosMesDeEmpresa(empresa, periodo, parsearPagina(paginaParam), clasificacion);
  } catch (error) {
    // Igual que la vista por semana: el layout ya muestra el panel de "sin acceso".
    if (error instanceof AccesoDenegadoError) return null;
    throw error;
  }

  if (!datos) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="text-sm text-ink-muted">Todavía no hay ninguna semana cargada para este período.</p>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-10">
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="flex items-center gap-2 text-xs tracking-[0.15em] text-ink-secondary uppercase mb-1">
            <span className="w-2 h-2 bg-plata" />
            {datos.empresaNombre} · Todo el mes
          </p>
          <h1 className="text-4xl font-serif font-semibold tracking-tight">
            {datos.todasCerradas ? "Historial de ejecución" : "Ejecución (solo lectura)"}
          </h1>
          <p className="mt-2 text-xs text-ink-muted max-w-xl">
            Solo se muestran los movimientos de las unidades de {datos.empresaNombre}, vengan de la
            cuenta bancaria que vengan. Los extractos se cargan y se cierran en Ejecución global.
          </p>
          {datos.puedeIrAlModuloGlobal && (
            <Link
              href={`/ejecucion/${periodo}`}
              className="mt-2 inline-block text-sm text-marino underline underline-offset-2 hover:text-marino-dark"
            >
              Operar en Ejecución global →
            </Link>
          )}
        </div>
        <div className="text-right">
          <a
            href={hrefConFiltro(`${base}/excel`, clasificacion)}
            className="rounded-md px-2.5 py-1 text-sm text-marino border border-marino hover:bg-marino-tint transition"
            title={
              clasificacion
                ? "Descarga solo los movimientos filtrados por la clasificación elegida"
                : "Descarga todos los movimientos del mes"
            }
          >
            {clasificacion ? "Descargar Excel (filtrado)" : "Descargar Excel"}
          </a>
        </div>
      </div>

      <SelectorMes
        periodo={periodo}
        opciones={opcionesDeMes(empresa, datos.meses, periodo, (b) => hrefConFiltro(b, clasificacion))}
      />

      <NavSemanas empresa={empresa} periodo={periodo} semanas={datos.semanas} activa="mes" clasificacion={clasificacion} />

      {datos.avisoAbiertas && (
        <p
          role="status"
          className="mb-4 rounded-md border border-marino bg-marino-tint px-3 py-2 text-sm text-marino"
        >
          {datos.avisoAbiertas}
        </p>
      )}

      {datos.sinUnidades && (
        <p className="mb-4 text-sm text-ink-muted">
          Esta empresa no tiene unidades de negocio asignadas, así que no hay movimientos para mostrar.
        </p>
      )}

      <form method="get" action={base} className="mb-4 flex flex-wrap items-end gap-2 text-xs text-ink-secondary">
        <label className="flex flex-col gap-0.5">
          Clasificación
          <select
            name="clasificacion"
            defaultValue={clasificacion ?? ""}
            className="h-7 rounded-md border border-line bg-paper-raised px-2 text-xs text-ink focus:border-marino focus:outline-none"
          >
            <option value="">Todas</option>
            {datos.clasificacionesDisponibles.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-7 rounded-md border border-marino px-3 font-medium text-marino transition hover:bg-marino-tint"
        >
          Filtrar
        </button>
        {clasificacion && (
          <Link href={base} className="flex h-7 items-center px-1 text-ink-muted underline hover:text-ink">
            Quitar filtro
          </Link>
        )}
        {clasificacion && (
          <span className="flex h-7 items-center text-ink-muted">
            Mostrando: {nombreParaMostrar(clasificacion)} · el Excel descarga solo lo filtrado
          </span>
        )}
      </form>

      <div>
        <div className="flex items-start justify-between mb-2">
          <h2 className="pt-1 text-sm font-medium text-ink-secondary">Movimientos ({datos.totalMovimientos})</h2>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint mb-0.5">Total del mes</p>
            <TotalesPorMoneda totales={datos.totalesPorMoneda} />
            {datos.hayReservados && <p className="mt-0.5 text-xs text-ink-muted">No incluye movimientos reservados</p>}
          </div>
        </div>

        {datos.totalMovimientos === 0 ? (
          <p className="text-sm text-ink-muted py-6 border-t border-line-strong">
            {clasificacion
              ? `Este mes no tiene movimientos de ${datos.empresaNombre} con la clasificación “${nombreParaMostrar(clasificacion)}”.`
              : `Este mes no tiene movimientos de ${datos.empresaNombre}.`}
          </p>
        ) : (
          <>
            <div className="mb-2 empty:hidden [&>div]:mt-0">
              <Paginacion base={base} pagina={datos.pagina} totalPaginas={datos.totalPaginas} query={queryFiltro} />
            </div>
            <div className="max-h-[calc(100vh-12rem)] overflow-auto border-t border-line-strong">
              <TablaMovimientos
                movimientos={datos.movimientos}
                numeroSemana={datos.semanas[datos.semanas.length - 1].numeroSemana}
                soloLectura
                mostrarSemana
              />
            </div>
            <Paginacion base={base} pagina={datos.pagina} totalPaginas={datos.totalPaginas} query={queryFiltro} />
          </>
        )}
      </div>
    </div>
  );
}
