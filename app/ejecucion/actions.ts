"use server";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { quitarDiacriticos } from "@/lib/slug";
import {
  obtenerOCrearEjecucionAbierta,
  obtenerOCrearAbiertaEnTx,
  bloquearPeriodo,
  obtenerEjecucionPorSemana,
  obtenerUltimaEjecucion,
} from "@/lib/ejecucion";
import {
  periodoDeFecha,
  ordenarPeriodos,
  resolverDestinos,
  mensajeMesesCerrados,
  repartoPorPeriodo,
  type EstadoSemanaDelPeriodo,
} from "@/lib/ejecucionSemanas";
import { evaluarCierre, type SinUnidad } from "@/lib/cierreEjecucion";
import { prefijoMoneda } from "@/lib/moneda";
import { contarParaCierreDeSemana, listarMovimientosSinUnidad, type FilaSinUnidad } from "@/lib/cierreEjecucionDb";
import {
  requireOperadorEjecucionGlobal,
  requireVerEjecucionGlobal,
  requireCierreEjecucion,
  requireCargaMadreEjecucion,
  puedeOperarEjecucionGlobal,
  puedeCerrarEjecucion,
  puedeCargarMadreEjecucion,
  veSubidaDeEjecucion,
  veTodoEjecucion,
} from "@/lib/auth";
import { FILAS_POR_PAGINA, mapearMovimiento, vistaDeLaSemana } from "@/lib/ejecucionVista";
import { SIN_FILTROS, type FiltrosEjecucion } from "@/lib/filtrosEjecucion";
import { calcularClasificacionesDisponibles } from "@/lib/clasificaciones";
import {
  CHEQUEOS_SUMA_CERO,
  MUESTRA_POR_GRUPO,
  agruparUnidadesSugeridas,
  armarChequeo,
  ordenarGruposSugerencia,
  totalizarSugerencias,
  type GrupoSugerenciaClasificacion,
  type GrupoUnidadSugerida,
  type ResultadoChequeo,
} from "@/lib/agregadosEjecucion";
import {
  normalizarCuenta,
  proponerUnidadPorCuenta,
  esUnidadDeLaLista,
} from "@/lib/unidadesNegocio";
import { aCentavos, centavosADecimal } from "@/lib/prorrateo";
import { leerArchivoSubido } from "@/lib/extractos/archivo";
import {
  mensajeUsarOpcionMadre,
  verificarCantidadFilas,
  verificarCantidadFilasMadre,
  verificarCuentaElegida,
  verificarTamanoArchivo,
  verificarTamanoMadre,
} from "@/lib/extractos/limites";
import { type FilaMadre } from "@/lib/extractos/madre";
import {
  OPCION_ARCHIVO_MADRE,
  cuentasCargadasPorOtroCamino,
  esClasificacionExplicita,
  resumirMadre,
  type ResumenMadre,
} from "@/lib/extractos/madreWeb";
import { crearExclusionMutua } from "@/lib/exclusionMutua";
import {
  analizarContinuidad,
  avisosDeContinuidad,
  verificarContinuidadSaldo,
  type ResultadoContinuidadSaldo,
} from "@/lib/extractos/continuidad";
import { NOMBRE_BANCO } from "@/lib/extractos/tipos";
import {
  controlarCuentaDelArchivo,
  cuentaEsVerificable,
  exigirConfirmacionDeCuenta,
  sugerirCuenta,
} from "@/lib/cuentasBancarias";
import { aplicarSugerenciasDeHistorial } from "@/lib/clasificacionHistorial";
import { cargarIndiceGlobal } from "@/lib/clasificacionHistorialDb";
import { obtenerUnidadesConEmpresa, contarSinUnidadEnSemana } from "@/lib/reporte";
import {
  centavosDeNumero,
  centavosDeDecimalTexto,
  monedaParaClave,
  MONEDA_PREDETERMINADA,
  decimalTextoDeCentavos,
  claveMovimiento,
  contarPorClave,
  separarNuevas,
} from "@/lib/conteoMovimientos";

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

// Ejecución global (docs/ejecucion_global_plan.md §3.4): las semanas son del PERÍODO, de todo el
// holding, y este módulo (/ejecucion) no depende de ninguna empresa. Las Server Actions se
// invocan directo desde el cliente y no pasan por el layout: cada una valida el permiso acá.
// La vista de solo lectura de cada empresa vive en app/[empresa]/[periodo]/ejecucion/actions.ts.
// Para las Server Actions que mutan: solo valida el período y el permiso global de operar.
async function resolverParaOperar(periodo: string) {
  if (!FORMATO_PERIODO.test(periodo)) {
    throw new Error(`"${periodo}" no es un período válido (AAAA-MM).`);
  }
  return requireOperadorEjecucionGlobal();
}

// Refresca la semana en el módulo global y en la pestaña de solo lectura de cada empresa
// (la semana se ve desde las dos).
function revalidarSemana(periodo: string, numeroSemana: number) {
  revalidatePath(`/ejecucion/${periodo}/${numeroSemana}`);
  revalidatePath("/[empresa]/[periodo]/ejecucion/[numeroSemana]", "page");
}

// Antes de mutar un movimiento: pertenece a ESTA semana (abierta) y no a otra. Sin esto, el
// chequeo de "semana cerrada" miraba solo la semana de la URL y no la del movimiento.
async function movimientoDeLaSemana(movimientoId: string, ejecucionId: string) {
  const m = await prisma.movimientoBancario.findUnique({
    where: { id: movimientoId },
    select: { id: true, ejecucionId: true, unidadNegocio: true },
  });
  return m && m.ejecucionId === ejecucionId ? m : null;
}

// Resuelve-o-crea la semana ABIERTA DEL PERÍODO (global, con lock por período) y devuelve su
// número, para que la página índice (sin segmento numérico) redirija ahí. Solo para quien puede
// OPERAR — ADMIN y FINANZAS sin permiso de operar no deben disparar la creación de una semana
// nueva con el simple hecho de navegar acá. Para ese caso se busca la última semana existente
// del período sin crear ninguna; null si todavía no hay ninguna (el índice le muestra un mensaje
// en vez de redirigir a algo inexistente).
export async function obtenerNumeroSemanaAbierta(periodo: string) {
  if (!FORMATO_PERIODO.test(periodo)) {
    throw new Error(`"${periodo}" no es un período válido (AAAA-MM).`);
  }
  const usuario = await requireVerEjecucionGlobal();

  if (puedeOperarEjecucionGlobal(usuario)) {
    const ejecucion = await obtenerOCrearEjecucionAbierta(periodo);
    return ejecucion.numeroSemana;
  }

  const ultima = await obtenerUltimaEjecucion(periodo);
  return ultima?.numeroSemana ?? null;
}

// Semanas del período con su estado, para navegar entre ellas. Solo lectura.
export async function listarSemanasDelPeriodo(periodo: string) {
  await requireVerEjecucionGlobal();
  const semanas = await prisma.ejecucionSemanal.findMany({
    where: { periodo },
    orderBy: { numeroSemana: "asc" },
    select: { numeroSemana: true, estado: true },
  });
  return semanas;
}

// Solo lectura: nunca crea nada. Devuelve null si esa semana no existe todavía.
// `pagina` es 1-indexada; se clampea entre 1 y el total de páginas reales, así un
// ?pagina=9999 nunca muestra un vacío falso en una semana que sí tiene movimientos.
// `filtros` (lib/filtrosEjecucion.ts: "sin clasificar", fechas, clasificación, unidad, cuenta, texto)
// recalcula totalMovimientos/totalPaginas/totalImporte sobre el universo filtrado, así el usuario
// nunca se pierde una fila que cayó en otra página. Los paneles de sugerencias, unidades sugeridas,
// sin unidad y los chequeos NO dependen del filtro: son de la semana completa.
// Ve ADMIN, FINANZAS y quien opera (todo el holding, todas las unidades); opera quien tenga el
// permiso. Un gerente no entra acá: ve su empresa en la pestaña de solo lectura.
export async function obtenerDatosSemana(
  periodo: string,
  numeroSemana: number,
  pagina: number = 1,
  filtros: FiltrosEjecucion = SIN_FILTROS
) {
  if (!FORMATO_PERIODO.test(periodo)) {
    throw new Error(`"${periodo}" no es un período válido (AAAA-MM).`);
  }
  // calcularClasificacionesDisponibles no depende de la semana (es una query global) — se
  // dispara ya para que corra en paralelo con toda la cadena de abajo en vez de sumar un
  // round-trip secuencial más contra la base.
  const clasificacionesPromise = calcularClasificacionesDisponibles();

  const usuario = await requireVerEjecucionGlobal();
  const puedeOperar = puedeOperarEjecucionGlobal(usuario);
  const puedeCerrar = puedeCerrarEjecucion(usuario);
  const verSaldo = veTodoEjecucion(usuario);
  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);

  if (!ejecucion) {
    return null;
  }

  // La lista filtrada y ordenada es la única fuente de la cantidad, el Total y las páginas (ver
  // vistaDeLaSemana): el Total excluye las filas "ignorado" (es justamente el cálculo que "ignorado"
  // existe para poder sacar de los reportes) y la cantidad las incluye (siguen visibles en la tabla,
  // la paginación tiene que contarlas).
  const vistaPromise = vistaDeLaSemana(ejecucion.id, filtros);

  const [vista, unidadesSugeridas, sinUnidadAsignada, sugerenciasClasificacion] = await Promise.all([
    vistaPromise,
    // Panel de unidades sugeridas: a diferencia de las filas de la tabla, no se pagina — un
    // archivo de ~16.500 filas reparte las sugerencias en decenas de páginas.
    // Los tres paneles son solo de quien opera: para el resto ni se consultan.
    puedeOperar ? consultarUnidadesSugeridas(ejecucion.id) : Promise.resolve([]),
    // Aviso antes del cierre: no van a entrar en el Reporte de nadie, y una vez cerrada la
    // semana ya no se pueden corregir.
    puedeOperar || puedeCerrar ? consultarSinUnidadAsignada(ejecucion.id) : Promise.resolve([]),
    // Panel de clasificaciones sugeridas: TODA la semana, no la página
    // (decisión 2026-10-07 — antes se armaba con las filas de la página actual).
    puedeOperar ? agruparSugerenciasClasificacion(ejecucion.id) : Promise.resolve([]),
  ]);

  const totalMovimientos = vista.cantidad;
  const totalPaginas = Math.max(1, Math.ceil(totalMovimientos / FILAS_POR_PAGINA));
  const paginaEfectiva = Math.min(Math.max(1, pagina), totalPaginas);

  // Desempate estable por `id`: con `fecha` sola, cientos de filas del mismo día no tienen
  // ningún orden garantizado entre sí, y ese orden puede además cambiar cuando una de ellas
  // se edita (un UPDATE reubica la fila físicamente en el heap de Postgres) — eso es lo que
  // causó que una edición de Unidad de Negocio terminara pisando una fila distinta al volver
  // a esta página. `id` es único y no cambia nunca, así que el orden queda fijo para siempre.
  //
  // Dentro de cada fecha y cuenta, las filas siguen la cadena de saldo cuando esta cierra completa
  // (vistaDeLaSemana, solo visualización): Flavia controla el arrastre con la columna Saldo.
  const idsPagina = vista.ids.slice((paginaEfectiva - 1) * FILAS_POR_PAGINA, paginaEfectiva * FILAS_POR_PAGINA);
  const filasPagina = await prisma.movimientoBancario.findMany({
    where: { ejecucionId: ejecucion.id, id: { in: idsPagina } },
    include: { desglose: { orderBy: { createdAt: "asc" } } },
  });
  const filaPorId = new Map(filasPagina.map((m) => [m.id, m]));
  const movimientos = idsPagina.flatMap((id) => filaPorId.get(id) ?? []);

  // Cuentas activas del holding para el selector de "Subir extracto" (solo si puede operar).
  const cuentasBancarias = puedeOperar
    ? await prisma.cuentaBancaria.findMany({
        where: { activa: true },
        orderBy: { nombre: "asc" },
        select: { nombre: true, banco: true },
      })
    : [];

  return {
    periodo: ejecucion.periodo,
    numeroSemana: ejecucion.numeroSemana,
    estado: ejecucion.estado,
    // "Cerrada por X el dd/mm" en la vista de una semana cerrada. por = null en
    // semanas cerradas antes de que se guardara cerradoPorId.
    cierre: ejecucion.fechaCierre
      ? {
          fecha: ejecucion.fechaCierre.toISOString(),
          por: ejecucion.cerradoPorId
            ? ((await prisma.usuario.findUnique({ where: { id: ejecucion.cerradoPorId }, select: { nombre: true } }))?.nombre ?? null)
            : null,
        }
      : null,
    puedeOperar,
    puedeCerrar,
    puedeCargarMadre: puedeCargarMadreEjecucion(usuario),
    veSubida: veSubidaDeEjecucion(usuario),
    clasificacionesDisponibles: await clasificacionesPromise,
    // Columna Saldo: ADMIN, FINANZAS y quien opera (hoy: Kike, Flavia y los administradores). Se
    // decide acá, en el servidor: para el resto la clave `saldo` no existe en lo que viaja.
    verSaldo,
    movimientos: movimientos.map((m) => mapearMovimiento(m, undefined, { verSaldo })),
    totalMovimientos,
    totalSemana: vista.totalSemana,
    cuentasDeLaSemana: vista.cuentas,
    // Total en pesos (como siempre) y el Total por moneda que muestra la pantalla.
    totalImporte: vista.totalCentavos / 100,
    totalesPorMoneda: vista.totalesPorMoneda,
    pagina: paginaEfectiva,
    totalPaginas,
    filtros,
    soloSinClasificar: filtros.soloSinClasificar,
    unidadesSugeridas,
    sinUnidadAsignada,
    sugerenciasClasificacion,
    cuentasBancarias,
  };
}

export type {
  FilaSugerenciaClasificacion,
  GrupoSugerenciaClasificacion,
  GrupoUnidadSugerida,
  ResultadoChequeo,
} from "@/lib/agregadosEjecucion";

// Sugerencias de clasificación pendientes (sugeridaPorSistema) de TODA la
// semana, agrupadas por clasificación — mismo criterio que el panel de unidades
// sugeridas: un archivo de ~16.500 filas reparte las sugerencias en decenas de
// páginas, y "Confirmar las N" tiene que confirmar las N de la semana, no las de
// la página que se está viendo. Un groupBy (pocas filas) + una muestra por grupo.
async function agruparSugerenciasClasificacion(
  ejecucionId: string
): Promise<GrupoSugerenciaClasificacion[]> {
  const conteos = await prisma.movimientoBancario.groupBy({
    by: ["clasificacion", "chequeIvaAmbiguo"],
    where: { ejecucionId, sugeridaPorSistema: true },
    _count: true,
  });
  const porClasificacion = totalizarSugerencias(conteos);
  const grupos = await Promise.all(
    Array.from(porClasificacion.entries()).map(async ([clasificacion, totales]) => {
      const filas = await prisma.movimientoBancario.findMany({
        where: { ejecucionId, sugeridaPorSistema: true, clasificacion },
        orderBy: [{ chequeIvaAmbiguo: "desc" }, { fecha: "asc" }, { id: "asc" }],
        take: MUESTRA_POR_GRUPO,
        select: { id: true, fecha: true, concepto: true, bancoYCuenta: true, importe: true, moneda: true, clasificacion: true, chequeIvaAmbiguo: true },
      });
      return {
        clasificacion,
        ...totales,
        filas: filas.map((m) => ({ ...m, fecha: m.fecha.toISOString().slice(0, 10), importe: Number(m.importe) })),
      };
    })
  );
  return ordenarGruposSugerencia(grupos);
}

// Panel de unidades sugeridas: TODA la semana (sin paginar y sin filtroClasificacion).
function consultarUnidadesSugeridas(ejecucionId: string) {
  return prisma.movimientoBancario
    .groupBy({
      by: ["bancoYCuenta", "unidadNegocio"],
      where: { ejecucionId, unidadSugeridaPorSistema: true },
      _count: true,
    })
    .then(agruparUnidadesSugeridas);
}

// Aviso antes del cierre (decisión 2026-10-07): movimientos de TODA la semana
// cuya unidad no pertenece a ninguna empresa.
function consultarSinUnidadAsignada(ejecucionId: string) {
  return obtenerUnidadesConEmpresa().then((unidades) => contarSinUnidadEnSemana(ejecucionId, unidades));
}

// Mismo filtro por ejecucionId que obtenerDatosSemana (no cruza otras semanas
// del período) — así el chequeo siempre mira exactamente el mismo conjunto de
// filas que el usuario ve en pantalla para esa semana, sea o no acumulativo el
// archivo que se subió. ignorado:false por el mismo motivo que en
// obtenerDatosSemana: una línea ignorada no debe pesar en ningún cálculo.
async function chequeosSumaCeroDeEjecucion(ejecucionId: string): Promise<ResultadoChequeo[]> {
  const resultados: ResultadoChequeo[] = [];
  for (const def of CHEQUEOS_SUMA_CERO) {
    const movimientos = await prisma.movimientoBancario.findMany({
      // Solo pesos: un movimiento de otra moneda no se netea contra uno en pesos.
      where: { ejecucionId, clasificacion: def.clasificacion, ignorado: false, moneda: MONEDA_PREDETERMINADA },
      orderBy: [{ fecha: "asc" }, { id: "asc" }],
    });
    resultados.push(armarChequeo(def, movimientos));
  }
  return resultados;
}

export async function calcularChequeosSumaCero(
  periodo: string,
  numeroSemana: number
): Promise<ResultadoChequeo[]> {
  // Solo lo usa quien opera (la pantalla de imputación).
  await resolverParaOperar(periodo);
  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) return [];
  return chequeosSumaCeroDeEjecucion(ejecucion.id);
}

export type ResultadoLiquidacionAmbigua = {
  fila: number;
  fecha: string;
  importe: number;
  candidatos: string[];
};

// Cruza contra PagoReferencia (planilla de Macchi, ver lib/pagoReferencia.ts)
// para discriminar "Liquidación final" de "Sueldos" cuando la leyenda
// bancaria por sí sola no alcanza — mismo criterio que usa Macchi a mano:
// fecha exacta + importe (reusa claveDuplicado, misma tolerancia de
// centavos que ya usa el resto del proyecto, pero por VALOR ABSOLUTO —
// PagoReferencia siempre guarda montos positivos, porque es un libro de
// pagos de Macchi, mientras que MovimientoBancario trae el signo del banco,
// negativo para un débito/pago. Comparar el signo tal cual, sin abs(),
// nunca matcheaba nada — bug real encontrado 2026-09-02 reintentando esta
// prueba). Corre DESPUÉS de que la clasificación normal ya se resolvió
// (archivo / reglas automáticas / SIN CLASIFICAR) y la pisa solo cuando
// corresponde — nunca la deja peor de lo que ya estaba. Si hay más de un
// candidato posible para la misma clave y al menos uno es liquidación, no
// se aplica ningún override (no forzar una asignación ambigua) — se junta
// para la alerta en vez de arriesgar asignarlo a la persona equivocada.
async function aplicarCruceLiquidacionFinal(
  filas: {
    numeroFila: number;
    fecha: Date;
    importe: number;
    clasificacion: string;
    sugeridaPorSistema: boolean;
  }[]
): Promise<ResultadoLiquidacionAmbigua[]> {
  if (filas.length === 0) return [];

  // Acotado al rango de fechas del archivo recién subido — PagoReferencia
  // puede tener 13.000+ filas (todo el holding, varios meses) mientras que
  // una carga semanal normal cubre unos pocos días; sin este filtro, cada
  // subirExtracto traía la tabla entera (~15s medido contra Neon).
  const fechas = filas.map((f) => f.fecha.getTime());
  const referencias = await prisma.pagoReferencia.findMany({
    where: { fecha: { gte: new Date(Math.min(...fechas)), lte: new Date(Math.max(...fechas)) } },
  });
  if (referencias.length === 0) return [];

  const porClave = new Map<string, typeof referencias>();
  for (const r of referencias) {
    const clave = claveDuplicado(r.fecha, Math.abs(Number(r.importe)));
    const grupo = porClave.get(clave);
    if (grupo) grupo.push(r);
    else porClave.set(clave, [r]);
  }

  const ambiguas: ResultadoLiquidacionAmbigua[] = [];

  for (const fila of filas) {
    const candidatos = porClave.get(claveDuplicado(fila.fecha, Math.abs(fila.importe)));
    if (!candidatos) continue;

    if (candidatos.length === 1) {
      if (candidatos[0].esLiquidacionFinal) {
        fila.clasificacion = "Liquidación final";
        fila.sugeridaPorSistema = true;
      }
      continue;
    }

    if (candidatos.some((c) => c.esLiquidacionFinal)) {
      ambiguas.push({
        fila: fila.numeroFila,
        fecha: fila.fecha.toISOString().slice(0, 10),
        importe: fila.importe,
        candidatos: candidatos.map((c) => c.proveedor),
      });
    }
  }

  return ambiguas;
}

// Cruza contra ChequeIvaReferencia (planilla de Macchi, ver
// lib/chequeIvaReferencia.ts) para discriminar "IVA" de "CH DIFERIDOS IVA" en
// movimientos "CHEQUE P/CAMARA" — PRIMERA VERSIÓN, acotada al único canal
// validado (diagnóstico 2026-09-08): MovimientoBancario.nroReferencia +
// importe contra N° de cheque + importe de la planilla, solo para filas cuyo
// concepto contiene "CHEQUE P/CAMARA". El canal de texto embebido en el
// concepto (casos sin nroReferencia) queda para una vuelta futura. IMPORTE CH
// en la planilla siempre es positivo (libro de cheques de Macchi) mientras
// que MovimientoBancario.importe trae el signo del banco (negativo, un
// cheque negociado es una salida) — mismo Math.abs() y mismo motivo que en
// aplicarCruceLiquidacionFinal. La dedup de lib/chequeIvaReferencia.ts ya
// garantiza como máximo una fila por (numeroCheque, importeCh) en la tabla
// — a diferencia de Liquidación final, acá no hay ambigüedad posible en el
// cruce en sí, así que no hace falta ningún tipo de alerta de "candidatos
// múltiples". Corre después de que la clasificación normal ya se resolvió y
// la pisa solo cuando hay un match confiable — nunca la deja peor de lo que
// ya estaba. "IVA"/"CH DIFERIDOS IVA" son categorías DISTINTAS de "CHEQUES
// DIFERIDOS" (ya existente, otro significado) — no fusionar.
async function aplicarCruceChequeIva(
  filas: {
    fecha: Date;
    importe: number;
    concepto: string;
    nroReferencia: string | null;
    clasificacion: string;
    sugeridaPorSistema: boolean;
    chequeIvaAmbiguo: boolean;
  }[]
): Promise<void> {
  const elegibles = filas
    .map((fila) => ({ fila, numeroCheque: Number(fila.nroReferencia) }))
    .filter(
      ({ fila, numeroCheque }) =>
        fila.nroReferencia &&
        Number.isFinite(numeroCheque) &&
        quitarDiacriticos(fila.concepto).toUpperCase().includes("CHEQUE P/CAMARA")
    );
  if (elegibles.length === 0) return;

  // Acotado a los N° de cheque presentes en este archivo — más preciso que
  // acotar por rango de fechas (la fecha de negociación de la planilla puede
  // caer en un mes distinto al de la fila, que es justamente lo que este
  // cruce necesita comparar) y evita traer ChequeIvaReferencia entera.
  const numeros = [...new Set(elegibles.map((e) => e.numeroCheque))];
  const referencias = await prisma.chequeIvaReferencia.findMany({
    where: { numeroCheque: { in: numeros } },
  });
  if (referencias.length === 0) return;

  const porNumero = new Map<number, typeof referencias>();
  for (const r of referencias) {
    const grupo = porNumero.get(r.numeroCheque);
    if (grupo) grupo.push(r);
    else porNumero.set(r.numeroCheque, [r]);
  }

  for (const { fila, numeroCheque } of elegibles) {
    const candidatos = (porNumero.get(numeroCheque) ?? []).filter(
      (r) => Math.abs(Number(r.importeCh) - Math.abs(fila.importe)) < 0.01
    );
    if (candidatos.length !== 1) continue;

    const referencia = candidatos[0];
    // getUTCFullYear()/getUTCMonth(), no getFullYear()/getMonth(): las fechas
    // se guardan como medianoche UTC, y el proceso corre en hora de Argentina
    // (UTC-3) — con los getters locales, cualquier fecha que caiga el día 1
    // de un mes retrocede al mes anterior (medianoche UTC del 1° = 21hs del
    // día 30/31 anterior en hora local), dando un "mismo mes" falso negativo
    // exactamente en esos casos. Bug real encontrado 2026-09-11 armando una
    // demo (referencia del 1/10/2018 comparada contra un movimiento del
    // 15/10/2018 daba "distinto mes"). Mismo criterio que claveDuplicado más
    // abajo, que ya usa .toISOString() en vez de getters locales por este
    // motivo.
    const mismoMes =
      fila.fecha.getUTCFullYear() === referencia.fecha.getUTCFullYear() &&
      fila.fecha.getUTCMonth() === referencia.fecha.getUTCMonth();
    fila.clasificacion = mismoMes ? "IVA" : "CH DIFERIDOS IVA";
    fila.sugeridaPorSistema = true;
    fila.chequeIvaAmbiguo = referencia.duplicadoAmbiguo;
  }
}

// Re-export: el cliente (AlertaContinuidadSaldo) lo importa desde acá.
export type { ResultadoContinuidadSaldo } from "@/lib/extractos/continuidad";

// Casi-duplicado: fila NUEVA (no reconocida como ya cargada) cuya cuenta + fecha +
// importe coinciden con un movimiento ya cargado de la misma cuenta, pero que
// difiere en concepto, nro de referencia o saldo — típico de un movimiento que el
// banco reexportó con otra leyenda. Se carga igual; solo se avisa.
export type PosibleDuplicado = {
  fila: number;
  fecha: string;
  importe: number;
  bancoYCuenta: string;
  concepto: string;
};

// Tope de casi-duplicados que viaja al cliente (el total viaja aparte): con un
// archivo de ~16.500 filas la lista completa no se puede leer igual.
const MAX_POSIBLES_DUPLICADOS = 200;

// Resumen de un extracto crudo ANTES de cargarlo (aprobado 2026-10-15): lo que Flavia
// compara con la pantalla del banco para confirmar. No se escribió nada.
export type VistaPreviaExtracto = {
  banco: string;
  cuenta: string;
  // false cuando el archivo no trae su número de cuenta (Galicia y Nación): la cuenta es solo la
  // que eligió la persona y hay que pedirle que la confirme antes de cargar.
  cuentaVerificada: boolean;
  filas: number;
  desde: string;
  hasta: string;
  creditos: number;
  debitos: number;
  neto: number;
  nuevas: number;
  yaCargadas: number;
  posiblesDuplicados: number;
  avisos: string[];
  continuidadSaldo: ResultadoContinuidadSaldo[];
  // Filas NUEVAS por mes ("septiembre: N filas; octubre: M filas"): cada fila va a la semana
  // abierta de su mes.
  repartoPorPeriodo: { periodo: string; filas: number }[];
};

type ResultadoImportar =
  | {
      ok: true;
      filasNuevas: number;
      filasYaCargadas: number;
      posiblesDuplicados: PosibleDuplicado[];
      cantidadPosiblesDuplicados: number;
      continuidadSaldo: ResultadoContinuidadSaldo[];
      liquidacionesAmbiguas: ResultadoLiquidacionAmbigua[];
      // Avisos informativos (cuenta no verificable, saldo previo, sin saldo, CUIT…).
      avisos: string[];
      // Solo viene seteado cuando la hoja se resolvió por selección explícita del
      // usuario (ver requiereSeleccionHoja) — así el mensaje de éxito puede dejar
      // trazado con qué hoja se cargó. En el caso normal (una sola hoja, o "Hoja1")
      // queda undefined a propósito, para no agregar ruido al mensaje de siempre.
      hoja?: string;
      // Dónde quedó cada mes que trajo filas nuevas: período, cuántas filas y número de semana.
      repartoPorPeriodo: { periodo: string; filas: number; numeroSemana: number }[];
    }
  // cuentaSugerida: el selector la propone cuando el archivo trae su número de cuenta.
  | { ok: false; error: string; cuentaSugerida?: string }
  // Archivo con más de una hoja y ninguna llamada "Hoja1": antes se tomaba
  // worksheets[0] en silencio, lo que podía atribuirle a una empresa los
  // movimientos de otra hoja/empresa sin ningún aviso. Este resultado no importa
  // nada todavía — el panel le muestra las hojas al usuario para que elija.
  | { ok: false; requiereSeleccionHoja: true; hojas: string[] }
  // Extracto crudo: no se cargó NADA todavía, se muestra el resumen y, si el usuario
  // confirma, se reenvía el archivo con confirmarVistaPrevia = true.
  | { ok: false; requiereVistaPrevia: true; vista: VistaPreviaExtracto };

// fecha + importe — la usa aplicarCruceLiquidacionFinal para emparejar contra
// PagoReferencia (el reconocimiento de lo ya cargado usa claveMovimiento, más
// completa).
function claveDuplicado(fecha: Date, importe: number) {
  return `${fecha.toISOString().slice(0, 10)}|${importe.toFixed(2)}`;
}

type FilaClaveDb = {
  fecha: Date;
  importe: string;
  bancoYCuenta: string;
  concepto: string;
  nroReferencia: string | null;
  saldo: string | null;
  moneda: string;
};

function claveDeFilaDb(m: FilaClaveDb) {
  return claveMovimiento({
    fecha: m.fecha,
    importeCentavos: centavosDeDecimalTexto(m.importe),
    bancoYCuenta: m.bancoYCuenta,
    concepto: m.concepto,
    nroReferencia: m.nroReferencia,
    saldoCentavos: m.saldo === null ? null : centavosDeDecimalTexto(m.saldo),
    moneda: m.moneda,
  });
}

function claveFechaImporteCuenta(fecha: Date, importeCentavos: number, bancoYCuenta: string, moneda?: string | null) {
  return JSON.stringify([
    fecha.toISOString().slice(0, 10),
    importeCentavos,
    normalizarCuenta(bancoYCuenta),
    ...monedaParaClave(moneda),
  ]);
}

type OpcionesSubida = {
  // Hoja elegida tras el selector (archivo con varias hojas).
  hoja?: string;
  // true solo en el reenvío después de la vista previa de un extracto crudo.
  confirmarVistaPrevia?: boolean;
  // true cuando la persona tildó "Confirmo que este extracto es de la cuenta X". Solo cuenta para
  // extractos cuya cuenta no se puede verificar por el archivo (Galicia y Nación); el servidor lo exige.
  confirmoCuenta?: boolean;
};

// Fila lista para importar. Las del extracto crudo traen además los centavos exactos
// (importeCentavos/saldoCentavos): se usan tal cual, sin pasar por el float.
type FilaAImportar = FilaMadre & { importeCentavos?: number; saldoCentavos?: number | null };

const pesos = (centavos: number) => centavos / 100;

export async function subirExtracto(
  periodo: string,
  numeroSemana: number,
  formData: FormData,
  opciones: OpcionesSubida = {}
): Promise<ResultadoImportar> {
  const { hoja: hojaElegida, confirmarVistaPrevia = false, confirmoCuenta = false } = opciones;
  const archivo = formData.get("archivo");

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false, error: "Elegí un archivo antes de subir." };
  }

  // La extensión solo filtra lo obvio: el camino (madre o extracto de un banco) se decide
  // por el CONTENIDO del archivo.
  if (!/\.(xlsx|xls|csv)$/i.test(archivo.name)) {
    return { ok: false, error: "El archivo tiene que ser un .xlsx, .xls o .csv." };
  }

  // Cuenta elegida en el selector (obligatoria acá: el archivo madre va por subirMadre).
  const cuentaElegida = String(formData.get("cuenta") ?? "").trim();
  if (cuentaElegida === OPCION_ARCHIVO_MADRE) {
    return { ok: false, error: "El archivo madre se carga con su propia acción (subirMadre), no con la de un extracto de banco." };
  }

  await resolverParaOperar(periodo);

  // Frenos de memoria (lib/extractos/limites.ts), ANTES de leer el archivo con ExcelJS: la madre
  // real (16.521 filas) superó los 512 MB que tenía Render. Mismo tope para todos los roles; sin cuenta
  // elegida podría ser una madre subida por el camino equivocado (se le indica cuál es el suyo).
  const frenoCuenta = verificarCuentaElegida(cuentaElegida);
  if (!frenoCuenta.ok) return { ok: false, error: frenoCuenta.error };
  const frenoTamano = verificarTamanoArchivo(archivo.size);
  if (!frenoTamano.ok) return { ok: false, error: frenoTamano.error };

  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) {
    return { ok: false, error: `No encontré la semana ${numeroSemana}.` };
  }
  if (ejecucion.estado === "CERRADA") {
    return { ok: false, error: "La semana ya está cerrada, no se pueden subir más movimientos." };
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const leido = await leerArchivoSubido(bytes, hojaElegida);

  if (leido.tipo === "error") return { ok: false, error: leido.error };
  if (leido.tipo === "seleccionHoja") return { ok: false, requiereSeleccionHoja: true, hojas: leido.hojas };

  let filas: FilaAImportar[];
  let cuentaCruda: { nombre: string } | null = null;
  let avisos: string[] = [];
  let continuidadSaldo: ResultadoContinuidadSaldo[];
  let resumenCrudo: { banco: string; cuenta: string; cuentaVerificada: boolean } | null = null;

  // Una madre (se detecta por contenido) no entra por el camino del extracto de un banco: tiene su
  // propia acción y sus propios topes (subirMadre), con la opción "Archivo madre" del selector.
  if (leido.tipo === "madre") {
    return { ok: false, error: `Este archivo es un archivo madre, no el extracto de una cuenta. ${mensajeUsarOpcionMadre()}` };
  } else {
    const { lectura } = leido;
    const frenoFilas = verificarCantidadFilas(lectura.filas.length);
    if (!frenoFilas.ok) return { ok: false, error: frenoFilas.error };

    // Validaciones en el servidor (el cliente no decide nada). Ejecución global: se elige entre
    // TODAS las cuentas del holding; la empresa de la cuenta es solo su titular (opcional).
    const cuentasDelHolding = await prisma.cuentaBancaria.findMany({
      select: {
        nombre: true,
        banco: true,
        terminacion: true,
        activa: true,
        empresa: { select: { nombre: true, cuit: true } },
      },
    });
    if (!cuentaElegida) {
      const sugerida = sugerirCuenta(cuentasDelHolding, lectura.banco, lectura.cuentaEnArchivo);
      return {
        ok: false,
        error: sugerida
          ? `Es un extracto de ${NOMBRE_BANCO[lectura.banco]}. Elegí la cuenta del extracto: por el número del archivo parece ser ${sugerida.nombre}.`
          : `Es un extracto de ${NOMBRE_BANCO[lectura.banco]}. Elegí la cuenta del extracto en el selector (si no está en la lista, cargala en Administración → Cuentas bancarias).`,
        cuentaSugerida: sugerida?.nombre,
      };
    }
    const cuenta = cuentasDelHolding.find(
      (c) => c.activa && normalizarCuenta(c.nombre) === normalizarCuenta(cuentaElegida)
    );
    if (!cuenta) {
      return { ok: false, error: `La cuenta "${cuentaElegida}" no está activa.` };
    }
    const control = controlarCuentaDelArchivo(cuenta, lectura.banco, lectura.cuentaEnArchivo);
    if (!control.ok) return { ok: false, error: control.error };

    // Galicia y Nación no traen el número de cuenta: solo se carga con la confirmación expresa de
    // la persona. Lo único que carga datos es el reenvío con confirmarVistaPrevia (sin él, o no
    // hay filas nuevas o se devuelve la vista previa), así que se exige ahí; el servidor no
    // depende de que el botón esté deshabilitado en pantalla.
    if (confirmarVistaPrevia) {
      const confirmacion = exigirConfirmacionDeCuenta(lectura.cuentaEnArchivo, confirmoCuenta, cuenta.nombre);
      if (!confirmacion.ok) return { ok: false, error: confirmacion.error };
    }

    avisos = [...control.avisos, ...lectura.avisos];
    // CUIT distinto del de la TITULAR de la cuenta (si tiene): aviso, no bloqueo (hay cuentas
    // compartidas legítimas).
    const titular = cuenta.empresa;
    const cuitTitular = titular?.cuit?.replace(/\D/g, "") ?? null;
    if (lectura.cuitEnArchivo && titular && cuitTitular && lectura.cuitEnArchivo !== cuitTitular) {
      avisos.push(
        `El CUIT del archivo (${lectura.cuitEnArchivo}) no es el de ${titular.nombre}, titular de ${cuenta.nombre} (${cuitTitular}): revisá que sea la cuenta correcta.`
      );
    }

    // La unidad sale del mapa por cuenta. La clasificación se SUGIERE desde el historial ya
    // clasificado (lib/clasificacionHistorial.ts); sin historial suficiente queda SIN CLASIFICAR.
    // No se usan las keywords de proponerClasificacionAutomatica (acertaron 0 de 21 en el backtest).
    const unidadPorCuenta = proponerUnidadPorCuenta(cuenta.nombre);
    const indiceHistorial = await cargarIndiceGlobal();
    const filasSinClasificar = lectura.filas.map((f) => ({
      numeroFila: f.numeroFila,
      fecha: f.fecha,
      nroReferencia: f.referencia,
      causal: f.causal,
      concepto: f.concepto,
      importe: pesos(f.importeCentavos),
      saldo: f.saldoCentavos === null ? null : pesos(f.saldoCentavos),
      importeCentavos: f.importeCentavos,
      saldoCentavos: f.saldoCentavos,
      bancoYCuenta: cuenta.nombre,
      clasificacion: "SIN CLASIFICAR",
      clasificacion2: null,
      unidadNegocio: unidadPorCuenta ?? "SIN ASIGNAR",
      detalle: f.detalle,
      detalle2: null,
      sugeridaPorSistema: false,
      chequeIvaAmbiguo: false,
      unidadSugeridaPorSistema: unidadPorCuenta !== null,
    }));
    const conHistorial = aplicarSugerenciasDeHistorial(filasSinClasificar, indiceHistorial);
    filas = conHistorial.filas;

    // Las filas ya vienen cronológicas y con el saldo posterior; se numeran en ese orden.
    const analisis = analizarContinuidad(filas.map((f, i) => ({ ...f, numeroFila: i })));
    continuidadSaldo = verificarContinuidadSaldo(filas.map((f, i) => ({ ...f, numeroFila: i })));
    avisos.push(...avisosDeContinuidad(analisis));
    if (unidadPorCuenta === null) {
      avisos.push(`${cuenta.nombre} no tiene unidad sugerida: los movimientos entran como SIN ASIGNAR.`);
    }
    if (conHistorial.sugeridas > 0) {
      avisos.push(
        `${conHistorial.sugeridas} de ${filas.length} movimientos tienen una clasificación sugerida por el historial: quedan para confirmar en el panel de sugerencias.`
      );
    }
    cuentaCruda = { nombre: cuenta.nombre };
    resumenCrudo = {
      banco: NOMBRE_BANCO[lectura.banco],
      cuenta: cuenta.nombre,
      cuentaVerificada: cuentaEsVerificable(lectura.cuentaEnArchivo),
    };
  }

  // Importe y saldo en centavos, redondeados igual que Postgres: es lo que entra
  // en la clave y, como texto decimal exacto, lo que se guarda (así lo guardado y
  // la clave nunca difieren por un centavo de float).
  const filasConClave = filas.map((f) => {
    const importeCentavos = f.importeCentavos ?? centavosDeNumero(f.importe);
    const saldoCentavos =
      f.saldoCentavos !== undefined ? f.saldoCentavos : f.saldo === null ? null : centavosDeNumero(f.saldo);
    return {
      fila: f,
      importeCentavos,
      saldoCentavos,
      clave: claveMovimiento({
        fecha: f.fecha,
        importeCentavos,
        bancoYCuenta: f.bancoYCuenta,
        concepto: f.concepto,
        nroReferencia: f.nroReferencia,
        saldoCentavos,
      }),
    };
  });

  // Rango de fechas y cuentas del archivo: lo ya cargado se busca POR CUENTA, en todos los
  // períodos, acotado a este rango (un extracto acumulativo que trae días de un mes ya cargado
  // no los vuelve a cargar). Math.min/max con el spread de ~16.500 fechas entra en el stack.
  const fechasDelArchivo = filas.map((f) => f.fecha.getTime());
  const desde = new Date(Math.min(...fechasDelArchivo));
  const hasta = new Date(Math.max(...fechasDelArchivo));
  const cuentasDelArchivo = Array.from(new Set(filas.map((f) => normalizarCuenta(f.bancoYCuenta))));
  const periodosDelArchivo = ordenarPeriodos(filas.map((f) => periodoDeFecha(f.fecha)));

  // Todo lo que decide qué se carga y la carga misma, dentro de UNA transacción con
  // locks: dos subidas simultáneas (dos pestañas, dos personas) contarían el mismo M antes de
  // que la otra inserte y duplicarían. Primero el lock de la cuenta (extracto crudo) y después
  // los de cada período, siempre en el mismo orden (sin deadlock). pg_advisory_xact_lock se
  // libera solo al terminar la transacción (compatible con el pooler de Neon en modo
  // transacción). "SELECT 1 FROM ...": pg_advisory_xact_lock devuelve void, que Prisma no sabe
  // deserializar.
  // timeout 120s: el archivo real de 16.521 filas tardó ~24s por llamada en local
  // (2026-10-07); el margen cubre una base más lenta que la local.
  const resultado = await prisma.$transaction(
    async (tx) => {
      if (cuentaCruda) {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${"ejecucion:cuenta:" + normalizarCuenta(cuentaCruda.nombre)}))`;
      }
      for (const p of ordenarPeriodos([ejecucion.periodo, ...periodosDelArchivo])) {
        await bloquearPeriodo(tx, p);
      }

      // Con el lock tomado, la semana pudo haberse cerrado mientras se leía el archivo.
      const vigente = await tx.ejecucionSemanal.findUnique({ where: { id: ejecucion.id }, select: { estado: true } });
      if (!vigente || vigente.estado === "CERRADA") {
        return { ok: false as const, error: "La semana ya está cerrada, no se pueden subir más movimientos." };
      }

      // Reconocer lo ya cargado CONTANDO (ver lib/conteoMovimientos.ts): de cada
      // clave se cargan N − M. Lo ya cargado no se toca nunca — conserva
      // clasificación, unidad, prorrateo, ignorado y adjuntos, esté en una semana
      // cerrada o en la abierta. Un solo round-trip (no uno por fila del Excel);
      // importe/saldo como texto: se pasan a centavos sin float.
      const existentes = await tx.$queryRaw<FilaClaveDb[]>`
        SELECT mb.fecha, mb.importe::text AS importe, mb."bancoYCuenta", mb.concepto,
               mb."nroReferencia", mb.saldo::text AS saldo, mb.moneda
        FROM "MovimientoBancario" mb
        WHERE mb.fecha >= ${desde.toISOString().slice(0, 10)}::date
          AND mb.fecha < (${hasta.toISOString().slice(0, 10)}::date + 1)
          AND regexp_replace(upper(trim(mb."bancoYCuenta")), '[[:space:]]+', ' ', 'g') = ANY(${cuentasDelArchivo}::text[])
      `;
      const yaCargadas = contarPorClave(existentes.map(claveDeFilaDb));
      const { nuevas, cantidadYaCargadas } = separarNuevas(filasConClave, (f) => f.clave, yaCargadas);

      // Cuenta + fecha + importe de lo ya cargado en el rango: alimenta el aviso de
      // casi-duplicados y el control de "un solo camino".
      const fechaImporteCuenta = new Set(
        existentes.map((m) => claveFechaImporteCuenta(m.fecha, centavosDeDecimalTexto(m.importe), m.bancoYCuenta, m.moneda))
      );

      // Casi-duplicados: solo entre las NUEVAS (las coincidencias exactas ya
      // quedaron reconocidas arriba y no se cargan). Se cargan igual.
      const casiDuplicados: PosibleDuplicado[] = nuevas
        .filter((n) =>
          fechaImporteCuenta.has(claveFechaImporteCuenta(n.fila.fecha, n.importeCentavos, n.fila.bancoYCuenta))
        )
        .map((n) => ({
          fila: n.fila.numeroFila,
          fecha: n.fila.fecha.toISOString().slice(0, 10),
          importe: n.fila.importe,
          bancoYCuenta: n.fila.bancoYCuenta,
          concepto: n.fila.concepto,
        }));

      if (cuentaCruda && nuevas.length > 0) {
        // UNA cuenta por un solo camino (madre o crudo), en todos los períodos: si la cuenta ya
        // tiene movimientos en las fechas de este archivo, ninguna fila coincide exactamente
        // con ellos pero sí hay filas con la misma fecha e importe, es casi seguro que esos
        // movimientos entraron por el OTRO camino (la clave de reconocimiento no coincide fila
        // a fila) y cargar acá los duplicaría. No hay una columna "origen" en la base: se
        // infiere así.
        const cuentaNormalizada = normalizarCuenta(cuentaCruda.nombre);
        const delRango = new Set(
          existentes
            .filter((m) => normalizarCuenta(m.bancoYCuenta) === cuentaNormalizada)
            .map((m) => claveFechaImporteCuenta(m.fecha, centavosDeDecimalTexto(m.importe), m.bancoYCuenta, m.moneda))
        );
        const parecidas = nuevas.filter((n) =>
          delRango.has(claveFechaImporteCuenta(n.fila.fecha, n.importeCentavos, n.fila.bancoYCuenta))
        ).length;
        if (delRango.size > 0 && cantidadYaCargadas === 0 && parecidas > 0) {
          return {
            ok: false as const,
            error: `La cuenta ${cuentaCruda.nombre} ya tiene movimientos cargados en las fechas de este archivo por otro camino (archivo madre o extracto crudo), y ${parecidas} de las filas de este archivo tienen la misma fecha e importe que algunos de ellos. Una cuenta se carga por un solo camino para no duplicar. No se cargó nada.`,
          };
        }
      }

      // A qué semana va cada mes (§3.4): las filas del mes de esta semana, a esta; las de otro
      // mes, a la semana abierta de SU mes (se crea si el mes no tiene ninguna). Un mes con
      // semanas y todas cerradas frena la subida (los tardíos son la Fase 4). Antes de la
      // vista previa: no tiene sentido pedir confirmar algo que no se va a cargar.
      const periodosNuevas = new Set(nuevas.map((n) => periodoDeFecha(n.fila.fecha)));
      const otrosPeriodos = Array.from(periodosNuevas).filter((p) => p !== ejecucion.periodo);
      const semanasDeOtros =
        otrosPeriodos.length === 0
          ? []
          : await tx.ejecucionSemanal.findMany({
              where: { periodo: { in: otrosPeriodos } },
              select: { periodo: true, estado: true },
            });
      const semanasPorPeriodo = new Map<string, EstadoSemanaDelPeriodo[]>();
      for (const s of semanasDeOtros) {
        semanasPorPeriodo.set(s.periodo, [...(semanasPorPeriodo.get(s.periodo) ?? []), s.estado]);
      }
      const destinos = resolverDestinos(ejecucion.periodo, periodosNuevas, semanasPorPeriodo);
      const repartoNuevas = repartoPorPeriodo(nuevas.map((n) => n.fila.fecha));
      const bloqueados = destinos
        .filter((d) => d.tipo === "bloqueado")
        .map((d) => ({ periodo: d.periodo, filas: repartoNuevas.find((r) => r.periodo === d.periodo)?.filas ?? 0 }));
      if (bloqueados.length > 0) {
        return { ok: false as const, error: mensajeMesesCerrados(bloqueados) };
      }

      // Extracto crudo: primero se muestra qué se va a cargar y se pide confirmar.
      if (resumenCrudo && !confirmarVistaPrevia && nuevas.length > 0) {
        const todas = filasConClave.map((f) => f.importeCentavos);
        const creditos = todas.filter((c) => c > 0).reduce((a, c) => a + c, 0);
        const debitos = todas.filter((c) => c < 0).reduce((a, c) => a + c, 0);
        return {
          ok: false as const,
          requiereVistaPrevia: true as const,
          vista: {
            banco: resumenCrudo.banco,
            cuenta: resumenCrudo.cuenta,
            cuentaVerificada: resumenCrudo.cuentaVerificada,
            filas: filas.length,
            desde: desde.toISOString().slice(0, 10),
            hasta: hasta.toISOString().slice(0, 10),
            creditos: pesos(creditos),
            debitos: pesos(debitos),
            neto: pesos(creditos + debitos),
            nuevas: nuevas.length,
            yaCargadas: cantidadYaCargadas,
            posiblesDuplicados: casiDuplicados.length,
            avisos,
            continuidadSaldo,
            repartoPorPeriodo: repartoNuevas,
          },
        };
      }

      const filasNuevas = nuevas.map((n) => n.fila);
      // Ambas mutan fila.clasificacion in-place cuando corresponde — tienen que
      // correr antes del createMany de abajo, y SOLO sobre las filas nuevas (las
      // ya cargadas no se tocan). Independientes entre sí (una mira Sueldos/
      // Liquidación final, la otra CHEQUE P/CAMARA) — no compiten por la misma fila.
      // El extracto crudo no se clasifica en esta etapa: no pasa por estos cruces.
      const liquidacionesAmbiguas =
        filasNuevas.length > 0 && !cuentaCruda ? await aplicarCruceLiquidacionFinal(filasNuevas) : [];
      if (filasNuevas.length > 0 && !cuentaCruda) await aplicarCruceChequeIva(filasNuevas);

      // Semana destino de cada mes (las de otros meses se crean acá si no existen).
      const semanaDeCadaPeriodo = new Map<string, { id: string; numeroSemana: number }>();
      for (const d of destinos) {
        semanaDeCadaPeriodo.set(
          d.periodo,
          d.tipo === "actual" ? ejecucion : await obtenerOCrearAbiertaEnTx(tx, d.periodo)
        );
      }

      for (const [p, semana] of semanaDeCadaPeriodo) {
        const delMes = nuevas.filter((n) => periodoDeFecha(n.fila.fecha) === p);
        await tx.movimientoBancario.createMany({
          data: delMes.map(({ fila, importeCentavos, saldoCentavos }) => ({
            ejecucionId: semana.id,
            fecha: fila.fecha,
            nroReferencia: fila.nroReferencia,
            causal: fila.causal,
            concepto: fila.concepto,
            importe: decimalTextoDeCentavos(importeCentavos),
            saldo: saldoCentavos === null ? null : decimalTextoDeCentavos(saldoCentavos),
            bancoYCuenta: fila.bancoYCuenta,
            clasificacion: fila.clasificacion,
            clasificacion2: fila.clasificacion2,
            unidadNegocio: fila.unidadNegocio,
            detalle: fila.detalle,
            detalle2: fila.detalle2,
            sugeridaPorSistema: fila.sugeridaPorSistema,
            chequeIvaAmbiguo: fila.chequeIvaAmbiguo,
            unidadSugeridaPorSistema: fila.unidadSugeridaPorSistema,
          })),
        });
      }

      return {
        ok: true as const,
        filasNuevas: nuevas.length,
        filasYaCargadas: cantidadYaCargadas,
        posiblesDuplicados: casiDuplicados.slice(0, MAX_POSIBLES_DUPLICADOS),
        cantidadPosiblesDuplicados: casiDuplicados.length,
        continuidadSaldo,
        liquidacionesAmbiguas,
        avisos,
        // Semana (número) donde quedó cada mes que trajo filas nuevas.
        repartoPorPeriodo: repartoNuevas.map((r) => ({
          ...r,
          numeroSemana: semanaDeCadaPeriodo.get(r.periodo)!.numeroSemana,
        })),
      };
    },
    { maxWait: 10_000, timeout: 120_000 }
  );

  if (resultado.ok && resultado.filasNuevas > 0) {
    // Ejecución global: la semana se ve desde la pestaña de cualquier empresa.
    revalidarSemana(periodo, numeroSemana);
  }
  return resultado;
}

// ---------------------------------------------------------------------------------------------
// Archivo madre por la web (solo ADMIN y FINANZAS; planillas de uso diario, topes en
// lib/extractos/limites.ts). Respeta las columnas del archivo (clasificación, unidad, cuenta) tal
// como las lee lib/extractos/madre.ts; el histórico sigue por prisma/scripts/cargar-madre-historial.ts.
// ---------------------------------------------------------------------------------------------

// Resumen que ve la persona antes de cargar (no se escribió nada).
export type VistaPreviaMadre = {
  filas: number;
  cuentasDelArchivo: number;
  desde: string;
  hasta: string;
  nuevas: number;
  yaCargadas: number;
  posiblesDuplicados: number;
  // Cuentas que parecen cargadas por el otro camino (extracto crudo): se OMITEN, no se cargan.
  cuentasOmitidas: { cuenta: string; filas: number }[];
  // Sobre las filas que se van a cargar.
  resumen: ResumenMadre;
  avisos: string[];
  repartoPorPeriodo: { periodo: string; filas: number }[];
};

type ResultadoMadre =
  | (Extract<ResultadoImportar, { ok: true }> & { cuentasOmitidas: { cuenta: string; filas: number }[] })
  | { ok: false; error: string }
  | { ok: false; requiereSeleccionHoja: true; hojas: string[] }
  | { ok: false; requiereVistaPreviaMadre: true; vista: VistaPreviaMadre };

type OpcionesMadre = {
  hoja?: string;
  // true solo en el reenvío después de la vista previa.
  confirmarVistaPrevia?: boolean;
  // true cuando la persona confirmó las clasificaciones nuevas que mostró la vista previa. El
  // servidor lo exige si el archivo trae alguna.
  confirmoClasificacionesNuevas?: boolean;
};

type FilaConClaveMadre = {
  fila: FilaAImportar;
  importeCentavos: number;
  saldoCentavos: number | null;
  clave: string;
  cuenta: string;
  claveFIC: string;
};

type DbLectura = typeof prisma | Prisma.TransactionClient;

// Una sola carga de madre a la vez por instancia: la lectura cuesta ~13,5 KB de memoria por fila
// (ver lib/extractos/limites.ts).
const cargaDeMadre = crearExclusionMutua();

// Log simple de tiempos por fase y RSS máximo de la carga de madre, para medir en las pruebas.
function crearMarcaMadre() {
  const inicio = Date.now();
  let anterior = inicio;
  return (fase: string, filas?: number) => {
    const ahora = Date.now();
    const rssMaxMb = Math.round(process.resourceUsage().maxRSS / 1024);
    console.info(
      `[madre] ${fase}: ${((ahora - anterior) / 1000).toFixed(1)} s (total ${((ahora - inicio) / 1000).toFixed(1)} s)` +
        `${filas === undefined ? "" : ` · ${filas} filas`} · RSS máx ${rssMaxMb} MB`
    );
    anterior = ahora;
  };
}

function armarFilasConClaveMadre(filas: FilaMadre[]): FilaConClaveMadre[] {
  return filas.map((fila) => {
    const importeCentavos = centavosDeNumero(fila.importe);
    const saldoCentavos = fila.saldo === null ? null : centavosDeNumero(fila.saldo);
    return {
      fila,
      importeCentavos,
      saldoCentavos,
      clave: claveMovimiento({
        fecha: fila.fecha,
        importeCentavos,
        bancoYCuenta: fila.bancoYCuenta,
        concepto: fila.concepto,
        nroReferencia: fila.nroReferencia,
        saldoCentavos,
      }),
      cuenta: normalizarCuenta(fila.bancoYCuenta),
      claveFIC: claveFechaImporteCuenta(fila.fecha, importeCentavos, fila.bancoYCuenta),
    };
  });
}

// Qué se cargaría: lo ya cargado se reconoce CONTANDO (N − M, igual que el extracto crudo y el
// script), las cuentas cargadas por el otro camino se omiten, y cada mes va a la semana abierta
// del suyo. Solo lee: lo usan la vista previa (cliente normal, sin locks) y la carga (dentro de la
// transacción con los locks tomados).
async function calcularCargaMadre(db: DbLectura, filasConClave: FilaConClaveMadre[], periodoDeLaSemana: string) {
  let minimo = Infinity;
  let maximo = -Infinity;
  for (const f of filasConClave) {
    const t = f.fila.fecha.getTime();
    if (t < minimo) minimo = t;
    if (t > maximo) maximo = t;
  }
  const desde = new Date(minimo);
  const hasta = new Date(maximo);
  const cuentasDelArchivo = Array.from(new Set(filasConClave.map((f) => f.cuenta)));

  const existentes = await db.$queryRaw<FilaClaveDb[]>`
    SELECT mb.fecha, mb.importe::text AS importe, mb."bancoYCuenta", mb.concepto,
           mb."nroReferencia", mb.saldo::text AS saldo, mb.moneda
    FROM "MovimientoBancario" mb
    WHERE mb.fecha >= ${desde.toISOString().slice(0, 10)}::date
      AND mb.fecha < (${hasta.toISOString().slice(0, 10)}::date + 1)
      AND regexp_replace(upper(trim(mb."bancoYCuenta")), '[[:space:]]+', ' ', 'g') = ANY(${cuentasDelArchivo}::text[])
  `;
  const existentesCotejo = existentes.map((m) => ({
    cuenta: normalizarCuenta(m.bancoYCuenta),
    clave: claveDeFilaDb(m),
    claveFIC: claveFechaImporteCuenta(m.fecha, centavosDeDecimalTexto(m.importe), m.bancoYCuenta, m.moneda),
  }));

  const omitidas = cuentasCargadasPorOtroCamino(filasConClave, existentesCotejo);
  const aCargar = filasConClave.filter((f) => !omitidas.has(f.cuenta));
  const cuentasOmitidas = [...omitidas].map((cuenta) => {
    const delArchivo = filasConClave.filter((f) => f.cuenta === cuenta);
    return { cuenta: delArchivo[0].fila.bancoYCuenta, filas: delArchivo.length };
  });

  const { nuevas, cantidadYaCargadas } = separarNuevas(
    aCargar,
    (f) => f.clave,
    contarPorClave(existentesCotejo.map((e) => e.clave))
  );
  const yaVistos = new Set(existentesCotejo.map((e) => e.claveFIC));
  const casiDuplicados: PosibleDuplicado[] = nuevas
    .filter((n) => yaVistos.has(n.claveFIC))
    .map((n) => ({
      fila: n.fila.numeroFila,
      fecha: n.fila.fecha.toISOString().slice(0, 10),
      importe: n.fila.importe,
      bancoYCuenta: n.fila.bancoYCuenta,
      concepto: n.fila.concepto,
    }));

  const periodosNuevas = new Set(nuevas.map((n) => periodoDeFecha(n.fila.fecha)));
  const otrosPeriodos = Array.from(periodosNuevas).filter((p) => p !== periodoDeLaSemana);
  const semanasDeOtros =
    otrosPeriodos.length === 0
      ? []
      : await db.ejecucionSemanal.findMany({
          where: { periodo: { in: otrosPeriodos } },
          select: { periodo: true, estado: true },
        });
  const semanasPorPeriodo = new Map<string, EstadoSemanaDelPeriodo[]>();
  for (const s of semanasDeOtros) {
    semanasPorPeriodo.set(s.periodo, [...(semanasPorPeriodo.get(s.periodo) ?? []), s.estado]);
  }
  const destinos = resolverDestinos(periodoDeLaSemana, periodosNuevas, semanasPorPeriodo);
  const repartoNuevas = repartoPorPeriodo(nuevas.map((n) => n.fila.fecha));
  const bloqueados = destinos
    .filter((d) => d.tipo === "bloqueado")
    .map((d) => ({ periodo: d.periodo, filas: repartoNuevas.find((r) => r.periodo === d.periodo)?.filas ?? 0 }));

  return { desde, hasta, cuentasDelArchivo, nuevas, cantidadYaCargadas, casiDuplicados, cuentasOmitidas, destinos, repartoNuevas, bloqueados };
}

function avisosMadre(resumen: ResumenMadre, cuentasOmitidas: { cuenta: string; filas: number }[]): string[] {
  const avisos: string[] = [];
  if (cuentasOmitidas.length > 0) {
    avisos.push(
      `Se omitieron ${cuentasOmitidas.length === 1 ? "la cuenta" : "las cuentas"} ${cuentasOmitidas
        .map((c) => `${c.cuenta} (${c.filas} filas)`)
        .join(", ")}: ya tienen movimientos en esas fechas cargados por otro camino (extracto de banco) y cargarlos de nuevo los duplicaría.`
    );
  }
  if (resumen.filasSinBanco > 0) {
    avisos.push(
      `${resumen.filasSinBanco} filas no traen banco ni cuenta y se cargan como "(sin banco)": revisá que no estén ya cargadas con su cuenta.`
    );
  }
  if (resumen.cuentasFueraDelCatalogo.length > 0) {
    avisos.push(
      `Cuentas que no están en Administración → Cuentas bancarias: ${resumen.cuentasFueraDelCatalogo.join(", ")}.`
    );
  }
  return avisos;
}

export async function subirMadre(
  periodo: string,
  numeroSemana: number,
  formData: FormData,
  opciones: OpcionesMadre = {}
): Promise<ResultadoMadre> {
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false, error: "Elegí un archivo antes de subir." };
  }
  if (!/\.xlsx$/i.test(archivo.name)) {
    return { ok: false, error: "El archivo madre tiene que ser un .xlsx." };
  }
  if (!FORMATO_PERIODO.test(periodo)) {
    throw new Error(`"${periodo}" no es un período válido (AAAA-MM).`);
  }
  await requireCargaMadreEjecucion();

  // Antes de leer nada (ExcelJS carga el archivo entero en memoria).
  const frenoTamano = verificarTamanoMadre(archivo.size);
  if (!frenoTamano.ok) return { ok: false, error: frenoTamano.error };

  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) return { ok: false, error: `No encontré la semana ${numeroSemana}.` };
  if (ejecucion.estado === "CERRADA") {
    return { ok: false, error: "La semana ya está cerrada, no se pueden subir más movimientos." };
  }

  const liberar = cargaDeMadre.intentar();
  if (!liberar) {
    return { ok: false, error: "Hay otra carga de archivo madre en curso. Esperá a que termine y volvé a intentar." };
  }
  try {
    return await procesarMadre(periodo, numeroSemana, ejecucion, archivo, opciones);
  } finally {
    liberar();
  }
}

async function procesarMadre(
  periodo: string,
  numeroSemana: number,
  ejecucion: { id: string; periodo: string; numeroSemana: number },
  archivo: File,
  { hoja: hojaElegida, confirmarVistaPrevia = false, confirmoClasificacionesNuevas = false }: OpcionesMadre
): Promise<ResultadoMadre> {
  const marca = crearMarcaMadre();
  const leido = await leerArchivoSubido(new Uint8Array(await archivo.arrayBuffer()), hojaElegida);
  marca("lectura", leido.tipo === "madre" ? leido.filas.length : undefined);
  if (leido.tipo === "error") return { ok: false, error: leido.error };
  if (leido.tipo === "seleccionHoja") return { ok: false, requiereSeleccionHoja: true, hojas: leido.hojas };
  if (leido.tipo === "crudo") {
    return {
      ok: false,
      error: "Este archivo es el extracto de un banco, no un archivo madre. Elegí la cuenta del extracto en el selector.",
    };
  }
  if (leido.filas.length === 0) return { ok: false, error: "No encontré ninguna fila con datos para importar." };
  const frenoFilas = verificarCantidadFilasMadre(leido.filas.length);
  if (!frenoFilas.ok) return { ok: false, error: frenoFilas.error };

  const [cuentasDelCatalogo, clasificaciones] = await Promise.all([
    prisma.cuentaBancaria.findMany({ select: { nombre: true } }),
    calcularClasificacionesDisponibles(),
  ]);
  const conocidas = { cuentasDelCatalogo: cuentasDelCatalogo.map((c) => c.nombre), clasificaciones };
  const filasConClave = armarFilasConClaveMadre(leido.filas);
  const periodosDelArchivo = ordenarPeriodos(leido.filas.map((f) => periodoDeFecha(f.fecha)));
  const hoja = hojaElegida;

  // Nada nuevo para cargar: se informa directo, sin vista previa ni escritura.
  const sinNovedades = (c: Awaited<ReturnType<typeof calcularCargaMadre>>) => ({
    ok: true as const,
    filasNuevas: 0,
    filasYaCargadas: c.cantidadYaCargadas,
    posiblesDuplicados: [],
    cantidadPosiblesDuplicados: 0,
    continuidadSaldo: [],
    liquidacionesAmbiguas: [],
    avisos: avisosMadre(resumirMadre([], conocidas), c.cuentasOmitidas),
    hoja,
    repartoPorPeriodo: [],
    cuentasOmitidas: c.cuentasOmitidas,
  });

  // Primero se muestra qué se va a cargar: nada se escribe todavía, ni se toman locks.
  if (!confirmarVistaPrevia) {
    const c = await calcularCargaMadre(prisma, filasConClave, ejecucion.periodo);
    marca("vista previa (cotejo con la base)");
    if (c.bloqueados.length > 0) return { ok: false, error: mensajeMesesCerrados(c.bloqueados) };
    if (c.nuevas.length === 0) return sinNovedades(c);
    const resumen = resumirMadre(c.nuevas.map((n) => n.fila), conocidas);
    return {
      ok: false,
      requiereVistaPreviaMadre: true,
      vista: {
        filas: leido.filas.length,
        cuentasDelArchivo: c.cuentasDelArchivo.length,
        desde: c.desde.toISOString().slice(0, 10),
        hasta: c.hasta.toISOString().slice(0, 10),
        nuevas: c.nuevas.length,
        yaCargadas: c.cantidadYaCargadas,
        posiblesDuplicados: c.casiDuplicados.length,
        cuentasOmitidas: c.cuentasOmitidas,
        resumen,
        avisos: avisosMadre(resumen, c.cuentasOmitidas),
        repartoPorPeriodo: c.repartoNuevas,
      },
    };
  }

  // Misma garantía que el extracto crudo: todo lo que decide qué se carga y la carga misma, dentro
  // de UNA transacción con locks (primero los de cada cuenta, ordenados, y después los de cada
  // período: siempre el mismo orden, sin deadlock). El lock de cuenta es el mismo que toma
  // subirExtracto, así que una carga de madre y una de extracto de esa cuenta no se pisan.
  const resultado = await prisma.$transaction(
    async (tx) => {
      // Si otra carga tiene el lock de un período o de una cuenta, esperar a lo sumo 20 s y fallar
      // (la transacción se deshace entera) en vez de colgarse.
      await tx.$executeRaw`SET LOCAL lock_timeout = '20s'`;
      const cuentas = Array.from(new Set(filasConClave.map((f) => f.cuenta))).sort();
      for (const cuenta of cuentas) {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${"ejecucion:cuenta:" + cuenta}))`;
      }
      for (const p of ordenarPeriodos([ejecucion.periodo, ...periodosDelArchivo])) {
        await bloquearPeriodo(tx, p);
      }

      const vigente = await tx.ejecucionSemanal.findUnique({ where: { id: ejecucion.id }, select: { estado: true } });
      if (!vigente || vigente.estado === "CERRADA") {
        return { ok: false as const, error: "La semana ya está cerrada, no se pueden subir más movimientos." };
      }

      const c = await calcularCargaMadre(tx, filasConClave, ejecucion.periodo);
      if (c.bloqueados.length > 0) return { ok: false as const, error: mensajeMesesCerrados(c.bloqueados) };
      if (c.nuevas.length === 0) return sinNovedades(c);

      const resumen = resumirMadre(c.nuevas.map((n) => n.fila), conocidas);
      if (resumen.clasificacionesNuevas.length > 0 && !confirmoClasificacionesNuevas) {
        return {
          ok: false as const,
          error: "El archivo trae clasificaciones que no están en la lista: confirmalas en la vista previa antes de cargar. No se cargó nada.",
        };
      }

      // Los cruces con las planillas de referencia NO pisan lo que el archivo trae explícito (en la
      // web; el script no cambia): solo corren sobre las filas sin clasificación propia.
      const sinClasificacionPropia = c.nuevas.map((n) => n.fila).filter((f) => !esClasificacionExplicita(f));
      const liquidacionesAmbiguas =
        sinClasificacionPropia.length > 0 ? await aplicarCruceLiquidacionFinal(sinClasificacionPropia) : [];
      if (sinClasificacionPropia.length > 0) await aplicarCruceChequeIva(sinClasificacionPropia);

      const semanaDeCadaPeriodo = new Map<string, { id: string; numeroSemana: number }>();
      for (const d of c.destinos) {
        semanaDeCadaPeriodo.set(
          d.periodo,
          d.tipo === "actual" ? ejecucion : await obtenerOCrearAbiertaEnTx(tx, d.periodo)
        );
      }

      // Por lotes y verificando el conteo (como el script): si no cierra, se deshace todo.
      const LOTE = 1000;
      for (const [p, semana] of semanaDeCadaPeriodo) {
        const delMes = c.nuevas.filter((n) => periodoDeFecha(n.fila.fecha) === p);
        const antes = await tx.movimientoBancario.count({ where: { ejecucionId: semana.id } });
        for (let i = 0; i < delMes.length; i += LOTE) {
          await tx.movimientoBancario.createMany({
            data: delMes.slice(i, i + LOTE).map(({ fila, importeCentavos, saldoCentavos }) => ({
              ejecucionId: semana.id,
              fecha: fila.fecha,
              nroReferencia: fila.nroReferencia,
              causal: fila.causal,
              concepto: fila.concepto,
              importe: decimalTextoDeCentavos(importeCentavos),
              saldo: saldoCentavos === null ? null : decimalTextoDeCentavos(saldoCentavos),
              bancoYCuenta: fila.bancoYCuenta,
              clasificacion: fila.clasificacion,
              clasificacion2: fila.clasificacion2,
              unidadNegocio: fila.unidadNegocio,
              detalle: fila.detalle,
              detalle2: fila.detalle2,
              sugeridaPorSistema: fila.sugeridaPorSistema,
              chequeIvaAmbiguo: fila.chequeIvaAmbiguo,
              unidadSugeridaPorSistema: fila.unidadSugeridaPorSistema,
            })),
          });
        }
        const despues = await tx.movimientoBancario.count({ where: { ejecucionId: semana.id } });
        if (despues - antes !== delMes.length) {
          throw new Error(`Se esperaban ${delMes.length} filas nuevas en ${p} y la semana sumó ${despues - antes}. No se cargó nada.`);
        }
      }

      return {
        ok: true as const,
        filasNuevas: c.nuevas.length,
        filasYaCargadas: c.cantidadYaCargadas,
        posiblesDuplicados: c.casiDuplicados.slice(0, MAX_POSIBLES_DUPLICADOS),
        cantidadPosiblesDuplicados: c.casiDuplicados.length,
        continuidadSaldo: [],
        liquidacionesAmbiguas,
        avisos: avisosMadre(resumen, c.cuentasOmitidas),
        hoja,
        repartoPorPeriodo: c.repartoNuevas.map((r) => ({
          ...r,
          numeroSemana: semanaDeCadaPeriodo.get(r.periodo)!.numeroSemana,
        })),
        cuentasOmitidas: c.cuentasOmitidas,
      };
    },
    // timeout 180 s: la madre completa (16.521 filas) va en una sola transacción.
    { maxWait: 10_000, timeout: 180_000 }
  );
  marca("transacción (cotejo + carga)", resultado.ok ? resultado.filasNuevas : undefined);

  if (resultado.ok && resultado.filasNuevas > 0) revalidarSemana(periodo, numeroSemana);
  return resultado;
}

// Escribe únicamente MovimientoBancario.unidadNegocio (el valor único de la
// fila, editable inline en la tabla) — nunca toca MovimientoBancarioDesglose.
// Los dos son campos/tablas separados, sin punto de contacto: cambiar acá el
// valor de la fila no altera ni borra el reparto que pueda existir en
// guardarDesgloseMovimiento, y viceversa.
export async function actualizarMovimiento(
  periodo: string,
  numeroSemana: number,
  id: string,
  datos: { clasificacion?: string; unidadNegocio?: string; ignorado?: boolean }
) {
  await aplicarActualizacionMovimiento(periodo, numeroSemana, id, datos);
  revalidarSemana(periodo, numeroSemana);
}

export type AgregadosEdicion = {
  chequeos: ResultadoChequeo[];
  unidadesSugeridas: GrupoUnidadSugerida[];
  sinUnidadAsignada: { unidad: string; movimientos: number }[];
  sugerenciasClasificacion: GrupoSugerenciaClasificacion[];
};

// Edición de clasificación / unidad desde el <select> de la tabla: misma escritura que
// actualizarMovimiento, pero SIN revalidatePath — revalidar hace que la respuesta de la acción
// lleve la pantalla entera re-renderizada (~330 KB por edición). En su lugar devuelve solo lo que
// cambia al reclasificar y que la fila no puede calcular sola, con las mismas funciones que usa
// la página (lib/agregadosEjecucion.ts): chequeos de suma cero, sugerencias de clasificación,
// unidades sugeridas y filas sin unidad de empresa. El Total $ y la cantidad de filas no se
// devuelven: salen de ignorado/importe, que esta edición no toca (sí dependen de la clasificación
// cuando la lista está filtrada por "sin clasificar"; ese caso sigue por actualizarMovimiento).
export async function guardarCampoMovimiento(
  periodo: string,
  numeroSemana: number,
  id: string,
  datos: { clasificacion?: string; unidadNegocio?: string }
): Promise<AgregadosEdicion> {
  const ejecucion = await aplicarActualizacionMovimiento(periodo, numeroSemana, id, datos);
  const [chequeos, unidadesSugeridas, sinUnidadAsignada, sugerenciasClasificacion] = await Promise.all([
    chequeosSumaCeroDeEjecucion(ejecucion.id),
    consultarUnidadesSugeridas(ejecucion.id),
    consultarSinUnidadAsignada(ejecucion.id),
    agruparSugerenciasClasificacion(ejecucion.id),
  ]);
  return { chequeos, unidadesSugeridas, sinUnidadAsignada, sugerenciasClasificacion };
}

async function aplicarActualizacionMovimiento(
  periodo: string,
  numeroSemana: number,
  id: string,
  datos: { clasificacion?: string; unidadNegocio?: string; ignorado?: boolean }
) {
  await resolverParaOperar(periodo);
  // Hallazgo 2026-09-08: hasta ahora esta acción no chequeaba el estado de la
  // semana — lo único que impedía editar una semana CERRADA era que la
  // página no te deja llegar a este componente (page.tsx renderiza un árbol
  // de solo lectura distinto cuando estado==="CERRADA"). Un llamado directo
  // a esta Server Action bypaseando la UI igual mutaba una semana cerrada.
  // Mismo criterio que guardarDesgloseMovimiento, que sí lo chequeaba.
  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) {
    throw new Error(`No encontré la semana ${numeroSemana}.`);
  }
  if (ejecucion.estado === "CERRADA") {
    throw new Error("Esta semana ya está cerrada, no se puede editar.");
  }

  // Decisión 2026-10-06: solo cuenta como confirmación de una unidad sugerida si
  // el valor CAMBIÓ — reelegir el mismo valor no confirma nada. El <select> de
  // TablaMovimientos ya solo dispara con un cambio real; esta comparación es la
  // segunda barrera server-side, contra el valor realmente guardado.
  // Lista cerrada (decisión 2026-10-06): solo se acepta una unidad de
  // UNIDADES_NEGOCIO, o el valor que la fila ya tiene (un valor viejo fuera de
  // lista, ej. "CREAR", no se rompe — el <select> lo muestra como opción extra).
  const actual = await movimientoDeLaSemana(id, ejecucion.id);
  if (!actual) {
    throw new Error("No encontré ese movimiento en esta semana.");
  }
  let unidadCambio = false;
  if (datos.unidadNegocio !== undefined) {
    unidadCambio = actual.unidadNegocio !== datos.unidadNegocio;
    if (unidadCambio && !esUnidadDeLaLista(datos.unidadNegocio)) {
      throw new Error(`"${datos.unidadNegocio}" no es una unidad de negocio de la lista.`);
    }
  }

  await prisma.movimientoBancario.update({
    where: { id },
    data: {
      ...datos,
      ...(unidadCambio ? { unidadSugeridaPorSistema: false } : {}),
      // Cualquier edición manual de clasificacion —incluso reelegir el mismo
      // valor que ya tenía sugerido— cuenta como confirmación. No puede
      // depender de comparar contra el valor anterior: un <select> nativo no
      // dispara onChange si el usuario reelige la opción ya seleccionada, así
      // que esto se limpia siempre que `clasificacion` viene en el payload,
      // sin excepción (ver PanelSugerenciasPendientes.tsx, botón "Confirmar").
      ...(datos.clasificacion !== undefined ? { sugeridaPorSistema: false } : {}),
    },
  });
  return ejecucion;
}

export type ResultadoConfirmarClasificacionesEnLote =
  | { ok: true; cantidad: number }
  | { ok: false; error: string };

// Acepta tal cual TODAS las sugerencias de una clasificación en la semana
// (motor de leyenda / cruce de Liquidación final / cruce de cheques IVA) — no
// solo las de la página (decisión 2026-10-07): el panel se arma sobre toda la
// semana. Solo limpia sugeridaPorSistema, nunca toca `clasificacion` (el
// usuario confirma lo que ya ve; corregir pasa por actualizarMovimiento, fila
// por fila). chequeIvaAmbiguo:false en el where: un cheque con match ambiguo
// nunca se confirma en lote, solo de a uno.
export async function confirmarClasificacionesEnLote(
  periodo: string,
  numeroSemana: number,
  clasificacion: string
): Promise<ResultadoConfirmarClasificacionesEnLote> {
  await resolverParaOperar(periodo);
  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) {
    return { ok: false, error: `No encontré la semana ${numeroSemana}.` };
  }
  if (ejecucion.estado === "CERRADA") {
    return { ok: false, error: "Esta semana ya está cerrada, no se puede editar." };
  }
  const resultado = await prisma.movimientoBancario.updateMany({
    where: { ejecucionId: ejecucion.id, sugeridaPorSistema: true, clasificacion, chequeIvaAmbiguo: false },
    data: { sugeridaPorSistema: false },
  });
  if (resultado.count === 0) {
    return { ok: false, error: "No hay ninguna sugerencia para confirmar." };
  }

  revalidarSemana(periodo, numeroSemana);
  return { ok: true, cantidad: resultado.count };
}

// Análogo a confirmarClasificacionesEnLote, pero para la unidad de negocio
// sugerida por cuenta bancaria (proponerUnidadPorCuenta): acepta tal cual todas
// las filas todavía sugeridas de esas cuentas en ESTA semana — solo limpia
// unidadSugeridaPorSistema, nunca toca `unidadNegocio`. Recibe las grafías
// crudas de bancoYCuenta (GrupoUnidadSugerida.cuentasCrudas), no ids: el panel
// agrupa sobre toda la semana, no sobre la página que se está viendo. Confirmar
// una cuenta que tiene sugerencias en varias páginas las confirma TODAS — el
// botón del panel muestra la cantidad total para que eso quede a la vista.
// unidadSugeridaPorSistema:true en el where hace que una fila corregida a mano
// entre medio (flag ya en false) no cuente en el resultado.
export async function confirmarUnidadesEnLote(
  periodo: string,
  numeroSemana: number,
  cuentasCrudas: string[],
  unidadNegocio: string
): Promise<ResultadoConfirmarClasificacionesEnLote> {
  await resolverParaOperar(periodo);
  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) {
    return { ok: false, error: `No encontré la semana ${numeroSemana}.` };
  }
  if (ejecucion.estado === "CERRADA") {
    return { ok: false, error: "Esta semana ya está cerrada, no se puede editar." };
  }
  if (cuentasCrudas.length === 0) {
    return { ok: false, error: "No hay ninguna sugerencia para confirmar." };
  }

  const resultado = await prisma.movimientoBancario.updateMany({
    where: {
      ejecucionId: ejecucion.id,
      unidadSugeridaPorSistema: true,
      bancoYCuenta: { in: cuentasCrudas },
      // Misma clave que el grupo del panel (cuenta + unidad): no confirma de
      // rebote una sugerencia distinta de la que el usuario está viendo.
      unidadNegocio,
    },
    data: { unidadSugeridaPorSistema: false },
  });

  revalidarSemana(periodo, numeroSemana);
  return { ok: true, cantidad: resultado.count };
}

export async function eliminarMovimiento(
  periodo: string,
  numeroSemana: number,
  id: string
) {
  await resolverParaOperar(periodo);
  // Mismo hueco que actualizarMovimiento (auditoría 2026-09-08): sin esto, lo
  // único que impedía borrar un movimiento de una semana CERRADA era que la
  // página no te deja llegar a este botón — un llamado directo a la Server
  // Action igual borraba la fila.
  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) {
    throw new Error(`No encontré la semana ${numeroSemana}.`);
  }
  if (ejecucion.estado === "CERRADA") {
    throw new Error("Esta semana ya está cerrada, no se puede editar.");
  }

  if (!(await movimientoDeLaSemana(id, ejecucion.id))) {
    throw new Error("No encontré ese movimiento en esta semana.");
  }
  await prisma.movimientoBancario.delete({ where: { id } });
  revalidarSemana(periodo, numeroSemana);
}

type ResultadoDesgloseMovimiento =
  | { ok: true }
  | { ok: false; errores: Record<string, string> };

// Prorrateo de un movimiento entre varias unidades de negocio. Reemplaza el
// desglose completo — mismo patrón que guardarDesglose en presupuesto/actions.ts.
// Escribe MovimientoBancarioDesglose y, del movimiento, SOLO
// unidadSugeridaPorSistema (ver abajo) — nunca MovimientoBancario.unidadNegocio
// (el valor propio de la fila, que queda guardado detrás del resumen y se edita
// aparte vía actualizarMovimiento).
//
// Habilitado para TODAS las clasificaciones (pedido de Kike, 2026-10-06 — antes
// solo SUELDOS/EXPENSAS): ingresos y egresos por igual. Hoy ningún cálculo ni
// reporte lee esta tabla; el Reporte la va a usar en un paso aparte.
//
// El cliente (PanelDesgloseMovimiento) ya resolvió porcentajes → montos con
// lib/prorrateo.ts y manda cada línea en CENTAVOS ENTEROS, en magnitud positiva
// — no texto: parsearImporteArgentino lee "1234.56" como 123456 (el punto es
// separador de miles), así que un texto con punto decimal se guardaría mal en
// silencio. Acá la suma se compara en centavos con igualdad EXACTA.
export async function guardarDesgloseMovimiento(
  periodo: string,
  numeroSemana: number,
  movimientoId: string,
  sublineas: { unidadNegocio: string; importeCentavos: number }[]
): Promise<ResultadoDesgloseMovimiento> {
  await resolverParaOperar(periodo);
  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) {
    return { ok: false, errores: { general: `No encontré la semana ${numeroSemana}.` } };
  }

  const movimiento = await prisma.movimientoBancario.findUnique({
    where: { id: movimientoId },
    include: { desglose: { select: { unidadNegocio: true } } },
  });
  if (!movimiento || movimiento.ejecucionId !== ejecucion.id) {
    return { ok: false, errores: { general: "No encontré ese movimiento." } };
  }
  if (ejecucion.estado === "CERRADA") {
    return { ok: false, errores: { general: "Esta semana ya está cerrada, no se puede editar." } };
  }

  // MovimientoBancario.importe trae el signo del banco (negativo en un débito,
  // positivo en una cobranza); cada línea viaja como magnitud positiva y acá se
  // le aplica el signo del movimiento padre, para que un futuro reporte "por
  // unidad de negocio" que sume esta tabla obtenga el signo correcto.
  const totalCentavos = aCentavos(Number(movimiento.importe));
  if (totalCentavos === 0) {
    return { ok: false, errores: { general: "Un movimiento de $0 no se puede prorratear." } };
  }
  const signoMovimiento = Number(movimiento.importe) < 0 ? -1 : 1;

  // Lista cerrada, más los valores viejos fuera de lista que este desglose ya
  // tenía (no se rompe un desglose cargado antes de la lista — mismo criterio
  // que el <select> del panel).
  const unidadesPrevias = new Set(movimiento.desglose.map((d) => d.unidadNegocio));
  const limpias = sublineas.map((s) => ({
    unidadNegocio: s.unidadNegocio.trim(),
    importeCentavos: s.importeCentavos,
  }));

  const errores: Record<string, string> = {};
  if (limpias.length < 2) {
    errores.general = "Un prorrateo necesita al menos 2 unidades de negocio.";
  }
  const vistas = new Set<string>();
  limpias.forEach((s, i) => {
    if (!s.unidadNegocio) {
      errores[`unidadNegocio_${i}`] = "Elegí la unidad de negocio.";
    } else if (!esUnidadDeLaLista(s.unidadNegocio) && !unidadesPrevias.has(s.unidadNegocio)) {
      errores[`unidadNegocio_${i}`] = "No es una unidad de negocio de la lista.";
    } else if (vistas.has(s.unidadNegocio)) {
      errores[`unidadNegocio_${i}`] = "Esta unidad ya está en otra línea.";
    }
    vistas.add(s.unidadNegocio);
    if (!Number.isSafeInteger(s.importeCentavos) || s.importeCentavos <= 0) {
      errores[`importe_${i}`] = "El importe no puede estar vacío ni ser 0.";
    }
  });

  if (Object.keys(errores).length === 0) {
    const suma = limpias.reduce((acc, s) => acc + s.importeCentavos, 0);
    if (suma !== totalCentavos) {
      // El símbolo es el de la moneda del movimiento; en pesos queda "$" pegado, igual que siempre.
      const simbolo = prefijoMoneda(movimiento.moneda);
      errores.general = `La suma del prorrateo (${simbolo}${(suma / 100).toLocaleString("es-AR")}) tiene que coincidir con el importe del movimiento (${simbolo}${(totalCentavos / 100).toLocaleString("es-AR")}).`;
    }
  }

  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  await prisma.$transaction([
    prisma.movimientoBancarioDesglose.deleteMany({ where: { movimientoId } }),
    prisma.movimientoBancarioDesglose.createMany({
      data: limpias.map((s) => ({
        movimientoId,
        unidadNegocio: s.unidadNegocio,
        importe: centavosADecimal(s.importeCentavos, signoMovimiento),
      })),
    }),
    // Prorratear ya es asignar unidades a mano: la unidad sugerida por la
    // cuenta (si la había) deja de estar pendiente y sale del panel de
    // unidades sugeridas. No toca el valor de unidadNegocio.
    prisma.movimientoBancario.update({
      where: { id: movimientoId },
      data: { unidadSugeridaPorSistema: false },
    }),
  ]);

  revalidarSemana(periodo, numeroSemana);
  return { ok: true };
}

export async function eliminarDesgloseMovimiento(
  periodo: string,
  numeroSemana: number,
  movimientoId: string
) {
  await resolverParaOperar(periodo);
  // Mismo hueco que actualizarMovimiento/eliminarMovimiento (auditoría
  // 2026-09-08) — guardarDesgloseMovimiento (la contraparte que reemplaza el
  // desglose) ya lo chequeaba; a esta le faltaba.
  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) {
    throw new Error(`No encontré la semana ${numeroSemana}.`);
  }
  if (ejecucion.estado === "CERRADA") {
    throw new Error("Esta semana ya está cerrada, no se puede editar.");
  }

  // Hallazgo 2026-10-06: antes borraba por movimientoId sin verificar que el
  // movimiento fuera de esta semana — alguien con permiso de operar la empresa
  // A podía borrar el desglose de un movimiento de la empresa B pasando su id.
  // El where por ejecucionId lo acota a esta semana (de esta empresa).
  await prisma.movimientoBancarioDesglose.deleteMany({
    where: { movimientoId, movimiento: { ejecucionId: ejecucion.id } },
  });
  revalidarSemana(periodo, numeroSemana);
}

export type { FilaSinUnidad };

type ResultadoCerrarSemana =
  | { ok: true }
  | {
      ok: false;
      error: string;
      // Hay avisos (SIN CLASIFICAR, sugerencias sin confirmar): no bloquean, pero piden
      // confirmación — se reenvía con confirmarAvisos = true.
      requiereConfirmacion?: true;
      avisos?: string[];
      // Unidades que no pertenecen a ninguna empresa y bloquean el cierre.
      bloqueos?: SinUnidad[];
      // Los movimientos que bloquean (hasta 100), para mostrarlos en pantalla.
      movimientosSinUnidad?: FilaSinUnidad[];
    };

// Cierre definitivo (§3.5): solo FINANZAS y ADMIN (D-4). Antes de cerrar, en el servidor:
//   1. BLOQUEA si hay movimientos no ignorados (o porciones de prorrateo) con una unidad que
//      no pertenece a ninguna empresa activa;
//   2. SOLO AVISA (pide confirmación) si quedan SIN CLASIFICAR o sugerencias sin confirmar;
//   3. guarda quién y cuándo.
//
// No se puede cerrar una semana que ya estaba CERRADA — sin este chequeo, una segunda
// invocación pisaría fechaCierre con una marca de tiempo más nueva sin que nada más lo
// justifique (el updateMany con estado ABIERTA lo hace atómico).
export async function cerrarSemana(
  periodo: string,
  numeroSemana: number,
  opciones: { confirmarAvisos?: boolean } = {}
): Promise<ResultadoCerrarSemana> {
  const usuario = await requireCierreEjecucion();
  if (!FORMATO_PERIODO.test(periodo)) {
    throw new Error(`"${periodo}" no es un período válido (AAAA-MM).`);
  }
  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) {
    throw new Error(`No encontré la semana ${numeroSemana}.`);
  }
  if (ejecucion.estado === "CERRADA") {
    return { ok: false, error: "Esta semana ya estaba cerrada." };
  }

  const evaluacion = evaluarCierre(await contarParaCierreDeSemana(ejecucion.id));
  if (!evaluacion.puedeCerrar) {
    return {
      ok: false,
      error: evaluacion.mensajeBloqueo,
      bloqueos: evaluacion.bloqueos,
      avisos: evaluacion.avisos,
      movimientosSinUnidad: await listarMovimientosSinUnidad(ejecucion.id, await obtenerUnidadesConEmpresa()),
    };
  }
  if (evaluacion.avisos.length > 0 && !opciones.confirmarAvisos) {
    return {
      ok: false,
      requiereConfirmacion: true,
      error: `${evaluacion.avisos.join(" ")} ¿Cerrás la semana igual?`,
      avisos: evaluacion.avisos,
    };
  }

  // Trazabilidad (decisión 2026-10-07): quién cerró, además de cuándo.
  const cerrada = await prisma.ejecucionSemanal.updateMany({
    where: { id: ejecucion.id, estado: "ABIERTA" },
    data: { estado: "CERRADA", fechaCierre: new Date(), cerradoPorId: usuario.id },
  });
  if (cerrada.count === 0) {
    return { ok: false, error: "Esta semana ya estaba cerrada." };
  }
  revalidarSemana(periodo, numeroSemana);
  return { ok: true };
}
