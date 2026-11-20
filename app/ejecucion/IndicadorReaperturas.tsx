import { reaperturaVigente, textoReapertura, type ReaperturaVista } from "@/lib/reaperturaSemana";

type Props = {
  estado: string;
  reaperturas: ReaperturaVista[];
};

// Indicador de la semana reabierta + historial de reaperturas. SOLO ADMIN: la página lo renderiza únicamente si
// obtenerReaperturasParaAdmin devolvió datos (null para cualquier otro rol), y ningún otro archivo lo usa (test estático).
// Sin reaperturas no muestra nada.
export default function IndicadorReaperturas({ estado, reaperturas }: Props) {
  if (reaperturas.length === 0) return null;
  const vigente = reaperturaVigente(estado, reaperturas);
  return (
    <div className="w-full px-4 pt-4">
      <div className="mx-auto w-full max-w-5xl px-2 space-y-2">
        {vigente && (
          <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">{textoReapertura(vigente)}</p>
        )}
        <details className="text-sm text-ink-secondary">
          <summary className="cursor-pointer text-xs uppercase tracking-wide text-ink-faint">
            Historial de reaperturas ({reaperturas.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {reaperturas.map((r) => (
              <li key={r.id}>
                {textoReapertura(r)}
                <span className="text-ink-muted">
                  {" "}
                  ({r.movimientosAlReabrir} movimientos
                  {r.semanaVaciaEliminada !== null ? `; se borró la semana ${r.semanaVaciaEliminada}, que estaba vacía` : ""})
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
