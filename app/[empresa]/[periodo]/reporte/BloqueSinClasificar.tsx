import { formatearConMoneda } from "@/lib/moneda";
import {
  TEXTO_SIN_CLASIFICAR_ABIERTAS,
  TEXTO_SIN_CLASIFICAR_CERRADAS,
  type BloqueSinClasificar as Bloque,
  type GrupoSinClasificar,
} from "@/lib/reporte/sinClasificar";

// Bloque "Sin clasificar" del Reporte: solo lectura, lo ve quien ve el Reporte de la empresa. No se muestra
// si no hay movimientos. No suma a ningún total (ver lib/reporte/sinClasificar.ts).
function Grupos({ titulo, grupos }: { titulo: string; grupos: GrupoSinClasificar[] }) {
  if (grupos.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs text-ink-muted">{titulo}</p>
      <table className="mt-1 w-full text-sm">
        <tbody>
          {grupos.flatMap((g) =>
            [
              { sentido: "Ingresos", t: g.ingresos },
              { sentido: "Egresos", t: g.egresos },
            ]
              .filter((x) => x.t.movimientos > 0)
              .map((x) => (
                <tr key={`${g.moneda}-${x.sentido}`} className="border-t border-line-hairline first:border-t-0">
                  <td className="py-1.5 pr-3">{x.sentido}</td>
                  <td className="py-1.5 pr-3 text-xs text-ink-muted">
                    {x.t.movimientos === 1 ? "1 movimiento" : `${x.t.movimientos} movimientos`}
                  </td>
                  <td className="py-1.5 text-right tabular whitespace-nowrap">
                    {formatearConMoneda(x.t.centavos / 100, g.moneda)}
                  </td>
                </tr>
              ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function BloqueSinClasificar({ sinClasificar }: { sinClasificar: Bloque | null }) {
  if (!sinClasificar) return null;
  return (
    <div className="mt-8 rounded-md border border-line-strong border-l-4 border-l-terracota bg-paper-raised px-5 py-4">
      <p className="text-sm font-medium">Sin clasificar</p>
      <Grupos titulo={TEXTO_SIN_CLASIFICAR_CERRADAS} grupos={sinClasificar.cerradas} />
      <Grupos titulo={TEXTO_SIN_CLASIFICAR_ABIERTAS} grupos={sinClasificar.abiertas} />
    </div>
  );
}
