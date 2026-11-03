import {
  EMPRESAS_CON_FILAS_EXTRA,
  EMPRESAS_CON_TIPEO_DIRECTO,
  EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE,
} from "@/lib/config";
import { camposManuales, type Bloque, type CampoManual, type Plantilla } from "@/lib/reporte/motor";
import {
  AVISO_UNA_VEZ,
  formatearCentavos,
  motivoBloqueo,
  motivoRechazoCambio,
  type EstadoSemanas,
} from "@/lib/reporte/bloqueo";
import { esClaveDeFilaExtra } from "@/lib/reporte/filasExtra";

// Tipeo directo en el Reporte (ADMIN y FINANZAS): el Real manual de las filas de la plantilla, el Presupuestado de las
// que lo tienen pisable, el del Capital de trabajo y, en las filas extra, también el Presupuestado. Puro: sin Prisma ni next/*, para poder probarlo. Define qué celdas se pueden
// tipear, cuáles de ellas viajan a la pantalla y qué rechaza el servidor. El guardado lo hace
// guardarValoresManuales (reporte/carga/actions.ts): ahí viven la validación contra la plantilla, los importes
// (lib/importes.ts) y la regla de bloqueo.

export type InterruptoresTipeo = {
  tipeo: readonly string[];
  disponibilidades: readonly string[];
  // Filas extra (lib/reporte/filasExtra.ts). Sin definir, el de lib/config.ts.
  filasExtra?: readonly string[];
};

const DE_CONFIG: InterruptoresTipeo = {
  tipeo: EMPRESAS_CON_TIPEO_DIRECTO,
  disponibilidades: EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE,
  filasExtra: EMPRESAS_CON_FILAS_EXTRA,
};

// Cierre es reservado: de él solo se tipea el Presupuestado del Capital de trabajo (ver camposTipeables); el resto no.
const BLOQUES_DE_FLUJO: readonly Bloque[] = ["INGRESOS", "EGRESOS", "ABAJO"];

export function tipeoDirectoActivo(empresaSlug: string, interruptores: InterruptoresTipeo = DE_CONFIG): boolean {
  return interruptores.tipeo.includes(empresaSlug);
}

// Fila de la plantilla cuyo Presupuestado derivado (Disponible o espejo) se puede pisar con un valor tipeado.
function tienePresupuestoPisable(f: Plantilla["filas"][number]): boolean {
  return (
    f.tipo === "linea" &&
    (f.presupuesto.tipo === "disponible" || f.presupuesto.tipo === "espejo") &&
    f.presupuesto.pisableConManual === true
  );
}

// Campos que se pueden tipear en el Reporte de esta empresa. Sin interruptor, ninguno.
// - Filas de la plantilla: el Real manual (los de Disponibilidades, solo si la empresa también ve ese bloque) y el
//   Presupuestado de las que lo tienen pisable (pisableConManual: Mantenor «Prestamos», Havanna «Acreditación Tarjetas»).
// - Cierre: el Presupuestado del Capital de trabajo (fila `capital`); vacío = la regla de la plantilla.
// - Filas extra (clave «extra.<id>», solo si la plantilla que se pasa las trae): Presupuestado y Real.
export function camposTipeables(
  plantilla: Plantilla,
  empresaSlug: string,
  interruptores: InterruptoresTipeo = DE_CONFIG
): CampoManual[] {
  if (!tipeoDirectoActivo(empresaSlug, interruptores)) return [];
  const conDisponibilidades = interruptores.disponibilidades.includes(empresaSlug);
  const conFilasExtra = (interruptores.filasExtra ?? EMPRESAS_CON_FILAS_EXTRA).includes(empresaSlug);
  const pisables = new Set(plantilla.filas.filter(tienePresupuestoPisable).map((f) => f.clave));
  const capitales = new Set(plantilla.filas.filter((f) => f.tipo === "capital").map((f) => f.clave));
  return camposManuales(plantilla).filter((c) => {
    if (esClaveDeFilaExtra(c.clave)) return conFilasExtra && BLOQUES_DE_FLUJO.includes(c.bloque);
    if (c.columna === "PRESUPUESTADO") {
      // Del Cierre solo el Capital de trabajo (fila `capital`): ni Disponible ni Saldo ni el Capital que es una línea o un total.
      if (c.bloque === "CIERRE") return capitales.has(c.clave);
      return pisables.has(c.clave) && BLOQUES_DE_FLUJO.includes(c.bloque);
    }
    return (
      c.columna === "REAL" &&
      (c.bloque === "DISPONIBILIDADES" ? conDisponibilidades : BLOQUES_DE_FLUJO.includes(c.bloque))
    );
  });
}

// Texto gris de una celda de Presupuestado vacía: el valor que calcula la regla de la plantilla (formato argentino, el mismo
// que acepta el input), para que se vea qué se usa si no se tipea nada. Con un valor guardado la celda no está vacía y el
// texto no se ve; sin derivado queda «0».
export function placeholderDeCelda(importeInicial: string, derivado: number | null | undefined): string {
  if (importeInicial !== "" || derivado === null || derivado === undefined) return "0";
  return formatearCentavos(derivado);
}

export const AVISO_PRESUPUESTO_VALIDADO = "Presupuesto validado: solo se puede cargar una vez";

// Una celda editable que viaja a la pantalla. Las que el bloqueo deja en solo lectura (valor ya cargado en
// un período cerrado, o Presupuestado de un Presupuesto validado) NO viajan: el Reporte las muestra como siempre.
export type CeldaTipeo = {
  // «clave|columna»: único por celda (una fila extra tiene dos).
  id: string;
  clave: string;
  columna: "PRESUPUESTADO" | "REAL";
  texto: string;
  // "1.234,56" (formato argentino, el mismo que acepta leerCuenta) o "" si no hay valor.
  importeInicial: string;
  // Bloqueada pero vacía: se puede cargar una sola vez.
  avisoUnaVez: boolean;
  aviso: string | null;
};

export type VistaTipeo = {
  celdas: CeldaTipeo[];
  // Cambia cuando cambian los valores guardados: la pantalla reemplaza lo tipeado por lo guardado.
  huella: string;
};

export type EntradaVistaTipeo = {
  empresaSlug: string;
  // La plantilla del REPORTE: con las filas extra del mes, si la empresa las tiene.
  plantilla: Plantilla;
  esAdminOFinanzas: boolean;
  // Mes de la URL (la última columna) y mes de hoy.
  periodo: string;
  actual: string;
  semanas: EstadoSemanas;
  // Real manual guardado del mes: filaClave → centavos.
  valoresReales: ReadonlyMap<string, number>;
  // Presupuestado manual guardado del mes (solo se tipea el de las filas extra).
  valoresPresupuesto?: ReadonlyMap<string, number>;
  // El PresupuestoMensual del mes está VALIDADO: bloquea la columna Presupuestado.
  presupuestoValidado?: boolean;
  interruptores?: InterruptoresTipeo;
};

// null = el Reporte no lleva ninguna celda editable de este tipo. Quien no es ADMIN ni FINANZAS recibe
// null SIEMPRE, con el interruptor que sea: ni celdas, ni claves, ni valores.
export function armarVistaTipeo(e: EntradaVistaTipeo): VistaTipeo | null {
  if (!e.esAdminOFinanzas) return null;
  const celdas: CeldaTipeo[] = [];
  for (const c of camposTipeables(e.plantilla, e.empresaSlug, e.interruptores)) {
    const existente = (c.columna === "REAL" ? e.valoresReales : e.valoresPresupuesto)?.get(c.clave);
    const bloqueo = motivoBloqueo({
      periodo: e.periodo,
      actual: e.actual,
      columna: c.columna,
      bloque: c.bloque,
      presupuestoValidado: e.presupuestoValidado ?? false,
      semanas: e.semanas,
    });
    // Carga única en cerrado: crear sí, modificar o borrar un valor ya cargado no. Sin override.
    if (motivoRechazoCambio(bloqueo, existente !== undefined) !== null) continue;
    celdas.push({
      id: `${c.clave}|${c.columna}`,
      clave: c.clave,
      columna: c.columna,
      texto: c.texto.trim(),
      importeInicial: existente === undefined ? "" : formatearCentavos(existente),
      avisoUnaVez: bloqueo !== null,
      aviso: bloqueo === null ? null : c.columna === "REAL" ? AVISO_UNA_VEZ : AVISO_PRESUPUESTO_VALIDADO,
    });
  }
  if (celdas.length === 0) return null;
  return { celdas, huella: celdas.map((c) => `${c.id}=${c.importeInicial}`).join("|") };
}

export type EntradaTipeo = { filaClave: string; columna: "PRESUPUESTADO" | "REAL"; texto: string };

// Lo que el servidor rechaza ANTES de delegar en guardarValoresManuales. null = se puede seguir.
export function motivoRechazoTipeo(args: {
  empresaSlug: string;
  // La plantilla del REPORTE del mes (con las filas extra).
  plantilla: Plantilla;
  esAdminOFinanzas: boolean;
  entradas: readonly EntradaTipeo[];
  interruptores?: InterruptoresTipeo;
}): string | null {
  if (!args.esAdminOFinanzas) return "Solo ADMIN y FINANZAS pueden cargar valores desde el Reporte.";
  if (!tipeoDirectoActivo(args.empresaSlug, args.interruptores)) {
    return "El tipeo directo en el Reporte no está habilitado para esta empresa.";
  }
  const permitidos = new Set(
    camposTipeables(args.plantilla, args.empresaSlug, args.interruptores).map((c) => `${c.clave}|${c.columna}`)
  );
  for (const e of args.entradas) {
    if (!permitidos.has(`${e.filaClave}|${e.columna}`)) {
      return `"${e.filaClave}" no se puede tipear desde el Reporte.`;
    }
  }
  return null;
}
