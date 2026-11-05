import { prisma } from "@/lib/prisma";
import type { EstadoPresupuesto, PresupuestoMensual, Usuario } from "@prisma/client";
import { resolverEmpresaPorSlug } from "@/lib/slug";
import { obtenerOCrearPresupuesto } from "@/lib/presupuesto";
import { requireAccesoEmpresa, puedeRevisarPresupuesto, esAdminOFinanzas } from "@/lib/auth";
import {
  PeriodoNoHabilitadoError,
  mensajePeriodoSoloLectura,
  puedeEditarPeriodoComoGerente,
  puedeVerPeriodo,
} from "@/lib/periodosHabilitados";
import { puedeEditarPresupuestoAhora } from "@/lib/estadoPresupuesto";

// Piezas del servidor compartidas por las Server Actions de Presupuesto
// (A/presupuesto/actions.ts) y por el Reporte. No es un archivo "use server": no expone
// acciones al cliente, solo funciones que las acciones y las páginas llaman por dentro.

// El layout de [empresa]/[periodo] ya garantiza, al renderizar la página, que
// el slug matchea una empresa real y que el usuario logueado tiene acceso a
// ella. Esta resolución (empresa + autorización + usuario) es defensiva para
// las Server Actions, que se invocan directo desde el cliente y no vuelven a
// pasar por el layout.
export async function resolverEmpresaYPresupuesto(empresaSlug: string, periodo: string) {
  const empresa = await resolverEmpresaPorSlug(empresaSlug);
  if (!empresa) {
    throw new Error(`No existe una empresa para "${empresaSlug}".`);
  }
  const usuario = await requireAccesoEmpresa(empresa.id);
  // Fuera de la lista de períodos habilitados no entra nadie (tampoco ADMIN ni FINANZAS). Va ANTES de
  // obtenerOCrearPresupuesto: un período no habilitado no tiene que crear ninguna fila.
  if (!puedeVerPeriodo(periodo)) {
    throw new PeriodoNoHabilitadoError(periodo);
  }
  const presupuesto = await obtenerOCrearPresupuesto(empresa.id, periodo);
  return { empresa, presupuesto, usuario };
}

export type ResultadoAutorizacion = { ok: true } | { ok: false; error: string };

// Único punto de autorización para las acciones que mutan líneas de un
// presupuesto (agregarLinea/editarLinea/eliminarLinea/guardarDesglose/
// eliminarDesglose/subirLineasMasivo). Depende del estado: en ABIERTO,
// cualquiera con acceso a la empresa (igual que siempre, ver
// requireAccesoEmpresa arriba); en EN_REVISION, solo quien tiene
// puedeRevisarPresupuesto (o ADMIN); en VALIDADO, nadie. La regla pura vive en
// puedeEditarPresupuestoAhora (lib/estadoPresupuesto.ts); acá solo se eligen los mensajes. Antes del
// estado va el período (puedeEditarPeriodoComoGerente).
export async function autorizarEdicionLinea(
  usuario: Usuario,
  empresaId: string,
  presupuesto: PresupuestoMensual
): Promise<ResultadoAutorizacion> {
  // Primero el período: el gerente solo edita el mes en curso de carga (ADMIN y FINANZAS, todos).
  if (!puedeEditarPeriodoComoGerente(presupuesto.periodo, esAdminOFinanzas(usuario))) {
    return { ok: false, error: mensajePeriodoSoloLectura() };
  }
  if (presupuesto.estado === "VALIDADO") {
    return { ok: false, error: "Este presupuesto ya está validado, no se puede editar." };
  }
  const esRevisor = presupuesto.estado === "EN_REVISION" ? await puedeRevisarPresupuesto(usuario, empresaId) : false;
  if (!puedeEditarPresupuestoAhora(presupuesto.estado, esRevisor)) {
    return {
      ok: false,
      error: "Este presupuesto está en revisión — mientras dure, solo quien lo revisa puede modificarlo.",
    };
  }
  return { ok: true };
}

// Después de una mutación exitosa hecha por el revisor mientras el
// presupuesto está EN_REVISION: marca que hubo cambios (aviso mínimo para el
// gerente, sin detalle línea por línea) y resetea revisionCompletada — si el
// revisor sigue tocando algo después de haber marcado "Terminé de revisar",
// tiene que volver a marcarlo. No hace nada en ABIERTO (nada que avisar ni
// resetear todavía).
export async function marcarComoModificadoSiEnRevision(presupuesto: PresupuestoMensual) {
  if (presupuesto.estado !== "EN_REVISION") return;
  await prisma.presupuestoMensual.update({
    where: { id: presupuesto.id },
    data: { fueModificadoPorRevisor: true, revisionCompletada: false },
  });
}

export type EstadoFlujo = {
  estado: EstadoPresupuesto;
  fueModificadoPorRevisor: boolean;
  revisionCompletada: boolean;
  // "Validado por X el dd/mm". por = null en presupuestos validados antes de que se guardara
  // validadoPorId.
  validacion: { fecha: string; por: string | null } | null;
  // Último pedido de cambios del revisor (null si nunca hubo). La pantalla lo muestra solo en ABIERTO.
  pedidoCambios: { mensaje: string; fecha: string; por: string | null } | null;
  esRevisor: boolean;
  cantidadLineas: number;
};

// Estado del flujo de UN presupuesto para pintar el bloque de estado y botones en el Reporte.
// SOLO LEE: si el mes no tiene PresupuestoMensual no lo crea (mirar el Reporte no escribe en
// la base); queda como ABIERTO sin líneas, que es lo que sería al crearse. Mismos datos que
// arma obtenerDatos de Presupuesto, sin las líneas.
export async function obtenerEstadoFlujo(
  empresaId: string,
  periodo: string,
  esRevisor: boolean
): Promise<EstadoFlujo> {
  const presupuesto = await prisma.presupuestoMensual.findUnique({
    where: { empresaId_periodo: { empresaId, periodo } },
  });
  if (!presupuesto) {
    return {
      estado: "ABIERTO",
      fueModificadoPorRevisor: false,
      revisionCompletada: false,
      validacion: null,
      pedidoCambios: null,
      esRevisor,
      cantidadLineas: 0,
    };
  }
  const [cantidadLineas, ultimoPedido] = await Promise.all([
    prisma.lineaPresupuesto.count({ where: { presupuestoId: presupuesto.id } }),
    prisma.pedidoCambiosPresupuesto.findFirst({
      where: { presupuestoId: presupuesto.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const nombreDe = async (id: string | null) =>
    id ? ((await prisma.usuario.findUnique({ where: { id }, select: { nombre: true } }))?.nombre ?? null) : null;
  return {
    estado: presupuesto.estado,
    fueModificadoPorRevisor: presupuesto.fueModificadoPorRevisor,
    revisionCompletada: presupuesto.revisionCompletada,
    validacion: presupuesto.fechaValidacion
      ? { fecha: presupuesto.fechaValidacion.toISOString(), por: await nombreDe(presupuesto.validadoPorId) }
      : null,
    pedidoCambios: ultimoPedido
      ? {
          mensaje: ultimoPedido.mensaje,
          fecha: ultimoPedido.createdAt.toISOString(),
          por: await nombreDe(ultimoPedido.solicitadoPorId),
        }
      : null,
    esRevisor,
    cantidadLineas,
  };
}
