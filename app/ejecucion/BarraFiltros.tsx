import Link from "next/link";
import { UNIDAD_SIN_ASIGNAR, aQuery, hayFiltros, type FiltrosEjecucion } from "@/lib/filtrosEjecucion";

type Props = {
  // Ruta de la semana, sin querystring (ej. /ejecucion/2026-09/2).
  base: string;
  filtros: FiltrosEjecucion;
  clasificaciones: string[];
  unidades: string[];
  cuentas: string[];
};

const CLASES_CAMPO =
  "h-7 rounded-md border border-line bg-paper-raised px-2 text-xs text-ink focus:border-marino focus:outline-none";

function conValorActual(opciones: string[], actual: string | undefined) {
  return actual && !opciones.includes(actual) ? [actual, ...opciones] : opciones;
}

// Filtros de la lista de movimientos: viven en la URL (se comparten y la paginación los respeta).
// Es un <form method="get"> común — sin "use client" — así que anda igual dentro de un Server
// Component (semana cerrada) o de un Client Component (semana abierta). Enviarlo vuelve a la
// página 1 porque `pagina` no forma parte del formulario.
export default function BarraFiltros({ base, filtros, clasificaciones, unidades, cuentas }: Props) {
  const hrefToggle = (soloSinClasificar: boolean) => {
    const q = aQuery({ ...filtros, soloSinClasificar });
    return q ? `${base}?${q}` : base;
  };

  return (
    <div className="mb-4 space-y-2">
      <div className="inline-flex rounded-md border border-line p-0.5">
        <Link
          href={hrefToggle(false)}
          className={`px-2.5 py-1 rounded text-xs font-medium transition ${
            !filtros.soloSinClasificar ? "bg-marino-tint text-marino" : "text-ink-secondary hover:text-ink"
          }`}
        >
          Todos
        </Link>
        <Link
          href={hrefToggle(true)}
          className={`px-2.5 py-1 rounded text-xs font-medium transition ${
            filtros.soloSinClasificar ? "bg-marino-tint text-marino" : "text-ink-secondary hover:text-ink"
          }`}
        >
          Solo sin clasificar
        </Link>
      </div>

      {/* key = filtros de la URL: `defaultValue` solo vale al montar, y dentro del panel (Client Component)
          la barra sigue montada al navegar por un enlace (ej. el aviso "sin unidad asignada"), así que
          sin esto los campos quedaban con el valor anterior. Remontar el form los vuelve a leer de la URL. */}
      <form key={aQuery(filtros)} method="get" action={base} className="flex flex-wrap items-end gap-2 text-xs text-ink-secondary">
        {filtros.soloSinClasificar && <input type="hidden" name="filtro" value="sin_clasificar" />}
        <label className="flex flex-col gap-0.5">
          Desde
          <input type="date" name="desde" defaultValue={filtros.desde ?? ""} className={CLASES_CAMPO} />
        </label>
        <label className="flex flex-col gap-0.5">
          Hasta
          <input type="date" name="hasta" defaultValue={filtros.hasta ?? ""} className={CLASES_CAMPO} />
        </label>
        <label className="flex flex-col gap-0.5">
          Clasificación
          <select name="clasificacion" defaultValue={filtros.clasificacion ?? ""} className={CLASES_CAMPO}>
            <option value="">Todas</option>
            {conValorActual(clasificaciones, filtros.clasificacion).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          Unidad de negocio
          <select name="unidad" defaultValue={filtros.unidad ?? ""} className={CLASES_CAMPO}>
            <option value="">Todas</option>
            {/* Solo para filtrar: no está en la lista de unidades, no se puede elegir en la tabla. */}
            <option value={UNIDAD_SIN_ASIGNAR}>{UNIDAD_SIN_ASIGNAR}</option>
            {conValorActual(unidades, filtros.unidad === UNIDAD_SIN_ASIGNAR ? undefined : filtros.unidad).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          Banco y cuenta
          <select name="cuenta" defaultValue={filtros.cuenta ?? ""} className={CLASES_CAMPO}>
            <option value="">Todas</option>
            {conValorActual(cuentas, filtros.cuenta).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          Concepto contiene
          <input type="text" name="q" maxLength={100} defaultValue={filtros.texto ?? ""} className={`${CLASES_CAMPO} w-44`} />
        </label>
        <button
          type="submit"
          className="h-7 rounded-md border border-marino px-3 font-medium text-marino transition hover:bg-marino-tint"
        >
          Filtrar
        </button>
        {hayFiltros(filtros) && (
          <Link href={base} className="flex h-7 items-center px-1 text-ink-muted underline hover:text-ink">
            Limpiar filtros
          </Link>
        )}
      </form>
    </div>
  );
}
