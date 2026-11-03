import { pendientesDe, type Celda, type FilaLinea, type FilaReporte, type Reporte } from "@/lib/reporte/motor";
import { PENDIENTES } from "@/lib/reporte/pendientes";
import { EMPRESAS_EN_DOLARES } from "@/lib/config";
import { formatearImporte } from "@/app/ejecucion/formato";
import Link from "next/link";
import BloqueNoAsignado from "./BloqueNoAsignado";
import { AccionesFlujo, AvisosFlujo, EstadoBadge } from "../FlujoPresupuesto";
import type { EstadoFlujo } from "@/lib/presupuestoAcceso";
import type { VistaCarga } from "@/lib/reporte/cargaGerente";
import { BarraGuardarPresupuesto, CeldaPresupuestoEditable, ProveedorCarga } from "./CargaPresupuesto";
import { BarraGuardarTipeo, CeldaTipeoEditable, ConTipeo } from "./TipeoDirecto";
import { AgregarFila, BorrarFila } from "./FilasExtra";
import type { VistaTipeo } from "@/lib/reporte/tipeoDirecto";
import type { VistaFilasExtra } from "@/lib/reporte/accionesFilasExtra";
import { bloqueDeRolTotal, idDeClaveExtra, type BloqueExtra } from "@/lib/reporte/filasExtra";
import { Fragment, type ReactNode } from "react";
import { nombreMesBanda, rangoDeMeses } from "@/lib/mesesReporte";
import { FAMILIA_REPORTE, poppinsReporte } from "./fuenteReporte";

// Colores del Excel "PRESUPUESTO MES A MES" (réplica fiel). Literales para que Tailwind los detecte.
const BANDA = "bg-[#CCD8E7]"; // encabezado de mes y filas de sección
const DATO = "bg-[#E6ECF3]"; // celdas de Presupuestado y Real, subencabezados
const TOTAL = "bg-[#D9D9D9]"; // filas de total
// Mes en solo lectura: velo oscuro encima del fondo de la celda (también en bandas y totales).
const SOMBRA = "bg-[linear-gradient(rgba(0,0,0,0.06),rgba(0,0,0,0.06))]";

// Cómo se muestran los números de una fila: Disponibilidades centrado y en negrita, el flujo (ingresos y
// egresos) a la derecha y un poco más chico, y los totales (incluye Capital y Disponible) en negrita.
type EstiloCeldas = "total" | "disponibilidades" | "flujo";

// Textos neutros: los ve cualquier rol, sin nombrar a nadie.
const AYUDA_PARCIAL_FILA = "Dato parcial: falta información para completar este valor";
const AYUDA_PARCIAL_TOTAL = "Dato parcial: falta información para completar este total";

// Centavos → pesos sin decimales, con "−" si es negativo (un egreso con más
// devoluciones que gastos se muestra negativo a propósito).
function importe(centavos: number) {
  const pesos = formatearImporte(Math.abs(centavos) / 100);
  return centavos < 0 ? `-${pesos}` : pesos;
}

// Con centavos: el control de arrastre mira diferencias de menos de $1.
function importeCentavos(centavos: number) {
  const pesos = (Math.abs(centavos) / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return centavos < 0 ? `-${pesos}` : pesos;
}

type Props = {
  empresaNombre: string;
  empresaSlug: string;
  periodo: string;
  reporte: Reporte;
  // ADMIN o FINANZAS y MOSTRAR_PENDIENTES_EN_REPORTE (lib/config.ts): ven las etiquetas K,
  // sus tooltips y la lista de pendientes.
  verPendientes: boolean;
  // ADMIN o FINANZAS: control de arrastre, marcas de la planilla y link a la carga.
  verControl: boolean;
  // Estado del Presupuesto del mes de la URL y botones del flujo; null = no se muestran
  // (ver mostrarFlujoEnReporte en lib/estadoPresupuesto.ts).
  flujo: EstadoFlujo | null;
  // Carga del Presupuestado en el Reporte (Etapa 2): celdas editables de la última columna y
  // bloque "Sin fila". null = el Reporte es de solo lectura, como siempre.
  carga: VistaCarga | null;
  // Tipeo directo del Real manual (solo ADMIN y FINANZAS, empresas del interruptor): celdas editables de la
  // columna Real del último mes. null = ninguna, el Reporte se ve como siempre.
  tipeo: VistaTipeo | null;
  // Filas extra (solo ADMIN y FINANZAS, empresas del interruptor): en qué bloques va «Agregar una fila» y qué
  // filas extra se pueden borrar. null = ni botones ni borrado; el gerente recibe null SIEMPRE.
  filasExtra: VistaFilasExtra | null;
  // Cartel de mes en solo lectura para el gerente (null = sin cartel). Ver avisoPeriodoSoloLectura.
  avisoSoloLectura: string | null;
  sinUnidades: boolean;
  noAsignado: { unidad: string; importe: number; movimientos: number }[];
  semanasConNoAsignado: number[];
  // Control de vista (VistaSelector), armado en page.tsx: va en el encabezado, junto a las acciones.
  controlVista?: ReactNode;
};

export default function ReportePlantilla({
  empresaNombre,
  empresaSlug,
  periodo,
  reporte,
  verPendientes,
  verControl,
  flujo,
  carga,
  tipeo,
  filasExtra,
  avisoSoloLectura,
  sinUnidades,
  noAsignado,
  semanasConNoAsignado,
  controlVista,
}: Props) {
  const { periodos, sinPresupuesto, sinEjecucion } = reporte;
  const idsEditables = new Set(carga?.celdas.map((c) => c.id));
  const idsTipeables = new Set(tipeo?.celdas.map((c) => c.id));
  // Meses que no se editan desde acá: los anteriores al último, y el último si el mes está en solo
  // lectura (cartel). Se marcan con la etiqueta «Solo lectura» y el fondo atenuado.
  const soloLecturaPorMes = periodos.map((_, i) => i < periodos.length - 1 || avisoSoloLectura !== null);
  return (
    <div className={`w-full px-3 py-2 ${poppinsReporte.variable}`}>
      <ConTipeo tipeo={tipeo} empresaSlug={empresaSlug} periodo={periodo}>
      <ConCarga carga={carga} empresaSlug={empresaSlug} periodo={periodo}>
      <header className="mb-4">
        <p className="mb-1 flex items-center gap-2 text-[11px] tracking-[0.15em] text-ink-secondary uppercase">
          <span aria-hidden="true" className="h-1.5 w-1.5 bg-plata" />
          Presupuesto financiero · {rangoDeMeses(periodos)}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-marino-dark">{empresaNombre}</h1>
          {flujo && <EstadoBadge estado={flujo.estado} variante="reporte" />}
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-stretch gap-3">
        {controlVista}
        {(verControl || carga || tipeo) && (
          <div
            role="group"
            aria-label="Acciones del reporte"
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line-strong bg-paper-raised px-3 py-1.5"
          >
            {verControl && (
              <Link
                href={`/${empresaSlug}/${periodo}/reporte/carga`}
                className="inline-flex h-9 items-center rounded-md border border-line-strong bg-paper-raised px-4 text-xs font-medium text-ink transition hover:border-marino hover:text-marino-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marino"
              >
                Cargar valores del mes
              </Link>
            )}
            {carga && <BarraGuardarPresupuesto />}
            {tipeo && <BarraGuardarTipeo />}
          </div>
        )}
      </div>

      <p
        className="mb-3 text-xs text-ink-secondary"
        title="El real suma los movimientos de las unidades de negocio de esta empresa, de cualquier extracto del período. Disponibilidades, Resultado FCI y demás valores tipeados se cargan a mano."
      >
        Presupuestado vs. real ejecutado (semanas cerradas), en {EMPRESAS_EN_DOLARES.includes(empresaSlug) ? "dólares" : "pesos"}.
      </p>

      {avisoSoloLectura && (
        <p className="mb-2 rounded-md bg-terracota-tint px-3 py-1 text-xs text-terracota" role="status">
          {avisoSoloLectura}
        </p>
      )}

      {flujo && (
        <div className="mb-3">
          <AvisosFlujo
            estado={flujo.estado}
            esRevisor={flujo.esRevisor}
            revisionCompletada={flujo.revisionCompletada}
            fueModificadoPorRevisor={flujo.fueModificadoPorRevisor}
            validacion={flujo.validacion}
            pedidoCambios={flujo.pedidoCambios}
          />
        </div>
      )}

      {sinUnidades && (
        <p className="mb-2 text-xs text-terracota bg-terracota-tint rounded-md px-3 py-1">
          Esta empresa no tiene unidades de negocio asignadas, así que el real va a dar 0. Un
          administrador las asigna en Administración → Unidades de negocio.
        </p>
      )}

      {/* Tarjeta de la tabla: réplica del Excel «PRESUPUESTO MES A MES» (fuente, colores y formato de importes). */}
      <section
        className={`rounded-md border border-line-strong bg-paper-raised ${periodos.length === 1 ? "max-w-5xl" : "max-w-[1800px]"}`}
        style={{ fontFamily: FAMILIA_REPORTE }}
      >
        <div className="px-4 pt-3 pb-2">
          <h2 className="text-[22pt] leading-tight font-bold text-[#8A8A8A]">Presupuesto Financiero</h2>
          <p className="text-[10pt] font-bold text-[#344E6D]">
            {empresaNombre} · {rangoDeMeses(periodos)}
          </p>
        </div>

        {/* Un solo mes entra sin scroll horizontal: sin contenedor con overflow, el encabezado fijo se pega a la
            ventana. Con varios meses el contenedor scrollea (en horizontal si la pantalla es angosta) y el
            encabezado se pega a él. */}
        <div className={periodos.length === 1 ? "" : "max-h-[calc(100vh-4rem)] overflow-auto"}>
          <table className="w-full text-[9pt] leading-4">
            <thead className="sticky top-0 z-20 bg-paper-raised">
              <tr>
                <th className="sticky left-0 z-10 bg-paper-raised" />
                {periodos.map((p, i) => (
                  <th
                    key={p}
                    colSpan={4}
                    className={`border-l border-line-hairline px-2 py-1 text-center font-bold tracking-wide ${BANDA}${
                      soloLecturaPorMes[i] ? ` ${SOMBRA}` : ""
                    }`}
                  >
                    {nombreMesBanda(p)}
                    {soloLecturaPorMes[i] && (
                      <span className="ml-2 rounded bg-white/60 px-1.5 text-[8pt] font-medium tracking-normal text-ink normal-case">
                        Solo lectura
                      </span>
                    )}
                    {sinPresupuesto[i] && (
                      <span className="ml-2 text-[8pt] font-normal tracking-normal text-ink normal-case">· sin presupuesto</span>
                    )}
                    {sinEjecucion[i] && (
                      <span className="ml-2 text-[8pt] font-normal tracking-normal text-ink normal-case">· sin ejecución</span>
                    )}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 z-10 w-[56ch] min-w-[56ch] bg-paper-raised py-1 pr-3 text-left text-[8pt] font-bold tracking-wide text-ink-secondary uppercase">
                  Concepto
                </th>
                {periodos.map((p, i) => (
                  <ColumnasMes key={p} atenuado={soloLecturaPorMes[i]} />
                ))}
              </tr>
            </thead>
            <tbody>
              {reporte.filas.map((f) => (
                <FilaConControl
                  key={f.fila.clave}
                  filaReporte={f}
                  reporte={reporte}
                  verPendientes={verPendientes}
                  verControl={verControl}
                  carga={carga}
                  idsEditables={idsEditables}
                  idsTipeables={idsTipeables}
                  filasExtra={filasExtra}
                  empresaSlug={empresaSlug}
                  periodo={periodo}
                  soloLecturaPorMes={soloLecturaPorMes}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {flujo && (
        <AccionesFlujo
          estado={flujo.estado}
          esRevisor={flujo.esRevisor}
          revisionCompletada={flujo.revisionCompletada}
          cantidadLineas={flujo.cantidadLineas}
          ocultarEnviarARevision={avisoSoloLectura !== null}
        />
      )}
      </ConCarga>
      </ConTipeo>

      {verPendientes && reporte.pendientes.length > 0 && (
        <div className="mt-4 rounded-md border border-line-strong bg-paper-raised px-5 py-4">
          <p className="text-sm font-medium">Pendiente de confirmar con Kike</p>
          <ul className="mt-2 space-y-1 text-sm">
            {reporte.pendientes.map((k) => (
              <li key={k} className="flex gap-2">
                <EtiquetaPendiente codigo={k} />
                <span className="text-ink-secondary">{PENDIENTES[k]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <BloqueNoAsignado
        empresaSlug={empresaSlug}
        periodo={periodo}
        noAsignado={noAsignado}
        semanasConNoAsignado={semanasConNoAsignado}
      />
    </div>
  );
}

// Con carga activa envuelve lo que necesita el estado de las celdas editables; sin carga no
// agrega nada.
function ConCarga({
  carga,
  empresaSlug,
  periodo,
  children,
}: {
  carga: VistaCarga | null;
  empresaSlug: string;
  periodo: string;
  children: ReactNode;
}) {
  if (!carga) return <>{children}</>;
  return (
    <ProveedorCarga empresaSlug={empresaSlug} periodo={periodo} celdas={carga.celdas} huella={carga.huella}>
      {children}
    </ProveedorCarga>
  );
}

// La fila y, debajo del Total Disponibilidades, el control de arrastre (solo
// ADMIN/FINANZAS; no es una fila de la planilla).
function FilaConControl({
  filaReporte,
  reporte,
  verPendientes,
  verControl,
  carga,
  idsEditables,
  idsTipeables,
  filasExtra,
  empresaSlug,
  periodo,
  soloLecturaPorMes,
}: {
  filaReporte: FilaReporte;
  reporte: Reporte;
  verPendientes: boolean;
  verControl: boolean;
  carga: VistaCarga | null;
  idsEditables: Set<string>;
  idsTipeables: Set<string>;
  filasExtra: VistaFilasExtra | null;
  empresaSlug: string;
  periodo: string;
  soloLecturaPorMes: boolean[];
}) {
  const meses = reporte.periodos.length;
  const { fila } = filaReporte;
  // «Agregar una fila» va al final de cada bloque: justo antes de su total (las filas extra ya están antes).
  const bloqueParaAgregar = fila.tipo === "total" ? bloqueDeRolTotal(fila.rol) : null;
  return (
    <>
      {bloqueParaAgregar && filasExtra?.bloques.includes(bloqueParaAgregar) && (
        <FilaAgregar
          bloque={bloqueParaAgregar}
          meses={meses}
          empresaSlug={empresaSlug}
          periodo={periodo}
        />
      )}
      <FilaTabla
        filaReporte={filaReporte}
        meses={meses}
        verPendientes={verPendientes}
        verControl={verControl}
        carga={carga}
        idsEditables={idsEditables}
        idsTipeables={idsTipeables}
        borrable={filasExtra !== null && filasExtra.borrables.includes(fila.clave)}
        empresaSlug={empresaSlug}
        periodo={periodo}
        soloLecturaPorMes={soloLecturaPorMes}
        soloSaldo={reporte.sinBloquesReservados}
      />
      {verControl && fila.tipo === "total" && fila.rol === "totalDisponibilidades" && (
        <tr className="h-5 bg-paper-cool text-[8.5pt] italic text-ink-secondary">
          <td className="sticky left-0 z-10 bg-paper-cool py-0 pr-4 whitespace-nowrap">
            Arrastre: diferencia con el cierre anterior
          </td>
          {reporte.arrastre.map((a, i) => (
            <td key={i} colSpan={4} className="py-0 px-2 text-right border-l border-line-hairline">
              {a === null || a.diferencia === null ? (
                "—"
              ) : (
                <span
                  className={a.cuadra ? "" : "text-terracota"}
                  title={`Cierre real anterior ${importe(a.cierreRealAnterior ?? 0)} + ajustes ${importe(a.ajustes)} vs. total ${importe(a.totalDisponibilidades ?? 0)}`}
                >
                  {a.cuadra ? "cuadra" : "no cuadra"} · dif. {importeCentavos(a.diferencia)}
                </span>
              )}
            </td>
          ))}
        </tr>
      )}
    </>
  );
}

function ColumnasMes({ atenuado }: { atenuado: boolean }) {
  const base = `${DATO} px-2 py-1 text-center font-bold tracking-wide whitespace-nowrap uppercase${atenuado ? ` ${SOMBRA}` : ""}`;
  return (
    <>
      <th className={`${base} border-l border-line-hairline`}>Presupuestado</th>
      <th className={base}>Real</th>
      <th className={base}>% Avance</th>
      <th className={base}>Falta ejecutar</th>
    </>
  );
}

function EtiquetaPendiente({ codigo }: { codigo: keyof typeof PENDIENTES }) {
  return (
    <span
      title={PENDIENTES[codigo]}
      className="inline-block rounded px-1.5 text-[11px] font-medium leading-5 text-terracota bg-terracota-tint"
    >
      {codigo}
    </span>
  );
}

function FilaTabla({
  filaReporte,
  meses,
  verPendientes,
  verControl,
  carga,
  idsEditables,
  idsTipeables,
  borrable,
  empresaSlug,
  periodo,
  soloLecturaPorMes,
  soloSaldo,
}: {
  filaReporte: FilaReporte;
  meses: number;
  verPendientes: boolean;
  verControl: boolean;
  carga: VistaCarga | null;
  idsEditables: Set<string>;
  idsTipeables: Set<string>;
  // Fila extra sin valores: se puede borrar (solo ADMIN y FINANZAS).
  borrable: boolean;
  empresaSlug: string;
  periodo: string;
  soloLecturaPorMes: boolean[];
  // El Reporte se armó sin acceso completo a los bloques reservados (el gerente): Disponibilidades, si
  // llega, se muestra como un solo valor «Saldo», bajo la columna Real y de solo lectura (ahí
  // Presupuestado = Real = el saldo real, y no es un presupuesto que se edite).
  soloSaldo: boolean;
}) {
  const { fila, celdas } = filaReporte;
  const enSaldo = soloSaldo && fila.bloque === "DISPONIBILIDADES";
  if (fila.tipo === "titulo") {
    // Disponibilidades: rótulo azul sobre blanco (sin banda). Ingresos y Egresos: banda a lo ancho; Egresos centrado.
    const rotulo = fila.bloque === "DISPONIBILIDADES";
    const bandaFila = rotulo ? "" : BANDA;
    return (
      <tr className={`h-5 border-t border-line-hairline ${bandaFila}`}>
        <td
          className={`sticky left-0 z-10 py-0 pr-3 font-bold ${
            rotulo
              ? "bg-paper-raised text-[10pt] text-[#4E75A3]"
              : `${BANDA} tracking-[0.12em] uppercase ${fila.bloque === "EGRESOS" ? "text-center" : ""}`
          }`}
        >
          {fila.texto}
        </td>
        {enSaldo ? (
          // «Saldo» queda sobre la columna Real, que es donde se muestra el valor de cada fila del bloque.
          Array.from({ length: meses }, (_, i) => (
            <Fragment key={i}>
              <td className="border-l border-line-hairline" />
              <td className="py-0 px-2 text-center text-[8pt] font-bold tracking-wide text-[#4E75A3] uppercase">Saldo</td>
              <td colSpan={2} />
            </Fragment>
          ))
        ) : (
          <td colSpan={meses * 4} />
        )}
      </tr>
    );
  }
  const esTotal = fila.tipo === "total";
  // Capital y Disponible también se ven como totales (gris, negrita, etiqueta a la derecha).
  const esTotalVisual = esTotal || fila.tipo === "capital" || fila.tipo === "disponible";
  const estilo: EstiloCeldas = esTotalVisual ? "total" : fila.bloque === "DISPONIBILIDADES" ? "disponibilidades" : "flujo";
  // Disponibilidades, Capital y Disponible no tienen % avance ni falta; Capital y
  // Disponible solo tienen P (como la planilla).
  const sinPorcentajes = fila.bloque === "DISPONIBILIDADES" || fila.tipo === "capital" || fila.tipo === "disponible";
  const soloP = fila.tipo === "capital" || fila.tipo === "disponible";
  // Carga del Presupuestado (Etapa 2): solo la columna P del ÚLTIMO mes (el de la URL). Una fila
  // de categoría es un input, o muestra por qué no se puede editar desde acá.
  // El id es "fila|…" (categoría) o "manual|…" (Presupuestado manual, Etapa 3). El Capital de
  // trabajo (Cierre) no lo carga el gerente: lo tipean ADMIN y FINANZAS (editorPresupuesto) o /reporte/carga.
  const idCelda =
    fila.tipo !== "linea"
      ? null
      : idsEditables.has(`fila|${fila.clave}`)
        ? `fila|${fila.clave}`
        : idsEditables.has(`manual|${fila.clave}`)
          ? `manual|${fila.clave}`
          : null;
  const editor = idCelda !== null ? <CeldaPresupuestoEditable id={idCelda} nombre={fila.texto.trim()} compacta /> : undefined;
  const editorReal =
    fila.tipo === "linea" && idsTipeables.has(`${fila.clave}|REAL`) ? (
      <CeldaTipeoEditable clave={fila.clave} columna="REAL" nombre={fila.texto.trim()} />
    ) : undefined;
  // Presupuestado tipeado en el Reporte (solo ADMIN y FINANZAS): las filas extra, las de Presupuestado pisable
  // (pisableConManual) y el Capital de trabajo; las demás lo cargan el gerente o /reporte/carga.
  const editorPresupuesto =
    (fila.tipo === "linea" || fila.tipo === "capital") && idsTipeables.has(`${fila.clave}|PRESUPUESTADO`) ? (
      <CeldaTipeoEditable
        clave={fila.clave}
        columna="PRESUPUESTADO"
        nombre={fila.texto.trim()}
        derivado={celdas[celdas.length - 1].presupuestado}
      />
    ) : undefined;
  const motivo =
    carga && fila.tipo === "linea" && Object.hasOwn(carga.motivosFilas, fila.clave)
      ? carga.motivosFilas[fila.clave]
      : undefined;
  return (
    <tr className={`h-5 border-t border-line-hairline${esTotalVisual ? ` ${TOTAL} font-bold` : ""}`}>
      <td
        className={`sticky left-0 z-10 py-0 pr-3 whitespace-nowrap ${esTotalVisual ? `${TOTAL} text-right` : "bg-paper-raised"}`}
      >
        <span
          className={estilo === "disponibilidades" ? "font-bold uppercase" : undefined}
          title={verPendientes && fila.tipo === "linea" ? fila.nota : undefined}
        >
          {fila.texto}
        </span>
        {borrable && (
          <BorrarFila empresaSlug={empresaSlug} periodo={periodo} id={idDeClaveExtra(fila.clave)} nombre={fila.texto.trim()} />
        )}
        {fila.tipo === "linea" && (
          <MarcasFila
            fila={fila}
            verPendientes={verPendientes}
            verControl={verControl}
            conValor={celdas.some((c) => c.real !== null)}
          />
        )}
        {verPendientes &&
          (fila.tipo === "capital" || fila.tipo === "disponible") &&
          pendientesDe(fila).map((k) => (
            <span key={k} className="ml-2">
              <EtiquetaPendiente codigo={k} />
            </span>
          ))}
      </td>
      {celdas.map((c, i) =>
        enSaldo ? (
          <CeldaSaldo key={i} celda={c} atenuado={soloLecturaPorMes[i]} total={esTotalVisual} />
        ) : (
          <CeldasMes
            key={i}
            celda={c}
            esTotal={esTotal}
            estilo={estilo}
            realParcial={fila.tipo === "linea" && !!fila.parcial}
            sinPorcentajes={sinPorcentajes}
            soloP={soloP}
            atenuado={soloLecturaPorMes[i]}
            editor={i === celdas.length - 1 ? (editor ?? editorPresupuesto) : undefined}
            editorReal={i === celdas.length - 1 ? editorReal : undefined}
            motivo={i === celdas.length - 1 ? motivo : undefined}
          />
        )
      )}
    </tr>
  );
}

const NOMBRE_DE_BLOQUE: Record<BloqueExtra, string> = {
  INGRESOS: "Ingresos",
  EGRESOS: "Egresos operativos",
  ABAJO: "Egresos de abajo",
};

// Una fila de la tabla con el botón «Agregar una fila» al final de un bloque (solo ADMIN y FINANZAS).
function FilaAgregar({
  bloque,
  meses,
  empresaSlug,
  periodo,
}: {
  bloque: BloqueExtra;
  meses: number;
  empresaSlug: string;
  periodo: string;
}) {
  return (
    <tr className="border-t border-line-hairline">
      <td className="sticky left-0 z-10 bg-paper-raised py-px pr-3">
        <AgregarFila empresaSlug={empresaSlug} periodo={periodo} bloque={bloque} nombreBloque={NOMBRE_DE_BLOQUE[bloque]} />
      </td>
      <td colSpan={meses * 4} />
    </tr>
  );
}

function MarcasFila({
  fila,
  verPendientes,
  verControl,
  conValor,
}: {
  fila: FilaLinea;
  verPendientes: boolean;
  verControl: boolean;
  conValor: boolean;
}) {
  return (
    <>
      {verPendientes &&
        pendientesDe(fila).map((k) => (
          <span key={k} className="ml-2">
            <EtiquetaPendiente codigo={k} />
          </span>
        ))}
      {verControl && fila.excluidaDelTotal && conValor && (
        <span title={fila.nota} className="ml-2 text-[8pt] font-normal text-[#9a3818]">
          no suma en el total (como la planilla)
        </span>
      )}
      {/* TODO(K14): «Recupero aporte blanqueo» no suma en el total de la planilla de agosto (julio sí): pregunta
          K14 pendiente con Kike. Hasta que la conteste, el gerente solo ve «no suma», sin explicación. */}
      {!verControl && fila.excluidaDelTotal && conValor && (
        <span className="ml-2 text-[8pt] font-normal text-ink-secondary">no suma</span>
      )}
      {fila.parcial && (
        <span title={AYUDA_PARCIAL_FILA} className="ml-2 text-[8pt] font-normal text-ink-secondary">
          parcial
        </span>
      )}
    </>
  );
}

// Disponibilidades para el gerente: un solo valor por mes (el saldo), de solo lectura, bajo la columna
// Real (el saldo ES el real; Presupuestado, % y falta quedan vacíos). Nunca un input, ni marcas de dato
// parcial (eso es de ADMIN y FINANZAS).
function CeldaSaldo({ celda, atenuado, total }: { celda: Celda; atenuado: boolean; total: boolean }) {
  const sombra = atenuado ? ` ${SOMBRA}` : "";
  const clase = `py-0 px-2 text-center font-bold tabular-nums whitespace-nowrap${sombra}`;
  return (
    <>
      <td className={`${clase}${total ? "" : ` ${DATO}`} border-l border-line-hairline`} />
      <td className={`${clase}${total ? "" : ` ${DATO}`}`}>{celda.real === null ? "" : importe(celda.real)}</td>
      <td className={clase} />
      <td className={clase} />
    </>
  );
}

function Asterisco() {
  return (
    <span title={AYUDA_PARCIAL_TOTAL} className="ml-0.5 text-[#9a3818]">
      *
    </span>
  );
}

function CeldasMes({
  celda,
  esTotal,
  estilo,
  realParcial,
  sinPorcentajes,
  soloP,
  atenuado,
  editor,
  editorReal,
  motivo,
}: {
  celda: Celda;
  esTotal: boolean;
  estilo: EstiloCeldas;
  realParcial: boolean;
  sinPorcentajes: boolean;
  soloP: boolean;
  // Mes en solo lectura: velo apenas más oscuro (se superpone al de la fila, también en los totales).
  atenuado: boolean;
  // Carga del Presupuestado: input en lugar del número, o el motivo de solo lectura debajo de él.
  editor?: ReactNode;
  // Tipeo directo del Real manual: input en lugar del número de la columna Real.
  editorReal?: ReactNode;
  motivo?: string;
}) {
  const alineacion =
    estilo === "disponibilidades" ? "text-center font-bold" : estilo === "total" ? "text-right" : "text-right text-[8.5pt]";
  const claseNumero = `py-0 px-2 tabular-nums whitespace-nowrap ${alineacion}${atenuado ? ` ${SOMBRA}` : ""}`;
  // Presupuestado y Real llevan el fondo azul claro de la planilla; en los totales manda el gris de la fila.
  const claseDato = `${claseNumero}${estilo === "total" ? "" : ` ${DATO}`}`;
  return (
    <>
      <td className={`${claseDato} border-l border-line-hairline`}>
        {editor ?? (celda.presupuestado === null ? "" : importe(celda.presupuestado))}
        {!editor && esTotal && celda.presupuestoIncompleto && celda.presupuestado !== null && <Asterisco />}
        {/* Por qué no se edita desde acá: tooltip, para no agrandar la fila. */}
        {!editor && motivo && (
          <span title={motivo} aria-label={motivo} className="ml-1 cursor-help text-[8pt] font-normal text-ink-secondary">
            ⓘ
          </span>
        )}
      </td>
      <td className={`${claseDato} ${realParcial ? "text-ink-secondary" : ""}`}>
        {editorReal ?? (soloP ? "" : celda.real === null ? "" : importe(celda.real))}
        {!editorReal && esTotal && celda.realIncompleto && celda.real !== null && <Asterisco />}
      </td>
      <td className={claseNumero}>
        {soloP || sinPorcentajes ? "" : celda.avance === null ? "" : `${formatearImporte(celda.avance)}%`}
      </td>
      <td className={claseNumero}>
        {soloP || sinPorcentajes ? "" : celda.faltaEjecutar === null ? "" : importe(celda.faltaEjecutar)}
      </td>
    </>
  );
}
