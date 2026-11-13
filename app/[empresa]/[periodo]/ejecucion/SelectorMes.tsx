"use client";

import { useRouter } from "next/navigation";
import { nombreDePeriodo } from "@/lib/ejecucionSemanas";
import type { OpcionMes } from "@/lib/mesesEjecucion";

// Selector de mes propio de la pestaña Ejecución (independiente del Reporte). Cada opción es un link a una
// semana que YA existe (la abierta del mes o, si no, la última): elegir un mes solo navega, no crea nada.
export default function SelectorMes({ periodo, opciones }: { periodo: string; opciones: OpcionMes[] }) {
  const router = useRouter();
  const actual = opciones.find((o) => o.periodo === periodo);
  return (
    <label className="mb-4 flex items-center gap-2 text-xs uppercase tracking-wide text-ink-faint">
      Mes
      <select
        value={actual?.href ?? ""}
        onChange={(e) => router.push(e.target.value)}
        className="h-8 rounded-md border border-line bg-paper-raised px-2 text-sm normal-case tracking-normal text-ink focus:border-marino focus:outline-none"
      >
        {opciones.map((o) => (
          <option key={o.periodo} value={o.href}>
            {nombreDePeriodo(o.periodo)}
            {o.vacio ? " · sin movimientos" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
