import Link from "next/link";
import TablaMovimientos from "@/app/ejecucion/TablaMovimientos";
import Paginacion from "@/app/ejecucion/Paginacion";
import TotalesPorMoneda from "@/app/ejecucion/TotalesPorMoneda";
import MovimientosEditablesEmpresa from "./MovimientosEditablesEmpresa";
import { obtenerDatosSemanaDeEmpresa } from "../datos";
import SelectorMes from "../SelectorMes";
import { opcionesDeMes } from "@/lib/mesesEjecucion";
import { AccesoDenegadoError } from "@/lib/auth";
import { textoTrazabilidad } from "@/lib/fecha";
import { hrefConFiltro, leerClasificacion, queryClasificacion } from "@/lib/filtroClasificacionEmpresa";
import { nombreParaMostrar } from "@/lib/clasificaciones";

type Props = {
  params: Promise<{ empresa: string; periodo: string; numeroSemana: string }>;
  searchParams: Promise<{ pagina?: string; filtro?: string; clasificacion?: string }>;
};

function parsearPagina(paginaParam: string | undefined) {
  const pagina = Number(paginaParam);
  return Number.isInteger(pagina) && pagina >= 1 ? pagina : 1;
}

// Pestaña "Ejecución financiera" de la empresa: SOLO LECTURA y filtrada a lo que es de esta
// empresa (docs/ejecucion_global_plan.md §3.4). Subir, editar y cerrar se hace en el módulo global
// (/ejecucion), al que lleva el enlace de arriba para quien opera o es ADMIN/FINANZAS.
export default async function EjecucionSemanaPage({ params, searchParams }: Props) {
  const { empresa, periodo, numeroSemana: numeroSemanaParam } = await params;
  const { pagina: paginaParam, filtro, clasificacion: clasificacionParam } = await searchParams;
  const numeroSemana = Number(numeroSemanaParam);
  // Elegir una clasificación reemplaza al viejo ?filtro=sin_clasificar (ver lib/filtroClasificacionEmpresa.ts).
  const clasificacion = leerClasificacion({ clasificacion: clasificacionParam, filtro });
  const queryFiltro = queryClasificacion(clasificacion);
  const base = `/${empresa}/${periodo}/ejecucion/${numeroSemana}`;

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
  try {
    datos = await obtenerDatosSemanaDeEmpresa(
      empresa,
      periodo,
      numeroSemana,
      parsearPagina(paginaParam),
      clasificacion
    );
  } catch (error) {
    // Ver el comentario equivalente en presupuesto/page.tsx: el layout ya
    // muestra el panel de "sin acceso", esto solo evita que se vea como un
    // error sin manejar cuando el chequeo defensivo vuelve a fallar acá.
    if (error instanceof AccesoDenegadoError) return null;
    throw error;
  }

  if (!datos) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="text-sm text-ink-muted">No encontré la semana {numeroSemana}.</p>
      </div>
    );
  }

  return (
    // Ancho completo: la tabla ya no entra en max-w-5xl sin scroll horizontal.
    <div className="w-full px-4 py-10">
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="flex items-center gap-2 text-xs tracking-[0.15em] text-ink-secondary uppercase mb-1">
            <span className="w-2 h-2 bg-plata" />
            {datos.empresaNombre} · Semana {datos.numeroSemana}
          </p>
          <h1 className="text-4xl font-serif font-semibold tracking-tight">
            {datos.estado === "CERRADA" ? "Historial de ejecución" : datos.edicion ? "Ejecución" : "Ejecución (solo lectura)"}
          </h1>
          <p className="mt-2 text-xs text-ink-muted max-w-xl">
            Solo se muestran los movimientos de las unidades de {datos.empresaNombre}, vengan de la
            cuenta bancaria que vengan.{" "}
            {datos.edicion
              ? "En esta semana abierta podés clasificar, ignorar y cambiar la unidad entre las de tu empresa. Cerrar la semana lo hace Finanzas en Ejecución global."
              : "Los extractos se cargan y se cierran en Ejecución global."}
          </p>
          {datos.puedeIrAlModuloGlobal && (
            <Link
              href={`/ejecucion/${periodo}/${datos.numeroSemana}`}
              className="mt-2 inline-block text-sm text-marino underline underline-offset-2 hover:text-marino-dark"
            >
              Operar en Ejecución global →
            </Link>
          )}
        </div>
        <div className="text-right">
          <a
            href={hrefConFiltro(`/${empresa}/${periodo}/ejecucion/${datos.numeroSemana}/excel`, clasificacion)}
            className="mr-3 rounded-md px-2.5 py-1 text-sm text-marino border border-marino hover:bg-marino-tint transition"
            title={
              clasificacion
                ? "Descarga solo los movimientos filtrados por la clasificación elegida"
                : "Descarga todos los movimientos de la semana"
            }
          >
            {clasificacion ? "Descargar Excel (filtrado)" : "Descargar Excel"}
          </a>
          <span
            className={`text-xs px-2.5 py-1 rounded-md ${
              datos.estado === "CERRADA"
                ? "bg-terracota-tint text-terracota"
                : "bg-marino-tint text-marino"
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

      <SelectorMes
        periodo={periodo}
        opciones={opcionesDeMes(empresa, datos.meses, periodo, (b) => hrefConFiltro(b, clasificacion))}
      />

      {datos.semanas.length > 1 && (
        <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs uppercase tracking-wide text-ink-faint">Semanas del período</span>
          {datos.semanas.map((s) => (
            <Link
              key={s.numeroSemana}
              href={hrefConFiltro(`/${empresa}/${periodo}/ejecucion/${s.numeroSemana}`, clasificacion)}
              className={`rounded-md px-2.5 py-1 transition ${
                s.numeroSemana === datos.numeroSemana
                  ? "bg-marino text-white"
                  : "text-ink-secondary hover:bg-paper-cool"
              }`}
            >
              Semana {s.numeroSemana} · {s.estado === "CERRADA" ? "cerrada" : "abierta"}
            </Link>
          ))}
          <Link
            href={hrefConFiltro(`/${empresa}/${periodo}/ejecucion/mes`, clasificacion)}
            className="rounded-md px-2.5 py-1 transition text-ink-secondary hover:bg-paper-cool"
          >
            Todo el mes
          </Link>
        </nav>
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
          <h2 className="pt-1 text-sm font-medium text-ink-secondary">
            Movimientos ({datos.totalMovimientos})
          </h2>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint mb-0.5">
              Total
            </p>
            <TotalesPorMoneda totales={datos.totalesPorMoneda} />
            {datos.hayReservados && (
              <p className="mt-0.5 text-xs text-ink-muted">No incluye movimientos reservados</p>
            )}
          </div>
        </div>

        {datos.totalMovimientos === 0 ? (
          <p className="text-sm text-ink-muted py-6 border-t border-line-strong">
            {clasificacion
              ? `Esta semana no tiene movimientos de ${datos.empresaNombre} con la clasificación “${nombreParaMostrar(clasificacion)}”.`
              : `Esta semana no tiene movimientos de ${datos.empresaNombre}.`}
          </p>
        ) : (
          <>
            <div className="mb-2 empty:hidden [&>div]:mt-0">
              <Paginacion
                base={`/${empresa}/${periodo}/ejecucion/${datos.numeroSemana}`}
                pagina={datos.pagina}
                totalPaginas={datos.totalPaginas}
                query={queryFiltro}
              />
            </div>
            {/* overflow-auto + alto máximo: el encabezado sticky de la tabla se pega al borde de esta caja. */}
            <div className="max-h-[calc(100vh-12rem)] overflow-auto border-t border-line-strong">
              {datos.edicion ? (
                <MovimientosEditablesEmpresa
                  empresaId={datos.empresaId}
                  periodo={periodo}
                  numeroSemana={datos.numeroSemana}
                  movimientos={datos.movimientos}
                  edicion={datos.edicion}
                />
              ) : (
                <TablaMovimientos
                  movimientos={datos.movimientos}
                  numeroSemana={datos.numeroSemana}
                  soloLectura
                />
              )}
            </div>
            <Paginacion
              base={`/${empresa}/${periodo}/ejecucion/${datos.numeroSemana}`}
              pagina={datos.pagina}
              totalPaginas={datos.totalPaginas}
              query={queryFiltro}
            />
          </>
        )}
      </div>
    </div>
  );
}
