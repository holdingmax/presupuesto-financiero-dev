"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatearImporteConCentavos } from "./formato";
import { prefijoMoneda } from "@/lib/moneda";
import { eliminarDesgloseMovimiento } from "./actions";
import { opcionesUnidad } from "@/lib/unidadesNegocio";
import { aCentavos, formatearCentavos, formatearPorcentaje, porcentajeDeCentavos } from "@/lib/prorrateo";
import PanelDesgloseMovimiento from "./PanelDesgloseMovimiento";

// Sin librería de íconos en el proyecto — SVG a mano, mismo criterio que
// IconoOjo (components/CampoPassword.tsx).
function IconoMenu() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function IconoChevron() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Reemplaza los botones "Ignorar"/"Quitar" sueltos: esos dos, uno de ellos solo
// visible en hover, dependían del ancho disponible en la columna de acciones y
// se comprimían/cortaban en pantallas angostas (la tabla es w-full con
// table-layout automático — sin esta columna a ancho fijo, el navegador achica
// la que no tenga contenido protegido en vez de desbordar). El botón ⋯ es de
// ancho fijo y siempre visible — no depende del viewport ni del hover.
// El prorrateo ya no vive acá: se abre con el tilde de la columna Prorrateo
// (pedido de Kike, 2026-10-06).
// La tabla vive dentro de una caja con scroll (encabezado fijo), que recortaría
// un menú "absolute" en las últimas filas: por eso el panel es "fixed", ubicado
// con el rectángulo del botón, y abre hacia arriba si abajo no hay lugar. Como
// "fixed" no acompaña al scroll, el menú se cierra si se mueve la caja o la ventana.
function MenuAcciones({
  ignorado,
  onToggleIgnorado,
  onQuitar,
}: {
  ignorado: boolean;
  onToggleIgnorado?: () => void;
  onQuitar?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState<{ right: number; top?: number; bottom?: number }>({ right: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto) return;
    function alClickearAfuera(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    }
    function cerrar() {
      setAbierto(false);
    }
    document.addEventListener("mousedown", alClickearAfuera);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      document.removeEventListener("mousedown", alClickearAfuera);
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [abierto]);

  function alternar() {
    if (!abierto && botonRef.current) {
      const r = botonRef.current.getBoundingClientRect();
      const right = window.innerWidth - r.right;
      // El panel mide ~80 px (dos opciones); con menos de 100 px debajo del botón abre hacia arriba.
      setPosicion(
        window.innerHeight - r.bottom < 100
          ? { right, bottom: window.innerHeight - r.top + 4 }
          : { right, top: r.bottom + 4 }
      );
    }
    setAbierto((v) => !v);
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={botonRef}
        type="button"
        onClick={alternar}
        aria-label="Acciones"
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-paper-cool hover:text-ink transition"
      >
        <IconoMenu />
      </button>
      {abierto && (
        // Fondo explícito por style (no solo la clase bg-paper-raised) + isolation:
        // "isolate" fuerza un stacking context propio para este panel, blindándolo
        // contra cualquier bleed-through del contenido de la fila de abajo dentro
        // de la tabla — no lo pude reproducir en local (dev ni build de producción,
        // el background-color computado ya daba blanco sólido), pero esto es
        // a prueba de balas independientemente de la causa real en testing.
        <div
          className="fixed z-30 w-36 rounded-md border border-line-strong bg-paper-raised py-1 shadow-lg shadow-ink/15"
          style={{ backgroundColor: "#ffffff", isolation: "isolate", ...posicion }}
        >
          {onToggleIgnorado && (
            <button
              type="button"
              onClick={() => {
                onToggleIgnorado();
                setAbierto(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-paper-cool hover:text-ink"
            >
              {ignorado ? "Reactivar" : "Ignorar"}
            </button>
          )}
          {onQuitar && (
            <button
              type="button"
              onClick={() => {
                onQuitar();
                setAbierto(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-terracota hover:bg-terracota-tint"
            >
              Quitar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// "60%" si es exacto, "33,33%" si no.
function textoPorcentaje(centesimas: number) {
  return centesimas % 100 === 0 ? `${centesimas / 100}%` : `${formatearPorcentaje(centesimas)}%`;
}

// Reemplaza el <select> de la unidad cuando el movimiento está prorrateado:
// "HAVANNA 60% · RADIO 40%" (las 2 primeras + "+N"), con el detalle en $ en el
// tooltip. La unidad propia de la fila queda guardada detrás, sin mostrarse
// (decisión 2026-10-06 — el Reporte va a usar el desglose). Clickeable solo si
// la fila es editable (abre el panel).
function ResumenProrrateo({
  importe,
  moneda,
  desglose,
  onAbrir,
}: {
  importe: number;
  moneda?: string;
  desglose: { unidadNegocio: string; importe: number }[];
  onAbrir?: () => void;
}) {
  const total = aCentavos(importe);
  const partes = desglose.map((d) => {
    const centavos = aCentavos(d.importe);
    return { unidad: d.unidadNegocio, centavos, porcentaje: porcentajeDeCentavos(centavos, total) };
  });
  const visibles = partes.slice(0, 2).map((p) => `${p.unidad} ${textoPorcentaje(p.porcentaje)}`);
  const texto = visibles.join(" · ") + (partes.length > 2 ? ` · +${partes.length - 2}` : "");
  const detalle = partes
    .map((p) => `${p.unidad}: ${prefijoMoneda(moneda)}${formatearCentavos(p.centavos)} (${formatearPorcentaje(p.porcentaje)}%)`)
    .join("\n");
  const clases = "max-w-[19rem] truncate text-left text-[13px] text-marino";

  return onAbrir ? (
    <button type="button" onClick={onAbrir} title={`Prorrateado:\n${detalle}`} className={`${clases} hover:underline`}>
      {texto}
    </button>
  ) : (
    <span title={`Prorrateado:\n${detalle}`} className={clases}>
      {texto}
    </span>
  );
}

export type MovimientoTabla = {
  id: string;
  fecha: string;
  concepto: string;
  importe: number;
  // Moneda del movimiento (código ISO). Sin dato es pesos.
  moneda?: string;
  // Solo existe si el servidor autorizó el saldo (mapearMovimiento con verSaldo); null = el banco
  // no lo informa (BBVA).
  saldo?: number | null;
  bancoYCuenta: string;
  clasificacion: string;
  // Valor único de la fila — completamente separado de `desglose` de abajo
  // (el reparto en varias unidades). Ninguno de los dos lee ni escribe al
  // otro; ver el comentario en actualizarMovimiento/guardarDesgloseMovimiento
  // en ejecucion/actions.ts.
  unidadNegocio: string;
  // true mientras la unidad la propuso el sistema por la cuenta bancaria y
  // nadie la confirmó ni la corrigió — solo cambia cómo se ve la celda.
  unidadSugeridaPorSistema: boolean;
  detalle: string;
  ignorado: boolean;
  desglose: { id: string; unidadNegocio: string; importe: number }[];
  // Solo en la vista "Todo el mes" de la empresa: a qué semana pertenece el movimiento.
  semana?: number;
};

type Props = {
  movimientos: MovimientoTabla[];
  numeroSemana: number;
  soloLectura?: boolean;
  // Columna Saldo: solo para quien ve todo Ejecución (el servidor ya decidió si los datos la traen).
  mostrarSaldo?: boolean;
  // Columna Semana (vista "Todo el mes" de la empresa).
  mostrarSemana?: boolean;
  deshabilitado?: boolean;
  clasificacionesDisponibles?: string[];
  onCambiarClasificacion?: (id: string, valor: string) => void;
  // Solo se llama con un cambio REAL de unidad (es un <select>: reelegir la
  // misma opción no dispara onChange) — el llamador guarda y lo toma como
  // confirmación de una unidad sugerida (decisión 2026-10-06).
  onCambiarUnidadNegocio?: (id: string, valor: string) => void;
  onQuitar?: (id: string) => void;
  onToggleIgnorado?: (id: string, valor: boolean) => void;
};

export default function TablaMovimientos({
  movimientos,
  numeroSemana,
  soloLectura = false,
  mostrarSaldo = false,
  mostrarSemana = false,
  deshabilitado = false,
  clasificacionesDisponibles = [],
  onCambiarClasificacion,
  onCambiarUnidadNegocio,
  onQuitar,
  onToggleIgnorado,
}: Props) {
  const router = useRouter();
  const { periodo } = useParams<{ periodo: string }>();
  const [desgloseAbiertoId, setDesgloseAbiertoId] = useState<string | null>(null);
  const totalColumnas = (soloLectura ? 7 : 8) + (mostrarSaldo ? 1 : 0) + (mostrarSemana ? 1 : 0);

  // Tilde de la columna Prorrateo (pedido de Kike, 2026-10-06): tildarlo abre el panel;
  // destildarlo cierra el panel si todavía no se guardó nada, o — si ya hay un
  // prorrateo guardado — pide confirmación y lo borra.
  async function alTildarProrrateo(m: MovimientoTabla, tildado: boolean) {
    if (tildado) {
      setDesgloseAbiertoId(m.id);
      return;
    }
    if (m.desglose.length === 0) {
      setDesgloseAbiertoId(null);
      return;
    }
    if (!confirm("¿Quitar el prorrateo de este movimiento? Se borra el reparto guardado.")) return;
    await eliminarDesgloseMovimiento(periodo, numeroSemana, m.id);
    setDesgloseAbiertoId(null);
    router.refresh();
  }

  // Cada th es sticky (no el thead): dentro de la caja con scroll de la pantalla se pega al borde
  // de arriba de la caja. Fondo sólido y z-20 para tapar a los selects que pasan por debajo; la
  // línea de abajo es un box-shadow porque con border-collapse un borde sticky se queda atrás.
  const th =
    "sticky top-0 z-20 bg-paper py-1.5 font-medium shadow-[inset_0_-1px_0_var(--color-line-strong)]";

  return (
    // Con el ancho completo de la pantalla la tabla ya no se comprime: Concepto se ajusta en varias
    // líneas (ancho mínimo 18rem), Clasificación toma el ancho de su opción más larga y el resto
    // queda en una sola línea. El min-w evita que se aplaste en pantallas angostas (scroll horizontal
    // dentro de la caja).
    <table className={`w-full text-[13px] ${mostrarSaldo ? "min-w-[1180px]" : "min-w-[1020px]"}`}>
      <thead>
        <tr className="text-xs text-ink-faint uppercase tracking-wide">
          <th className={`${th} text-left pr-3`}>Fecha</th>
          {mostrarSemana && <th className={`${th} text-left pr-3`}>Semana</th>}
          <th className={`${th} text-left pr-3`}>Banco y cuenta</th>
          <th className={`${th} text-left pr-3`}>Concepto</th>
          <th className={`${th} text-right pr-3`}>Importe</th>
          {mostrarSaldo && (
            <th
              className={`${th} text-right pr-3 cursor-help`}
              title="Saldo de la cuenta DESPUÉS del movimiento. En Nación el banco informa el saldo anterior; acá se muestra ya convertido al posterior. BBVA no informa saldo."
            >
              Saldo
            </th>
          )}
          <th className={`${th} text-left pr-3`}>Clasificación</th>
          <th className={`${th} text-left pr-3`}>Unidad de negocio</th>
          <th className={`${th} text-center pr-3`}>Prorrateo</th>
          {!soloLectura && <th className={`${th} w-10`} />}
        </tr>
      </thead>
      <tbody>
        {movimientos.map((m) => {
          const desglosado = m.desglose.length > 0;
          const expandida = desgloseAbiertoId === m.id;

          return (
          <Fragment key={m.id}>
          <tr
            className={`group border-t border-line-hairline hover:bg-surface-hover transition-colors ${
              m.ignorado ? "line-through text-ink-muted opacity-60" : ""
            }`}
          >
            <td className="py-1 pr-3 whitespace-nowrap text-ink-secondary">{m.fecha}</td>
            {mostrarSemana && <td className="py-1 pr-3 whitespace-nowrap text-ink-secondary">{m.semana}</td>}
            <td className="py-1 pr-3 whitespace-nowrap text-ink-secondary">
              {m.bancoYCuenta}
            </td>
            <td className="min-w-[18rem] whitespace-normal break-words py-1 pr-3">{m.concepto}</td>
            <td
              className={`py-1 pr-3 text-right tabular whitespace-nowrap ${
                m.importe < 0 ? "text-negative" : "text-positive"
              }`}
            >
              {prefijoMoneda(m.moneda)}
              {formatearImporteConCentavos(m.importe)}
            </td>
            {mostrarSaldo && (
              <td className="py-1 pr-3 text-right tabular whitespace-nowrap text-ink-secondary">
                {m.saldo === null || m.saldo === undefined ? "" : `${prefijoMoneda(m.moneda)}${formatearImporteConCentavos(m.saldo)}`}
              </td>
            )}
            <td className="py-1 pr-3 whitespace-nowrap">
              {soloLectura ? (
                <span>{m.clasificacion}</span>
              ) : (
                <div className="relative inline-block">
                  <select
                    value={m.clasificacion}
                    disabled={deshabilitado}
                    onChange={(e) => onCambiarClasificacion?.(m.id, e.target.value)}
                    className="appearance-none rounded-md border border-transparent bg-transparent py-0.5 pl-2 pr-6 text-[13px] outline-none transition hover:border-line hover:bg-surface-hover focus:border-marino focus:bg-paper-raised disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-transparent"
                  >
                    {!clasificacionesDisponibles.includes(m.clasificacion) && (
                      <option value={m.clasificacion}>{m.clasificacion}</option>
                    )}
                    {clasificacionesDisponibles.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faint">
                    <IconoChevron />
                  </span>
                </div>
              )}
            </td>
            <td className="py-1 pr-3">
              <div className="flex items-center gap-2">
                {desglosado ? (
                  <ResumenProrrateo
                    importe={m.importe}
                    moneda={m.moneda}
                    desglose={m.desglose}
                    onAbrir={
                      soloLectura || deshabilitado
                        ? undefined
                        : () => setDesgloseAbiertoId(expandida ? null : m.id)
                    }
                  />
                ) : soloLectura ? (
                  <span className={m.unidadSugeridaPorSistema ? "italic text-ink-secondary" : ""}>
                    {m.unidadNegocio}
                  </span>
                ) : (
                  // Lista cerrada (lib/unidadesNegocio.ts); un valor viejo fuera
                  // de lista (ej. "CREAR", "SIN ASIGNAR") se muestra como opción
                  // extra para no cambiarlo en silencio.
                  <div className="relative inline-block">
                    <select
                      value={m.unidadNegocio}
                      disabled={deshabilitado}
                      onChange={(e) => onCambiarUnidadNegocio?.(m.id, e.target.value)}
                      title={
                        m.unidadSugeridaPorSistema
                          ? "Sugerida por la cuenta bancaria — sin confirmar"
                          : undefined
                      }
                      className={`w-32 appearance-none rounded-md border border-transparent bg-transparent py-0.5 pl-2 pr-6 text-[13px] outline-none transition hover:border-line hover:bg-surface-hover focus:border-marino focus:bg-paper-raised disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-transparent ${
                        m.unidadSugeridaPorSistema ? "italic text-ink-secondary" : ""
                      }`}
                    >
                      {opcionesUnidad([m.unidadNegocio]).map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faint">
                      <IconoChevron />
                    </span>
                  </div>
                )}
                {!desglosado && m.unidadSugeridaPorSistema && (
                  <span
                    title="Sugerida por la cuenta bancaria — sin confirmar"
                    className="whitespace-nowrap text-xs text-ink-faint"
                  >
                    · sugerida
                  </span>
                )}
              </div>
            </td>
            <td className="py-1 pr-3 text-center whitespace-nowrap">
              {!soloLectura && !deshabilitado ? (
                <input
                  type="checkbox"
                  aria-label="Prorratea"
                  title={
                    m.importe === 0
                      ? "Un movimiento de $0 no se puede prorratear"
                      : "Repartir este movimiento entre varias unidades de negocio"
                  }
                  checked={desglosado || expandida}
                  disabled={m.importe === 0}
                  onChange={(e) => alTildarProrrateo(m, e.target.checked)}
                  className="cursor-pointer accent-marino disabled:cursor-not-allowed disabled:opacity-40"
                />
              ) : (
                desglosado && <span className="text-xs text-ink-secondary">sí</span>
              )}
            </td>
            {!soloLectura && (
              <td className="py-1">
                {!deshabilitado && (
                  <MenuAcciones
                    ignorado={m.ignorado}
                    onToggleIgnorado={
                      onToggleIgnorado ? () => onToggleIgnorado(m.id, !m.ignorado) : undefined
                    }
                    onQuitar={onQuitar ? () => onQuitar(m.id) : undefined}
                  />
                )}
              </td>
            )}
          </tr>
          {expandida && (
            <tr className="border-t border-line-hairline">
              <td colSpan={totalColumnas} className="py-3">
                <PanelDesgloseMovimiento
                  numeroSemana={numeroSemana}
                  movimientoId={m.id}
                  importeMovimiento={m.importe}
                  moneda={m.moneda}
                  desgloseInicial={m.desglose}
                  onCerrar={() => setDesgloseAbiertoId(null)}
                />
              </td>
            </tr>
          )}
          </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
