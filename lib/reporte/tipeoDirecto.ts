import {
  EMPRESAS_CON_FILAS_EXTRA,
  EMPRESAS_CON_TIPEO_DIRECTO,
  EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE,
} from "@/lib/config";
import { camposManuales, type Bloque, type CampoManual, type Plantilla } from "@/lib/reporte/motor";
import {
  AVISO_UNA_VEZ,
  formatearPesos,
  valorExactoConCentavos,
  motivoBloqueo,
  motivoRechazoCambio,
  type EstadoSemanas,
} from "@/lib/reporte/bloqueo";
import { leerCuenta } from "@/lib/importes";
import { esClaveDeFilaExtra } from "@/lib/reporte/filasExtra";
import { ERROR_SIN_PERMISO_DE_CARGAR_REAL } from "@/lib/permisosReal";

export const ERROR_SOLO_REAL = "Con tu permiso solo podés cargar el Real; el Presupuestado va por su flujo.";
export const ERROR_SOLO_ADMIN_FINANZAS_CAPITAL = "El Capital de trabajo lo cargan solo ADMIN y FINANZAS.";

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

// Cierre es reservado: de él solo se tipea el Capital de trabajo (ver camposTipeables); el resto no. Y solo ADMIN y FINANZAS:
// el gerente nunca recibe ni guarda una celda de Cierre.
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
// - Cierre: el Presupuestado del Capital de trabajo (fila `capital`); vacío = la regla de la plantilla. Y el Capital que es
//   una LÍNEA manual (Bradenton y Havanna Perú: valor tipeado en P y en R): Presupuestado y Real. El de un total (Plate
//   Silver) y Disponible/Saldo/Excedente no abren celda. Estas celdas son solo de ADMIN y FINANZAS (ver armarVistaTipeo).
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
  // Capital de trabajo tipeado como línea de Cierre (P y R manuales): solo existe en Bradenton y Havanna Perú.
  const capitalesLinea = new Set(plantilla.filas.filter((f) => f.tipo === "linea" && f.bloque === "CIERRE").map((f) => f.clave));
  return camposManuales(plantilla).filter((c) => {
    if (esClaveDeFilaExtra(c.clave)) return conFilasExtra && BLOQUES_DE_FLUJO.includes(c.bloque);
    if (c.bloque === "CIERRE") {
      // Del Cierre solo el Capital de trabajo: la fila `capital` (solo Presupuestado) o la línea manual (P y R). Ni Disponible
      // ni Saldo ni el Capital que es un total.
      return c.columna === "PRESUPUESTADO" ? capitales.has(c.clave) || capitalesLinea.has(c.clave) : capitalesLinea.has(c.clave);
    }
    if (c.columna === "PRESUPUESTADO") {
      return pisables.has(c.clave) && BLOQUES_DE_FLUJO.includes(c.bloque);
    }
    return (
      c.columna === "REAL" &&
      (c.bloque === "DISPONIBILIDADES" ? conDisponibilidades : BLOQUES_DE_FLUJO.includes(c.bloque))
    );
  });
}

// Texto gris de una celda de Presupuestado vacía: el valor que calcula la regla de la plantilla (formato argentino, en
// pesos enteros: solo se muestra, no se guarda), para que se vea qué se usa si no se tipea nada. Con un valor guardado la celda no está vacía y el
// texto no se ve; sin derivado queda «0».
export function placeholderDeCelda(importeInicial: string, derivado: number | null | undefined): string {
  if (importeInicial !== "" || derivado === null || derivado === undefined) return "0";
  return formatearPesos(derivado);
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
  // "1.235" (pesos enteros, formato argentino; es lo que se MUESTRA) o "" si no hay valor. El valor exacto va en `centavos`.
  importeInicial: string;
  // Valor guardado en centavos exactos (null = sin valor). La huella y la comparación de cambios usan este, no el texto.
  centavos: number | null;
  // "1.234,56" cuando el valor guardado tiene centavos (para el tooltip); null si no los tiene o no hay valor.
  valorExacto: string | null;
  // Bloqueada pero vacía: se puede cargar una sola vez.
  avisoUnaVez: boolean;
  aviso: string | null;
};

export type VistaTipeo = {
  celdas: CeldaTipeo[];
  // Cambia cuando cambian los valores guardados: la pantalla reemplaza lo tipeado por lo guardado.
  huella: string;
  // El usuario puede tipear Disponibilidades (el Real de alguna de sus filas): el Reporte muestra ese bloque como lo ve
  // un ADMIN (P y R, con el input en R) y no como el «Saldo» de solo lectura del gerente. Es por permiso, no por celdas
  // que queden sin bloquear: no cambia a mitad de bloque cuando un mes cerrado deja algunas filas en solo lectura.
  disponibilidades: boolean;
};

export type EntradaVistaTipeo = {
  empresaSlug: string;
  // La plantilla del REPORTE: con las filas extra del mes, si la empresa las tiene.
  plantilla: Plantilla;
  esAdminOFinanzas: boolean;
  // Puede cargar el Real de ESTA empresa (lib/permisosReal.ts). Sin definir = esAdminOFinanzas. Un GERENTE con permiso
  // (esAdminOFinanzas false, puedeCargarReal true) recibe SOLO las celdas de Real.
  puedeCargarReal?: boolean;
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

// ¿Disponibilidades se dibuja como el «Saldo» de solo lectura del gerente? Sí cuando el Reporte se armó sin acceso completo
// a los bloques reservados, salvo que el usuario pueda tipear Disponibilidades: ahí se ve como lo ve un ADMIN.
export function disponibilidadesComoSaldo(
  sinBloquesReservados: boolean,
  tipeo: Pick<VistaTipeo, "disponibilidades"> | null
): boolean {
  return sinBloquesReservados && tipeo?.disponibilidades !== true;
}

// null = el Reporte no lleva ninguna celda editable de este tipo. Quien no puede cargar el Real de la empresa recibe
// null SIEMPRE, con el interruptor que sea: ni celdas, ni claves, ni valores. Quien puede sin ser ADMIN ni FINANZAS
// (gerente con permiso) recibe solo las celdas de Real.
export function armarVistaTipeo(e: EntradaVistaTipeo): VistaTipeo | null {
  if (!(e.puedeCargarReal ?? e.esAdminOFinanzas)) return null;
  const soloReal = !e.esAdminOFinanzas;
  const celdas: CeldaTipeo[] = [];
  const tipeables = camposTipeables(e.plantilla, e.empresaSlug, e.interruptores);
  const disponibilidades = tipeables.some((c) => c.bloque === "DISPONIBILIDADES" && c.columna === "REAL");
  for (const c of tipeables) {
    // El gerente con permiso recibe solo Real y nunca Cierre (el Capital de trabajo es de ADMIN y FINANZAS).
    if (soloReal && (c.columna !== "REAL" || c.bloque === "CIERRE")) continue;
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
      importeInicial: existente === undefined ? "" : formatearPesos(existente),
      centavos: existente ?? null,
      valorExacto: valorExactoConCentavos(existente ?? null),
      avisoUnaVez: bloqueo !== null,
      aviso: bloqueo === null ? null : c.columna === "REAL" ? AVISO_UNA_VEZ : AVISO_PRESUPUESTO_VALIDADO,
    });
  }
  if (celdas.length === 0) return null;
  return { celdas, huella: celdas.map((c) => `${c.id}=${c.centavos ?? ""}`).join("|"), disponibilidades };
}

// ¿Lo tipeado cambia el valor guardado? El texto mostrado va en pesos enteros, así que no alcanza comparar textos: un valor
// con centavos (71.815.208,61) se muestra «71.815.209» y corregirlo a 71.815.209,00 sí es un cambio. Texto igual al mostrado
// = sin tocar (conserva los centavos); si no, se compara lo que se lee contra los centavos exactos guardados. Una cuenta
// («100+50») siempre cuenta como cambio: se guarda con su nota. Lo que no se entiende también: lo rechaza el servidor.
export function celdaModificada(celda: Pick<CeldaTipeo, "importeInicial" | "centavos">, texto: string): boolean {
  const t = texto.trim();
  if (t === celda.importeInicial.trim()) return false;
  if (celda.centavos === null) return true;
  const r = leerCuenta(t);
  return !(r.ok && r.nota === null && r.centavos === celda.centavos);
}

export type EntradaTipeo = { filaClave: string; columna: "PRESUPUESTADO" | "REAL"; texto: string };

// Lo que el servidor rechaza ANTES de delegar en guardarValoresManuales. null = se puede seguir.
export function motivoRechazoTipeo(args: {
  empresaSlug: string;
  // La plantilla del REPORTE del mes (con las filas extra).
  plantilla: Plantilla;
  esAdminOFinanzas: boolean;
  // Puede cargar el Real de ESTA empresa (lib/permisosReal.ts). Sin definir = esAdminOFinanzas.
  puedeCargarReal?: boolean;
  entradas: readonly EntradaTipeo[];
  interruptores?: InterruptoresTipeo;
}): string | null {
  if (!(args.puedeCargarReal ?? args.esAdminOFinanzas)) return ERROR_SIN_PERMISO_DE_CARGAR_REAL;
  // Un gerente con permiso carga solo Real: el Presupuestado va por su flujo.
  if (!args.esAdminOFinanzas) {
    const p = args.entradas.find((e) => e.columna !== "REAL");
    if (p) return ERROR_SOLO_REAL;
  }
  if (!tipeoDirectoActivo(args.empresaSlug, args.interruptores)) {
    return "El tipeo directo en el Reporte no está habilitado para esta empresa.";
  }
  const permitidos = new Map(
    camposTipeables(args.plantilla, args.empresaSlug, args.interruptores).map((c) => [`${c.clave}|${c.columna}`, c] as const)
  );
  for (const e of args.entradas) {
    const campo = permitidos.get(`${e.filaClave}|${e.columna}`);
    if (!campo) return `"${e.filaClave}" no se puede tipear desde el Reporte.`;
    // Misma regla que armarVistaTipeo: Cierre (Capital de trabajo) solo para ADMIN y FINANZAS.
    if (!args.esAdminOFinanzas && campo.bloque === "CIERRE") return ERROR_SOLO_ADMIN_FINANZAS_CAPITAL;
  }
  return null;
}
