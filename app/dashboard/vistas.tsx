import Link from "next/link";
import type { ReactNode } from "react";
import type { CalidadDelMes } from "@/lib/dashboard/calidad";
import type { CeldaDeAvance, FilaDeAvance, RitmoDelMes, TotalDeAvance } from "@/lib/dashboard/avance";
import type { ControlDepositosDeCheques } from "@/lib/dashboard/controles";
import { opcionesDeMes, type EncabezadoDeAvance } from "@/lib/dashboard/encabezado";
import { cantidad, ddMm, importeDeAvance, importeEnMillones, porcentajeDeAvance } from "@/lib/dashboard/formato";
import { geometriaDeBarra, indicadoresConValor } from "@/lib/dashboard/presentacion";
import { simboloMoneda } from "@/lib/moneda";

// Vistas del dashboard: SOLO presentación, sin hooks ni acceso a datos. Reciben ya armado lo que calcularon los módulos de
// lib/dashboard, así se pueden probar renderizándolas. Los bloques «solo ADMIN» (Sin asignar y el control de depósitos) viven
// en sus propias vistas y SOLO existen si quien arma la pantalla se las da: sin dato no hay ni título. Estilos: .dash-* en
// app/globals.css.

const NOMBRE_DE_MONEDA: Readonly<Record<string, string>> = { USD: "dólares", PEN: "soles", UYU: "pesos uruguayos" };

// ---- Encabezado ---------------------------------------------------------------------------------------------------

export function TituloDeAvance({ encabezado }: { encabezado: EncabezadoDeAvance }) {
  const { semanas, movimientosAfuera } = encabezado.semanasProvisorias;
  return (
    <>
      <h1 id="resumen" className="font-serif text-[1.75rem] leading-tight font-semibold tracking-tight text-marino-dark sm:text-4xl">
        Avance de {encabezado.nombreDelMes}
      </h1>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-ink-secondary">
        {encabezado.datosAl && (
          <span>
            datos al <strong className="dash-num font-medium text-ink">{encabezado.datosAl}</strong>
          </span>
        )}
        {encabezado.ritmo && (
          <span title={`${encabezado.ritmo.diasConDatos} de ${encabezado.ritmo.diasDelMes} días con datos`}>
            <strong className="dash-num font-medium text-ink">{porcentajeDeAvance(encabezado.ritmo.porcentaje).replace("%", " %")}</strong> del mes
          </span>
        )}
      </p>
      {semanas > 0 && (
        <p role="note" className="mt-3 max-w-prose border-l-4 border-terracota bg-terracota-tint px-3 py-2 text-sm text-ink">
          {semanas === 1 ? "Hay 1 semana" : `Hay ${semanas} semanas`} con movimientos todavía en lotes abiertos:{" "}
          {cantidad(movimientosAfuera)} {movimientosAfuera === 1 ? "movimiento queda afuera" : "movimientos quedan afuera"} de estos números.
        </p>
      )}
    </>
  );
}

export function SelectorDeMes({ periodo }: { periodo: string }) {
  return (
    <nav aria-label="Mes" className="dash-seg dash-noprint">
      {opcionesDeMes(periodo).map((o) => (
        <Link key={o.periodo} href={`/dashboard?periodo=${o.periodo}`} aria-current={o.actual ? "page" : undefined}>
          {o.nombre}
        </Link>
      ))}
    </nav>
  );
}

// ---- Barra de avance con la marca del ritmo del mes ----------------------------------------------------------------

// La barra se llena con el avance; la marca fina muestra el ritmo del mes (días con datos / días del mes). Es solo una
// comparación visual: sin colores de alerta ni umbrales. El avance y el ritmo van también como texto (aria-valuetext).
export function BarraDeAvance({
  avance,
  ritmo,
  tono,
  etiqueta,
  grande,
}: {
  avance: number | null;
  ritmo: number | null;
  tono: "egresos" | "ingresos";
  etiqueta: string;
  grande?: boolean;
}) {
  const g = geometriaDeBarra(avance, ritmo);
  const texto = g.sinDato
    ? `${etiqueta}: sin dato`
    : `${etiqueta}: avance ${porcentajeDeAvance(avance)}${g.excede ? " (supera el presupuesto)" : ""}${g.marca !== null ? `, ritmo del mes ${porcentajeDeAvance(ritmo)}` : ""}`;
  return (
    <div
      role="progressbar"
      aria-label={etiqueta}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={g.sinDato ? undefined : g.relleno}
      aria-valuetext={texto}
      className={`dash-bar dash-bar--${tono}${grande ? " dash-bar--grande" : ""}${g.excede ? " dash-bar--excede" : ""}`}
    >
      {!g.sinDato && <div className="dash-bar__relleno" style={{ width: `${g.relleno}%` }} />}
      {g.marca !== null && <div className="dash-bar__marca" style={{ left: `${g.marca}%` }} />}
    </div>
  );
}

function LeyendaDeMarca({ ritmo }: { ritmo: RitmoDelMes }) {
  return (
    <p className="text-xs text-ink-secondary">
      <span className="dash-leyenda-marca" />
      Marca: ritmo del mes <strong className="dash-num font-medium text-ink">{porcentajeDeAvance(ritmo.porcentaje)}</strong> · {ritmo.diasConDatos} de {ritmo.diasDelMes} días con datos
    </p>
  );
}

// ---- Resumen del mes (total de egresos operativos por moneda) ------------------------------------------------------

// Total de egresos operativos por moneda. Los ingresos NO se suman: el total solo cubre egresos operativos. Sin totales (una sola
// empresa por moneda) no hay bloque.
export function PieDeTotalesVista({ totales, ritmo }: { totales: readonly TotalDeAvance[]; ritmo?: RitmoDelMes | null }) {
  if (totales.length === 0) return null;
  const [principal, ...otras] = totales;
  return (
    <div className="mt-7 border-t border-line pt-6">
      <p className="text-sm text-ink-secondary">
        {principal.rotulo} · egresos operativos ({simboloMoneda(principal.moneda)})
      </p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="dash-num font-serif text-6xl leading-none font-semibold text-marino-dark">{porcentajeDeAvance(principal.avance)}</p>
        <p className="dash-num text-lg text-ink">
          <span className="font-semibold" title={importeDeAvance(principal.real, principal.moneda)}>{importeEnMillones(principal.real, principal.moneda)}</span>{" "}
          <span className="text-ink-secondary">de</span>{" "}
          <span title={importeDeAvance(principal.presupuestado, principal.moneda)}>{importeEnMillones(principal.presupuestado, principal.moneda)}</span>
        </p>
      </div>
      <div className="mt-5">
        <BarraDeAvance avance={principal.avance} ritmo={ritmo?.porcentaje ?? null} tono="egresos" etiqueta="Avance total de egresos operativos" grande />
      </div>
      <div className="mt-3 flex flex-col gap-1">
        {ritmo && <LeyendaDeMarca ritmo={ritmo} />}
        <p className="text-xs text-ink-muted">
          {principal.presupuestado === null ? "Falta el presupuestado o el real de alguna empresa: no se muestra una suma parcial." : "Los ingresos no se suman."}
        </p>
      </div>
      {otras.map((t) => (
        <div key={t.moneda} className="mt-5 border-t border-line-hairline pt-4">
          <p className="text-sm text-ink-secondary">
            {t.rotulo} · egresos operativos ({simboloMoneda(t.moneda)})
          </p>
          <p className="dash-num mt-1 flex flex-wrap items-baseline gap-x-4 text-ink">
            <span className="font-serif text-3xl font-semibold text-marino-dark">{porcentajeDeAvance(t.avance)}</span>
            <span title={importeDeAvance(t.real, t.moneda)}>{importeEnMillones(t.real, t.moneda)}</span>
            <span className="text-ink-secondary">de</span>
            <span title={importeDeAvance(t.presupuestado, t.moneda)}>{importeEnMillones(t.presupuestado, t.moneda)}</span>
          </p>
          <div className="mt-2">
            <BarraDeAvance avance={t.avance} ritmo={ritmo?.porcentaje ?? null} tono="egresos" etiqueta={`Avance total de egresos operativos (${simboloMoneda(t.moneda)})`} />
          </div>
          {t.presupuestado === null && <p className="mt-1 text-xs text-ink-muted">Falta el presupuestado o el real de alguna empresa: no se muestra una suma parcial.</p>}
        </div>
      ))}
    </div>
  );
}

export function PieNoDisponibleVista() {
  return <p className="mt-7 border-t border-line pt-5 text-sm text-ink-muted">El total no está disponible: falta cargar alguna empresa.</p>;
}

// Mientras se esperan todas las empresas: el espacio del total, sin animación.
export function TotalesCargandoVista() {
  return (
    <div className="mt-7 border-t border-line pt-6" aria-busy="true">
      <span className="dash-esqueleto h-4 w-64 max-w-full" />
      <span className="dash-esqueleto mt-4 h-14 w-48" />
      <span className="dash-esqueleto mt-5 h-3.5 w-full" />
      <p className="mt-3 text-xs text-ink-muted">Calculando el total a medida que llegan las empresas…</p>
    </div>
  );
}

// ---- Avance por empresa --------------------------------------------------------------------------------------------

export function ListaDeEmpresas({ children }: { children: ReactNode }) {
  return <div className="dash-grilla">{children}</div>;
}

export function marcasDeFila(fila: FilaDeAvance): string[] {
  const marcas: string[] = [];
  if (fila.sinReporte) marcas.push("sin Reporte por plantilla");
  if (fila.cartelPresupuesto) marcas.push(fila.cartelPresupuesto);
  if (fila.incluyePartesManualesOParciales) marcas.push("incluye partes manuales o parciales");
  if (fila.realManualPendiente) marcas.push("Real manual pendiente");
  return marcas;
}

function Metrica({ titulo, celda, moneda, ritmo, tono }: { titulo: string; celda: CeldaDeAvance | null; moneda: string; ritmo: RitmoDelMes | null; tono: "egresos" | "ingresos" }) {
  const real = celda?.real ?? null;
  const presupuestado = celda?.presupuestado ?? null;
  const avance = celda?.avance ?? null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-medium text-ink-secondary">{titulo}</h4>
        <p className="dash-num text-base font-semibold text-marino-dark">{porcentajeDeAvance(avance)}</p>
      </div>
      <p className="dash-num mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs text-ink-secondary">Real</span>{" "}
        <span className="font-serif text-[1.75rem] leading-tight font-semibold text-ink" title={importeDeAvance(real, moneda)}>
          {importeEnMillones(real, moneda)}
        </span>{" "}
        <span className="text-sm text-ink-secondary">
          de <span title={importeDeAvance(presupuestado, moneda)}>{importeEnMillones(presupuestado, moneda)}</span> presupuestado
        </span>
      </p>
      <div className="mt-2.5">
        <BarraDeAvance avance={avance} ritmo={ritmo?.porcentaje ?? null} tono={tono} etiqueta={`${titulo} de ${moneda === "ARS" ? "la empresa" : `la empresa (${NOMBRE_DE_MONEDA[moneda] ?? moneda})`}`} />
      </div>
    </div>
  );
}

export function FilaDeAvanceVista({ fila, hrefReporte }: { fila: FilaDeAvance; hrefReporte: string }) {
  const marcas = marcasDeFila(fila);
  const enOtraMoneda = fila.moneda !== "ARS";
  return (
    <article className="dash-card">
      <header className="flex items-start justify-between gap-3">
        <h3 className="font-serif text-xl leading-snug font-semibold text-marino-dark">
          <Link href={hrefReporte} className="underline-offset-4 hover:underline">
            {fila.nombre}
            <span className="sr-only"> — ver el Reporte</span>
            <span aria-hidden="true" className="ml-1 text-base font-normal text-marino">→</span>
          </Link>
        </h3>
        {enOtraMoneda && (
          <span className="dash-etiqueta shrink-0" title={`Importes en ${NOMBRE_DE_MONEDA[fila.moneda] ?? fila.moneda}`}>
            {simboloMoneda(fila.moneda)} · {NOMBRE_DE_MONEDA[fila.moneda] ?? fila.moneda}
          </span>
        )}
      </header>
      {fila.sinReporte ? (
        <p className="mt-4 text-sm text-ink-secondary">Esta empresa no tiene Reporte por plantilla: no hay presupuesto ni avance para mostrar.</p>
      ) : (
        <div className="mt-4 space-y-5">
          <Metrica titulo="Egresos operativos" celda={fila.egresosOperativos} moneda={fila.moneda} ritmo={fila.ritmo} tono="egresos" />
          <Metrica titulo="Ingresos" celda={fila.ingresos} moneda={fila.moneda} ritmo={fila.ritmo} tono="ingresos" />
        </div>
      )}
      {(fila.ritmo || marcas.length > 0) && (
        <footer className="mt-4 flex flex-col gap-2.5 border-t border-line-hairline pt-3">
          {fila.ritmo && <LeyendaDeMarca ritmo={fila.ritmo} />}
          {marcas.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {marcas.map((t) => (
                <li key={t} className="dash-etiqueta">{t}</li>
              ))}
            </ul>
          )}
        </footer>
      )}
    </article>
  );
}

// Mientras la empresa carga: su nombre (es del propio alcance) y bloques quietos.
export function FilaCargandoVista({ nombre }: { nombre: string }) {
  return (
    <article className="dash-card" aria-busy="true">
      <h3 className="font-serif text-xl leading-snug font-semibold text-marino-dark">{nombre}</h3>
      <div className="mt-4 space-y-5">
        {[0, 1].map((i) => (
          <div key={i}>
            <span className="dash-esqueleto h-3.5 w-32" />
            <span className="dash-esqueleto mt-2 h-8 w-44 max-w-full" />
            <span className="dash-esqueleto mt-3 h-2 w-full" />
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-muted">Cargando…</p>
    </article>
  );
}

export function FilaConErrorVista({ nombre }: { nombre: string }) {
  return (
    <article className="dash-card dash-card--error">
      <h3 className="font-serif text-xl leading-snug font-semibold text-marino-dark">{nombre}</h3>
      <p className="mt-3 text-sm text-negative">No se pudo cargar esta empresa. Probá recargar la página.</p>
    </article>
  );
}

// ---- Calidad del dato (colapsable; destaca solo lo distinto de cero) ------------------------------------------------

export function CalidadVista({ calidad }: { calidad: CalidadDelMes }) {
  const { semanas, movimientosAfuera } = calidad.semanasProvisorias;
  const conValor = indicadoresConValor(calidad.indicadores);
  const sinFila = calidad.clasificacionesSinFila.movimientos;
  const observaciones = conValor.length + (sinFila > 0 ? 1 : 0);
  return (
    <details className="dash-calidad rounded-lg border border-line bg-paper-raised" open>
      <summary className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3.5 sm:px-5">
        <span className="flex items-center gap-2.5">
          <svg className="dash-calidad__flecha h-4 w-4 shrink-0 text-marino" viewBox="0 0 16 16" role="presentation" focusable="false">
            <path d="M5.5 3.5 10.5 8l-5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 id="calidad" className="font-serif text-2xl font-semibold tracking-tight text-marino-dark">Calidad del dato</h2>
        </span>
        <span className="text-sm text-ink-secondary">
          {observaciones === 0 ? "Sin observaciones en el mes" : `${observaciones} ${observaciones === 1 ? "indicador con movimientos" : "indicadores con movimientos"}`}
        </span>
      </summary>
      <div className="space-y-5 border-t border-line px-4 py-4 sm:px-5 sm:py-5">
        <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
          <div>
            <dt className="text-ink-secondary">Datos al</dt>
            <dd className="dash-num text-xl font-semibold text-ink">{calidad.datosAl ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-secondary">En lotes cerrados</dt>
            <dd className="dash-num text-xl font-semibold text-ink">{cantidad(calidad.movimientosEnLotesCerrados)}</dd>
          </div>
          <div>
            <dt className="text-ink-secondary">En lotes abiertos</dt>
            <dd className="dash-num text-xl font-semibold text-ink">{cantidad(calidad.movimientosEnLotesAbiertos)}</dd>
            {semanas > 0 && (
              <dd className="text-xs text-ink-muted">
                {semanas === 1 ? "1 semana provisoria" : `${semanas} semanas provisorias`} · {cantidad(movimientosAfuera)} afuera del Reporte
              </dd>
            )}
          </div>
        </dl>
        <ul className="divide-y divide-line-hairline text-sm">
          {calidad.indicadores.map((i) => (
            <li key={i.clave} className={`flex items-baseline justify-between gap-4 py-2.5 ${i.total > 0 ? "font-medium text-ink" : "text-ink-muted"}`}>
              <span>{i.rotulo}</span>
              <span className="dash-num shrink-0 text-right">
                {cantidad(i.total)}
                {i.total > 0 && <span className="ml-2 text-xs font-normal text-ink-secondary">({cantidad(i.enLotesAbiertos)} en lotes abiertos)</span>}
              </span>
            </li>
          ))}
          <li className={`flex items-baseline justify-between gap-4 py-2.5 ${sinFila > 0 ? "font-medium text-ink" : "text-ink-muted"}`}>
            <span>
              Clasificaciones sin fila propia en el Reporte
              <span className="block text-xs font-normal text-ink-muted">movimientos en pesos que no suman a ninguna línea</span>
            </span>
            <span className="dash-num shrink-0 text-right">
              {cantidad(sinFila)}
              <span className="ml-1 text-xs font-normal text-ink-muted">de {cantidad(calidad.clasificacionesSinFila.deMovimientos)}</span>
            </span>
          </li>
        </ul>
      </div>
    </details>
  );
}

// ---- Solo administración (zona aparte) -----------------------------------------------------------------------------

// Contenedor de la zona de administración. Solo lo monta quien arma la pantalla cuando el usuario puede verla.
export function ZonaAdminVista({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="solo-administracion" className="dash-admin">
      <h2 id="solo-administracion" className="font-serif text-2xl font-semibold tracking-tight text-marino-dark">Solo administración</h2>
      <p className="mt-1 text-sm text-ink-secondary">Controles que ve únicamente el administrador. No se suman a ningún total.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

export function SinAsignarVista({ sinAsignar }: { sinAsignar: NonNullable<CalidadDelMes["sinAsignar"]> }) {
  return (
    <section aria-labelledby="sin-asignar" className="dash-admin__item">
      <h3 id="sin-asignar" className="text-base font-semibold text-marino-dark">{sinAsignar.rotulo}</h3>
      <p className="mt-1 text-xs text-ink-muted">Movimientos sin unidad de negocio. No están en ninguna empresa.</p>
      {sinAsignar.porMoneda.length === 0 ? (
        <p className="mt-2 text-sm text-ink-secondary">No hay movimientos sin asignar en el mes.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm text-ink">
          {sinAsignar.porMoneda.map((f) => (
            <li key={f.moneda} className="dash-num">
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
    <section aria-labelledby="control-depositos" className="dash-admin__item">
      <h3 id="control-depositos" className="text-base font-semibold text-marino-dark">{control ? control.rotulo : "Depósitos de cheques pendientes de registro"}</h3>
      {control === null ? (
        <p className="mt-2 text-sm text-ink-secondary">No hay movimientos en el mes.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-muted">Semana del {ddMm(control.lunes)} al {ddMm(control.domingo)}. Control aparte: no se suma a ningún total.</p>
          {control.porMoneda.length === 0 ? (
            <p className="mt-2 text-sm text-ink-secondary">No hay depósitos en la semana.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm text-ink">
              {control.porMoneda.map((f) => (
                <li key={f.moneda} className="dash-num">
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

export function SeccionCargandoVista({ texto, titulo }: { texto: string; titulo?: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-raised px-4 py-4 sm:px-5" aria-busy="true">
      {titulo && <h2 id="calidad" className="font-serif text-2xl font-semibold tracking-tight text-marino-dark">{titulo}</h2>}
      <p className={`text-sm text-ink-muted ${titulo ? "mt-2" : ""}`}>{texto}</p>
    </div>
  );
}
