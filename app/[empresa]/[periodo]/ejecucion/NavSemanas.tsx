import Link from "next/link";
import { hrefConFiltro } from "@/lib/filtroClasificacionEmpresa";

// Selector de semanas de la pestaña Ejecución de la empresa, con la opción "Todo el mes" al lado.
// `activa`: número de semana, o "mes" cuando se está viendo todo el período.
export default function NavSemanas({
  empresa,
  periodo,
  semanas,
  activa,
  clasificacion,
}: {
  empresa: string;
  periodo: string;
  semanas: { numeroSemana: number; estado: string }[];
  activa: number | "mes";
  clasificacion: string | undefined;
}) {
  if (semanas.length <= 1) return null;
  const clase = (esActiva: boolean) =>
    `rounded-md px-2.5 py-1 transition ${esActiva ? "bg-marino text-white" : "text-ink-secondary hover:bg-paper-cool"}`;
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs uppercase tracking-wide text-ink-faint">Semanas del período</span>
      {semanas.map((s) => (
        <Link
          key={s.numeroSemana}
          href={hrefConFiltro(`/${empresa}/${periodo}/ejecucion/${s.numeroSemana}`, clasificacion)}
          className={clase(s.numeroSemana === activa)}
        >
          Semana {s.numeroSemana} · {s.estado === "CERRADA" ? "cerrada" : "abierta"}
        </Link>
      ))}
      <Link href={hrefConFiltro(`/${empresa}/${periodo}/ejecucion/mes`, clasificacion)} className={clase(activa === "mes")}>
        Todo el mes
      </Link>
    </nav>
  );
}
