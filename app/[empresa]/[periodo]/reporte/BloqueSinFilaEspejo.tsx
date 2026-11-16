import { formatearConMoneda } from "@/lib/moneda";
import { TEXTO_SIN_FILA_ESPEJO, type SinFilaEspejo } from "@/lib/reporte/avisoEspejo";

// Aviso del espejo Avianor-Conexión (solo ADMIN y FINANZAS; solo lectura, no suma a ningún total). No se muestra si no hay nada.
export default function BloqueSinFilaEspejo({ sinFila }: { sinFila: SinFilaEspejo[] | null }) {
  if (!sinFila || sinFila.length === 0) return null;
  return (
    <div className="mt-8 rounded-md border border-line-strong border-l-4 border-l-terracota bg-paper-raised px-5 py-4">
      <p className="text-sm font-medium">Avianor: clasificación sin fila</p>
      <p className="mt-1 text-xs text-ink-muted">{TEXTO_SIN_FILA_ESPEJO}</p>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {sinFila.map((f) => (
            <tr key={`${f.estado}-${f.moneda}-${f.clasificacion}`} className="border-t border-line-hairline first:border-t-0">
              <td className="py-1.5 pr-3">{f.clasificacion}</td>
              <td className="py-1.5 pr-3 text-xs text-ink-muted">
                {f.estado === "CERRADA" ? "Semana cerrada" : "Semana abierta (todavía se puede corregir)"}
              </td>
              <td className="py-1.5 pr-3 text-xs text-ink-muted">
                {f.movimientos === 1 ? "1 movimiento" : `${f.movimientos} movimientos`}
              </td>
              <td className="py-1.5 text-right tabular whitespace-nowrap">{formatearConMoneda(f.centavos / 100, f.moneda)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
