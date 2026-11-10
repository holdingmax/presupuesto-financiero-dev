import { PERIODOS_HABILITADOS } from "@/lib/config";
import { esPeriodoHabilitado } from "@/lib/periodosHabilitados";
import { claveEquivalencia, type Bloque, type Plantilla } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { AVISO_UNA_VEZ, motivoBloqueo, motivoRechazoCambio, type EstadoSemanas } from "@/lib/reporte/bloqueo";
import { calcularReparto, notaDeReparto } from "@/lib/reporte/repartoExpensasCalculo";

// Calculadora de reparto de Expensas (/admin/reparto-expensas): el total del mes y un porcentaje por empresa se
// convierten en el Real manual de la fila «Expensas» de cada Reporte (ValorManualReporte, columna REAL). Puro: sin
// Prisma ni next/*, para poder probarlo; la escritura la hace guardarRepartoExpensas (admin/reparto-expensas/actions.ts).
// Las reglas de bloqueo NO se reescriben: salen de lib/reporte/bloqueo.ts, las mismas que usa el tipeo directo
// (tipeoDirecto.ts) y guardarValoresManuales.

const CLASIFICACION_EXPENSAS = claveEquivalencia("EXPENSAS");

export type FilaExpensas = { clave: string; bloque: Bloque; texto: string };

// La fila «Expensas» de una plantilla cuyo Real se tipea: línea de Real manual cuyo Presupuestado sale de la
// categoría EXPENSAS. Eso deja afuera, sin nombrarlas: la de Avianor (su Real sale de Ejecución por clasificación),
// «Expensas - No socios» (Presupuestado manual o sin Real) y «Dividendos - Expensas…» de Conexión (idem).
// null = la plantilla no tiene una fila así.
export function filaExpensasManual(plantilla: Plantilla): FilaExpensas | null {
  const filas = plantilla.filas.filter(
    (f) =>
      f.tipo === "linea" &&
      f.real.tipo === "manual" &&
      f.presupuesto.tipo === "categorias" &&
      f.presupuesto.categorias.some((c) => claveEquivalencia(c) === CLASIFICACION_EXPENSAS)
  );
  if (filas.length === 0) return null;
  if (filas.length > 1) {
    throw new Error(`La plantilla tiene ${filas.length} filas de Expensas con Real manual; se esperaba una.`);
  }
  const f = filas[0];
  if (f.tipo !== "linea") return null;
  return { clave: f.clave, bloque: f.bloque, texto: f.texto.trim() };
}

export type EmpresaConExpensas = { id: string; nombre: string; slug: string; fila: FilaExpensas };

// Las empresas (de las que se pasan, ya con su slug) cuya plantilla tiene fila de Expensas manual. Orden por nombre.
// Una empresa sin plantilla o sin esa fila no aparece.
export function empresasConExpensas(
  empresas: readonly { id: string; nombre: string; slug: string }[],
  plantillas: Readonly<Record<string, Plantilla>> = PLANTILLAS_POR_SLUG
): EmpresaConExpensas[] {
  const resultado: EmpresaConExpensas[] = [];
  for (const e of empresas) {
    const plantilla = plantillas[e.slug];
    if (!plantilla) continue;
    const fila = filaExpensasManual(plantilla);
    if (fila) resultado.push({ ...e, fila });
  }
  return resultado.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

// Estado de UNA empresa en el período, para la pantalla y para el servidor (misma regla).
//   editable: false = no se puede tocar su valor (período fuera de la lista, o bloqueado y ya cargado).
//   avisoUnaVez: el período está bloqueado pero la fila está vacía: admite la PRIMERA carga (carga única).
export type EstadoEmpresaReparto = {
  editable: boolean;
  motivo: string | null;
  avisoUnaVez: boolean;
  existenteCentavos: number | null;
};

export function estadoEmpresaReparto(e: {
  periodo: string;
  actual: string;
  habilitados?: readonly string[];
  bloque: Bloque;
  semanas: EstadoSemanas;
  existenteCentavos: number | null;
}): EstadoEmpresaReparto {
  if (!esPeriodoHabilitado(e.periodo, e.habilitados ?? PERIODOS_HABILITADOS)) {
    return {
      editable: false,
      motivo: `El período ${e.periodo} no está habilitado.`,
      avisoUnaVez: false,
      existenteCentavos: e.existenteCentavos,
    };
  }
  const bloqueo = motivoBloqueo({
    periodo: e.periodo,
    actual: e.actual,
    columna: "REAL",
    bloque: e.bloque,
    presupuestoValidado: false,
    semanas: e.semanas,
  });
  const rechazo = motivoRechazoCambio(bloqueo, e.existenteCentavos !== null);
  return {
    editable: rechazo === null,
    motivo: rechazo ?? bloqueo,
    avisoUnaVez: bloqueo !== null && rechazo === null,
    existenteCentavos: e.existenteCentavos,
  };
}

export { AVISO_UNA_VEZ };

export type EntradaReparto = {
  esAdminOFinanzas: boolean;
  periodo: string;
  actual: string;
  habilitados?: readonly string[];
  semanas: EstadoSemanas;
  totalTexto: string;
  // Todas las empresas de la lista, en el orden que sea; `porcentajeTexto` vacío = 0.
  empresas: readonly {
    empresaId: string;
    nombre: string;
    filaClave: string;
    bloque: Bloque;
    porcentajeTexto: string;
    // Real guardado hoy en esa fila y período (centavos), o null si no hay.
    existenteCentavos: number | null;
  }[];
  confirmarReemplazo: boolean;
};

export type Escritura = {
  empresaId: string;
  nombre: string;
  filaClave: string;
  centavos: number;
  nota: string;
  reemplazaCentavos: number | null;
};

export type PlanReparto =
  | { ok: true; totalCentavos: number; escrituras: Escritura[]; sinTocar: string[] }
  | {
      ok: false;
      error: string;
      // Hay valores ya cargados que se pisarían: no se escribió nada; reenviar con confirmarReemplazo = true.
      requiereConfirmacion?: true;
      reemplazos?: { empresaId: string; nombre: string; actualCentavos: number; nuevoCentavos: number }[];
    };

// Decide qué se escribe, o por qué no. Todo o nada: si una sola empresa no se puede escribir, no se escribe ninguna
// (los porcentajes de las demás dejarían de sumar el total). Las empresas con 0% o vacías no se tocan: ni se crean
// ni se borran ni se modifican.
export function planificarReparto(e: EntradaReparto): PlanReparto {
  if (!e.esAdminOFinanzas) {
    return { ok: false, error: "Solo ADMIN y FINANZAS pueden cargar el reparto de Expensas." };
  }
  if (!esPeriodoHabilitado(e.periodo, e.habilitados ?? PERIODOS_HABILITADOS)) {
    return { ok: false, error: `El período ${e.periodo} no está habilitado.` };
  }

  const reparto = calcularReparto(
    e.totalTexto,
    e.empresas.map((x) => x.porcentajeTexto)
  );
  if (!reparto.ok) return reparto;

  const escrituras: Escritura[] = [];
  const sinTocar: string[] = [];
  e.empresas.forEach((emp, i) => {
    if (reparto.porcentajes[i] === 0) {
      sinTocar.push(emp.nombre);
      return;
    }
    escrituras.push({
      empresaId: emp.empresaId,
      nombre: emp.nombre,
      filaClave: emp.filaClave,
      centavos: reparto.montos[i],
      nota: notaDeReparto(reparto.porcentajes[i], reparto.totalCentavos),
      reemplazaCentavos: emp.existenteCentavos,
    });
  });
  if (escrituras.length === 0) return { ok: false, error: "Ninguna empresa tiene porcentaje." };

  // Bloqueo: el mismo de siempre. Un período bloqueado admite la primera carga, no modificar lo ya cargado.
  for (const esc of escrituras) {
    const emp = e.empresas.find((x) => x.empresaId === esc.empresaId)!;
    const estado = estadoEmpresaReparto({
      periodo: e.periodo,
      actual: e.actual,
      habilitados: e.habilitados,
      bloque: emp.bloque,
      semanas: e.semanas,
      existenteCentavos: emp.existenteCentavos,
    });
    if (!estado.editable) {
      return { ok: false, error: `${esc.nombre}: no se puede modificar un valor ya cargado (${estado.motivo}).` };
    }
  }

  const reemplazos = escrituras
    .filter((x) => x.reemplazaCentavos !== null)
    .map((x) => ({
      empresaId: x.empresaId,
      nombre: x.nombre,
      actualCentavos: x.reemplazaCentavos as number,
      nuevoCentavos: x.centavos,
    }));
  if (reemplazos.length > 0 && !e.confirmarReemplazo) {
    return {
      ok: false,
      error: `Ya hay un valor cargado en ${reemplazos.map((r) => r.nombre).join(", ")}. Confirmá para reemplazarlo.`,
      requiereConfirmacion: true,
      reemplazos,
    };
  }

  return { ok: true, totalCentavos: reparto.totalCentavos, escrituras, sinTocar };
}
