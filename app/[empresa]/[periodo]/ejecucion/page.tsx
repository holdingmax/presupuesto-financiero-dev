import Link from "next/link";
import { redirect } from "next/navigation";
import { obtenerMesDeEntrada, obtenerNumeroSemanaParaVer, puedeIrAlModuloGlobal } from "./datos";
import { AccesoDenegadoError } from "@/lib/auth";

type Props = {
  params: Promise<{ empresa: string; periodo: string }>;
};

// Solo lectura: nunca crea una semana (eso lo hace el módulo global, /ejecucion/[periodo], para
// quien opera). Redirige a la última semana del período para que /ejecucion/[numeroSemana] sea
// siempre una consulta.
export default async function EjecucionIndexPage({ params }: Props) {
  const { empresa, periodo } = await params;

  let numeroSemana;
  let irAlGlobal;
  let otroMes;
  try {
    // Si el mes de la URL no tiene movimientos de esta empresa (p. ej. el mes en curso, vacío), va al mes
    // más reciente que sí los tiene (primero el que tiene sin clasificar). Con movimientos, manda la URL.
    otroMes = await obtenerMesDeEntrada(empresa, periodo);
    numeroSemana = await obtenerNumeroSemanaParaVer(empresa, periodo);
    irAlGlobal = await puedeIrAlModuloGlobal(empresa, periodo);
  } catch (error) {
    // Ver el comentario equivalente en presupuesto/page.tsx: el layout ya
    // muestra el panel de "sin acceso", esto solo evita que se vea como un
    // error sin manejar cuando el chequeo defensivo vuelve a fallar acá.
    if (error instanceof AccesoDenegadoError) return null;
    throw error;
  }

  // redirect() va fuera del try (lanza una excepción propia de Next).
  if (otroMes) redirect(`/${empresa}/${otroMes.periodo}/ejecucion/${otroMes.numeroSemana}`);

  if (numeroSemana === null) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="text-sm text-ink-muted">Todavía no hay ninguna semana cargada para este período.</p>
        {irAlGlobal && (
          <Link
            href={`/ejecucion/${periodo}`}
            className="mt-3 inline-block text-sm text-marino underline underline-offset-2 hover:text-marino-dark"
          >
            Operar en Ejecución global
          </Link>
        )}
      </div>
    );
  }

  redirect(`/${empresa}/${periodo}/ejecucion/${numeroSemana}`);
}
