import { armarIndiceRubros, rubroDe } from "@/lib/rubros";
import { normalizarTexto } from "@/lib/texto";
import { CLASIFICACIONES_PRESUPUESTO_TODAS } from "@/app/[empresa]/[periodo]/presupuesto/clasificacionesPresupuesto";
import { PENDIENTES, PENDIENTES_DE_REAL, type CodigoPendiente } from "@/lib/reporte/pendientes";

// Motor del Reporte por plantilla (Etapa 2a, docs/reporte_etapa2a_plan.md §3, y
// Etapa 2b, docs/reporte_etapa2b_plan.md §7.2). Puro: sin Prisma ni nada de
// servidor — recibe la plantilla de la empresa y, por mes, el Real por
// clasificación cruda (centavos con signo de banco), el Presupuesto por
// clasificación guardada (centavos) y los valores manuales cargados, y devuelve la
// grilla filas × meses × {presupuestado, real, % avance, falta ejecutar}. El motor
// no sabe nada de empresas: solo interpreta la plantilla.
//
// Todo en centavos enteros: nada de float para sumar. Las celdas se calculan por
// dependencias (no por el orden visual): p. ej. "Prestamos" de Mantenor, que está
// abajo, toma el Disponible, que está más abajo todavía.

export type Bloque = "DISPONIBILIDADES" | "INGRESOS" | "EGRESOS" | "ABAJO" | "CIERRE";

// Bloques que solo ven ADMIN y FINANZAS (Ejecución global §3.4 y §6): quien no los ve no
// recibe esas filas, ni sus valores, ni lo que se calcula a partir de ellas.
export const BLOQUES_RESERVADOS: readonly Bloque[] = ["DISPONIBILIDADES", "CIERRE"];

export function esBloqueReservado(bloque: Bloque): boolean {
  return BLOQUES_RESERVADOS.includes(bloque);
}

// Qué bloques reservados ve quien NO es ADMIN ni FINANZAS (el gerente), cada uno con su interruptor
// (lib/config.ts). Cierre depende de Disponibilidades: el Saldo y el Disponible se calculan con el total
// de Disponibilidades, así que mostrarlos sin ese bloque no protegería nada. El motor lo aplica solo
// (cierre sin disponibilidades = cierre apagado), además del test de configuración.
export type VisibilidadReservados = { disponibilidades: boolean; cierre: boolean };

export const SIN_BLOQUES_RESERVADOS: VisibilidadReservados = { disponibilidades: false, cierre: false };

// true = todo (ADMIN y FINANZAS); false = nada; un objeto = solo esos bloques.
export type AccesoReservados = boolean | VisibilidadReservados;

export function visibilidadDeAcceso(acceso: AccesoReservados): VisibilidadReservados {
  if (acceso === true) return { disponibilidades: true, cierre: true };
  if (acceso === false) return SIN_BLOQUES_RESERVADOS;
  return { disponibilidades: acceso.disponibilidades, cierre: acceso.cierre && acceso.disponibilidades };
}

// De las filas de Cierre, las únicas que puede ver el gerente cuando su interruptor está prendido: el
// Saldo (rol "saldo" o visibleGerente), el Capital de trabajo (fila de tipo capital o, en Bradenton, la línea tipeada de
// Cierre) y el Disponible. «Disponible antes de gastos» y las demás NO: no se pidieron.
export function esFilaDeCierreVisibleParaGerente(fila: Fila): boolean {
  if (fila.bloque !== "CIERRE") return false;
  switch (fila.tipo) {
    case "capital":
    case "disponible":
      return true;
    case "total":
      return fila.rol === "saldo" || fila.visibleGerente === true;
    case "linea":
      return fila.presupuesto.tipo === "manual";
    case "titulo":
      return false;
  }
}

// Filas cuyos valores puede leer y calcular quien tiene este acceso: todas las de bloques no reservados
// más las de cada bloque reservado que ve. (Una fila calculable no es necesariamente una fila visible:
// ver esFilaDeCierreVisibleParaGerente.)
export function clavesCalculables(plantilla: Plantilla, acceso: AccesoReservados): Set<string> {
  const v = visibilidadDeAcceso(acceso);
  return new Set(plantilla.filas.filter((f) => bloqueCalculable(f.bloque, v)).map((f) => f.clave));
}

function bloqueCalculable(bloque: Bloque, v: VisibilidadReservados): boolean {
  if (bloque === "DISPONIBILIDADES") return v.disponibilidades;
  if (bloque === "CIERRE") return v.cierre;
  return true;
}

// Claves de las filas que ve quien no tiene acceso a ningún bloque reservado.
export function clavesVisibles(plantilla: Plantilla): Set<string> {
  return clavesCalculables(plantilla, false);
}

export type Sentido = "creditos" | "debitos";

export type FuenteReal =
  // Valores crudos de Ejecución; se comparan sin mayúsculas/tildes y con los
  // alias confirmados de lib/rubros.ts (COM Y GTOS BRIOS ↔ Gastos bancarios…).
  // Sin `sentido` es el neto (créditos + débitos). Con `sentido`, solo los
  // importes positivos (creditos) o negativos (debitos): así una misma
  // clasificación puede ir en dos filas (Préstamo MS: entrada y devolución).
  | {
      tipo: "clasificaciones";
      clasificaciones: string[];
      sentido?: Sentido;
      // Resta el Real MANUAL de estas filas del mes, a partir de `desde` ("AAAA-MM"). Antes de `desde`, el
      // cálculo no cambia. Si el mes no tiene semanas cerradas sigue siendo null (se evalúa antes de restar).
      restarManuales?: { desde: string; filas: string[] };
    }
  // Valor que en la planilla se tipea (Disponibilidades, Resultado FCI…): sale de
  // ValorManualReporte (columna REAL). Sin cargar = null ("—").
  | { tipo: "manual" }
  // Desde `desde` ("AAAA-MM") es manual (como `manual`); antes conserva R = P en mes cerrado (como
  // `igualPresupuesto`), así los meses cerrados anteriores no se desarman.
  | { tipo: "manualDesde"; desde: string }
  // R = P de la misma fila (el `=+P` de la planilla).
  | { tipo: "igualPresupuesto" }
  | { tipo: "ninguna" };

// valorPersistido de clasificacionesPresupuesto.ts.
export type FuentePresupuesto =
  | { tipo: "categorias"; categorias: string[] }
  // ValorManualReporte (columna PRESUPUESTADO).
  | { tipo: "manual" }
  // P = R de la misma fila: los componentes de Disponibilidades llevan el mismo
  // número en las dos columnas.
  | { tipo: "igualReal" }
  // Espejo de otra fila (cheques después del 10, acreditación de tarjetas…).
  | {
      tipo: "espejo";
      fila: string;
      columna: "presupuestado" | "real";
      mes: "actual" | "anterior";
      factor: 1 | -1;
      // Un Presupuestado manual del mes (ValorManualReporte) pisa el espejo; sin valor sigue el espejo.
      pisableConManual?: boolean;
    }
  // = DISPONIBLE SI − CAPITAL DE TRABAJO del mismo mes.
  | { tipo: "disponible" }
  | { tipo: "ninguna" };

export type CodigosPendientes = CodigoPendiente | CodigoPendiente[];

export type FilaTitulo = { clave: string; bloque: Bloque; tipo: "titulo"; texto: string };
export type FilaLinea = {
  clave: string;
  bloque: Bloque;
  tipo: "linea";
  // Texto exacto de la planilla de Macchi (docs/reporte_diagnostico.md §2).
  texto: string;
  // Ingresos +1, egresos −1: valor = signo × neto con signo de banco. Un egreso
  // normal queda positivo; uno con más devoluciones que gastos queda negativo y
  // se muestra con "−", a propósito (sin Math.abs). Los valores manuales se
  // guardan tal como se muestran (sin signo).
  signo: 1 | -1;
  real: FuenteReal;
  presupuesto: FuentePresupuesto;
  pendiente?: CodigosPendientes;
  // Lo calculado es solo una parte (ej. Sueldos sin el reparto de nómina).
  parcial?: boolean;
  // De dónde sale en la planilla de Macchi.
  nota?: string;
  // Solo en DISPONIBILIDADES: "cuadre" = parte de la plata del cierre anterior;
  // "ajuste" = se suma o resta aparte (docs/reporte_etapa2b_plan.md §1).
  arrastre?: "cuadre" | "ajuste";
  // La planilla de Macchi no la incluye en el total (E1 del plan 2b §6). Un valor
  // cargado acá no entra en el total y la pantalla lo marca.
  excluidaDelTotal?: boolean;
  // Fila extra agregada por ADMIN/FINANZAS (lib/reporte/filasExtra.ts): no está en la plantilla estática.
  extra?: true;
};
export type FilaTotal = {
  clave: string;
  bloque: Bloque;
  tipo: "total";
  texto: string;
  suma: string[];
  // Se restan (Saldo = Disponible antes de gastos − Total egresos).
  resta?: string[];
  // Si alguna de estas filas no tiene valor, el total tampoco (D8: sin
  // Disponibilidades cargadas, todo el cierre queda en "—").
  requiere?: string[];
  // Su Presupuestado depende de que el mes tenga PresupuestoMensual.
  soloConPresupuesto?: boolean;
  // Filas que el control de arrastre necesita encontrar.
  // Los tres últimos marcan el total de cada bloque de flujo: ahí se suman las filas extra (filasExtra.ts).
  rol?: "totalDisponibilidades" | "saldo" | "totalIngresos" | "totalEgresosOperativos" | "totalEgresos";
  // Fila de Cierre que el gerente ve (solo lectura) cuando su empresa tiene Cierre prendido, aunque no lleve rol
  // "saldo" (Plate Silver y Bradenton: Posición, Capital y Excedente). No toca el control de arrastre ni las filas extra.
  visibleGerente?: true;
};
export type ReglaCapital = {
  terminos: { fila: string; factor: number }[];
  fijo?: number;
  // El fijo solo se suma si algún término tiene valor distinto de 0 (con todos en 0 o vacíos, la fila queda vacía).
  fijoSoloConTerminos?: boolean;
};
export type FilaCapital = {
  clave: string;
  bloque: "CIERRE";
  tipo: "capital";
  texto: string;
  // Regla por defecto (la fórmula de agosto de cada empresa), o "manual" si la
  // planilla lo tipea. Un valor manual (P) siempre la reemplaza.
  regla: ReglaCapital | "manual";
  pendiente?: CodigosPendientes;
  nota?: string;
};
export type FilaDisponible = {
  clave: string;
  bloque: "CIERRE";
  tipo: "disponible";
  texto: string;
  base: string; // Total Disponibilidades
  resta: string; // Capital de trabajo
  suma?: string[]; // Havanna: + Préstamo
  pendiente?: CodigosPendientes;
  nota?: string;
};
export type Fila = FilaTitulo | FilaLinea | FilaTotal | FilaCapital | FilaDisponible;

export type Plantilla = { empresa: string; filas: Fila[] };

export type DatosMes = {
  periodo: string;
  // Clasificación cruda de Ejecución → centavos con signo de banco (neto).
  real: Map<string, number>;
  // Solo los importes positivos / negativos, para las filas con `sentido`.
  realCreditos?: Map<string, number>;
  realDebitos?: Map<string, number>;
  // Clasificación guardada en LineaPresupuesto → centavos. null = el mes no
  // tiene PresupuestoMensual ("sin presupuesto"; mirar el reporte no lo crea).
  presupuesto: Map<string, number> | null;
  // Semanas CERRADAS de Ejecución del mes (de cualquier empresa: el Real sale de
  // las unidades). 0 = el mes no tiene ejecución: el Real es "—", no 0. Sin dato
  // (undefined) se asume que hay ejecución.
  semanasCerradas?: number;
  // Mes cerrado (mes pasado sin semanas ABIERTAS: mismo criterio que la regla de
  // bloqueo). Las filas con R = P (espejos, reservas) muestran R solo si el mes
  // está cerrado; en curso, "—". Sin dato = en curso.
  mesCerrado?: boolean;
  // ValorManualReporte del mes: filaClave → centavos, por columna.
  manuales?: { presupuesto: Map<string, number>; real: Map<string, number> };
};

export type Celda = {
  presupuestado: number | null;
  real: number | null;
  // Porcentaje (98.5 = 98,5 %). null si falta P o R, o si P es 0.
  avance: number | null;
  faltaEjecutar: number | null;
  // Falta información para completar el valor (fila pendiente o parcial; en un
  // total: alguna de las filas que suma).
  presupuestoIncompleto: boolean;
  realIncompleto: boolean;
};

export type FilaReporte = { fila: Fila; celdas: Celda[] };

// Control de arrastre (D9): Total Disponibilidades del mes contra el cierre REAL
// del mes anterior más los componentes "de ajuste".
export type ControlArrastre = {
  cierreRealAnterior: number | null;
  ajustes: number;
  totalDisponibilidades: number | null;
  diferencia: number | null;
  // |diferencia| < $1. null si no se puede calcular.
  cuadra: boolean | null;
};

export type Reporte = {
  periodos: string[];
  sinPresupuesto: boolean[];
  // Mes sin ninguna semana cerrada: todo el Real del mes queda en null.
  sinEjecucion: boolean[];
  filas: FilaReporte[];
  // Códigos K de la plantilla, en orden, sin repetir.
  pendientes: CodigoPendiente[];
  // Uno por mes; null si la plantilla no tiene Disponibilidades (o si quien mira no las ve).
  arrastre: (ControlArrastre | null)[];
  // true si se armó sin acceso completo a los bloques reservados (puede ver alguno, ver
  // `visibilidad`): lo que no ve no está, y las celdas que dependen de ello (ej. "Cheques en
  // cartera despues del 10") quedan en null.
  sinBloquesReservados: boolean;
};

export type OpcionesReporte = {
  // true (o sin definir) = ADMIN y FINANZAS: todo, incluido el control de arrastre.
  // false = quien mira NO ve Disponibilidades ni Cierre: esas filas no se calculan (no se
  // lee ni su valor manual) ni se devuelven, y todo lo que depende de ellas queda en null.
  // Un objeto = el gerente con interruptores prendidos: solo los bloques que ve (el arrastre
  // nunca se calcula para él).
  verBloquesReservados?: AccesoReservados;
};

// Clave para emparejar una clasificación (de Ejecución o de Presupuesto) con la
// fuente de una fila: el rubro de la lista de Presupuesto si es uno de ellos o
// un alias confirmado; si no, el texto normalizado ("CAMPO", "AVION", "MS").
const INDICE_EQUIVALENCIAS = armarIndiceRubros(
  Array.from(new Set(CLASIFICACIONES_PRESUPUESTO_TODAS.map((o) => o.valorPersistido)))
);
export function claveEquivalencia(valor: string): string {
  return rubroDe(INDICE_EQUIVALENCIAS, valor) ?? normalizarTexto(valor);
}

const CATEGORIAS_PRESUPUESTO = new Set(CLASIFICACIONES_PRESUPUESTO_TODAS.map((o) => o.valorPersistido));

// Diferencia máxima (centavos) para dar por cuadrado el arrastre: $1. El máximo
// observado en los Excel de Macchi es $0,66.
export const UMBRAL_ARRASTRE_CENTAVOS = 100;

export function pendientesDe(fila: Fila): CodigoPendiente[] {
  if (fila.tipo === "titulo" || fila.tipo === "total" || fila.pendiente === undefined) return [];
  return Array.isArray(fila.pendiente) ? fila.pendiente : [fila.pendiente];
}

function realIncompletoDe(fila: FilaLinea): boolean {
  if (fila.parcial) return true;
  // K8–K14 son preguntas de presupuesto, arrastre o cierre: no vacían el Real.
  return fila.real.tipo === "ninguna" && pendientesDe(fila).some((k) => PENDIENTES_DE_REAL.includes(k));
}

function presupuestoIncompletoDe(fila: FilaLinea): boolean {
  return fila.presupuesto.tipo === "ninguna" && pendientesDe(fila).length > 0;
}

// −1 × 0 da −0 en JS: un egreso sin movimientos tiene que ser 0, no "−0".
function sinMenosCero(valor: number): number {
  return valor === 0 ? 0 : valor;
}

function porcentaje(real: number, presupuestado: number): number {
  return (real / presupuestado) * 100;
}

type SlotReal = "neto" | "creditos" | "debitos";
type EntradaIndice = Partial<Record<SlotReal, string>>;

function sumarAgrupado(datos: Map<string, number> | undefined, indice: Map<string, EntradaIndice>, slot: SlotReal) {
  const porFila = new Map<string, number>();
  if (!datos) return porFila;
  for (const [clasificacion, centavos] of datos) {
    const clave = indice.get(claveEquivalencia(clasificacion))?.[slot];
    if (clave === undefined) continue;
    porFila.set(clave, (porFila.get(clave) ?? 0) + centavos);
  }
  return porFila;
}

// oculto: el valor depende de un bloque reservado que quien mira no ve (v = null).
type Valor = { v: number | null; inc: boolean; oculto?: boolean };
type Columna = "P" | "R";

// Suma solo las filas con valor; sin ninguna con valor, null.
function sumarNoNulos(valores: (number | null)[]): number | null {
  const conValor = valores.filter((v): v is number => v !== null);
  return conValor.length === 0 ? null : conValor.reduce((a, b) => a + b, 0);
}

// `mesesDeContexto`: los primeros meses de `meses` se usan solo para calcular
// (espejo del mes anterior, control de arrastre del primer mes visible) y no
// aparecen en el resultado.
export function armarReporte(
  plantilla: Plantilla,
  meses: DatosMes[],
  mesesDeContexto = 0,
  opciones: OpcionesReporte = {}
): Reporte {
  const acceso = opciones.verBloquesReservados ?? true;
  const verTodo = acceso === true;
  const visibilidad = visibilidadDeAcceso(acceso);
  const filaPorClave = new Map(plantilla.filas.map((f) => [f.clave, f]));
  const filaDisponible = plantilla.filas.find((f): f is FilaDisponible => f.tipo === "disponible");

  // Índices clave de equivalencia → clave de fila. validarPlantilla garantiza
  // que ninguna clasificación ni categoría aparece en dos filas con el mismo
  // sentido.
  const indiceReal = new Map<string, EntradaIndice>();
  const indicePresupuesto = new Map<string, EntradaIndice>();
  for (const fila of plantilla.filas) {
    if (fila.tipo !== "linea") continue;
    if (fila.real.tipo === "clasificaciones") {
      const slot: SlotReal = fila.real.sentido ?? "neto";
      for (const c of fila.real.clasificaciones) {
        const clave = claveEquivalencia(c);
        indiceReal.set(clave, { ...indiceReal.get(clave), [slot]: fila.clave });
      }
    }
    if (fila.presupuesto.tipo === "categorias") {
      for (const c of fila.presupuesto.categorias) indicePresupuesto.set(claveEquivalencia(c), { neto: fila.clave });
    }
  }

  const sinEjecucion = meses.map((m) => m.semanasCerradas === 0);
  const sinPresupuesto = meses.map((m) => m.presupuesto === null);
  const realPorMes = meses.map((m) => ({
    neto: sumarAgrupado(m.real, indiceReal, "neto"),
    creditos: sumarAgrupado(m.realCreditos, indiceReal, "creditos"),
    debitos: sumarAgrupado(m.realDebitos, indiceReal, "debitos"),
  }));
  const presupuestoPorMes = meses.map((m) =>
    m.presupuesto ? sumarAgrupado(m.presupuesto, indicePresupuesto, "neto") : null
  );

  const memo = new Map<string, Valor>();
  const enCurso = new Set<string>();

  function valor(clave: string, i: number, col: Columna): Valor {
    const k = `${clave}|${i}|${col}`;
    const guardado = memo.get(k);
    if (guardado) return guardado;
    if (enCurso.has(k)) throw new Error(`Ciclo de dependencias en la plantilla: ${clave}`);
    const fila = filaPorClave.get(clave);
    if (!fila) throw new Error(`La plantilla no tiene la fila "${clave}".`);
    // Bloque reservado sin permiso: ni se calcula ni se lee su valor manual.
    if (!bloqueCalculable(fila.bloque, visibilidad)) {
      const oculto: Valor = { v: null, inc: false, oculto: true };
      memo.set(k, oculto);
      return oculto;
    }
    enCurso.add(k);
    const resultado = calcular(fila, i, col);
    enCurso.delete(k);
    memo.set(k, resultado);
    return resultado;
  }

  function presupuestadoDeLinea(fila: FilaLinea, i: number): Valor {
    const inc = presupuestoIncompletoDe(fila);
    const p = fila.presupuesto;
    switch (p.tipo) {
      case "categorias": {
        const delMes = presupuestoPorMes[i];
        return { v: delMes ? (delMes.get(fila.clave) ?? 0) : null, inc };
      }
      case "manual":
        return { v: meses[i].manuales?.presupuesto.get(fila.clave) ?? null, inc };
      case "igualReal": {
        const r = valor(fila.clave, i, "R");
        return { v: r.v, inc, oculto: r.oculto };
      }
      case "espejo": {
        const manual = p.pisableConManual ? meses[i].manuales?.presupuesto.get(fila.clave) : undefined;
        if (manual !== undefined) return { v: manual, inc };
        const columna: Columna = p.columna === "presupuestado" ? "P" : "R";
        const j = p.mes === "actual" ? i : i - 1;
        // Sin mes anterior no hay valor.
        if (j < 0) return { v: null, inc };
        const o = valor(p.fila, j, columna);
        return { v: o.v === null ? null : sinMenosCero(p.factor * o.v), inc, oculto: o.oculto };
      }
      case "disponible": {
        if (!filaDisponible) throw new Error(`${fila.clave}: la plantilla no tiene fila de Disponible.`);
        const d = valor(filaDisponible.clave, i, "P");
        return { v: d.v, inc, oculto: d.oculto };
      }
      case "ninguna":
        return { v: null, inc };
    }
  }

  function realDeLinea(fila: FilaLinea, i: number): Valor {
    const inc = realIncompletoDe(fila);
    const r = fila.real;
    switch (r.tipo) {
      case "clasificaciones": {
        if (sinEjecucion[i]) return { v: null, inc };
        const delMes = realPorMes[i][r.sentido ?? "neto"];
        const bruto = aplicarSigno(fila.signo, delMes.get(fila.clave) ?? 0);
        const resta = r.restarManuales;
        if (!resta || meses[i].periodo < resta.desde) return { v: bruto, inc };
        const manuales = meses[i].manuales?.real;
        const aRestar = resta.filas.reduce((a, c) => a + (manuales?.get(c) ?? 0), 0);
        return { v: sinMenosCero(bruto - aRestar), inc };
      }
      case "manual":
        return { v: meses[i].manuales?.real.get(fila.clave) ?? null, inc };
      case "manualDesde": {
        if (meses[i].periodo >= r.desde) return { v: meses[i].manuales?.real.get(fila.clave) ?? null, inc };
        const p = valor(fila.clave, i, "P");
        return { v: meses[i].mesCerrado ? p.v : null, inc, oculto: p.oculto };
      }
      case "igualPresupuesto": {
        // Se resuelve igual (ciclos); en un mes en curso el R queda vacío.
        const p = valor(fila.clave, i, "P");
        return { v: meses[i].mesCerrado ? p.v : null, inc, oculto: p.oculto };
      }
      case "ninguna":
        return { v: null, inc };
    }
  }

  function calcular(fila: Fila, i: number, col: Columna): Valor {
    switch (fila.tipo) {
      case "titulo":
        return { v: null, inc: false };
      case "linea":
        return col === "P" ? presupuestadoDeLinea(fila, i) : realDeLinea(fila, i);
      case "total": {
        // Se resuelven todas las dependencias, aunque alguna no haga falta, para
        // que un ciclo se detecte siempre.
        const sumandos = fila.suma.map((c) => valor(c, i, col));
        const restas = (fila.resta ?? []).map((c) => valor(c, i, col));
        const requeridas = (fila.requiere ?? []).map((c) => valor(c, i, col));
        const inc = [...sumandos, ...restas].some((x) => x.inc);
        // Un total que suma algo que depende de un bloque reservado no se puede mostrar:
        // sería una suma parcial que parece completa.
        if ([...sumandos, ...restas, ...requeridas].some((x) => x.oculto)) return { v: null, inc, oculto: true };
        if (col === "P" && fila.soloConPresupuesto && sinPresupuesto[i]) return { v: null, inc };
        if (requeridas.some((x) => x.v === null)) return { v: null, inc };
        const suma = sumarNoNulos(sumandos.map((x) => x.v));
        if (suma === null) return { v: null, inc };
        const resta = restas.reduce((a, x) => a + (x.v ?? 0), 0);
        return { v: sinMenosCero(suma - resta), inc };
      }
      case "capital": {
        if (col === "R") return { v: null, inc: false };
        const regla = fila.regla;
        // Se resuelven los términos siempre (ciclos); un manual reemplaza el resultado.
        const terminos = regla === "manual" ? [] : regla.terminos.map((t) => ({ t, x: valor(t.fila, i, "P") }));
        const manual = meses[i].manuales?.presupuesto.get(fila.clave);
        if (manual !== undefined) return { v: manual, inc: false };
        if (regla === "manual" || sinPresupuesto[i]) return { v: null, inc: false };
        if (terminos.every((x) => x.x.v === null)) return { v: null, inc: false };
        if (regla.fijoSoloConTerminos && terminos.every((x) => !x.x.v)) return { v: null, inc: false };
        const suma = terminos.reduce((a, x) => a + x.t.factor * (x.x.v ?? 0), 0) + (regla.fijo ?? 0);
        return { v: sinMenosCero(Math.round(suma)), inc: terminos.some((x) => x.x.inc) };
      }
      case "disponible": {
        if (col === "R") return { v: null, inc: false };
        const base = valor(fila.base, i, "P").v;
        const capital = valor(fila.resta, i, "P").v;
        const extra = (fila.suma ?? []).map((c) => valor(c, i, "P").v);
        if (base === null || capital === null) return { v: null, inc: false };
        return { v: sinMenosCero(base - capital + extra.reduce<number>((a, x) => a + (x ?? 0), 0)), inc: false };
      }
    }
  }

  // Sin permiso, las filas de los bloques reservados ni siquiera se recorren. Con permiso parcial, de
  // Cierre solo se devuelven las filas pedidas (el resto se calcula, porque el Saldo depende de ellas,
  // pero no se devuelve).
  const filasAMostrar = verTodo
    ? plantilla.filas
    : plantilla.filas.filter(
        (f) => bloqueCalculable(f.bloque, visibilidad) && (f.bloque !== "CIERRE" || esFilaDeCierreVisibleParaGerente(f))
      );
  const filas: FilaReporte[] = filasAMostrar.map((fila) => {
    if (fila.tipo === "titulo") return { fila, celdas: [] };
    const conPorcentajes = fila.bloque !== "DISPONIBILIDADES" && fila.tipo !== "capital" && fila.tipo !== "disponible";
    const celdas = meses.map((_, i) => {
      const p = valor(fila.clave, i, "P");
      const r = valor(fila.clave, i, "R");
      return completarCelda(p.v, r.v, p.inc, r.inc, conPorcentajes);
    });
    return { fila, celdas };
  });

  const pendientes: CodigoPendiente[] = [];
  for (const fila of filasAMostrar) {
    for (const k of pendientesDe(fila)) if (!pendientes.includes(k)) pendientes.push(k);
  }

  const filaTotalDisp = plantilla.filas.find((f) => f.tipo === "total" && f.rol === "totalDisponibilidades");
  const filaSaldo = plantilla.filas.find((f) => f.tipo === "total" && f.rol === "saldo");
  const arrastre = meses.map((_, i): ControlArrastre | null => {
    if (!verTodo || !filaTotalDisp || !filaSaldo) return null;
    const cierreRealAnterior = i > 0 ? valor(filaSaldo.clave, i - 1, "R").v : null;
    let ajustes = 0;
    for (const f of plantilla.filas) {
      if (f.tipo !== "linea" || f.arrastre !== "ajuste" || f.excluidaDelTotal) continue;
      ajustes += valor(f.clave, i, "R").v ?? 0;
    }
    const totalDisponibilidades = valor(filaTotalDisp.clave, i, "R").v;
    const diferencia =
      totalDisponibilidades === null || cierreRealAnterior === null
        ? null
        : totalDisponibilidades - (cierreRealAnterior + ajustes);
    return {
      cierreRealAnterior,
      ajustes,
      totalDisponibilidades,
      diferencia,
      cuadra: diferencia === null ? null : Math.abs(diferencia) < UMBRAL_ARRASTRE_CENTAVOS,
    };
  });

  const desde = mesesDeContexto;
  return {
    periodos: meses.slice(desde).map((m) => m.periodo),
    sinPresupuesto: sinPresupuesto.slice(desde),
    sinEjecucion: sinEjecucion.slice(desde),
    filas: filas.map((f) => ({ fila: f.fila, celdas: f.celdas.slice(desde) })),
    pendientes,
    arrastre: arrastre.slice(desde),
    sinBloquesReservados: !verTodo,
  };
}

function completarCelda(
  presupuestado: number | null,
  real: number | null,
  presupuestoIncompleto: boolean,
  realIncompleto: boolean,
  conPorcentajes: boolean
): Celda {
  return {
    presupuestado,
    real,
    avance:
      !conPorcentajes || presupuestado === null || real === null || presupuestado === 0
        ? null
        : porcentaje(real, presupuestado),
    // Sin presupuestado (0 o vacío) no hay "falta": un número negativo engaña.
    faltaEjecutar:
      !conPorcentajes || presupuestado === null || presupuestado === 0 || real === null ? null : presupuestado - real,
    presupuestoIncompleto,
    realIncompleto,
  };
}

// −1 × 0 → ver sinMenosCero; el signo de una fila se aplica solo al Real por clasificación.
function aplicarSigno(signo: 1 | -1, centavos: number): number {
  return sinMenosCero(signo * centavos);
}

// Un valor que se carga a mano en la pantalla /reporte/carga.
export type CampoManual = {
  clave: string;
  texto: string;
  bloque: Bloque;
  columna: "PRESUPUESTADO" | "REAL";
};

// Todos los campos manuales de una plantilla, en el orden de la planilla. Los
// componentes de Disponibilidades tienen un solo campo (REAL; P = R). El Capital
// de trabajo tiene el campo P, que reemplaza a la regla.
export function camposManuales(plantilla: Plantilla): CampoManual[] {
  const campos: CampoManual[] = [];
  for (const f of plantilla.filas) {
    if (f.tipo === "linea") {
      if (f.real.tipo === "manual" || f.real.tipo === "manualDesde") {
        campos.push({ clave: f.clave, texto: f.texto, bloque: f.bloque, columna: "REAL" });
      }
      if (f.presupuesto.tipo === "manual" || (f.presupuesto.tipo === "espejo" && f.presupuesto.pisableConManual)) {
        campos.push({ clave: f.clave, texto: f.texto, bloque: f.bloque, columna: "PRESUPUESTADO" });
      }
    } else if (f.tipo === "capital") {
      campos.push({ clave: f.clave, texto: f.texto, bloque: f.bloque, columna: "PRESUPUESTADO" });
    }
  }
  return campos;
}

// Errores de estructura de una plantilla (vacío = válida). Lo usan los tests de
// las 7 plantillas.
export function validarPlantilla(plantilla: Plantilla): string[] {
  const errores: string[] = [];
  const vistas = new Set<string>();
  const todas = new Set(plantilla.filas.map((f) => f.clave));
  // clave de equivalencia → filas y sentido ("neto" si no tiene).
  const clasificacionEnFila = new Map<string, { fila: string; sentido: string }[]>();
  const categoriaEnFila = new Map<string, string>();
  const existe = (de: string, clave: string, anterior = false) => {
    if (!todas.has(clave)) errores.push(`${de} apunta a "${clave}", que no existe`);
    else if (anterior && !vistas.has(clave)) errores.push(`${de} suma "${clave}", que no existe antes`);
  };
  for (const fila of plantilla.filas) {
    if (vistas.has(fila.clave)) errores.push(`Clave repetida: ${fila.clave}`);
    if (fila.tipo === "total") {
      for (const clave of [...fila.suma, ...(fila.resta ?? []), ...(fila.requiere ?? [])]) {
        existe(fila.clave, clave, true);
      }
    }
    if (fila.tipo === "capital" && fila.regla !== "manual") {
      for (const t of fila.regla.terminos) existe(fila.clave, t.fila);
    }
    if (fila.tipo === "disponible") {
      for (const clave of [fila.base, fila.resta, ...(fila.suma ?? [])]) existe(fila.clave, clave);
    }
    vistas.add(fila.clave);
    for (const k of pendientesDe(fila)) {
      if (!(k in PENDIENTES)) errores.push(`${fila.clave}: pendiente ${k} fuera del catálogo`);
    }
    if (fila.tipo !== "linea") continue;
    if (fila.bloque === "DISPONIBILIDADES" && !fila.arrastre) {
      errores.push(`${fila.clave}: un componente de Disponibilidades necesita 'arrastre'`);
    }
    if (fila.presupuesto.tipo === "espejo") existe(fila.clave, fila.presupuesto.fila);
    if (fila.presupuesto.tipo === "disponible" && !plantilla.filas.some((f) => f.tipo === "disponible")) {
      errores.push(`${fila.clave}: toma el Disponible, pero la plantilla no tiene esa fila`);
    }
    if (fila.real.tipo === "clasificaciones") {
      for (const c of fila.real.restarManuales?.filas ?? []) {
        const o = plantilla.filas.find((f) => f.clave === c);
        if (!o || o.tipo !== "linea" || (o.real.tipo !== "manual" && o.real.tipo !== "manualDesde")) {
          errores.push(`${fila.clave}: restarManuales apunta a "${c}", que no es una fila con Real manual`);
        }
      }
      const sentido = fila.real.sentido ?? "neto";
      for (const c of fila.real.clasificaciones) {
        const clave = claveEquivalencia(c);
        const otras = clasificacionEnFila.get(clave) ?? [];
        for (const otra of otras) {
          // Dos filas pueden compartir la clasificación solo con sentidos distintos.
          if (otra.sentido === sentido || otra.sentido === "neto" || sentido === "neto") {
            errores.push(`La clasificación ${c} está en ${otra.fila} y en ${fila.clave}`);
          }
        }
        otras.push({ fila: fila.clave, sentido });
        clasificacionEnFila.set(clave, otras);
      }
    }
    if (fila.presupuesto.tipo === "categorias") {
      for (const c of fila.presupuesto.categorias) {
        if (!CATEGORIAS_PRESUPUESTO.has(c)) errores.push(`${fila.clave}: la categoría ${c} no existe en Presupuesto`);
        const clave = claveEquivalencia(c);
        const otra = categoriaEnFila.get(clave);
        if (otra) errores.push(`La categoría ${c} está en ${otra} y en ${fila.clave}`);
        categoriaEnFila.set(clave, fila.clave);
      }
    }
  }
  if (errores.length === 0) {
    // Ciclos: se arma un mes vacío; el motor resuelve todas las dependencias.
    try {
      armarReporte(plantilla, [{ periodo: "2000-01", real: new Map(), presupuesto: new Map() }]);
    } catch (e) {
      errores.push(e instanceof Error ? e.message : String(e));
    }
  }
  return errores;
}

// Todas las clasificaciones crudas que pide la plantilla (para la consulta del
// Real y el bloque "No asignado").
export function clasificacionesDePlantilla(plantilla: Plantilla): string[] {
  return plantilla.filas.flatMap((f) =>
    f.tipo === "linea" && f.real.tipo === "clasificaciones" ? f.real.clasificaciones : []
  );
}

// Los N períodos "AAAA-MM" que terminan en `periodo`, del más viejo al más nuevo.
export function periodosHasta(periodo: string, cantidad: number): string[] {
  const [anio, mes] = periodo.split("-").map(Number);
  const periodos: string[] = [];
  for (let i = cantidad - 1; i >= 0; i--) {
    const total = anio * 12 + (mes - 1) - i;
    periodos.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return periodos;
}
