import type { EstadoPresupuesto, Rol } from "@prisma/client";

// Quién confirma la versión final de un presupuesto (EN_REVISION con revisión terminada → VALIDADO).
// Puro (sin Prisma ni next/*) para poder probarlo. presupuesto/actions.ts lo usa en
// confirmarVersionFinal y confirmarEnNombreDelGerente; la pantalla (FlujoPresupuesto) usa las dos
// reglas de rol para mostrar u ocultar botones, pero la decisión real está acá, en el servidor.
//
// - "Confirmar versión final": SOLO el rol GERENTE (de una empresa a la que tiene acceso).
// - "Confirmar en nombre del gerente": ADMIN, o FINANZAS con puedeRevisarPresupuesto. Pide un motivo
//   escrito (mínimo 10 caracteres) y deja constancia en el presupuesto.
// Ninguno de los dos roles puede usar la acción del otro.

export const MIN_MOTIVO_EN_NOMBRE = 10;
export const MAX_MOTIVO_EN_NOMBRE = 500;

export type ModoConfirmacion = "GERENTE" | "EN_NOMBRE";

export function puedeConfirmarComoGerente(rol: Rol): boolean {
  return rol === "GERENTE";
}

export function puedeConfirmarEnNombreDelGerente(rol: Rol, esRevisor: boolean): boolean {
  return rol === "ADMIN" || (rol === "FINANZAS" && esRevisor);
}

type ResultadoMotivo = { ok: true; motivo: string } | { ok: false; error: string };

// El motivo es obligatorio: queda como constancia de por qué no confirmó el gerente.
export function validarMotivoEnNombre(texto: unknown): ResultadoMotivo {
  const motivo = typeof texto === "string" ? texto.trim() : "";
  if (motivo.length < MIN_MOTIVO_EN_NOMBRE) {
    return { ok: false, error: `Escribí el motivo (mínimo ${MIN_MOTIVO_EN_NOMBRE} caracteres).` };
  }
  if (motivo.length > MAX_MOTIVO_EN_NOMBRE) {
    return { ok: false, error: `El motivo es demasiado largo (máximo ${MAX_MOTIVO_EN_NOMBRE} caracteres).` };
  }
  return { ok: true, motivo };
}

export type DatosConfirmacion = {
  estado: "VALIDADO";
  fechaValidacion: Date;
  validadoPorId: string;
  confirmadoEnNombreDeGerente: boolean;
  motivoConfirmacionEnNombre: string | null;
};

export type EntradaConfirmacion = {
  modo: ModoConfirmacion;
  usuario: { id: string; rol: Rol };
  // ¿Puede revisar presupuestos de esta empresa? (puedeRevisarPresupuesto). Solo cuenta para FINANZAS.
  esRevisor: boolean;
  presupuesto: { id: string; estado: EstadoPresupuesto; revisionCompletada: boolean };
  motivo?: unknown;
  ahora?: Date;
};

type Decision = { ok: true; datos: DatosConfirmacion } | { ok: false; error: string };

// Todas las reglas, en orden: rol, estado, revisión terminada y (solo "en nombre") motivo.
export function decidirConfirmacion(e: EntradaConfirmacion): Decision {
  if (e.modo === "GERENTE") {
    if (!puedeConfirmarComoGerente(e.usuario.rol)) {
      return { ok: false, error: "Solo el gerente de la empresa puede confirmar la versión final." };
    }
  } else if (!puedeConfirmarEnNombreDelGerente(e.usuario.rol, e.esRevisor)) {
    return { ok: false, error: "No tenés permiso para confirmar en nombre del gerente." };
  }
  if (e.presupuesto.estado !== "EN_REVISION") {
    return { ok: false, error: "Este presupuesto no está en revisión." };
  }
  if (!e.presupuesto.revisionCompletada) {
    return { ok: false, error: "Todavía no marcaron que terminaron de revisar este presupuesto." };
  }
  const ahora = e.ahora ?? new Date();
  if (e.modo === "GERENTE") {
    return {
      ok: true,
      datos: {
        estado: "VALIDADO",
        fechaValidacion: ahora,
        validadoPorId: e.usuario.id,
        confirmadoEnNombreDeGerente: false,
        motivoConfirmacionEnNombre: null,
      },
    };
  }
  const motivo = validarMotivoEnNombre(e.motivo);
  if (!motivo.ok) return motivo;
  return {
    ok: true,
    datos: {
      estado: "VALIDADO",
      fechaValidacion: ahora,
      validadoPorId: e.usuario.id,
      confirmadoEnNombreDeGerente: true,
      motivoConfirmacionEnNombre: motivo.motivo,
    },
  };
}

// Lo mínimo que se necesita de prisma.presupuestoMensual (así se prueba con una base falsa).
export type DbConfirmacion = {
  updateMany(args: {
    where: { id: string; estado: "EN_REVISION"; revisionCompletada: true };
    data: DatosConfirmacion;
  }): Promise<{ count: number }>;
};

export const ERROR_CAMBIO_MIENTRAS_CONFIRMABA =
  "El presupuesto cambió mientras lo confirmabas. Recargá la pantalla y revisá su estado.";

// Decide y escribe. Guardia atómica: las condiciones se repiten en el WHERE, así VALIDADO solo se
// escribe si sigue EN_REVISION y completada (otra persona pudo cambiar el estado en el medio).
// Con cualquier rechazo de decidirConfirmacion no se llama a la base.
export async function ejecutarConfirmacion(
  db: DbConfirmacion,
  e: EntradaConfirmacion
): Promise<{ ok: true } | { ok: false; error: string }> {
  const decision = decidirConfirmacion(e);
  if (!decision.ok) return decision;
  const { count } = await db.updateMany({
    where: { id: e.presupuesto.id, estado: "EN_REVISION", revisionCompletada: true },
    data: decision.datos,
  });
  if (count === 0) return { ok: false, error: ERROR_CAMBIO_MIENTRAS_CONFIRMABA };
  return { ok: true };
}
