import Link from "next/link";
import { enlacesDeModo, modoDePeriodo, type VistaReporte } from "@/lib/reporte/vistaReporte";

const COLUMNAS: { vista: VistaReporte; texto: string }[] = [
  { vista: "actual", texto: "Un mes" },
  { vista: "todo", texto: "Columnas juntas" },
];

const CLASE_LINK =
  "inline-flex min-h-9 items-center rounded-md px-3 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marino";
const CLASE_ACTIVO = "bg-marino text-white font-medium";
const CLASE_INACTIVO = "text-ink-secondary hover:text-ink hover:bg-paper-cool";

// Interruptor «Mes en curso | Meses anteriores» del Reporte. El modo sale del período de la URL
// (lib/reporte/vistaReporte.ts), así que siempre marca lo que se está viendo; son links, sin estado en el
// cliente. En «Meses anteriores» suma «Un mes | Columnas juntas» (?vista=); los botones de mes los pone
// la página. Control segmentado: rectángulo con borde; la opción activa va en marino lleno (aria-current="page").
export default function VistaSelector({
  empresaSlug,
  periodo,
  vista,
}: {
  empresaSlug: string;
  periodo: string;
  vista: VistaReporte;
}) {
  const enAnteriores = modoDePeriodo(periodo) === "anteriores";
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <nav
        aria-label="Período del reporte"
        className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-line-strong bg-paper-raised p-1 text-xs"
      >
        {enlacesDeModo(empresaSlug, periodo).map((e) => (
          <Link
            key={e.modo}
            href={e.href}
            aria-current={e.activo ? "page" : undefined}
            className={`${CLASE_LINK} ${e.activo ? CLASE_ACTIVO : CLASE_INACTIVO}`}
          >
            {e.texto}
          </Link>
        ))}
      </nav>
      {enAnteriores && (
        <nav
          aria-label="Columnas del reporte"
          className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-line-strong bg-paper-raised p-1 text-xs"
        >
          {COLUMNAS.map((o) => (
            <Link
              key={o.vista}
              href={`/${empresaSlug}/${periodo}/reporte?vista=${o.vista}`}
              aria-current={o.vista === vista ? "page" : undefined}
              className={`${CLASE_LINK} ${o.vista === vista ? CLASE_ACTIVO : CLASE_INACTIVO}`}
            >
              {o.texto}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
