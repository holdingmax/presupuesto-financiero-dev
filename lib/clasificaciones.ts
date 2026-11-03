import { prisma } from "@/lib/prisma";
import { quitarDiacriticos } from "@/lib/slug";

// Variantes reales confirmadas (con Kike, 2026-08-27) que hay que unificar antes
// de guardar — la clave es el valor normalizado (sin tildes, mayúsculas, espacios
// colapsados) tal como puede venir de un archivo real; el valor es el nombre
// canónico que se persiste. Diccionario pensado para crecer: cada entrada nueva
// es un caso puntual confirmado contra un archivo real, no una adivinanza (mismo
// criterio que COLUMNAS en ejecucion/actions.ts).
//
// "COMISIONES Y GASTOS BANCARIOS" viene así, tal cual, en
// PF_-_BRADENTON_-_AGOSTO_2026.xlsx (hojas "EJECUCION RESUMEN-GTOS" y "CHASE")
// — mismo concepto que "Gastos bancarios", no una clasificación nueva. Ojo: es
// coincidencia EXACTA de la clave completa, no substring — un texto compuesto
// como "COMISIONES Y GASTOS BANCARIOS- IMP AL CHEQUE- IMP. VS" (visto en
// PF_-_FREDY_-_AGOSTO_2026.xlsx) NO matchea esta clave y pasa sin tocar, tal
// como debe ser: mezcla varios conceptos en una celda, no es esta clasificación.
const MAPEO_CLASIFICACION: Record<string, string> = {
  "COMISIONES Y GASTOS BANCARIOS": "Gastos bancarios",
};

export function normalizarClasificacion(valorCrudo: string): string {
  const clave = quitarDiacriticos(valorCrudo).trim().toUpperCase().replace(/\s+/g, " ");
  return MAPEO_CLASIFICACION[clave] ?? valorCrudo;
}

type ReglaClasificacionAutomatica = {
  clasificacion: string;
  contiene: string[];
};

// Reglas confirmadas por Kike (2026-09-01) que proponen una Clasificación a
// partir de la leyenda (MovimientoBancario.concepto) cuando el archivo no
// trae una explícita — ver proponerClasificacionAutomatica más abajo, y su
// único punto de uso en subirExtracto (ejecucion/actions.ts), donde
// reemplaza el fallback "SIN CLASIFICAR" sin pisar nunca un valor ya
// cargado. Cada keyword acá es un caso puntual confirmado, mismo criterio
// que MAPEO_CLASIFICACION arriba — no agregar keywords especulativas.
// Match por "contiene" (substring), no por clave exacta como
// MAPEO_CLASIFICACION: acá se busca la keyword DENTRO de la leyenda
// completa del movimiento, que trae mucho más texto alrededor.
const REGLAS_CLASIFICACION_AUTOMATICA: ReglaClasificacionAutomatica[] = [
  {
    clasificacion: "Gastos bancarios",
    contiene: [
      "IMPUESTO AL DEBITO Y CREDITO BANCARIO LEY",
      "RETENCION DE INGRESOS BRUTOS",
      "DEBITO FISCAL IVA BASICO",
    ],
  },
  {
    clasificacion: "IMP Y PREVISIONALES",
    contiene: ["IMPUESTO AFIP", "TRANSFERENCIA B2B", "AUTOMOTOR", "PADRON INMOBILIARIO"],
  },
];

// Si la leyenda matchea más de una regla, gana la primera en orden de
// definición arriba (determinístico) — con las keywords confirmadas hoy no
// hay overlap real entre ellas, pero queda documentado el desempate para
// cuando se agreguen más. Devuelve null si ninguna matchea (el llamador cae
// a "SIN CLASIFICAR", igual que siempre).
export function proponerClasificacionAutomatica(leyenda: string): string | null {
  const texto = quitarDiacriticos(leyenda).trim().toUpperCase().replace(/\s+/g, " ");
  const regla = REGLAS_CLASIFICACION_AUTOMATICA.find((r) =>
    r.contiene.some((kw) => texto.includes(kw))
  );
  return regla?.clasificacion ?? null;
}

// Rubros habilitados para desglosar una línea de presupuesto en varios
// conceptos (pedido explícito: solo Impuestos/Proveedores, no el resto).
// Valores canónicos reales de CLASIFICACIONES_SUGERIDAS, no los nombres
// amigables "Impuestos"/"Proveedores" — esos no existen como valor en el
// sistema hoy (ver comentario arriba sobre por qué siguen separados).
//
// Clasificación es texto libre (datalist, no un <select> cerrado): si algún
// día aparece una variante real no detectada de estos dos valores (revisado
// 2026-08-31: 0 variantes en ~29.000 filas reales de MovimientoBancario +
// LineaPresupuesto en testing), agregarla a normalizarClasificacion() como
// caso confirmado — mismo criterio que se usó con "Gastos bancarios". No
// implementar detección difusa (similitud/distancia) de forma especulativa
// sin un caso real primero.
const CLASIFICACIONES_CON_DESGLOSE = ["IMP Y PREVISIONALES", "PROV Y SERV"];

export function esElegibleParaDesglose(clasificacion: string): boolean {
  const clave = quitarDiacriticos(clasificacion).trim().toUpperCase().replace(/\s+/g, " ");
  return CLASIFICACIONES_CON_DESGLOSE.includes(clave);
}

// En Ejecución el prorrateo por unidad de negocio (MovimientoBancarioDesglose)
// ya no depende de la clasificación: desde 2026-10-06 (pedido de Kike) se
// habilitó para TODAS — antes solo SUELDOS/EXPENSAS vía una lista análoga a
// CLASIFICACIONES_CON_DESGLOSE. Esta lista de arriba sigue siendo solo de
// Presupuesto.

// Lista curada de clasificaciones habituales, compartida entre el <select>
// de ejecución (TablaMovimientos.tsx) y el <datalist> de presupuesto
// (PresupuestoForm.tsx) — unificada a pedido explícito. "Gastos bancarios" y
// "Prestamos y tarjetas" son rubros reales de presupuesto sin equivalente en
// la lista original de ejecución. "Impuestos"/"IMP Y PREVISIONALES" y
// "Proveedores"/"PROV Y SERV" quedan como entradas separadas a propósito —
// fusionarlas es una decisión de negocio pendiente, no técnica. "CAMPO",
// "CH DIFERIDOS IVA", "COMISIONES ESPECIALES", "DEP CH 3°" y "JPS" son
// categorías reales del proceso manual de Macchi — "CH DIFERIDOS IVA" es
// distinta de "CHEQUES DIFERIDOS", no fusionar.
// "OTROS" y "PAGOS ESPECIALES" (agregadas 2026-09-01): igual que las de
// Macchi arriba, ya existen como valor real en Ejecución (63+11 filas en
// local) — se agregan en la misma grafía real (mayúsculas) para no
// fragmentar el rubro en dos versiones distintas. "OTROS" es exclusiva de
// Fredy Publicidad (reintegros de obra social y fondo fijo de los chicos de
// Fredy); "PAGOS ESPECIALES" son personas que cobran prestando su
// nombre/CUIL.
// "COMISIONES ESPECIALES" es un caso pendiente de definir, no un olvido: a
// diferencia de "Gastos bancarios"/"OTROS"/"PAGOS ESPECIALES" de acá arriba,
// NO tiene alias en MAPEO_CLASIFICACION ni entrada en
// CLASIFICACIONES_CON_DESGLOSE — no sumarla a ninguna de las dos sin
// confirmar antes con el negocio.
// "Liquidación final" (agregada 2026-09-02): la asigna aplicarCruceLiquidacionFinal
// en ejecucion/actions.ts, cruzando contra PagoReferencia — nunca la escribe un
// archivo ni el usuario a mano, pero tiene que estar acá para que el <select> de
// TablaMovimientos la muestre bien cuando alguien la corrige manualmente.
// Las seis de aerolíneas del final (agregadas 2026-11-03) vienen tal cual en la madre de Kike
// ("ARCHIVO MADRE OCTUBRE 2026 - DETALLE Y CONTROLES.xlsx") y alimentan filas de HWC en el Reporte
// (plantillas/hwc.ts); "LINHEAS" es la grafía del archivo, no un typo.
export const CLASIFICACIONES_SUGERIDAS = [
  "COBRANZAS",
  "COM Y GTOS BRIOS",
  "PROV Y SERV",
  "SUELDOS",
  "SAC",
  "IMP Y PREVISIONALES",
  "IVA",
  "AVION",
  "CHEQUES DIFERIDOS",
  "INVERSIONES",
  "FCI",
  "EXPENSAS",
  "Gastos bancarios",
  "Prestamos y tarjetas",
  "CAMPO",
  "CH DIFERIDOS IVA",
  "COMISIONES ESPECIALES",
  "DEP CH 3°",
  "JPS",
  "OTROS",
  "PAGOS ESPECIALES",
  "Liquidación final",
  "COBRANZAS LATAM",
  "COBRANZAS LAN/AVIANCA",
  "COBRANZA JETSMART",
  "WCS",
  "AVIANCA",
  "GOL LINHEAS A",
];

// TEMPORAL / hallazgo fuera del alcance original de la paginación: el `distinct` de Prisma
// (`findMany({ distinct: [...] })`) tardaba ~8s acá (medido directo contra la base), contra
// ~2.4s con un DISTINCT nativo en SQL — es overhead del ORM en esta query puntual, no del
// volumen de filas (acotar por ejecucionId no lo mejoraba, porque casi toda la tabla ya
// pertenece a una sola semana). Cambio de bajo riesgo: mismo resultado, misma semántica,
// sin valores interpolados en el SQL (no hay superficie de inyección).
export async function calcularClasificacionesDisponibles() {
  const clasificacionesEnUso = await prisma.$queryRaw<
    { clasificacion: string }[]
  >`SELECT DISTINCT clasificacion FROM "MovimientoBancario"`;

  return Array.from(
    new Set([
      ...CLASIFICACIONES_SUGERIDAS,
      ...clasificacionesEnUso.map((c) => c.clasificacion),
    ])
  ).sort((a, b) => a.localeCompare(b, "es"));
}

// Nombres de presentación para mostrarle a un gerente o a Salas (ej. el
// reporte "PRESUPUESTO MES A MES") — SOLO para mostrar en pantalla, nunca
// para guardar ni para comparar/filtrar contra la base. El valor técnico
// ("IMP Y PREVISIONALES", "PROV Y SERV") sigue siendo el único que se
// persiste y el que ya usan normalizarClasificacion/CLASIFICACIONES_SUGERIDAS
// — fusionar nombres es una decisión de negocio pendiente (ver comentario
// más arriba), esto no la toma, solo traduce para la pantalla. Mismo patrón
// que CHEQUEOS_SUMA_CERO en ejecucion/actions.ts (que ya empareja 3 de estos
// mismos valores con un nombre lindo, acotado a ese panel puntual) — acá se
// generaliza para cualquier pantalla que lo necesite.
//
// Lista pensada para crecer: cada entrada es un nombre confirmado con
// Macchi, no una traducción inventada (mismo criterio que
// MAPEO_CLASIFICACION más arriba). "JPS" queda deliberadamente afuera — no
// es una sigla, es el nombre de una unidad de negocio real (ver
// prisma/seed.ts), no necesita traducción.
const NOMBRES_PRESENTACION_CLASIFICACION: Record<string, string> = {
  "PROV Y SERV": "Proveedores",
  "IMP Y PREVISIONALES": "Impuestos",
  "DEP CH 3°": "Depósito de cheques de terceros",
  "SAC": "Aguinaldo",
  "FCI": "Fondos comunes de inversión",
  "CH DIFERIDOS IVA": "Cheques diferidos IVA",
  "CHEQUES DIFERIDOS": "Cheques diferidos",
  "COMISIONES ESPECIALES": "Comisiones especiales",
  "OTROS": "Otros",
  "PAGOS ESPECIALES": "Pagos especiales",
  // Kike confirmó que "COM Y GTOS BRIOS" es literalmente la abreviatura de
  // "Comisiones y gastos bancarios" — pero esto es SOLO el nombre para
  // mostrar en pantalla. NO tocar MAPEO_CLASIFICACION ni
  // normalizarClasificacion() por esto: hay una decisión de negocio previa
  // (con 4.145 filas reales confirmadas) de que "COM Y GTOS BRIOS" no se
  // fusiona con "Gastos bancarios" en los datos guardados — sigue siendo
  // una clasificación técnica distinta, pendiente de aclarar esa
  // contradicción con Kike. Mostrar un nombre lindo acá no decide eso.
  "COM Y GTOS BRIOS": "Comisiones y gastos bancarios",
};

// Devuelve el nombre lindo si hay uno confirmado, o el valor técnico tal
// cual si no (nunca deja una pantalla sin texto para mostrar).
export function nombreParaMostrar(clasificacion: string): string {
  return NOMBRES_PRESENTACION_CLASIFICACION[clasificacion] ?? clasificacion;
}
