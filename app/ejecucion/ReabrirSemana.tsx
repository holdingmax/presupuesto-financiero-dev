"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reabrirSemana } from "@/app/ejecucion/actionsReabrir";
import { MOTIVO_MAXIMO, MOTIVO_MINIMO, validarMotivo } from "@/lib/reaperturaSemana";

type Props = {
  periodo: string;
  numeroSemana: number;
  // Las advertencias del cuadro (las arma el servidor: lib/reaperturaSemana.ts#avisosDeReapertura).
  avisos: string[];
};

// Botón "Reabrir semana para corregir" + cuadro de confirmación. SOLO se renderiza para ADMIN (la página lo decide con
// puedeReabrirSemana); el servidor lo vuelve a exigir con requireAdmin, así que ocultarlo no es la protección.
export default function ReabrirSemana({ periodo, numeroSemana, avisos }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function cerrarCuadro() {
    if (enviando) return;
    setAbierto(false);
    setError(null);
  }

  async function confirmar() {
    const validado = validarMotivo(motivo);
    if (!validado.ok) {
      setError(validado.error);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const resultado = await reabrirSemana(periodo, numeroSemana, validado.motivo);
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      setAbierto(false);
      setMotivo("");
      router.refresh();
    } catch {
      setError("No se pudo reabrir la semana. Si el problema sigue, avisá a quien administra el sistema.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-3 rounded-md px-2.5 py-1 text-sm text-terracota border border-terracota hover:bg-terracota-tint transition"
      >
        Reabrir semana para corregir
      </button>
      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-reabrir"
        >
          <div className="w-full max-w-lg rounded-md bg-white p-6 text-left shadow-lg">
            <h2 id="titulo-reabrir" className="text-lg font-semibold mb-3">
              Reabrir la semana {numeroSemana}
            </h2>
            <p className="text-sm text-ink-secondary mb-2">Antes de reabrirla, tené en cuenta:</p>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-ink-secondary mb-4">
              {avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <label htmlFor="motivo-reabrir" className="block text-sm font-medium mb-1">
              Motivo (obligatorio)
            </label>
            <textarea
              id="motivo-reabrir"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={MOTIVO_MAXIMO}
              disabled={enviando}
              className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm"
              placeholder={`Qué se corrige y por qué (mínimo ${MOTIVO_MINIMO} caracteres)`}
            />
            {error && <p className="mt-2 text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={cerrarCuadro}
                disabled={enviando}
                className="rounded-md px-3 py-1.5 text-sm text-ink-secondary hover:bg-paper-cool transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={enviando}
                className="rounded-md px-3 py-1.5 text-sm bg-terracota text-white hover:opacity-90 transition disabled:opacity-60"
              >
                {enviando ? "Reabriendo…" : "Reabrir semana"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
