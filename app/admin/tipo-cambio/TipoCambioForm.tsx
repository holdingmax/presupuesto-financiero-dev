"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { guardarTipoCambio } from "./actions";

export type FilaTipoCambioVista = { periodo: string; moneda: string; valor: string; cargadoPor: string; cuando: string };

const CAMPO = "h-9 px-2 rounded-md border border-line bg-paper text-sm text-ink focus:outline-none focus:border-marino";

// Cargar o corregir el tipo de cambio de un mes. Acepta "3,467" o "3.467". Las reglas las vuelve a validar el servidor.
export default function TipoCambioForm({ filas }: { filas: FilaTipoCambioVista[] }) {
  const router = useRouter();
  const [periodo, setPeriodo] = useState("");
  const [valor, setValor] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  async function guardar() {
    setOcupado(true);
    setMensaje(null);
    try {
      const r = await guardarTipoCambio(periodo.trim(), "USD", valor);
      if (r.ok) {
        setMensaje({ ok: true, texto: `Guardado: dólar de ${periodo.trim()} = ${valor.trim()} soles.` });
        setValor("");
        router.refresh();
      } else {
        setMensaje({ ok: false, texto: r.error });
      }
    } catch {
      setMensaje({ ok: false, texto: "No pude guardar. Probá de nuevo." });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link href="/" className="text-xs underline text-ink-muted">
        ← Inicio
      </Link>
      <h1 className="mt-2 text-3xl font-serif font-semibold tracking-tight">Tipo de cambio</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Cuántos soles vale 1 dólar en cada mes (para Havanna Perú se usa el del último día del mes, por ejemplo octubre
        2026 = 3,467). El importe original en dólares nunca se cambia: la conversión se hace recién al armar el reporte.
        Si cargás de nuevo el mismo mes, se corrige el valor.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-secondary">Período (AAAA-MM)</span>
          <input value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="2026-10" className={`${CAMPO} w-32`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-secondary">Moneda</span>
          <select disabled className={CAMPO} aria-label="Moneda">
            <option>USD</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-secondary">Soles por dólar</span>
          <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="3,467" className={`${CAMPO} w-32`} />
        </label>
        <button
          type="button"
          onClick={guardar}
          disabled={ocupado || periodo.trim() === "" || valor.trim() === ""}
          className="inline-flex h-9 items-center rounded-md bg-marino px-4 text-sm font-medium text-white transition hover:bg-marino-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {ocupado ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {mensaje && (
        <p
          className={`mt-3 rounded-md px-3 py-2 text-sm ${mensaje.ok ? "bg-marino-tint text-marino" : "bg-terracota-tint text-terracota"}`}
          role={mensaje.ok ? "status" : "alert"}
        >
          {mensaje.texto}
        </p>
      )}

      <h2 className="mt-8 text-sm font-medium">Ya cargados</h2>
      {filas.length === 0 ? (
        <p className="mt-2 text-sm text-ink-secondary">Todavía no hay ningún tipo de cambio cargado.</p>
      ) : (
        <table className="mt-2 w-full text-sm tabular">
          <thead>
            <tr className="text-left text-xs text-ink-secondary">
              <th className="py-1 pr-3 font-medium">Período</th>
              <th className="py-1 pr-3 font-medium">Moneda</th>
              <th className="py-1 pr-3 text-right font-medium">Soles por unidad</th>
              <th className="py-1 pr-3 font-medium">Cargó</th>
              <th className="py-1 font-medium">Cuándo</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={`${f.periodo}|${f.moneda}`} className="border-t border-line">
                <td className="py-1.5 pr-3">{f.periodo}</td>
                <td className="py-1.5 pr-3">{f.moneda}</td>
                <td className="py-1.5 pr-3 text-right">{f.valor}</td>
                <td className="py-1.5 pr-3">{f.cargadoPor}</td>
                <td className="py-1.5 text-xs text-ink-secondary">{f.cuando}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
