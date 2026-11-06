import {
  CLASIFICACIONES_PRESUPUESTO_UNICAS,
  type OpcionClasificacionPresupuesto,
} from "@/app/[empresa]/[periodo]/presupuesto/clasificacionesPresupuesto";
import { formatearCentavos, formatearPesos, parsearCuenta, valorExactoConCentavos } from "@/lib/reporte/bloqueo";
import { leerCuenta } from "@/lib/importes";
import {
  claveEquivalencia,
  type Bloque,
  type Fila,
  type FilaLinea,
  type Plantilla,
} from "@/lib/reporte/motor";

// Reglas puras (sin Prisma ni next/*) de la carga del Presupuestado directo en el Reporte
// (Etapa 2): qué celdas se pueden editar, por qué otras no, y cómo se interpreta lo tipeado.
// Las usan A/reporte/page.tsx (para armar la pantalla) y aplicarCarga.ts (que guarda). El
// servidor recalcula el plan con lo que hay en la base: el cliente nunca decide qué es editable.

// Solo las filas de estos bloques se cargan: Disponibilidades y Cierre son reservados.
export const BLOQUES_CARGABLES: readonly Bloque[] = ["INGRESOS", "EGRESOS", "ABAJO"];

// Detalle de las líneas que crea la carga desde el Reporte (concepto = texto de la fila).
export const DETALLE_CARGA_DESDE_REPORTE = "Carga desde el Reporte";

// ---------------------------------------------------------------------------------------------
// Importes. Los negativos se rechazan en UN solo lugar (permiteNegativos): si Kike cambia la
// regla, se cambia acá y nada más.
// ---------------------------------------------------------------------------------------------

export const MENSAJE_IMPORTE_NEGATIVO = "Los importes se cargan en positivo.";

// Decisión de Kike (2026-11): el gerente también puede cargar negativos en todas las filas que
// hoy carga (una devolución, un ajuste). Ya no depende del rol; el parámetro se conserva para que
// la regla siga viviendo en un solo lugar si hay que volver a distinguir roles.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function permiteNegativos(_esAdminOFinanzas: boolean): boolean {
  return true;
}

// Tope de la columna Decimal(18,2), con margen.
const MAX_CENTAVOS = 1e15;

export type ImporteCarga =
  // centavos null = borrar (vacío o 0). `nota` = la cuenta tal como se tipeó ("100+50"), si lo era.
  { ok: true; centavos: number | null; nota: string | null } | { ok: false; error: string };

export function validarImporteCarga(texto: string, esAdminOFinanzas: boolean): ImporteCarga {
  if (typeof texto !== "string" || texto.trim() === "") return { ok: true, centavos: null, nota: null };
  const cuenta = leerCuenta(texto);
  if (!cuenta.ok) return { ok: false, error: cuenta.error };
  if (cuenta.centavos === 0) return { ok: true, centavos: null, nota: null };
  if (cuenta.centavos < 0 && !permiteNegativos(esAdminOFinanzas)) {
    return { ok: false, error: MENSAJE_IMPORTE_NEGATIVO };
  }
  if (Math.abs(cuenta.centavos) >= MAX_CENTAVOS) return { ok: false, error: "El importe es demasiado grande." };
  return { ok: true, centavos: cuenta.centavos, nota: cuenta.nota };
}

export const MAX_ACLARACION = 200;

export type AclaracionCarga = { ok: true; detalle: string } | { ok: false; error: string };

// "Otros" sin explicación no le sirve a nadie (decisión 2026-10-07): al cargar un solo número,
// la aclaración obligatoria hace de detalle de la línea.
export function validarAclaracion(texto: string | undefined): AclaracionCarga {
  const detalle = typeof texto === "string" ? texto.trim() : "";
  if (!detalle) return { ok: false, error: "Para «Otros» explicá qué es este gasto." };
  if (detalle.length > MAX_ACLARACION) {
    return { ok: false, error: `La aclaración es demasiado larga (máximo ${MAX_ACLARACION} caracteres).` };
  }
  return { ok: true, detalle };
}

export function requiereAclaracion(categoria: string): boolean {
  return claveEquivalencia(categoria) === claveEquivalencia("OTROS");
}

// ---------------------------------------------------------------------------------------------
// Plan de edición: qué celdas son editables y por qué las otras no.
// ---------------------------------------------------------------------------------------------

// Una LineaPresupuesto del mes, con lo mínimo que necesita el plan.
export type LineaParaCarga = {
  id: string;
  clasificacion: string;
  detalle: string;
  importeCentavos: number;
  tieneDesglose: boolean;
};

export type CeldaCarga =
  | {
      modo: "editable";
      // Clasificación en la que se guarda: la de la línea existente o, si no hay, la primera
      // categoría de la fila.
      categoria: string;
      // Concepto de la línea nueva.
      texto: string;
      lineaId: string | null;
      valorCentavos: number | null;
      requiereAclaracion: boolean;
      aclaracionInicial: string;
    }
  | {
      modo: "soloLectura";
      valorCentavos: number;
      // Texto corto para mostrar en la celda (no una celda muda).
      motivo: string;
    };

// Motivo que se muestra en lo que el Reporte NO puede cargar (varias líneas, desglose, otra categoría
// de la fila, clasificación fuera de la lista). Un solo texto para toda la pantalla: si cambia
// quién lo resuelve, se cambia acá.
export const MOTIVO_SE_AJUSTA_EN_PRESUPUESTO = "lo ajusta Finanzas en Presupuesto";

// Planifica UNA celda: `categorias` son las clasificaciones de la fila (la primera es donde se
// guarda una carga nueva) y `lineas` todas las del mes. Una línea cuenta para la fila si su
// clasificación es equivalente (mismos alias que usa el motor) a alguna de las categorías.
export function planCelda(categorias: readonly string[], texto: string, lineas: readonly LineaParaCarga[]): CeldaCarga {
  const claves = categorias.map(claveEquivalencia);
  const delasFila = lineas.filter((l) => claves.includes(claveEquivalencia(l.clasificacion)));
  const total = delasFila.reduce((acc, l) => acc + l.importeCentavos, 0);
  const primera = categorias[0];

  if (delasFila.length === 0) {
    return {
      modo: "editable",
      categoria: primera,
      texto,
      lineaId: null,
      valorCentavos: null,
      requiereAclaracion: requiereAclaracion(primera),
      aclaracionInicial: "",
    };
  }
  if (delasFila.length > 1) {
    return { modo: "soloLectura", valorCentavos: total, motivo: `varias líneas · ${MOTIVO_SE_AJUSTA_EN_PRESUPUESTO}` };
  }
  const linea = delasFila[0];
  if (linea.tieneDesglose) {
    return { modo: "soloLectura", valorCentavos: total, motivo: `con desglose · ${MOTIVO_SE_AJUSTA_EN_PRESUPUESTO}` };
  }
  // Fila de 2 categorías (Liquidación final + Juicios): se guarda en la primera; si la línea
  // está en la otra, no se mueve en silencio.
  if (claveEquivalencia(linea.clasificacion) !== claves[0]) {
    return {
      modo: "soloLectura",
      valorCentavos: total,
      motivo: `cargado como ${linea.clasificacion} · ${MOTIVO_SE_AJUSTA_EN_PRESUPUESTO}`,
    };
  }
  const pideAclaracion = requiereAclaracion(linea.clasificacion);
  return {
    modo: "editable",
    categoria: linea.clasificacion,
    texto,
    lineaId: linea.id,
    valorCentavos: linea.importeCentavos,
    requiereAclaracion: pideAclaracion,
    // El detalle de la línea existente, para no tener que volver a escribirlo.
    aclaracionInicial: pideAclaracion && linea.detalle !== DETALLE_CARGA_DESDE_REPORTE ? linea.detalle : "",
  };
}

export function esFilaDeCategoria(fila: Plantilla["filas"][number]): fila is FilaLinea & {
  presupuesto: { tipo: "categorias"; categorias: string[] };
} {
  return fila.tipo === "linea" && fila.presupuesto.tipo === "categorias" && BLOQUES_CARGABLES.includes(fila.bloque);
}

// Categorías de la lista de Presupuesto que ninguna fila de la plantilla recoge. Hoy ese
// dinero está en la barra de Presupuesto pero no en el Reporte.
export function categoriasSinFila(plantilla: Plantilla): OpcionClasificacionPresupuesto[] {
  const cubiertas = new Set<string>();
  for (const f of plantilla.filas) {
    if (f.tipo === "linea" && f.presupuesto.tipo === "categorias") {
      f.presupuesto.categorias.forEach((c) => cubiertas.add(claveEquivalencia(c)));
    }
  }
  return CLASIFICACIONES_PRESUPUESTO_UNICAS.filter((o) => !cubiertas.has(claveEquivalencia(o.valorPersistido)));
}

// ---------------------------------------------------------------------------------------------
// Etapa 3: filas de Presupuestado manual (ValorManualReporte).
// ---------------------------------------------------------------------------------------------

// Fila de datos de Ingresos / Egresos / "de abajo" cuyo Presupuestado se tipea: el gerente la
// carga. Quedan afuera las de categoría (Etapa 2), las derivadas (espejo / "Disponible") y las
// "igual al Real" (Disponibilidades, que además es un bloque reservado).
export function esFilaManualEditable(fila: Fila): fila is FilaLinea {
  return fila.tipo === "linea" && BLOQUES_CARGABLES.includes(fila.bloque) && fila.presupuesto.tipo === "manual";
}

// Un ValorManualReporte PRESUPUESTADO existente, con quién y cuándo lo cargó.
export type ValorManualParaCarga = {
  filaClave: string;
  centavos: number;
  nota: string | null;
  cargadoPor: string | null;
  actualizadoEn: Date;
};

export type CeldaManualCarga = {
  valorCentavos: number | null;
  nota: string | null;
  // "Cargó Fulano · 28/10/2026" (null si no hay valor).
  leyenda: string | null;
};

export function leyendaDeValor(v: Pick<ValorManualParaCarga, "cargadoPor" | "actualizadoEn">): string {
  const fecha = v.actualizadoEn.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  return v.cargadoPor ? `Cargó ${v.cargadoPor} · ${fecha}` : `Cargado el ${fecha}`;
}

export type PlanCarga = {
  // filaClave → celda, solo de las filas de categoría.
  filas: Record<string, CeldaCarga>;
  // filaClave → valor actual, solo de las filas de Presupuestado manual (todas son editables).
  manuales: Record<string, CeldaManualCarga>;
  sinFila: { categoria: string; texto: string; celda: CeldaCarga }[];
  // Líneas con una clasificación que no es de la lista ni de ninguna fila (datos viejos):
  // se muestran en solo lectura para que nada quede invisible.
  fueraDeLista: { centavos: number; lineas: number } | null;
};

export function planDeCarga(
  plantilla: Plantilla,
  lineas: readonly LineaParaCarga[],
  valoresManuales: readonly ValorManualParaCarga[] = []
): PlanCarga {
  const filas: Record<string, CeldaCarga> = {};
  const manuales: Record<string, CeldaManualCarga> = {};
  const valorDe = (clave: string): CeldaManualCarga => {
    const v = valoresManuales.find((x) => x.filaClave === clave);
    return v
      ? { valorCentavos: v.centavos, nota: v.nota, leyenda: leyendaDeValor(v) }
      : { valorCentavos: null, nota: null, leyenda: null };
  };
  const conocidas = new Set<string>();
  for (const f of plantilla.filas) {
    if (f.tipo === "linea" && f.presupuesto.tipo === "categorias") {
      f.presupuesto.categorias.forEach((c) => conocidas.add(claveEquivalencia(c)));
    }
    if (esFilaDeCategoria(f)) filas[f.clave] = planCelda(f.presupuesto.categorias, f.texto.trim(), lineas);
    if (esFilaManualEditable(f)) manuales[f.clave] = valorDe(f.clave);
  }
  const sinFila = categoriasSinFila(plantilla).map((o) => {
    conocidas.add(claveEquivalencia(o.valorPersistido));
    return { categoria: o.valorPersistido, texto: o.textoVisible, celda: planCelda([o.valorPersistido], o.textoVisible, lineas) };
  });
  const sueltas = lineas.filter((l) => !conocidas.has(claveEquivalencia(l.clasificacion)));
  return {
    filas,
    manuales,
    sinFila,
    fueraDeLista:
      sueltas.length === 0
        ? null
        : { centavos: sueltas.reduce((acc, l) => acc + l.importeCentavos, 0), lineas: sueltas.length },
  };
}

// Lo que el cliente manda por cada celda que cambió. `clave` = filaClave (destino "fila") o la
// categoría (destino "sinFila"). Nunca se manda un id de línea: el servidor la busca.
export type EntradaCarga = {
  // "fila" y "sinFila": clasificaciones (LineaPresupuesto). "manual": Presupuestado manual
  // (ValorManualReporte, columna PRESUPUESTADO).
  destino: "fila" | "sinFila" | "manual";
  clave: string;
  // Lo tipeado en la celda, tal cual ("1.234,56", "100+50", "" para vaciar).
  importe: string;
  aclaracion?: string;
  // Solo "manual": el valor que la pantalla mostraba al cargarse ("" = vacío). El
  // servidor lo compara con el actual para no pisar lo que otra persona cargó mientras tanto.
  base?: string;
};

// ¿Cambió el valor guardado desde que la pantalla lo mostró? null contra null NO es un cambio, ni
// el mismo valor. `base` es el texto que mostraba la pantalla; si no se entiende, cuenta como
// cambio (mejor rechazar que pisar).
export function cambioMientrasEditaba(base: string | undefined, actualCentavos: number | null): boolean {
  if (typeof base !== "string") return true;
  const actual = actualCentavos === 0 ? null : actualCentavos;
  if (base.trim() === "") return actual !== null;
  const cuenta = parsearCuenta(base);
  if (!cuenta) return true;
  return (cuenta.centavos === 0 ? null : cuenta.centavos) !== actual;
}

// Nombre para mostrar en los mensajes de error: el texto de la fila de la plantilla o el de
// la categoría. Si no se encuentra, la clave.
export function nombreDeEntrada(plantilla: Plantilla, entrada: Pick<EntradaCarga, "destino" | "clave">): string {
  if (entrada.destino !== "sinFila") {
    const fila = plantilla.filas.find((f) => f.clave === entrada.clave);
    return fila && fila.tipo !== "titulo" ? fila.texto.trim() : entrada.clave;
  }
  return categoriasSinFila(plantilla).find((o) => o.valorPersistido === entrada.clave)?.textoVisible ?? entrada.clave;
}

// La celda del plan a la que apunta una entrada (null = no existe o no es cargable).
export function celdaDeEntrada(plan: PlanCarga, entrada: Pick<EntradaCarga, "destino" | "clave">): CeldaCarga | null {
  if (entrada.destino === "fila") return Object.hasOwn(plan.filas, entrada.clave) ? plan.filas[entrada.clave] : null;
  if (entrada.destino === "sinFila") return plan.sinFila.find((s) => s.categoria === entrada.clave)?.celda ?? null;
  return null;
}

// El valor manual al que apunta una entrada "manual" (null = no existe o no es cargable).
export function manualDeEntrada(plan: PlanCarga, entrada: Pick<EntradaCarga, "destino" | "clave">): CeldaManualCarga | null {
  if (entrada.destino === "manual") return Object.hasOwn(plan.manuales, entrada.clave) ? plan.manuales[entrada.clave] : null;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Vista para el cliente: valores ya formateados y lo mínimo que necesita la pantalla.
// ---------------------------------------------------------------------------------------------

// Una celda editable (la pantalla guarda y compara contra los valores iniciales).
export type CeldaVistaCarga = {
  id: string; // "<destino>|<clave>"
  destino: "fila" | "sinFila" | "manual";
  clave: string;
  requiereAclaracion: boolean;
  // Lo que mostraba la pantalla al cargarse, en pesos enteros ("" = vacío).
  importeInicial: string;
  // Valor guardado en centavos exactos (null = sin valor): la huella y la comparación de cambios usan este, no el texto.
  centavos: number | null;
  // "1.234,56" si el valor guardado tiene centavos (tooltip y `base` del chequeo de cambios concurrentes); null si no.
  valorExacto: string | null;
  aclaracionInicial: string;
  // "Cargó Fulano · 28/10/2026" (manual con valor).
  leyenda: string | null;
};

export type FilaSinFilaVista = {
  id: string;
  texto: string;
  // null = editable; si no, el motivo de solo lectura y el valor a mostrar.
  soloLectura: { motivo: string; valor: string } | null;
};

export type VistaCarga = {
  celdas: CeldaVistaCarga[];
  // filaClave → motivo de solo lectura (las filas editables no aparecen).
  motivosFilas: Record<string, string>;
  sinFila: FilaSinFilaVista[];
  fueraDeLista: { valor: string; lineas: number } | null;
  // Cambia cuando cambia algún valor guardado: la pantalla repone lo tipeado con lo guardado.
  huella: string;
};

export function idCelda(destino: CeldaVistaCarga["destino"], clave: string): string {
  return `${destino}|${clave}`;
}

export function vistaDeCarga(plan: PlanCarga): VistaCarga {
  const celdas: CeldaVistaCarga[] = [];
  const motivosFilas: Record<string, string> = {};
  const agregar = (destino: "fila" | "sinFila", clave: string, celda: CeldaCarga) => {
    if (celda.modo !== "editable") return;
    celdas.push({
      id: idCelda(destino, clave),
      destino,
      clave,
      requiereAclaracion: celda.requiereAclaracion,
      importeInicial: celda.valorCentavos === null ? "" : formatearPesos(celda.valorCentavos),
      centavos: celda.valorCentavos,
      valorExacto: valorExactoConCentavos(celda.valorCentavos),
      aclaracionInicial: celda.aclaracionInicial,
      leyenda: null,
    });
  };
  const agregarManual = (clave: string, celda: CeldaManualCarga) => {
    celdas.push({
      id: idCelda("manual", clave),
      destino: "manual",
      clave,
      requiereAclaracion: false,
      importeInicial: celda.valorCentavos === null ? "" : formatearPesos(celda.valorCentavos),
      centavos: celda.valorCentavos,
      valorExacto: valorExactoConCentavos(celda.valorCentavos),
      aclaracionInicial: "",
      leyenda: celda.leyenda,
    });
  };
  for (const [clave, celda] of Object.entries(plan.filas)) {
    if (celda.modo === "soloLectura") motivosFilas[clave] = celda.motivo;
    else agregar("fila", clave, celda);
  }
  const sinFila = plan.sinFila.map((s): FilaSinFilaVista => {
    agregar("sinFila", s.categoria, s.celda);
    return {
      id: idCelda("sinFila", s.categoria),
      texto: s.texto,
      soloLectura:
        s.celda.modo === "soloLectura"
          ? { motivo: s.celda.motivo, valor: formatearCentavos(s.celda.valorCentavos) }
          : null,
    };
  });
  const fueraDeLista = plan.fueraDeLista
    ? { valor: formatearCentavos(plan.fueraDeLista.centavos), lineas: plan.fueraDeLista.lineas }
    : null;
  for (const [clave, celda] of Object.entries(plan.manuales)) agregarManual(clave, celda);
  const huella = JSON.stringify([
    celdas.map((c) => [c.id, c.centavos, c.aclaracionInicial, c.leyenda]),
    motivosFilas,
    sinFila.map((s) => s.soloLectura),
    fueraDeLista,
  ]);
  return { celdas, motivosFilas, sinFila, fueraDeLista, huella };
}
