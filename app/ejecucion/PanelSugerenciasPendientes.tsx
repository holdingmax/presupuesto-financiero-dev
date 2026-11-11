"use client";

import { useState } from "react";
import { formatearImporteConCentavos } from "./formato";
import { prefijoMoneda } from "@/lib/moneda";
import type { GrupoSugerenciaClasificacion } from "./actions";

// Sin librería de íconos en el proyecto — SVG a mano, mismo criterio que
// IconoMenu/IconoChevron en TablaMovimientos.tsx.
function IconoAlerta() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
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

type Props = {
  // Armado del server sobre TODA la semana (agruparSugerenciasClasificacion en
  // actions.ts), no sobre la página que se está viendo: cantidad/ambiguas son los
  // totales reales; `filas` es una muestra de hasta 50 por grupo.
  grupos: GrupoSugerenciaClasificacion[];
  clasificacionesDisponibles: string[];
  // Se llama tanto cuando el <select> de una fila cambia de valor de verdad
  // (onChange normal) como cuando se aprieta "Confirmar" reeligiendo el
  // mismo valor que ya tenía — en los dos casos hay que mandar `valor` igual,
  // porque actualizarMovimiento (el server action detrás de esto en
  // PanelImputacion) limpia sugeridaPorSistema sin excepción cuando
  // clasificacion viene en el payload, sin comparar contra el valor anterior.
  onConfirmarFila: (id: string, valor: string) => Promise<void>;
  // Bulk: confirma TODAS las de esa clasificación en la semana (menos las
  // ambiguas), sin cambiar el valor.
  onConfirmarGrupo: (clasificacion: string) => Promise<void>;
};

export default function PanelSugerenciasPendientes({
  grupos,
  clasificacionesDisponibles,
  onConfirmarFila,
  onConfirmarGrupo,
}: Props) {
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  // Solo trackea lo que el usuario todavía no confirmó, para el <select> de cada
  // fila. Las filas confirmadas se ocultan al toque (ocultas) y desaparecen de
  // verdad cuando el server refresca los grupos.
  const [valores, setValores] = useState<Record<string, string>>({});
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [confirmandoGrupo, setConfirmandoGrupo] = useState<string | null>(null);

  const total = grupos.reduce((suma, g) => suma + g.cantidad, 0);
  if (total === 0) return null;

  function toggleGrupo(clasificacion: string) {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(clasificacion)) next.delete(clasificacion);
      else next.add(clasificacion);
      return next;
    });
  }

  async function confirmarFila(id: string, valor: string) {
    setOcultas((prev) => new Set(prev).add(id));
    await onConfirmarFila(id, valor);
  }

  async function confirmarGrupo(clasificacion: string) {
    setConfirmandoGrupo(clasificacion);
    await onConfirmarGrupo(clasificacion);
    setConfirmandoGrupo(null);
  }

  return (
    <div className="mb-8 rounded-lg border border-line-strong border-l-4 border-l-marino bg-paper-raised px-5 py-4">
      <p className="text-sm font-medium mb-1">Sugerencias pendientes ({total})</p>
      <p className="text-xs text-ink-muted mb-3">
        Clasificaciones propuestas automáticamente en toda la semana, todavía sin confirmar. Revisá
        por grupo y confirmá de una, o corregí una fila puntual antes de confirmar el resto.
      </p>
      <div className="space-y-2">
        {grupos.map((grupo) => {
          const abierto = abiertos.has(grupo.clasificacion);
          const filasVisibles = grupo.filas.filter((f) => !ocultas.has(f.id));
          const ocultasDelGrupo = grupo.filas.length - filasVisibles.length;
          const ocultasNoAmbiguas = grupo.filas.filter((f) => ocultas.has(f.id) && !f.chequeIvaAmbiguo).length;
          const cantidad = grupo.cantidad - ocultasDelGrupo;
          const confirmablesEnLote = grupo.cantidad - grupo.ambiguas - ocultasNoAmbiguas;
          const fueraDeMuestra = grupo.cantidad - grupo.filas.length;
          if (cantidad <= 0) return null;

          return (
            <div key={grupo.clasificacion} className="rounded-md border border-line-hairline bg-paper">
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleGrupo(grupo.clasificacion)}
                  className="flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink"
                >
                  <span className={`transition-transform ${abierto ? "rotate-0" : "-rotate-90"}`}>
                    <IconoChevron />
                  </span>
                  {grupo.clasificacion} ({cantidad})
                </button>
                {confirmablesEnLote > 0 && (
                  <button
                    type="button"
                    disabled={confirmandoGrupo !== null}
                    onClick={() => confirmarGrupo(grupo.clasificacion)}
                    className="h-7 shrink-0 px-3 rounded-md bg-marino text-white text-xs font-medium hover:bg-marino-dark active:scale-[0.99] transition disabled:opacity-50"
                  >
                    {confirmandoGrupo === grupo.clasificacion
                      ? "Confirmando..."
                      : `Confirmar las ${confirmablesEnLote}`}
                  </button>
                )}
              </div>

              {abierto && (
                <div className="overflow-x-auto border-t border-line-hairline">
                  <table className="w-full min-w-[640px] text-xs">
                    <tbody>
                      {filasVisibles.map((f) => {
                        const valor = valores[f.id] ?? f.clasificacion;
                        return (
                          <tr key={f.id} className="border-t border-line-hairline first:border-t-0">
                            <td className="py-1.5 pl-3 pr-2 whitespace-nowrap text-ink-secondary">{f.fecha}</td>
                            <td className="py-1.5 pr-2 max-w-[240px] truncate" title={f.concepto}>
                              {f.chequeIvaAmbiguo && (
                                <span
                                  title="Esta referencia tiene más de un cheque real con el mismo N° e importe — confirmá solo después de revisarla a mano."
                                  className="mr-1 inline-block align-middle text-terracota"
                                >
                                  <IconoAlerta />
                                </span>
                              )}
                              {f.concepto}
                            </td>
                            <td className="py-1.5 pr-2 whitespace-nowrap text-ink-secondary">{f.bancoYCuenta}</td>
                            <td
                              className={`py-1.5 pr-2 text-right tabular whitespace-nowrap ${
                                f.importe < 0 ? "text-negative" : "text-positive"
                              }`}
                            >
                              {prefijoMoneda(f.moneda)}
                              {formatearImporteConCentavos(f.importe)}
                            </td>
                            <td className="py-1.5 pr-2">
                              <select
                                value={valor}
                                onChange={(e) => {
                                  setValores((prev) => ({ ...prev, [f.id]: e.target.value }));
                                  confirmarFila(f.id, e.target.value);
                                }}
                                className="w-36 rounded-md border border-line bg-transparent px-1.5 py-1 text-xs outline-none focus:border-marino"
                              >
                                {!clasificacionesDisponibles.includes(valor) && <option value={valor}>{valor}</option>}
                                {clasificacionesDisponibles.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-1.5 pr-3">
                              <button
                                type="button"
                                onClick={() => confirmarFila(f.id, valor)}
                                className="h-6 whitespace-nowrap px-2 rounded-md border border-line text-ink-secondary hover:bg-paper-cool hover:text-ink transition"
                              >
                                Confirmar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {fueraDeMuestra > 0 && (
                    <p className="border-t border-line-hairline px-3 py-2 text-xs text-ink-muted">
                      Se muestran las primeras {grupo.filas.length}; hay {fueraDeMuestra} más en la
                      semana. &quot;Confirmar las {confirmablesEnLote}&quot; las confirma todas (menos
                      las ambiguas, que se confirman de a una).
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
