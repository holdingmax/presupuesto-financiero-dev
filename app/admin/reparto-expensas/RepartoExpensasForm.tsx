"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CampoImporte from "@/components/CampoImporte";
import { formatearCentavos, formatearPorcentaje, parsearPorcentaje } from "@/lib/prorrateo";
import { calcularReparto } from "@/lib/reporte/repartoExpensasCalculo";
import type { EstadoEmpresaReparto } from "@/lib/reporte/repartoExpensas";
import { guardarRepartoExpensas, type ResultadoRepartoExpensas } from "./actions";

export type EmpresaReparto = {
  id: string;
  nombre: string;
  filaTexto: string;
  existenteCentavos: number | null;
  nota: string | null;
  cargadoPor: string | null;
  estado: EstadoEmpresaReparto;
};

type Props = {
  periodo: string;
  periodos: { periodo: string; nombre: string }[];
  empresas: EmpresaReparto[];
};

type Reemplazo = { empresaId: string; nombre: string; actualCentavos: number; nuevoCentavos: number };

// Calculadora de reparto de Expensas. El navegador solo muestra la vista previa (mismo cálculo que el servidor,
// lib/reporte/repartoExpensasCalculo.ts); al guardar viaja el TEXTO tipeado y el servidor vuelve a calcular todo.
export default function RepartoExpensasForm({ periodo, periodos, empresas }: Props) {
  const router = useRouter();
  const [total, setTotal] = useState("");
  const [porcentajes, setPorcentajes] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [reemplazos, setReemplazos] = useState<Reemplazo[] | null>(null);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  // Una empresa no editable queda en 0 (no se toca), tipee lo que tipee.
  const textoDe = (e: EmpresaReparto) => (e.estado.editable ? (porcentajes[e.id] ?? "") : "");
  const textos = empresas.map(textoDe);
  const calculo = calcularReparto(total, textos);
  const sumaPorcentajes = textos.reduce((a, t) => a + (parsearPorcentaje(t) ?? 0), 0);
  const periodoNoEditable = empresas.length > 0 && empresas.every((e) => !e.estado.editable);

  function limpiarAvisos() {
    setReemplazos(null);
    setMensaje(null);
  }

  async function guardar(confirmar: boolean) {
    setGuardando(true);
    setMensaje(null);
    let resultado: ResultadoRepartoExpensas;
    try {
      resultado = await guardarRepartoExpensas(
        periodo,
        total,
        empresas.map((e) => ({ empresaId: e.id, porcentajeTexto: textoDe(e) })),
        confirmar
      );
    } catch {
      setGuardando(false);
      setMensaje({ ok: false, texto: "No se pudo guardar. Probá de nuevo." });
      return;
    }
    setGuardando(false);
    if (!resultado.ok) {
      setReemplazos(resultado.requiereConfirmacion ? (resultado.reemplazos ?? []) : null);
      setMensaje({ ok: false, texto: resultado.error });
      return;
    }
    setReemplazos(null);
    setMensaje({ ok: true, texto: `Guardado: ${resultado.guardados} empresa${resultado.guardados === 1 ? "" : "s"}.` });
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs tracking-[0.15em] text-ink-secondary uppercase mb-1">
            <span className="w-2 h-2 bg-plata" />
            Administración
          </p>
          <h1 className="text-4xl font-serif font-semibold tracking-tight">Reparto de Expensas</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            Cargá el total del mes y el porcentaje de cada empresa: el sistema calcula el monto y lo guarda como el Real
            de la fila Expensas de su Reporte. Los porcentajes tienen que sumar 100%.
          </p>
        </div>
        <Link href="/" className="text-sm text-ink-secondary underline underline-offset-2 hover:text-ink">
          Volver
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap gap-2" aria-label="Período">
        {periodos.map((p) => (
          <Link
            key={p.periodo}
            href={`/admin/reparto-expensas?periodo=${p.periodo}`}
            aria-current={p.periodo === periodo ? "page" : undefined}
            className={`h-8 px-3 inline-flex items-center rounded-md border text-xs font-medium transition ${
              p.periodo === periodo
                ? "border-marino bg-marino-tint text-marino"
                : "border-line text-ink-secondary hover:text-ink"
            }`}
          >
            {p.nombre}
          </Link>
        ))}
      </div>

      {empresas.length === 0 ? (
        <p className="text-sm text-ink-secondary">Ninguna empresa activa tiene una fila de Expensas para cargar.</p>
      ) : (
        <>
          {periodoNoEditable && (
            <p className="mb-4 rounded-md bg-terracota-tint px-3 py-2 text-sm text-terracota">
              Este período no se puede modificar: {empresas[0].estado.motivo}
            </p>
          )}

          <div className="mb-6 max-w-xs">
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="total-expensas">
              Total de Expensas del mes
            </label>
            <CampoImporte
              id="total-expensas"
              value={total}
              disabled={periodoNoEditable}
              onChange={(v) => {
                setTotal(v);
                limpiarAvisos();
              }}
            />
          </div>

          <div className="space-y-3">
            {empresas.map((e, i) => {
              const toca = calculo.ok && calculo.porcentajes[i] > 0;
              return (
                <div key={e.id} className="rounded-md border border-line-strong bg-paper-raised px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{e.nombre}</p>
                      <p className="text-xs text-ink-muted">Fila «{e.filaTexto}»</p>
                    </div>
                    <div className="relative w-28">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Porcentaje de ${e.nombre}`}
                        disabled={!e.estado.editable}
                        value={porcentajes[e.id] ?? ""}
                        onChange={(ev) => {
                          setPorcentajes((prev) => ({ ...prev, [e.id]: ev.target.value }));
                          limpiarAvisos();
                        }}
                        placeholder="0"
                        className="w-full h-10 rounded-md border border-line bg-paper pl-3 pr-7 text-sm tabular outline-none focus:border-marino focus:ring-2 focus:ring-marino/15 disabled:opacity-50"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">%</span>
                    </div>
                    <p className="w-40 text-right text-sm tabular">
                      {calculo.ok && toca ? `$${formatearCentavos(calculo.montos[i])}` : <span className="text-ink-faint">—</span>}
                    </p>
                  </div>
                  {e.existenteCentavos !== null && (
                    <p className="mt-2 text-xs text-ink-secondary">
                      Hoy tiene cargado ${formatearCentavos(e.existenteCentavos)}
                      {e.cargadoPor ? ` (${e.cargadoPor})` : ""}
                      {e.nota ? ` · ${e.nota}` : ""}.
                      {e.estado.editable ? " Si guardás, te pedimos confirmar el reemplazo." : ""}
                    </p>
                  )}
                  {!e.estado.editable && !periodoNoEditable && (
                    <p className="mt-2 text-xs text-terracota">No editable: {e.estado.motivo}</p>
                  )}
                  {e.estado.avisoUnaVez && (
                    <p className="mt-2 text-xs text-ink-secondary">
                      Período cerrado: solo se puede cargar una vez ({e.estado.motivo}).
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-md border border-line bg-paper-cool px-4 py-3 text-sm">
            <p className="text-xs text-ink-muted">Suma de control</p>
            <p className="tabular">
              {formatearPorcentaje(sumaPorcentajes)}%
              {calculo.ok ? (
                <>
                  {" · "}${formatearCentavos(calculo.montos.reduce((a, m) => a + m, 0))} de ${formatearCentavos(calculo.totalCentavos)}{" "}
                  <span className="ml-1 font-medium text-verde">✓ Cierra exacto</span>
                </>
              ) : (
                <span className="ml-2 text-terracota">{total.trim() === "" && sumaPorcentajes === 0 ? "" : calculo.error}</span>
              )}
            </p>
          </div>

          {reemplazos && (
            <div className="mt-4 rounded-md border border-terracota bg-terracota-tint px-4 py-3 text-sm">
              <p className="font-medium text-terracota">Ya hay valores cargados. ¿Reemplazarlos?</p>
              <ul className="mt-2 space-y-1 text-xs">
                {reemplazos.map((r) => (
                  <li key={r.empresaId}>
                    {r.nombre}: ${formatearCentavos(r.actualCentavos)} → ${formatearCentavos(r.nuevoCentavos)}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  disabled={guardando}
                  onClick={() => guardar(true)}
                  className="h-9 px-4 rounded-md bg-marino text-white text-sm font-medium hover:bg-marino-dark transition disabled:opacity-40"
                >
                  {guardando ? "Guardando..." : "Reemplazar y guardar"}
                </button>
                <button
                  type="button"
                  onClick={() => setReemplazos(null)}
                  className="h-9 px-3 rounded-md text-sm text-ink-secondary hover:text-ink transition"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {mensaje && !reemplazos && (
            <p className={`mt-4 text-sm ${mensaje.ok ? "text-verde" : "text-terracota"}`}>{mensaje.texto}</p>
          )}

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              disabled={!calculo.ok || guardando || reemplazos !== null || periodoNoEditable}
              onClick={() => guardar(false)}
              className="h-10 px-5 rounded-md bg-marino text-white text-sm font-medium hover:bg-marino-dark active:scale-[0.99] transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {guardando && reemplazos === null ? "Guardando..." : "Guardar reparto"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
