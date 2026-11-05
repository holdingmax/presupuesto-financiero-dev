import Link from "next/link";
import { redirect } from "next/navigation";
import { obtenerDatos } from "./actions";
import { AccesoDenegadoError, esAdminOFinanzas, requireUsuarioAlDia } from "@/lib/auth";
import { ocultaPestanaPresupuesto } from "@/lib/navegacionEmpresa";
import { PERIODO_POR_DEFECTO } from "@/lib/config";
import { PeriodoNoHabilitadoError } from "@/lib/periodosHabilitados";
import { nombreDePeriodo } from "@/lib/ejecucionSemanas";
import PeriodoSelector from "./PeriodoSelector";
import PresupuestoForm from "./PresupuestoForm";

type Props = {
  params: Promise<{ empresa: string; periodo: string }>;
};

export default async function PresupuestoPage({ params }: Props) {
  const { empresa, periodo } = await params;

  // El gerente de una empresa que carga en el Reporte no usa esta pantalla (ni ve su pestaña): si
  // entra por URL directa va al Reporte del mismo mes. Solo la pantalla: las acciones no cambian.
  // Va antes del try: redirect() lanza una excepción que no hay que atrapar.
  if (ocultaPestanaPresupuesto(esAdminOFinanzas(await requireUsuarioAlDia()), empresa)) {
    redirect(`/${empresa}/${periodo}/reporte`);
  }

  let datos;
  try {
    datos = await obtenerDatos(empresa, periodo);
  } catch (error) {
    // El layout ya validó el acceso y muestra su propio panel de "sin
    // acceso" — este chequeo (repetido adentro de obtenerDatos, defensivo
    // para cuando se invoca como Server Action) puede volver a fallar acá
    // porque Next arranca a resolver esta página en paralelo con el layout.
    // No hay nada más para renderizar en ese caso: el layout ya lo cubre.
    if (error instanceof AccesoDenegadoError) return null;
    // Período fuera de la lista de lib/config.ts, para alguien que no es ADMIN ni FINANZAS.
    if (error instanceof PeriodoNoHabilitadoError) {
      return (
        <div className="mx-auto w-full max-w-5xl px-6 py-10">
          <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
            El presupuesto de este mes todavía no está habilitado.{" "}
            <Link
              href={`/${empresa}/${PERIODO_POR_DEFECTO}/presupuesto`}
              className="underline underline-offset-2"
            >
              Ir al presupuesto de {nombreDePeriodo(PERIODO_POR_DEFECTO)}
            </Link>
          </p>
        </div>
      );
    }
    throw error;
  }

  return (
    <>
      <PeriodoSelector empresaSlug={empresa} periodo={periodo} />
      <PresupuestoForm
        empresaNombre={datos.empresaNombre}
        periodo={datos.periodo}
        estado={datos.estado}
        fueModificadoPorRevisor={datos.fueModificadoPorRevisor}
        revisionCompletada={datos.revisionCompletada}
        validacion={datos.validacion}
        pedidoCambios={datos.pedidoCambios}
        esRevisor={datos.esRevisor}
        puedeConfirmarFinal={datos.puedeConfirmarFinal}
        puedeConfirmarEnNombre={datos.puedeConfirmarEnNombre}
        avisoSoloLectura={datos.avisoSoloLectura}
        lineasIniciales={datos.lineas}
        totales={datos.totales}
      />
    </>
  );
}
