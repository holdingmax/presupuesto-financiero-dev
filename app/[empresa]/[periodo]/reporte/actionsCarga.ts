"use server";

import { revalidatePath } from "next/cache";
import { resolverEmpresaPorSlug } from "@/lib/slug";
import { requireAccesoEmpresa, puedeRevisarPresupuesto, esAdminOFinanzas } from "@/lib/auth";
import { mensajePeriodoSoloLectura, puedeEditarPeriodoComoGerente, puedeVerPeriodo } from "@/lib/periodosHabilitados";
import { cargaEnReporteActiva } from "@/lib/estadoPresupuesto";
import { plantillaDeEmpresa } from "@/lib/reporte/plantillas";
import { aplicarCargaPresupuesto, type ResultadoCarga } from "@/lib/reporte/aplicarCarga";
import type { EntradaCarga } from "@/lib/reporte/cargaGerente";

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

export type ResultadoGuardado = ResultadoCarga;

// Guarda el Presupuestado que el gerente tipea en el Reporte (Etapas 2 y 3): una LineaPresupuesto
// por clasificación (para que Presupuesto, la barra de totales y el Reporte sigan de acuerdo) y los
// valores manuales de Presupuestado de las filas manuales y del Capital de trabajo. Real,
// Disponibilidades y el resto de Cierre no se tocan: esta acción solo escribe las claves que el
// servidor calcula como editables. guardarValoresManuales (solo ADMIN/FINANZAS) no se modifica.
// Las guardas de autorización van acá; las de estado y de qué celda es editable, dentro de la
// transacción de aplicarCargaPresupuesto (lib/reporte/aplicarCarga.ts).
export async function guardarPresupuestoDelReporte(
  empresaSlug: string,
  periodo: string,
  entradas: EntradaCarga[]
): Promise<ResultadoGuardado> {
  if (!FORMATO_PERIODO.test(periodo)) return { ok: false, error: "Período inválido." };
  const empresa = await resolverEmpresaPorSlug(empresaSlug);
  if (!empresa) return { ok: false, error: "No encontré esa empresa." };
  // El usuario tiene acceso a ESTA empresa (ADMIN a todas; el resto, por su fila de UsuarioEmpresa).
  const usuario = await requireAccesoEmpresa(empresa.id);
  const adminOFinanzas = esAdminOFinanzas(usuario);
  // Fuera de los períodos habilitados no entra nadie (tampoco ADMIN ni FINANZAS).
  if (!puedeVerPeriodo(periodo)) {
    return { ok: false, error: "El presupuesto de este mes todavía no está habilitado." };
  }
  // El gerente solo edita el mes en curso de carga (PERIODO_EN_CARGA_GERENTE); ADMIN y FINANZAS, todos.
  if (!puedeEditarPeriodoComoGerente(periodo, adminOFinanzas)) {
    return { ok: false, error: mensajePeriodoSoloLectura() };
  }
  // Interruptor por empresa (lib/config.ts): apagado, esta acción no hace nada.
  if (!cargaEnReporteActiva(empresaSlug)) {
    return { ok: false, error: "La carga desde el Reporte no está habilitada para esta empresa." };
  }
  const plantilla = plantillaDeEmpresa(empresaSlug);
  if (!plantilla) return { ok: false, error: "Esta empresa no tiene reporte por plantilla." };

  const resultado = await aplicarCargaPresupuesto({
    empresaId: empresa.id,
    periodo,
    plantilla,
    entradas,
    esAdminOFinanzas: adminOFinanzas,
    esRevisor: await puedeRevisarPresupuesto(usuario, empresa.id),
    usuarioId: usuario.id,
  });

  if (resultado.ok) {
    revalidatePath(`/${empresaSlug}/${periodo}/presupuesto`);
    revalidatePath(`/${empresaSlug}/${periodo}/reporte`);
  }
  return resultado;
}
