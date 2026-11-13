import { nombreParaMostrar } from "@/lib/clasificaciones";
import { formatearImporte } from "@/app/ejecucion/formato";
import BloqueNoAsignado from "./BloqueNoAsignado";
import BloqueSinClasificar from "./BloqueSinClasificar";
import type { BloqueSinClasificar as DatosSinClasificar } from "@/lib/reporte/sinClasificar";
import {
  CLASE_BORDE_MES,
  CLASE_CABECERA_COLUMNA,
  CLASE_CABECERA_CONCEPTO,
  CLASE_CABECERA_MES,
  CLASE_CELDA_CONCEPTO,
  CLASE_CELDA_NUMERO,
  CLASE_CELDA_TITULO,
  CLASE_FILA,
  CLASE_FILA_TITULO,
  importePesos,
} from "./estilosReporte";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function formatearPeriodo(periodo: string) {
  const [anio, mes] = periodo.split("-");
  const nombreMes = MESES[Number(mes) - 1] ?? mes;
  return `${nombreMes.charAt(0).toUpperCase()}${nombreMes.slice(1)} ${anio}`;
}

type FilaReporte = {
  clasificacion: string;
  presupuestado: number;
  real: number;
};

type Props = {
  empresaNombre: string;
  empresaSlug: string;
  periodo: string;
  filas: FilaReporte[];
  // La empresa no tiene ninguna unidad de negocio asignada (Empresa.unidadesNegocio
  // vacío): su REAL siempre da $0 — se avisa para que no parezca un error.
  sinUnidades: boolean;
  // De los extractos de ESTA empresa: importes cuya unidad no pertenece a ninguna
  // empresa. No se suman a ningún rubro (ver lib/reporte.ts).
  noAsignado: { unidad: string; importe: number; movimientos: number }[];
  semanasConNoAsignado: number[];
  sinClasificar: DatosSinClasificar | null;
};

export default function ReportePresupuestoMesAMes({
  empresaNombre,
  empresaSlug,
  periodo,
  filas,
  sinUnidades,
  noAsignado,
  semanasConNoAsignado,
  sinClasificar,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10">
      <div className="mb-10">
        <p className="flex items-center gap-2 text-xs tracking-[0.15em] text-ink-secondary uppercase">
          <span className="h-2 w-2 bg-plata" />
          {empresaNombre} · {formatearPeriodo(periodo)}
        </p>
        <h1 className="mt-1 text-4xl font-serif font-semibold tracking-tight">
          Presupuesto mes a mes
        </h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Egresos — presupuestado vs. real ejecutado (semanas cerradas de Ejecución). El real
          suma los movimientos de las unidades de negocio de esta empresa, de cualquier
          extracto del período.
        </p>
      </div>

      {sinUnidades && (
        <p className="mb-6 text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          Esta empresa no tiene unidades de negocio asignadas, así que el real va a dar $0. Un
          administrador las asigna en Administración → Unidades de negocio.
        </p>
      )}

      <div className="overflow-x-auto border-t border-line-strong">
        <table className="w-max min-w-full text-sm">
          <thead>
            <tr className="text-xs text-ink-secondary">
              <th className="sticky left-0 z-10 bg-paper" />
              <th colSpan={4} className={CLASE_CABECERA_MES}>
                {formatearPeriodo(periodo)}
              </th>
            </tr>
            <tr className="text-xs text-ink-faint uppercase tracking-wide">
              <th className={CLASE_CABECERA_CONCEPTO}>Concepto</th>
              <th className={`${CLASE_CABECERA_COLUMNA} ${CLASE_BORDE_MES}`}>Presupuestado</th>
              <th className={CLASE_CABECERA_COLUMNA}>Real</th>
              <th className={CLASE_CABECERA_COLUMNA}>% Avance</th>
              <th className={CLASE_CABECERA_COLUMNA}>Falta ejecutar</th>
            </tr>
          </thead>
          <tbody>
            <tr className={CLASE_FILA_TITULO}>
              <td className={CLASE_CELDA_TITULO}>Egresos</td>
              <td colSpan={4} />
            </tr>
            {filas.map((f) => {
              const faltaEjecutar = f.presupuestado - f.real;
              // Sin presupuesto no hay porcentaje que calcular: celda en blanco.
              const avance = f.presupuestado === 0 ? null : (f.real / f.presupuestado) * 100;
              return (
                <tr key={f.clasificacion} className={CLASE_FILA}>
                  <td className={CLASE_CELDA_CONCEPTO}>{nombreParaMostrar(f.clasificacion)}</td>
                  <td className={`${CLASE_CELDA_NUMERO} ${CLASE_BORDE_MES}`}>{importePesos(f.presupuestado)}</td>
                  <td className={CLASE_CELDA_NUMERO}>{importePesos(f.real)}</td>
                  <td className={CLASE_CELDA_NUMERO}>{avance === null ? "" : `${formatearImporte(avance)}%`}</td>
                  <td className={CLASE_CELDA_NUMERO}>{importePesos(faltaEjecutar)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BloqueNoAsignado
        empresaSlug={empresaSlug}
        periodo={periodo}
        noAsignado={noAsignado}
        semanasConNoAsignado={semanasConNoAsignado}
      />
      <BloqueSinClasificar sinClasificar={sinClasificar} />

      <p className="mt-8 text-xs text-ink-muted">Disponibilidades e Ingresos: próximamente</p>
    </div>
  );
}
