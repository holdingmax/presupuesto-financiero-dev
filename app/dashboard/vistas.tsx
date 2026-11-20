import Link from "next/link";
import type { ReactNode } from "react";
import type { CalidadDelMes } from "@/lib/dashboard/calidad";
import type { FilaDeAvance, TotalDeAvance } from "@/lib/dashboard/avance";
import type { ControlDepositosDeCheques } from "@/lib/dashboard/controles";
import { opcionesDeMes, type EncabezadoDeAvance } from "@/lib/dashboard/encabezado";
import { cantidad, ddMm, importeDeAvance, porcentajeDeAvance } from "@/lib/dashboard/formato";
import { simboloMoneda } from "@/lib/moneda";

// Vistas del dashboard (Entrega 3): SOLO presentación, sin hooks ni acceso a datos. Reciben ya armado lo que calcularon los
// módulos de lib/dashboard, así se pueden probar renderizándolas. Cada bloque «solo ADMIN» (Sin asignar y el control de
// depósitos) vive en su propia vista y SOLO existe si quien arma la pantalla se la da: sin dato no hay ni título.

const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marino";
const TH = "px-3 py-2 text-xs font-medium tracking-wide text-ink-secondary uppercase";
const TD_NUM = "tabular px-3 py-3 text-right text-sm text-ink whitespace-nowrap";

// ---- Encabezado ---------------------------------------------------------------------------------------------------

export function TituloDeAvance({ encabezado }: { encabezado: EncabezadoDeAvance }) {
  const partes = [`Avance de ${encabezado.nombreDelMes}`];
  if (encabezado.datosAl) partes.push(`datos al ${encabezado.datosAl}`);
  if (encabezado.ritmo) partes.push(`${porcentajeDeAvance(encabezado.ritmo.porcentaje).replace("%", " %")} del mes`);
  const { semanas, movimientosAfuera } = encabezado.semanasProvisorias;
  return (
    <>
      <h1 className="font-serif text-3xl font-semibold tracking-tight">{partes.join(" · ")}</h1>
      {semanas > 0 && (
        <p role="note" className="mt-3 rounded-md border border-terracota/40 bg-terracota-tint px-3 py-2 text-sm text-ink">
          {semanas === 1 ? "Hay 1 semana" : `Hay ${semanas} semanas`} con movimientos todavía en lotes abiertos:{" "}
          {cantidad(movimientosAfuera)} {movimientosAfuera === 1 ? "movimiento queda afuera" : "movimientos quedan afuera"} de estos números.
        </p>
      )}
    </>
  );
}

export function SelectorDeMes({ periodo }: { periodo: string }) {
  return (
    <nav aria-label="Mes" className="flex flex-wrap gap-2">
      {opcionesDeMes(periodo).map((o) => (
        <Link
          key={o.periodo}
          href={`/dashboard?periodo=${o.periodo}`}
          aria-current={o.actual ? "page" : undefined}
          className={`inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium transition ${FOCO} ${
            o.actual
              ? "border-marino bg-marino text-white"
              : "border-line-strong bg-paper-raised text-ink hover:border-marino hover:text-marino-dark"
          }`}
        >
          {o.nombre}
        </Link>
      ))}
    </nav>
  );
}

// ---- Avance del mes -----------------------------------------------------------------------------------------------

export function TablaDeAvance({ children, pie }: { children: ReactNode; pie: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-paper-raised">
      <table className="w-full min-w-[56rem] border-collapse text-left">
        <caption className="sr-only">Avance del mes contra el presupuesto, por empresa</caption>
        <thead>
          <tr className="border-b border-line bg-paper-cool">
            <th rowSpan={2} scope="col" className={`${TH} align-bottom`}>Empresa</th>
            <th colSpan={4} scope="colgroup" className={`${TH} border-l border-line text-center`}>Egresos operativos</th>
            <th colSpan={3} scope="colgroup" className={`${TH} border-l border-line text-center`}>Ingresos</th>
            <th rowSpan={2} scope="col" className={`${TH} border-l border-line align-bottom`}>Estado</th>
          </tr>
          <tr className="border-b border-line bg-paper-cool">
            <th scope="col" className={`${TH} border-l border-line text-right`}>Presupuestado</th>
            <th scope="col" className={`${TH} text-right`}>Real</th>
            <th scope="col" className={`${TH} text-right`}>Avance</th>
            <th scope="col" className={`${TH} text-right`}>Ritmo del mes</th>
            <th scope="col" className={`${TH} border-l border-line text-right`}>Presupuestado</th>
            <th scope="col" className={`${TH} text-right`}>Real</th>
            <th scope="col" className={`${TH} text-right`}>Avance</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
        <tfoot>{pie}</tfoot>
      </table>
    </div>
  );
}

function Marca({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded-full border border-line-strong bg-paper px-2 py-0.5 text-xs text-ink-secondary">{children}</span>;
}

export function marcasDeFila(fila: FilaDeAvance): string[] {
  const marcas: string[] = [];
  if (fila.sinReporte) marcas.push("sin Reporte por plantilla");
  if (fila.cartelPresupuesto) marcas.push(fila.cartelPresupuesto);
  if (fila.incluyePartesManualesOParciales) marcas.push("incluye partes manuales o parciales");
  if (fila.realManualPendiente) marcas.push("Real manual pendiente");
  return marcas;
}

function NombreDeEmpresa({ nombre, moneda, href }: { nombre: string; moneda?: string; href?: string }) {
  const simbolo = moneda && moneda !== "ARS" ? ` (${simboloMoneda(moneda)})` : "";
  return (
    <th scope="row" className="px-3 py-3 text-sm font-medium text-ink">
      {href ? (
        <Link href={href} className={`underline-offset-2 hover:text-marino-dark hover:underline ${FOCO}`}>
          {nombre}
          <span className="sr-only"> — ver el Reporte</span>
        </Link>
      ) : (
        nombre
      )}
      {simbolo && <span className="font-normal text-ink-secondary">{simbolo}</span>}
    </th>
  );
}

export function FilaDeAvanceVista({ fila, hrefReporte, extra }: { fila: FilaDeAvance; hrefReporte: string; extra?: ReactNode }) {
  const e = fila.egresosOperativos;
  const i = fila.ingresos;
  const m = fila.moneda;
  return (
    <tr className="border-b border-line-hairline last:border-b-0">
      <NombreDeEmpresa nombre={fila.nombre} moneda={fila.moneda} href={hrefReporte} />
      <td className={`${TD_NUM} border-l border-line-hairline`}>{importeDeAvance(e?.presupuestado ?? null, m)}</td>
      <td className={TD_NUM}>{importeDeAvance(e?.real ?? null, m)}</td>
      <td className={TD_NUM}>{porcentajeDeAvance(e?.avance ?? null)}</td>
      <td className={`${TD_NUM} text-ink-secondary`} title={fila.ritmo ? `${fila.ritmo.diasConDatos} de ${fila.ritmo.diasDelMes} días con datos` : undefined}>
        {fila.ritmo ? porcentajeDeAvance(fila.ritmo.porcentaje) : "—"}
      </td>
      <td className={`${TD_NUM} border-l border-line-hairline`}>{importeDeAvance(i?.presupuestado ?? null, m)}</td>
      <td className={TD_NUM}>{importeDeAvance(i?.real ?? null, m)}</td>
      <td className={TD_NUM}>{porcentajeDeAvance(i?.avance ?? null)}</td>
      <td className="border-l border-line-hairline px-3 py-3 text-sm">
        <div className="flex flex-wrap gap-1">
          {marcasDeFila(fila).map((t) => (
            <Marca key={t}>{t}</Marca>
          ))}
        </div>
        {extra}
      </td>
    </tr>
  );
}

// Mientras la empresa carga: el nombre (es del propio alcance) y un aviso.
export function FilaCargandoVista({ nombre }: { nombre: string }) {
  return (
    <tr className="border-b border-line-hairline last:border-b-0" aria-busy="true">
      <NombreDeEmpresa nombre={nombre} />
      <td colSpan={8} className="px-3 py-3 text-sm text-ink-muted">
        <span aria-hidden="true" className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-marino align-[-2px]" />
        Cargando…
      </td>
    </tr>
  );
}

export function FilaConErrorVista({ nombre }: { nombre: string }) {
  return (
    <tr className="border-b border-line-hairline last:border-b-0">
      <NombreDeEmpresa nombre={nombre} />
      <td colSpan={8} className="px-3 py-3 text-sm text-negative">
        No se pudo cargar esta empresa. Probá recargar la página.
      </td>
    </tr>
  );
}

// Total de egresos operativos por moneda. Los ingresos NO se suman: el total solo cubre egresos operativos.
export function PieDeTotalesVista({ totales }: { totales: readonly TotalDeAvance[] }) {
  return (
    <>
      {totales.map((t) => (
        <tr key={t.moneda} className="border-t border-line-strong bg-paper-cool">
          <th scope="row" className="px-3 py-3 text-sm font-semibold text-ink">
            {t.rotulo}
            <span className="font-normal text-ink-secondary"> · egresos operativos ({simboloMoneda(t.moneda)})</span>
          </th>
          <td className={`${TD_NUM} border-l border-line font-semibold`}>{importeDeAvance(t.presupuestado, t.moneda)}</td>
          <td className={`${TD_NUM} font-semibold`}>{importeDeAvance(t.real, t.moneda)}</td>
          <td className={`${TD_NUM} font-semibold`}>{porcentajeDeAvance(t.avance)}</td>
          <td className={TD_NUM} />
          <td colSpan={4} className="border-l border-line px-3 py-3 text-xs text-ink-muted">
            {t.presupuestado === null ? "Falta el presupuestado o el real de alguna empresa: no se muestra una suma parcial." : "Los ingresos no se suman."}
          </td>
        </tr>
      ))}
    </>
  );
}

export function PieNoDisponibleVista() {
  return (
    <tr className="border-t border-line-strong bg-paper-cool">
      <td colSpan={9} className="px-3 py-3 text-sm text-ink-muted">
        El total no está disponible: falta cargar alguna empresa.
      </td>
    </tr>
  );
}

// ---- Calidad del dato ---------------------------------------------------------------------------------------------

export function CalidadVista({ calidad }: { calidad: CalidadDelMes }) {
  const { semanas, movimientosAfuera } = calidad.semanasProvisorias;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Dato titulo="Datos al" valor={calidad.datosAl ?? "—"} detalle="último movimiento en lotes cerrados" />
        <Dato titulo="En lotes cerrados" valor={cantidad(calidad.movimientosEnLotesCerrados)} detalle="movimientos que cuentan en el Reporte" />
        <Dato
          titulo="En lotes abiertos"
          valor={cantidad(calidad.movimientosEnLotesAbiertos)}
          detalle={semanas > 0 ? `${semanas === 1 ? "1 semana provisoria" : `${semanas} semanas provisorias`}, ${cantidad(movimientosAfuera)} afuera del Reporte` : "ninguna semana provisoria"}
        />
      </dl>
      <div className="overflow-x-auto rounded-lg border border-line bg-paper-raised">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Indicadores de calidad del dato del mes</caption>
          <thead>
            <tr className="border-b border-line bg-paper-cool">
              <th scope="col" className={TH}>Indicador</th>
              <th scope="col" className={`${TH} text-right`}>Movimientos</th>
              <th scope="col" className={`${TH} text-right`}>En lotes abiertos</th>
            </tr>
          </thead>
          <tbody>
            {calidad.indicadores.map((i) => (
              <tr key={i.clave} className="border-b border-line-hairline last:border-b-0">
                <th scope="row" className="px-3 py-3 text-sm font-normal text-ink">{i.rotulo}</th>
                <td className={TD_NUM}>{cantidad(i.total)}</td>
                <td className={`${TD_NUM} text-ink-secondary`}>{cantidad(i.enLotesAbiertos)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-3 py-3 text-sm font-normal text-ink">
                Clasificaciones sin fila propia en el Reporte
                <span className="block text-xs text-ink-muted">movimientos en pesos que no suman a ninguna línea</span>
              </th>
              <td className={TD_NUM}>
                {cantidad(calidad.clasificacionesSinFila.movimientos)}
                <span className="text-ink-muted"> de {cantidad(calidad.clasificacionesSinFila.deMovimientos)}</span>
              </td>
              <td className={TD_NUM} />
            </tr>
          </tbody>
        </table>
      </div>
      {calidad.sinAsignar && <SinAsignarVista sinAsignar={calidad.sinAsignar} />}
    </div>
  );
}

function Dato({ titulo, valor, detalle }: { titulo: string; valor: string; detalle: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-raised px-4 py-3">
      <dt className="text-xs font-medium tracking-wide text-ink-secondary uppercase">{titulo}</dt>
      <dd className="tabular mt-1 text-2xl font-semibold text-ink">{valor}</dd>
      <dd className="mt-1 text-xs text-ink-muted">{detalle}</dd>
    </div>
  );
}

// ---- Solo administración ------------------------------------------------------------------------------------------

export function SinAsignarVista({ sinAsignar }: { sinAsignar: NonNullable<CalidadDelMes["sinAsignar"]> }) {
  return (
    <section aria-labelledby="sin-asignar" className="rounded-lg border border-line-strong bg-paper-raised px-4 py-3">
      <h3 id="sin-asignar" className="text-sm font-semibold text-ink">{sinAsignar.rotulo}</h3>
      <p className="mt-1 text-xs text-ink-muted">Movimientos sin unidad de negocio. No están en ninguna empresa.</p>
      {sinAsignar.porMoneda.length === 0 ? (
        <p className="mt-2 text-sm text-ink-secondary">No hay movimientos sin asignar en el mes.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-ink">
          {sinAsignar.porMoneda.map((f) => (
            <li key={f.moneda} className="tabular">
              {simboloMoneda(f.moneda)}: {cantidad(f.movimientos)} {f.movimientos === 1 ? "movimiento" : "movimientos"} ({cantidad(f.enLotesAbiertos)} en lotes abiertos) · ingresos {importeDeAvance(f.ingresosCentavos, f.moneda)} · egresos {importeDeAvance(f.egresosCentavos, f.moneda)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ControlDeDepositosVista({ control }: { control: ControlDepositosDeCheques | null }) {
  return (
    <section aria-labelledby="control-depositos" className="rounded-lg border border-line-strong bg-paper-raised px-4 py-3">
      <h3 id="control-depositos" className="text-sm font-semibold text-ink">{control ? control.rotulo : "Depósitos de cheques pendientes de registro"}</h3>
      {control === null ? (
        <p className="mt-2 text-sm text-ink-secondary">No hay movimientos en el mes.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-muted">Semana del {ddMm(control.lunes)} al {ddMm(control.domingo)}. Control aparte: no se suma a ningún total.</p>
          {control.porMoneda.length === 0 ? (
            <p className="mt-2 text-sm text-ink-secondary">No hay depósitos en la semana.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-ink">
              {control.porMoneda.map((f) => (
                <li key={f.moneda} className="tabular">
                  {simboloMoneda(f.moneda)}: neto {importeDeAvance(f.netoCentavos, f.moneda)} · {cantidad(f.movimientos)} {f.movimientos === 1 ? "movimiento" : "movimientos"} ({cantidad(f.enLotesAbiertos)} en lotes abiertos)
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function ErrorDeSeccionVista({ texto }: { texto: string }) {
  return <p className="rounded-md border border-line bg-paper-raised px-3 py-3 text-sm text-negative">{texto}</p>;
}

export function SeccionCargandoVista({ texto }: { texto: string }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-line bg-paper-raised px-3 py-3 text-sm text-ink-muted" aria-busy="true">
      <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-marino" />
      {texto}
    </p>
  );
}
