import { nombreDePeriodo } from "@/lib/ejecucionSemanas";
import { formatearDiaMes } from "@/lib/fecha";

// Reglas PURAS de "Reabrir semana para corregir" (solo ADMIN). Sin Prisma ni next/*: las usan la acción
// (app/ejecucion/actionsReabrir.ts), el núcleo con base (lib/reaperturaSemanaDb.ts), la pantalla y los tests.

export const MOTIVO_MINIMO = 10;
export const MOTIVO_MAXIMO = 500;

// El motivo es obligatorio y se valida SIEMPRE en el servidor (la pantalla solo ayuda). Se guarda sin espacios sobrantes.
export function validarMotivo(texto: unknown): { ok: true; motivo: string } | { ok: false; error: string } {
  const motivo = typeof texto === "string" ? texto.trim() : "";
  if (motivo.length < MOTIVO_MINIMO) {
    return { ok: false, error: `Contá por qué se reabre la semana (mínimo ${MOTIVO_MINIMO} caracteres).` };
  }
  if (motivo.length > MOTIVO_MAXIMO) {
    return { ok: false, error: `El motivo es muy largo (máximo ${MOTIVO_MAXIMO} caracteres).` };
  }
  return { ok: true, motivo };
}

// Lo que cuelga de OTRA semana ABIERTA del mismo período (ver decidirOtrasAbiertas).
export type OtraSemanaAbierta = {
  numeroSemana: number;
  movimientos: number;
  adjuntos: number;
  desgloses: number;
  // Reaperturas registradas de esa semana: la clave foránea (RESTRICT) impide borrarla, y además es historial.
  reaperturas: number;
};

export type DecisionOtrasAbiertas =
  | { tipo: "ninguna" }
  // Todas las otras abiertas están vacías de verdad (ni movimientos, ni adjuntos, ni desgloses, ni historial): se borran
  // en la misma transacción y se registra el número.
  | { tipo: "borrar"; numeros: number[] }
  | { tipo: "rechazar"; numeroSemana: number; mensaje: string };

function pluralizar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

// Solo puede haber UNA semana abierta por período (lo sostiene el código y el lock del período, no un índice de la base).
// Si al reabrir la N ya hay otra abierta M: vacía => se borra; con algo adentro => se rechaza nombrándola y pidiendo
// cerrarla primero con el cierre normal.
export function decidirOtrasAbiertas(
  otras: OtraSemanaAbierta[],
  contexto: { periodo: string; numeroReabierta: number }
): DecisionOtrasAbiertas {
  if (otras.length === 0) return { tipo: "ninguna" };
  const conContenido = [...otras]
    .sort((a, b) => a.numeroSemana - b.numeroSemana)
    .find((o) => o.movimientos > 0 || o.adjuntos > 0 || o.desgloses > 0 || o.reaperturas > 0);
  if (!conContenido) return { tipo: "borrar", numeros: otras.map((o) => o.numeroSemana).sort((a, b) => a - b) };

  const partes: string[] = [];
  if (conContenido.movimientos > 0) partes.push(pluralizar(conContenido.movimientos, "movimiento", "movimientos"));
  if (conContenido.adjuntos > 0) partes.push(pluralizar(conContenido.adjuntos, "adjunto", "adjuntos"));
  if (conContenido.desgloses > 0) partes.push(pluralizar(conContenido.desgloses, "prorrateo", "prorrateos"));
  if (conContenido.reaperturas > 0) partes.push("un historial de reaperturas");
  return {
    tipo: "rechazar",
    numeroSemana: conContenido.numeroSemana,
    mensaje:
      `No se puede reabrir la semana ${contexto.numeroReabierta} de ${nombreDePeriodo(contexto.periodo)}: ` +
      `la semana ${conContenido.numeroSemana} del período está abierta y tiene ${partes.join(", ")}. ` +
      `Cerrala primero con el cierre normal y después reabrí la semana ${contexto.numeroReabierta}.`,
  };
}

// Mes pasado: lo que se avisa en el cuadro de confirmación cuando se reabre una semana de un mes ya terminado.
export function esMesViejo(periodo: string, actual: string): boolean {
  return periodo < actual;
}

// Las tres cosas que SIEMPRE avisa el cuadro de confirmación (decisión de Kike), más una cuarta si el mes ya pasó
// (decisión por defecto mientras Kike no confirme si se permiten meses viejos).
export function avisosDeReapertura(periodo: string, numeroSemana: number, actual: string): string[] {
  const mes = nombreDePeriodo(periodo);
  const avisos = [
    `Mientras la semana ${numeroSemana} esté reabierta, deja de contar en el Reporte: el Real de ${mes} baja (o queda en "—") hasta que la cierres de nuevo.`,
    `Se destraban los valores manuales de ${mes}: mientras haya una semana abierta, el mes deja de estar cerrado para el Reporte, y el Real manual de flujo (y Disponibilidades, si esta era la única semana cerrada) vuelven a poder modificarse.`,
    `Cualquier carga de ${mes} (archivo madre o extracto) va a entrar en la semana ${numeroSemana} hasta que se cierre.`,
  ];
  if (esMesViejo(periodo, actual)) {
    avisos.push(`${mes} ya terminó: estás reabriendo una semana de un mes cerrado.`);
  }
  return avisos;
}

// Lo que ve el ADMIN de cada reapertura (fechas como texto ISO: viajan a la pantalla).
export type ReaperturaVista = {
  id: string;
  usuarioNombre: string;
  motivo: string;
  creadaEn: string;
  movimientosAlReabrir: number;
  semanaVaciaEliminada: number | null;
};

// "Reabierta por Leticia el 20/11. Motivo: …"
export function textoReapertura(r: Pick<ReaperturaVista, "usuarioNombre" | "creadaEn" | "motivo">): string {
  return `Reabierta por ${r.usuarioNombre} el ${formatearDiaMes(r.creadaEn)}. Motivo: ${r.motivo}`;
}

// La reapertura que está "vigente": la semana está ABIERTA y tiene reaperturas (una semana nunca cerrada no tiene
// ninguna: solo se registran al reabrir). Después de volver a cerrarla ya no hay indicador, queda el historial.
// `reaperturas` viene de la más nueva a la más vieja.
export function reaperturaVigente(estado: string, reaperturas: ReaperturaVista[]): ReaperturaVista | null {
  return estado === "ABIERTA" && reaperturas.length > 0 ? reaperturas[0] : null;
}
