import Link from "next/link";
import type { ReactNode } from "react";
import type { CalidadDelMes } from "@/lib/dashboard/calidad";
import type { CeldaDeAvance, FilaDeAvance, RitmoDelMes, TotalDeAvance } from "@/lib/dashboard/avance";
import type { ControlDepositosDeCheques } from "@/lib/dashboard/controles";
import { opcionesDeMes, type EncabezadoDeAvance } from "@/lib/dashboard/encabezado";
import { cantidad, ddMm, importeDeAvance, importeEnMillones, porcentajeDeAvance } from "@/lib/dashboard/formato";
import { etiquetasDeFila, geometriaDeBarra, indicadoresConValor, mostrarRitmoPropio } from "@/lib/dashboard/presentacion";
import { iniciales } from "@/lib/iniciales";
import { simboloMoneda } from "@/lib/moneda";

// Vistas del dashboard: SOLO presentación, sin hooks ni acceso a datos. Reciben ya armado lo que calcularon los módulos de
// lib/dashboard, así se pueden probar renderizándolas. Los bloques «solo ADMIN» (Sin asignar y el control de depósitos) viven
// en sus propias vistas y SOLO existen si quien arma la pantalla se las da: sin dato no hay ni título. Estilos: .dash-* en
// app/globals.css. Color con significado constante: azul = egresos operativos, teal = ingresos, dorado = marca del ritmo; es
// identidad y orden, nunca un veredicto (no hay semáforo): cada dato también va escrito.

const NOMBRE_DE_MONEDA: Readonly<Record<string, string>> = { USD: "dólares", PEN: "soles", UYU: "pesos uruguayos" };

// ---- Resumen (sobre azul marino profundo) ---------------------------------------------------------------------------

export function TituloDeAvance({ encabezado }: { encabezado: EncabezadoDeAvance }) {
  const { semanas, movimientosAfuera } = encabezado.semanasProvisorias;
  return (
    <>
      <h1 id="resumen" className="font-serif text-[1.75rem] leading-tight font-semibold tracking-tight text-white sm:text-4xl">
        Avance de {encabezado.nombreDelMes}
      </h1>
      <p className="mt-3 flex flex-wrap items-baseline gap-2">
        {encabezado.datosAl && (
          <span className="dash-hero__chip">
            datos al <strong className="dash-num font-semibold text-white">{encabezado.datosAl}</strong>
          </span>
        )}
        {encabezado.ritmo && (
          <span className="dash-hero__chip" title={`${encabezado.ritmo.diasConDatos} de ${encabezado.ritmo.diasDelMes} días con datos`}>
            <strong className="dash-num font-semibold text-white">{porcentajeDeAvance(encabezado.ritmo.porcentaje).replace("%", " %")}</strong> del mes
          </span>
        )}
      </p>
      {semanas > 0 && (
        <p role="note" className="mt-4 max-w-prose rounded-lg border-l-4 border-[#e0a82e] bg-[#fdf0d3] px-3 py-2 text-sm text-[#7a4b00]">
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

function LeyendaDeMarca({ ritmo, sobreOscuro }: { ritmo: RitmoDelMes; sobreOscuro?: boolean }) {
  return (
    <p className={`text-sm ${sobreOscuro ? "text-white/85" : "text-ink-secondary"}`}>
      <span className="dash-leyenda-marca" />
      Marca: ritmo del mes <strong className={`dash-num font-semibold ${sobreOscuro ? "text-white" : "text-ink"}`}>{porcentajeDeAvance(ritmo.porcentaje)}</strong> · {ritmo.diasConDatos} de {ritmo.diasDelMes} días con datos
    </p>
  );
}

const NOTA_SUMA_PARCIAL = "Falta el presupuestado o el real de alguna empresa: no se muestra una suma parcial.";

// Total de egresos operativos por moneda. Los ingresos NO se suman: el total solo cubre egresos operativos. Una moneda con
// datos completos va en grande, con su barra; sin datos ("— de —") pasa a una línea compacta, sin barra. La leyenda de la marca
// del ritmo se muestra UNA vez, acá. Sin totales (una sola empresa por moneda) solo queda la leyenda.
export function PieDeTotalesVista({ totales, ritmo }: { totales: readonly TotalDeAvance[]; ritmo?: RitmoDelMes | null }) {
  if (totales.length === 0) {
    return ritmo ? (
      <div className="mt-6 border-t border-white/15 pt-4">
        <LeyendaDeMarca ritmo={ritmo} sobreOscuro />
      </div>
    ) : null;
  }
  const [principal, ...otras] = totales;
  const completo = principal.presupuestado !== null;
  return (
    <div className="mt-8 border-t border-white/15 pt-7">
      <p className="text-base text-white/85">
        {principal.rotulo} · egresos operativos ({simboloMoneda(principal.moneda)})
      </p>
      {completo ? (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-2">
            <p className="dash-num font-serif text-6xl leading-none font-semibold text-white sm:text-[6.5rem]">{porcentajeDeAvance(principal.avance)}</p>
            <p className="dash-num pb-1 text-xl text-white">
              <span className="font-semibold" title={importeDeAvance(principal.real, principal.moneda)}>{importeEnMillones(principal.real, principal.moneda)}</span>{" "}
              <span className="text-white/70">de</span>{" "}
              <span title={importeDeAvance(principal.presupuestado, principal.moneda)}>{importeEnMillones(principal.presupuestado, principal.moneda)}</span>
            </p>
          </div>
          <div className="mt-6">
            <BarraDeAvance avance={principal.avance} ritmo={ritmo?.porcentaje ?? null} tono="egresos" etiqueta="Avance total de egresos operativos" grande />
          </div>
          <div className="mt-4 flex flex-col gap-1">
            {ritmo && <LeyendaDeMarca ritmo={ritmo} sobreOscuro />}
            <p className="text-sm text-white/75">Los ingresos no se suman.</p>
          </div>
        </>
      ) : (
        <>
          <p className="dash-num mt-2 flex flex-wrap items-baseline gap-x-3 text-xl text-white">
            <span>{porcentajeDeAvance(principal.avance)}</span>
            <span title={importeDeAvance(principal.real, principal.moneda)}>{importeEnMillones(principal.real, principal.moneda)}</span>
            <span className="text-white/70">de</span>
            <span title={importeDeAvance(principal.presupuestado, principal.moneda)}>{importeEnMillones(principal.presupuestado, principal.moneda)}</span>
          </p>
          <p className="mt-1 text-sm text-white/75">{NOTA_SUMA_PARCIAL}</p>
          {ritmo && (
            <div className="mt-3">
              <LeyendaDeMarca ritmo={ritmo} sobreOscuro />
            </div>
          )}
        </>
      )}
      {otras.map((t) => (
        <div key={t.moneda} className="mt-6 border-t border-white/10 pt-5">
          <p className="text-base text-white/85">
            {t.rotulo} · egresos operativos ({simboloMoneda(t.moneda)})
          </p>
          <p className="dash-num mt-1 flex flex-wrap items-baseline gap-x-3 text-xl text-white">
            <span className="font-serif text-3xl font-semibold">{porcentajeDeAvance(t.avance)}</span>
            <span title={importeDeAvance(t.real, t.moneda)}>{importeEnMillones(t.real, t.moneda)}</span>
            <span className="text-white/70">de</span>
            <span title={importeDeAvance(t.presupuestado, t.moneda)}>{importeEnMillones(t.presupuestado, t.moneda)}</span>
          </p>
          {t.presupuestado === null ? (
            <p className="mt-1 text-sm text-white/75">{NOTA_SUMA_PARCIAL}</p>
          ) : (
            <div className="mt-3">
              <BarraDeAvance avance={t.avance} ritmo={ritmo?.porcentaje ?? null} tono="egresos" etiqueta={`Avance total de egresos operativos (${simboloMoneda(t.moneda)})`} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function PieNoDisponibleVista() {
  return <p className="mt-8 border-t border-white/15 pt-5 text-sm text-white/80">El total no está disponible: falta cargar alguna empresa.</p>;
}

// Mientras se esperan todas las empresas: el espacio del total, sin animación.
export function TotalesCargandoVista() {
  return (
    <div className="mt-8 border-t border-white/15 pt-7" aria-busy="true">
      <span className="dash-esqueleto h-4 w-64 max-w-full" />
      <span className="dash-esqueleto mt-4 h-20 w-56 max-w-full" />
      <span className="dash-esqueleto mt-6 h-5 w-full" />
      <p className="mt-3 text-sm text-white/75">Calculando el total a medida que llegan las empresas…</p>
    </div>
  );
}

// ---- Avance por empresa --------------------------------------------------------------------------------------------

export function ListaDeEmpresas({ children }: { children: ReactNode }) {
  return <div className="dash-grilla">{children}</div>;
}

export function marcasDeFila(fila: FilaDeAvance): string[] {
  return etiquetasDeFila(fila).map((e) => e.texto);
}

function Metrica({ titulo, celda, moneda, ritmo, tono }: { titulo: string; celda: CeldaDeAvance | null; moneda: string; ritmo: RitmoDelMes | null; tono: "egresos" | "ingresos" }) {
  const real = celda?.real ?? null;
  const presupuestado = celda?.presupuestado ?? null;
  const avance = celda?.avance ?? null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="flex items-center text-sm font-medium text-ink-secondary">
          <span className={`dash-muestra${tono === "ingresos" ? " dash-muestra--ingresos" : ""}`} role="presentation" />
          {titulo}
        </h4>
        <p className={`dash-num text-xl font-semibold dash-pct--${tono}`}>{porcentajeDeAvance(avance)}</p>
      </div>
      <p className="dash-num mt-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs text-ink-secondary">Real</span>{" "}
        <span className="font-serif text-[2rem] leading-tight font-semibold text-ink" title={importeDeAvance(real, moneda)}>
          {importeEnMillones(real, moneda)}
        </span>{" "}
        <span className="text-sm text-ink-secondary">
          de <span title={importeDeAvance(presupuestado, moneda)}>{importeEnMillones(presupuestado, moneda)}</span> presupuestado
        </span>
      </p>
      <div className="mt-3">
        <BarraDeAvance avance={avance} ritmo={ritmo?.porcentaje ?? null} tono={tono} etiqueta={`${titulo} de ${moneda === "ARS" ? "la empresa" : `la empresa (${NOMBRE_DE_MONEDA[moneda] ?? moneda})`}`} />
      </div>
    </div>
  );
}

// `ritmoGeneral` es el ritmo del mes del resumen: la leyenda de la marca se repite en la tarjeta SOLO si el de esta empresa
// difiere (por ejemplo, datos hasta el 12 cuando el resto llega al 13). Sin ritmo general, se muestra.
export function FilaDeAvanceVista({ fila, hrefReporte, ritmoGeneral }: { fila: FilaDeAvance; hrefReporte: string; ritmoGeneral?: RitmoDelMes | null }) {
  const etiquetas = etiquetasDeFila(fila);
  const enOtraMoneda = fila.moneda !== "ARS";
  const leyendaPropia = fila.ritmo !== null && mostrarRitmoPropio(fila.ritmo, ritmoGeneral);
  return (
    <article className="dash-card dash-card--enlace">
      <header className="flex items-start gap-3">
        <span className="dash-monograma" aria-hidden="true">{iniciales(fila.nombre) || "?"}</span>
        <h3 className="min-w-0 flex-1 pt-0.5 font-serif text-xl leading-snug font-semibold text-[#14233a]">
          <Link href={hrefReporte} className="dash-card__enlace">
            {fila.nombre}
            <span className="sr-only"> — ver el Reporte</span>
            <span aria-hidden="true" className="ml-1 text-base font-normal text-[#2563c9]">→</span>
          </Link>
        </h3>
        {enOtraMoneda && (
          <span className="dash-etiqueta shrink-0" title={`Importes en ${NOMBRE_DE_MONEDA[fila.moneda] ?? fila.moneda}`}>
            {simboloMoneda(fila.moneda)} · {NOMBRE_DE_MONEDA[fila.moneda] ?? fila.moneda}
          </span>
        )}
      </header>
      {fila.sinReporte ? (
        <p className="mt-5 text-sm text-ink-secondary">Esta empresa no tiene Reporte por plantilla: no hay presupuesto ni avance para mostrar.</p>
      ) : (
        <div className="mt-5 space-y-6">
          <Metrica titulo="Egresos operativos" celda={fila.egresosOperativos} moneda={fila.moneda} ritmo={fila.ritmo} tono="egresos" />
          <Metrica titulo="Ingresos" celda={fila.ingresos} moneda={fila.moneda} ritmo={fila.ritmo} tono="ingresos" />
        </div>
      )}
      {(leyendaPropia || etiquetas.length > 0) && (
        <footer className="mt-5 flex flex-col gap-3 border-t border-[#e3e8f0] pt-4">
          {leyendaPropia && fila.ritmo && <LeyendaDeMarca ritmo={fila.ritmo} />}
          {etiquetas.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {etiquetas.map((e) => (
                <li key={e.texto} className="dash-etiqueta" data-categoria={e.categoria}>{e.texto}</li>
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
      <header className="flex items-start gap-3">
        <span className="dash-monograma" aria-hidden="true">{iniciales(nombre) || "?"}</span>
        <h3 className="min-w-0 flex-1 pt-0.5 font-serif text-xl leading-snug font-semibold text-[#14233a]">{nombre}</h3>
      </header>
      <div className="mt-5 space-y-6">
        {[0, 1].map((i) => (
          <div key={i}>
            <span className="dash-esqueleto h-4 w-32" />
            <span className="dash-esqueleto mt-2 h-9 w-44 max-w-full" />
            <span className="dash-esqueleto mt-3 h-3 w-full" />
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs text-ink-secondary">Cargando…</p>
    </article>
  );
}

export function FilaConErrorVista({ nombre }: { nombre: string }) {
  return (
    <article className="dash-card dash-card--error">
      <header className="flex items-start gap-3">
        <span className="dash-monograma" aria-hidden="true">{iniciales(nombre) || "?"}</span>
        <h3 className="min-w-0 flex-1 pt-0.5 font-serif text-xl leading-snug font-semibold text-[#14233a]">{nombre}</h3>
      </header>
      <p className="mt-4 text-sm text-negative">No se pudo cargar esta empresa. Probá recargar la página.</p>
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
    <details className="dash-calidad" open>
      <summary className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
        <span className="flex items-center gap-2.5">
          <svg className="dash-calidad__flecha h-4 w-4 shrink-0 text-[#2563c9]" viewBox="0 0 16 16" role="presentation" focusable="false">
            <path d="M5.5 3.5 10.5 8l-5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 id="calidad" className="font-serif text-2xl font-semibold tracking-tight text-[#14233a]">Calidad del dato</h2>
        </span>
        <span className="dash-calidad__resumen">
          {observaciones === 0 ? "Sin observaciones en el mes" : `${observaciones} ${observaciones === 1 ? "indicador con movimientos" : "indicadores con movimientos"}`}
        </span>
      </summary>
      <div className="space-y-5 border-t border-[#e3e8f0] px-4 py-5 sm:px-6">
        <dl className="flex flex-wrap gap-3 text-sm">
          <div className="dash-dato">
            <dt className="text-ink-secondary">Datos al</dt>
            <dd className="dash-num text-xl font-semibold text-ink">{calidad.datosAl ?? "—"}</dd>
          </div>
          <div className="dash-dato">
            <dt className="text-ink-secondary">En lotes cerrados</dt>
            <dd className="dash-num text-xl font-semibold text-ink">{cantidad(calidad.movimientosEnLotesCerrados)}</dd>
          </div>
          <div className="dash-dato">
            <dt className="text-ink-secondary">En lotes abiertos</dt>
            <dd className="dash-num text-xl font-semibold text-ink">{cantidad(calidad.movimientosEnLotesAbiertos)}</dd>
            {semanas > 0 && (
              <dd className="text-xs text-ink-secondary">
                {semanas === 1 ? "1 semana provisoria" : `${semanas} semanas provisorias`} · {cantidad(movimientosAfuera)} afuera del Reporte
              </dd>
            )}
          </div>
        </dl>
        <ul className="divide-y divide-[#edf0f5] text-sm">
          {calidad.indicadores.map((i) => (
            <li key={i.clave} data-con-valor={i.total > 0 ? "" : undefined} className={`flex items-baseline justify-between gap-4 py-2.5 ${i.total > 0 ? "font-medium text-ink" : "text-ink-muted"}`}>
              <span>{i.rotulo}</span>
              <span className="dash-num shrink-0 text-right">
                {cantidad(i.total)}
                {i.total > 0 && <span className="ml-2 text-xs font-normal text-ink-secondary">({cantidad(i.enLotesAbiertos)} en lotes abiertos)</span>}
              </span>
            </li>
          ))}
          <li data-con-valor={sinFila > 0 ? "" : undefined} className={`flex items-baseline justify-between gap-4 py-2.5 ${sinFila > 0 ? "font-medium text-ink" : "text-ink-muted"}`}>
            <span>
              Clasificaciones sin fila propia en el Reporte
              <span className="block text-xs font-normal text-ink-secondary">movimientos en pesos que no suman a ninguna línea</span>
            </span>
            <span className="dash-num shrink-0 text-right">
              {cantidad(sinFila)}
              <span className="ml-1 text-xs font-normal text-ink-secondary">de {cantidad(calidad.clasificacionesSinFila.deMovimientos)}</span>
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
      <h2 id="solo-administracion" className="flex items-center gap-2.5 font-serif text-2xl font-semibold tracking-tight text-[#14233a]">
        <svg className="h-5 w-5 shrink-0" viewBox="0 0 20 20" role="presentation" focusable="false">
          <rect x="4" y="9" width="12" height="8" rx="2" fill="currentColor" />
          <path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Solo administración
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">Controles que ve únicamente el administrador. No se suman a ningún total.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

export function SinAsignarVista({ sinAsignar }: { sinAsignar: NonNullable<CalidadDelMes["sinAsignar"]> }) {
  return (
    <section aria-labelledby="sin-asignar" className="dash-admin__item">
      <h3 id="sin-asignar" className="text-base font-semibold text-[#14233a]">{sinAsignar.rotulo}</h3>
      <p className="mt-1 text-xs text-ink-secondary">Movimientos sin unidad de negocio. No están en ninguna empresa.</p>
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
      <h3 id="control-depositos" className="text-base font-semibold text-[#14233a]">{control ? control.rotulo : "Depósitos de cheques pendientes de registro"}</h3>
      {control === null ? (
        <p className="mt-2 text-sm text-ink-secondary">No hay movimientos en el mes.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-secondary">Semana del {ddMm(control.lunes)} al {ddMm(control.domingo)}. Control aparte: no se suma a ningún total.</p>
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
  return <p className="rounded-xl border border-[#d3dbe6] bg-white px-4 py-3 text-sm text-negative">{texto}</p>;
}

export function SeccionCargandoVista({ texto, titulo }: { texto: string; titulo?: string }) {
  return (
    <div className="rounded-xl border border-[#d3dbe6] bg-white px-4 py-4 sm:px-6" aria-busy="true">
      {titulo && <h2 id="calidad" className="font-serif text-2xl font-semibold tracking-tight text-[#14233a]">{titulo}</h2>}
      <p className={`text-sm text-ink-secondary ${titulo ? "mt-2" : ""}`}>{texto}</p>
    </div>
  );
}
