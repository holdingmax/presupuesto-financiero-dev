import type ExcelJS from "exceljs";
import { normalizarClasificacion, proponerClasificacionAutomatica } from "@/lib/clasificaciones";
import {
  normalizarCuenta,
  proponerUnidadPorCuenta,
  proponerUnidadPorRazonSocial,
  unidadDeCeldaMadre,
} from "@/lib/unidadesNegocio";
import { normalizarEncabezado } from "./encabezados";

// Parseo del archivo "madre" (el .xlsx de Kike con varias cuentas, encabezados en la
// fila 1 y columnas Fecha / Concepto / Importe / Saldo / BANCO Y CTA …). Se movió acá
// TAL CUAL desde subirExtracto (ejecucion/actions.ts) el 2026-10-15, sin cambiar su
// comportamiento: lo fija lib/extractos/__tests__/madre.test.ts. No lee la base.

const FILA_HEADERS = 1;

// Coincidencia exacta de string (post-normalización), no fuzzy — cada clave nueva es un
// sinónimo puntual confirmado contra un archivo real, no una adivinanza. Varias claves
// pueden apuntar al mismo campo (ver NRO REFERENCIA/NRO. DE REFERENCIA/NRO DE REFERENCIA):
// si algún archivo futuro trajera dos de esas columnas a la vez para el mismo campo (ej.
// "Descripcion" Y "Concepto" juntas), gana la que se procese después en la fila de
// encabezados — no hay merge ni prioridad definida. No es el caso de ningún archivo visto
// hasta ahora, así que no se resolvió; queda documentado acá para quien lo retome.
const COLUMNAS: Record<string, string> = {
  "FECHA": "fecha",
  "NRO REFERENCIA": "nroReferencia",
  "NRO. DE REFERENCIA": "nroReferencia",
  "NRO DE REFERENCIA": "nroReferencia",
  "NRO, DE REFERENCIA": "nroReferencia", // ej. archivo de prueba de Macchi: coma en vez de espacio después de "Nro"
  "CAUSAL": "causal",
  "CONCEPTO": "concepto",
  "DESCRIPCION": "concepto", // ej. HWC: "Descripcion" es el texto completo del movimiento
  "IMPORTE": "importe",
  "SALDO": "saldo",
  "BANCO Y CTA": "bancoYCuenta",
  "BANCO": "bancoYCuenta", // ej. HWC: solo trae "Banco" a secas, sin el número de cuenta
  "DETALLE": "detalle",
  "DESC": "detalle", // ej. HWC: "Desc" (abreviado) es una aclaración corta, no la Descripcion completa
  "CLASIFICACION": "clasificacion",
  "CLASIF 2": "clasificacion2",
  "UNIDAD DE NEG": "unidadNegocio",
  "DETALLE 2": "detalle2",
};

// Una celda con fórmula viene de ExcelJS como { formula, result, ... } en vez de un número
// plano; una celda con un error de fórmula rota (ej. #REF!) viene como { error: "#REF!" }.
function esObjetoConResultadoNumerico(valor: unknown): valor is { result: number } {
  return (
    typeof valor === "object" &&
    valor !== null &&
    "result" in valor &&
    typeof (valor as { result: unknown }).result === "number" &&
    Number.isFinite((valor as { result: number }).result)
  );
}

function esObjetoConError(valor: unknown): valor is { error: string } {
  return typeof valor === "object" && valor !== null && "error" in valor;
}

// Importe es obligatorio: si la celda venía con fórmula, se resuelve con .result;
// si no se puede resolver a un número válido, se devuelve null y la fila se descarta.
function extraerImporte(valorCrudo: unknown): { valor: number | null; corregidoPorFormula: boolean } {
  if (valorCrudo == null) return { valor: 0, corregidoPorFormula: false };
  if (typeof valorCrudo === "number") {
    return { valor: Number.isFinite(valorCrudo) ? valorCrudo : null, corregidoPorFormula: false };
  }
  if (esObjetoConResultadoNumerico(valorCrudo)) {
    return { valor: valorCrudo.result, corregidoPorFormula: true };
  }
  return { valor: null, corregidoPorFormula: false };
}

// Saldo es opcional (nullable en el schema): un error de fórmula (#REF!) es un problema real
// del Excel original, no de nuestro parseo — se guarda como null sin descartar la fila.
function extraerSaldo(
  valorCrudo: unknown
): { valor: number | null; corregidoPorFormula: boolean; tuvoError: boolean } {
  if (valorCrudo == null) return { valor: null, corregidoPorFormula: false, tuvoError: false };
  if (typeof valorCrudo === "number") {
    return {
      valor: Number.isFinite(valorCrudo) ? valorCrudo : null,
      corregidoPorFormula: false,
      tuvoError: false,
    };
  }
  if (esObjetoConError(valorCrudo)) {
    return { valor: null, corregidoPorFormula: false, tuvoError: true };
  }
  if (esObjetoConResultadoNumerico(valorCrudo)) {
    return { valor: valorCrudo.result, corregidoPorFormula: true, tuvoError: false };
  }
  return { valor: null, corregidoPorFormula: false, tuvoError: false };
}

// Celda de unidad ("UNIDAD DE NEG" o "EMPRESA") → valor recortado, o null si viene
// vacía o dice "SIN ASIGNAR" (cuenta como vacío, decisión 2026-10-06 — así puede
// caer al siguiente escalón del orden en subirExtracto).
function leerUnidadDeCelda(valorCrudo: unknown): string | null {
  const texto = valorCrudo ? String(valorCrudo).trim() : "";
  if (!texto || normalizarCuenta(texto) === "SIN ASIGNAR") return null;
  return texto;
}

// Texto de una celda para mostrar en un aviso (valor simple, fórmula con resultado, fecha…), recortado.
function textoDeCelda(valorCrudo: unknown): string {
  if (valorCrudo == null) return "";
  const crudo =
    typeof valorCrudo === "object" && valorCrudo !== null && "result" in valorCrudo
      ? (valorCrudo as { result: unknown }).result
      : valorCrudo;
  const texto = crudo instanceof Date ? crudo.toISOString().slice(0, 10) : String(crudo);
  return texto.length > 40 ? `${texto.slice(0, 40)}…` : texto;
}

export type FilaMadre = {
  numeroFila: number;
  fecha: Date;
  nroReferencia: string | null;
  causal: string | null;
  concepto: string;
  importe: number;
  saldo: number | null;
  bancoYCuenta: string;
  clasificacion: string;
  clasificacion2: string | null;
  unidadNegocio: string;
  detalle: string | null;
  detalle2: string | null;
  sugeridaPorSistema: boolean;
  chequeIvaAmbiguo: boolean;
  unidadSugeridaPorSistema: boolean;
  // Solo para AVISAR en la vista previa del madre (lib/extractos/avisosMadre.ts): el texto de unidad que trae el
  // archivo y que no se reconoció ni como unidad de la lista ni como razón social conocida. NO se guarda ni
  // cambia la unidad asignada (que sigue saliendo del orden de siempre). null = no hay nada que avisar.
  unidadNoReconocida?: { texto: string; columna: "UNIDAD DE NEG" | "EMPRESA" } | null;
};

// Fila que se descartó porque el importe no se pudo leer (ej. texto "1.234,56"). Las filas vacías no cuentan.
export type FilaDescartadaMadre = { numeroFila: number; concepto: string; importeTexto: string };

export type LecturaMadre =
  | { ok: true; filas: FilaMadre[]; descartadas: FilaDescartadaMadre[] }
  | { ok: false; error: string };

export function leerFilasMadre(hoja: ExcelJS.Worksheet): LecturaMadre {
  const encabezados: Record<number, string> = {};
  // Texto crudo de cada columna, matcheada o no en COLUMNAS — los fallbacks de abajo
  // (ej. "EMPRESA") necesitan poder encontrar una columna que el diccionario ignoró.
  const encabezadosCrudos: Record<number, string> = {};
  const filaEncabezado = hoja.getRow(FILA_HEADERS);
  filaEncabezado.eachCell((celda, colNumero) => {
    const texto = normalizarEncabezado(String(celda.value ?? ""));
    encabezadosCrudos[colNumero] = texto;
    const campo = COLUMNAS[texto];
    if (campo) encabezados[colNumero] = campo;
  });

  // Algunos exports por empresa (recortados del maestro) vienen sin la columna
  // "CLASIFICACION" y dejan la clasificación real bajo "CLASIF 2" — sin este fallback,
  // esas filas se importaban todas como "SIN CLASIFICAR" en vez de leer el dato real.
  // Si el archivo sí trae "CLASIFICACION" (el caso normal), esto no cambia nada.
  if (!Object.values(encabezados).includes("clasificacion")) {
    const colClasificacion2 = Object.keys(encabezados).find(
      (col) => encabezados[Number(col)] === "clasificacion2"
    );
    if (colClasificacion2) {
      encabezados[Number(colClasificacion2)] = "clasificacion";
    }
  }

  // Algunos exports por empresa no traen "UNIDAD DE NEG" y en su lugar tienen una
  // columna "EMPRESA" con texto libre (ej. "QUINTEROS", "SIERRA"). Confirmado con Kike
  // (2026-10-06): EMPRESA es la razón social (SPP, LI, QUINTEROS, TUCSON), no la unidad
  // — un error de etiqueta. Por eso se lee en un campo aparte ("empresaColumna", nunca
  // persistido): queda DEBAJO de la sugerencia por cuenta y se traduce a unidad con el
  // mapa por razón social (UNIDAD_POR_RAZON_SOCIAL, ver el orden más abajo) — nunca se
  // guarda la razón social como si fuera una unidad.
  // Si el archivo sí trae "UNIDAD DE NEG" (el caso normal, incluido el maestro),
  // "EMPRESA" queda ignorada igual que siempre.
  if (!Object.values(encabezados).includes("unidadNegocio")) {
    const colEmpresa = Object.keys(encabezadosCrudos).find(
      (col) => encabezadosCrudos[Number(col)] === "EMPRESA" && !encabezados[Number(col)]
    );
    if (colEmpresa) {
      encabezados[Number(colEmpresa)] = "empresaColumna";
    }
  }

  if (!Object.values(encabezados).includes("concepto")) {
    return {
      ok: false,
      error:
        "No encontré la columna Concepto. Revisá que el archivo tenga los encabezados esperados (Fecha, Concepto, Importe, Clasificacion, Unidad de Neg, etc).",
    };
  }

  const filas: FilaMadre[] = [];
  const descartadas: FilaDescartadaMadre[] = [];

  hoja.eachRow((fila, numeroFila) => {
    if (numeroFila === FILA_HEADERS) return;

    const valores: Record<string, unknown> = {};
    fila.eachCell((celda, colNumero) => {
      const campo = encabezados[colNumero];
      if (campo) valores[campo] = celda.value;
    });

    if (!valores.concepto && !valores.importe) return;

    const { valor: importeExtraido } = extraerImporte(valores.importe);
    if (importeExtraido === null) {
      descartadas.push({
        numeroFila,
        concepto: String(valores.concepto ?? "(sin concepto)"),
        importeTexto: textoDeCelda(valores.importe),
      });
      return;
    }

    const { valor: saldoExtraido } = extraerSaldo(valores.saldo);

    const fechaValor = valores.fecha;
    const fecha =
      fechaValor instanceof Date
        ? fechaValor
        : new Date(String(fechaValor ?? new Date().toISOString()));

    const concepto = String(valores.concepto ?? "(sin concepto)");

    // Separado en variables (en vez de un solo ternario anidado) para poder
    // distinguir de dónde salió la clasificación: sugeridaPorSistema solo
    // queda en true cuando la propuso el motor de leyenda acá mismo — un
    // valor explícito del archivo o el fallback "SIN CLASIFICAR" no son una
    // sugerencia que alguien tenga que confirmar, son el dato real de Kike o
    // un vacío. Los cruces de más abajo (aplicarCruceLiquidacionFinal /
    // aplicarCruceChequeIva) vuelven a poner esto en true si terminan
    // pisando el valor de acá con el suyo propio.
    const clasificacionExplicita = valores.clasificacion
      ? normalizarClasificacion(String(valores.clasificacion))
      : null;
    const clasificacionAutomatica = clasificacionExplicita
      ? null
      : proponerClasificacionAutomatica(concepto);

    // Orden (decisión 2026-10-07):
    //   1. "UNIDAD DE NEG" con una unidad VÁLIDA de la lista (o el alias "AVION" → AVIANOR) → se respeta siempre
    //      (guardada con el nombre canónico: "SPP " → "SPP").
    //   2. mapa por cuenta bancaria (UNIDAD_POR_CUENTA) → sugerida.
    //   3. mapa por razón social (UNIDAD_POR_RAZON_SOCIAL) → sugerida. La razón
    //      social sale de la columna "EMPRESA" o, si "UNIDAD DE NEG" trae algo que
    //      no es una unidad de la lista (ej. "QUINTEROS" — error de etiqueta
    //      confirmado por Kike), de esa misma celda.
    //   4. "SIN ASIGNAR" (incluidas las razones sociales MIXTAS: LI, TUCSON,
    //      CREAR, CIELOS, LI RATIO — revisión manual).
    // "SIN ASIGNAR" literal en cualquiera de las dos columnas cuenta como vacío.
    const bancoYCuenta = valores.bancoYCuenta ? String(valores.bancoYCuenta) : "(sin banco)";
    const celdaUnidad = leerUnidadDeCelda(valores.unidadNegocio);
    const unidadExplicita = celdaUnidad ? unidadDeCeldaMadre(celdaUnidad) : null;
    const unidadPorCuenta = unidadExplicita ? null : proponerUnidadPorCuenta(bancoYCuenta);
    const razonSocial =
      celdaUnidad && !unidadExplicita ? celdaUnidad : leerUnidadDeCelda(valores.empresaColumna);
    const unidadPorRazonSocial =
      unidadExplicita || unidadPorCuenta || !razonSocial ? null : proponerUnidadPorRazonSocial(razonSocial);

    // Solo aviso: texto de unidad que ninguna regla reconoció (ver unidadNoReconocida en FilaMadre). Un texto que
    // sí es una razón social conocida (QUINTEROS, WHEELER…) es el error de etiqueta ya confirmado: no se avisa.
    const textoRazonSocial = razonSocial;
    const unidadNoReconocida: FilaMadre["unidadNoReconocida"] =
      celdaUnidad && !unidadExplicita && proponerUnidadPorRazonSocial(celdaUnidad) === null
        ? { texto: celdaUnidad, columna: "UNIDAD DE NEG" }
        : !celdaUnidad && textoRazonSocial && proponerUnidadPorRazonSocial(textoRazonSocial) === null
          ? { texto: textoRazonSocial, columna: "EMPRESA" }
          : null;

    filas.push({
      numeroFila,
      fecha,
      nroReferencia: valores.nroReferencia ? String(valores.nroReferencia) : null,
      causal: valores.causal ? String(valores.causal) : null,
      concepto,
      importe: importeExtraido,
      saldo: saldoExtraido,
      bancoYCuenta,
      clasificacion: clasificacionExplicita ?? clasificacionAutomatica ?? "SIN CLASIFICAR",
      clasificacion2: valores.clasificacion2 ? String(valores.clasificacion2) : null,
      unidadNegocio: unidadExplicita ?? unidadPorCuenta ?? unidadPorRazonSocial ?? "SIN ASIGNAR",
      detalle: valores.detalle ? String(valores.detalle) : null,
      detalle2: valores.detalle2 ? String(valores.detalle2) : null,
      sugeridaPorSistema: clasificacionAutomatica !== null,
      chequeIvaAmbiguo: false,
      unidadSugeridaPorSistema: unidadPorCuenta !== null || unidadPorRazonSocial !== null,
      unidadNoReconocida,
    });
  });

  return { ok: true, filas, descartadas };
}
