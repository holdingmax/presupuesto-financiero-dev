"use server";

import { revalidatePath } from "next/cache";
import { requireUsuarioAlDia } from "@/lib/auth";
import {
  confirmarSugerenciasDeEmpresa,
  editarMovimientoDeEmpresa,
  type ResultadoConfirmarEmpresa,
  type ResultadoEdicionEmpresa,
} from "@/lib/clasificarPorEmpresaDb";
import { esTipoSugerencia } from "@/lib/clasificarPorEmpresa";

// Clasificar los movimientos de la propia empresa (gerente con la casilla «Puede cargar Real de esta empresa»). Estas Server
// Actions se invocan directo desde el cliente: cada una autentica y delega en lib/clasificarPorEmpresaDb.ts, que vuelve a
// decidir TODO en el servidor (permiso por empresa, semana abierta, movimiento de una unidad de la empresa). No hay acá
// ninguna acción de cerrar, eliminar ni prorratear, a propósito. Las de Ejecución global (app/ejecucion/actions.ts) no se tocan.

function refrescar(periodo: string, numeroSemana: number) {
  revalidatePath("/[empresa]/[periodo]/ejecucion/[numeroSemana]", "page");
  revalidatePath("/[empresa]/[periodo]/ejecucion/mes", "page");
  revalidatePath(`/ejecucion/${periodo}/${numeroSemana}`);
}

export async function clasificarMovimientoEmpresa(
  empresaId: string,
  periodo: string,
  numeroSemana: number,
  movimientoId: string,
  datos: { clasificacion?: string; unidadNegocio?: string; ignorado?: boolean }
): Promise<ResultadoEdicionEmpresa> {
  const usuario = await requireUsuarioAlDia();
  const r = await editarMovimientoDeEmpresa(usuario, empresaId, periodo, numeroSemana, movimientoId, datos);
  if (r.ok) refrescar(periodo, numeroSemana);
  return r;
}

export async function confirmarSugerenciasEmpresa(
  empresaId: string,
  periodo: string,
  numeroSemana: number,
  tipo: "clasificacion" | "unidad"
): Promise<ResultadoConfirmarEmpresa> {
  const usuario = await requireUsuarioAlDia();
  if (!esTipoSugerencia(tipo)) return { ok: false, error: "Tipo de sugerencia no válido." };
  const r = await confirmarSugerenciasDeEmpresa(usuario, empresaId, periodo, numeroSemana, tipo);
  if (r.ok) refrescar(periodo, numeroSemana);
  return r;
}
