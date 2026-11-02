import Link from "next/link";
import { enlacesDePeriodos } from "@/lib/periodosHabilitados";
import { nombreDePeriodo } from "@/lib/ejecucionSemanas";

// Selector de mes de la pantalla de Presupuesto y, para el gerente que no ve esa pestaña, del Reporte
// (no está en NavTabs). Links a los períodos de lib/config.ts, con el actual resaltado.
export default function PeriodoSelector({
  empresaSlug,
  periodo,
  segmento = "presupuesto",
  vista,
  periodos,
  compacto = false,
}: {
  empresaSlug: string;
  periodo: string;
  segmento?: "presupuesto" | "reporte";
  // Vista del Reporte que se conserva al cambiar de mes.
  vista?: string;
  // Meses a mostrar; sin ella, la lista de lib/config.ts (como siempre en Presupuesto).
  periodos?: readonly string[];
  // Barra baja y alineada a la izquierda, para el Reporte compacto.
  compacto?: boolean;
}) {
  return (
    <nav
      aria-label="Mes"
      className={
        compacto
          ? "flex w-full items-center gap-1 px-3 pt-2 text-xs"
          : "mx-auto flex w-full max-w-3xl items-center gap-1 px-6 pt-6 text-sm"
      }
    >
      <span className="mr-2 text-xs uppercase tracking-[0.15em] text-ink-secondary">Mes</span>
      {enlacesDePeriodos(empresaSlug, periodo, periodos, segmento, vista).map((enlace) => (
        <Link
          key={enlace.periodo}
          href={enlace.href}
          aria-current={enlace.activo ? "page" : undefined}
          className={`rounded-md ${compacto ? "px-2.5 py-1" : "px-3 py-1.5"} transition ${
            enlace.activo
              ? "bg-marino text-white font-medium"
              : "text-ink-secondary hover:text-ink hover:bg-paper-cool"
          }`}
        >
          {nombreDePeriodo(enlace.periodo)}
        </Link>
      ))}
    </nav>
  );
}
