"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireCargaRealEmpresa } from "@/lib/cargaRealEmpresa";
import { errorPeriodoNoHabilitado } from "@/lib/periodosHabilitados";
import { slugDeEmpresa } from "@/lib/slug";
import { bloquearPeriodo, obtenerEjecucionPorSemana } from "@/lib/ejecucion";
import { normalizarCuenta } from "@/lib/unidadesNegocio";
import { verificarCantidadFilasHavannaPeru, verificarTamanoHavannaPeru } from "@/lib/extractos/limites";
import { leerHavannaPeru, type ControlPieMoneda } from "@/lib/extractos/havannaPeru";
import { cargarIndiceDeEmpresa } from "@/lib/clasificacionHistorialDb";
import { aplicarSugerenciasAFilas, rangoDelPeriodo } from "@/lib/extractos/cargaEmpresa";
import { DETECTOR_CHASE, DETECTOR_HAVANNA_PERU, seleccionarPestanaHavannaPeru } from "@/lib/extractos/havannaPeruPestanas";
import { esCsvChase, hojaDeCsvChase, leerChase } from "@/lib/extractos/chase";
import { hojaDeBytesBrou, leerBrou } from "@/lib/extractos/brou";
import { leerHistoricosBbvaPeru } from "@/lib/extractos/bbvaPeruHistorico";
import { ErrorExtracto, type HojaGrilla } from "@/lib/extractos/tipos";
import {
  ERROR_EMPRESA_SIN_EXTRACTO,
  archivoDeUnaCuenta,
  armarFilasACargar,
  configDeEmpresa,
  datosParaCrear,
  errorDeLectura,
  errorFechasFueraDelPeriodo,
  monedasDeConfig,
  planificarCarga,
  resolverCuentasForzadas,
  type CuentasPorMoneda,
  type FilaExistente,
} from "@/lib/extractos/cargaEmpresa";

// Extracto de UNA empresa por su propio camino (Etapa 2: Havanna Perú, Bradenton y Plate Silver): el libro PF de la empresa, no el extracto de
// un banco. NO toca subirExtracto ni subirMadre. Toda la lógica que decide está en lib/extractos/cargaEmpresa.ts
// (pura y probada); acá solo se lee la base, se llama a eso y se escribe. Mismas reglas de siempre: lo ya cargado
// se reconoce CONTANDO (N − M) y no se toca, y todo lo que decide qué se carga y la carga misma van en UNA
// transacción con los mismos locks por cuenta y por período que subirExtracto.

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

export type OpcionesExtractoEmpresa = {
  // Pestaña elegida en el selector (cuando había varias candidatas o ninguna dentro del período).
  pestana?: string;
  // true solo en el reenvío después de la vista previa.
  confirmarVistaPrevia?: boolean;
};

export type PestanaCandidataVista = { nombre: string; desde: string; hasta: string; filas: number };

export type ResultadoExtractoEmpresa =
  | {
      ok: true;
      filasNuevas: number;
      filasYaCargadas: number;
      // Cuántas de las nuevas quedaron con una clasificación sugerida por el historial (0 si la empresa no usa sugerencias).
      sugeridas: number;
      pestana: string;
      control: ControlPieMoneda[];
      avisos: string[];
    }
  | { ok: false; error: string; control?: ControlPieMoneda[] }
  | { ok: false; requierePestana: true; motivo: "varias_en_periodo" | "ninguna_en_periodo"; candidatas: PestanaCandidataVista[] }
  | {
      ok: false;
      requiereVistaPrevia: true;
      vista: {
        pestana: string;
        desde: string;
        hasta: string;
        filas: number;
        nuevas: number;
        yaCargadas: number;
        // Cuántas de las nuevas llegan con una clasificación sugerida (a confirmar en el panel de sugerencias).
        sugeridas: number;
        porCuenta: { cuenta: string; moneda: string; filas: number; nuevas: number }[];
        control: ControlPieMoneda[];
        avisos: string[];
        // Solo el histórico crudo de BBVA Perú: una línea por archivo leído (cuenta, moneda, titular, fechas).
        detalleArchivos?: string[];
      };
    };

export async function subirExtractoEmpresa(
  empresaId: string,
  periodo: string,
  numeroSemana: number,
  formData: FormData,
  opciones: OpcionesExtractoEmpresa = {}
): Promise<ResultadoExtractoEmpresa> {
  // 1) Permiso, ANTES de mirar el archivo: ADMIN y FINANZAS, o un gerente con la tilde de ESTA empresa.
  await requireCargaRealEmpresa(empresaId);

  // 2) La empresa tiene que estar en la lista de config.
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true } });
  if (!empresa) return { ok: false, error: "No encontré esa empresa." };
  const config = configDeEmpresa(slugDeEmpresa(empresa.nombre));
  if (!config) return { ok: false, error: ERROR_EMPRESA_SIN_EXTRACTO };

  // 3) Período habilitado (nadie escribe en uno no habilitado, ADMIN y FINANZAS incluidos).
  if (!FORMATO_PERIODO.test(periodo)) return { ok: false, error: `"${periodo}" no es un período válido (AAAA-MM).` };
  const noHabilitado = errorPeriodoNoHabilitado(periodo);
  if (noHabilitado) return { ok: false, error: noHabilitado };

  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: "Elegí un archivo antes de subir." };
  // Perú: el «Histórico de Movimientos» crudo del BBVA (.xls, HTML) puede venir en VARIOS archivos (tramos de la misma
  // cuenta). El libro PF (.xlsx) sigue siendo de UN archivo y por su camino de siempre.
  const subidos = formData.getAll("archivo").filter((a): a is File => a instanceof File && a.size > 0);
  const esHistorico = config.lector === "havanna-peru" && /\.xls$/i.test(archivo.name);
  if (esHistorico) {
    if (subidos.some((a) => !/\.xls$/i.test(a.name))) {
      return { ok: false, error: "No se pueden mezclar el libro PF (.xlsx) con el histórico del BBVA (.xls) en la misma subida. Subí uno u otro." };
    }
    for (const a of subidos) {
      const f = verificarTamanoHavannaPeru(a.size);
      if (!f.ok) return { ok: false, error: `${a.name}: ${f.error}` };
    }
  } else if (subidos.length > 1) {
    return { ok: false, error: "Por este camino se sube un solo archivo a la vez." };
  }
  // Bradenton (Chase) acepta además el .csv original que baja el banco; Plate Silver (BROU) solo el .xls tal cual lo baja
  // el banco; el resto de las empresas, solo el .xlsx.
  const esBrou = config.lector === "brou";
  const cuentasSeResuelvenDespues = esBrou || esHistorico;
  const aceptaCsv = config.lector === "chase";
  const esCsv = aceptaCsv && /\.csv$/i.test(archivo.name);
  if (esHistorico) {
    // validado arriba
  } else if (esBrou) {
    if (!/\.xls$/i.test(archivo.name)) return { ok: false, error: "El archivo tiene que ser el .xls que baja el BROU, tal cual se descargó." };
  } else if (!esCsv && !/\.xlsx$/i.test(archivo.name)) {
    return { ok: false, error: aceptaCsv ? "El archivo tiene que ser un .xlsx (libro PF) o el .csv de Chase." : "El archivo tiene que ser un .xlsx." };
  }
  const freno = verificarTamanoHavannaPeru(archivo.size);
  if (!freno.ok) return { ok: false, error: freno.error };

  // 4) Cuentas forzadas (no las elige el archivo ni la persona).
  const cuentasDeLaBase = await prisma.cuentaBancaria.findMany({
    select: { id: true, nombre: true, banco: true, activa: true, empresaId: true, moneda: true },
  });
  // El archivo del BROU es de UNA cuenta: sus cuentas se resuelven DESPUÉS de leerlo (la cuenta sale de su encabezado).
  let cuentas: CuentasPorMoneda = {};
  if (!cuentasSeResuelvenDespues) {
    const resCuentas = resolverCuentasForzadas(config, empresa.id, cuentasDeLaBase);
    if (!resCuentas.ok) return { ok: false, error: resCuentas.error };
    cuentas = resCuentas.cuentas;
  }

  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) return { ok: false, error: `No encontré la semana ${numeroSemana}.` };
  if (ejecucion.estado === "CERRADA") return { ok: false, error: "La semana ya está cerrada, no se pueden subir más movimientos." };

  // 5) Pestaña por contenido y lectura.
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  let hoja!: HojaGrilla; // sin asignar en el histórico de BBVA (no usa hoja)
  let nombrePestana: string;
  let crudo = false;
  let lecturaHistorica: ReturnType<typeof leerHistoricosBbvaPeru> | null = null;
  try {
    if (esHistorico) {
      // Todas las tablas del histórico se leen y combinan acá; no hay pestaña que elegir.
      const crudos = await Promise.all(subidos.map(async (a) => ({ nombre: a.name, bytes: new Uint8Array(await a.arrayBuffer()) })));
      lecturaHistorica = leerHistoricosBbvaPeru(crudos);
      nombrePestana = subidos.length === 1 ? "Histórico de Movimientos" : `Histórico de Movimientos (${subidos.length} archivos)`;
    } else if (esBrou) {
      // Una sola tabla en una sola hoja: no hay pestaña que elegir.
      hoja = hojaDeBytesBrou(bytes);
      nombrePestana = hoja.nombre;
    } else if (esCsv) {
      // El CSV no tiene pestañas: es una sola tabla. Se decide por contenido, no por la extensión.
      if (!esCsvChase(bytes)) {
        return { ok: false, error: "El .csv no parece el extracto de Chase (no encuentro el encabezado Posting Date / Description / Amount / Balance)." };
      }
      hoja = hojaDeCsvChase(bytes);
      nombrePestana = hoja.nombre;
      crudo = true;
    } else {
      const sel = seleccionarPestanaHavannaPeru(
        bytes,
        rangoDelPeriodo(periodo),
        opciones.pestana,
        config.lector === "chase" ? DETECTOR_CHASE : DETECTOR_HAVANNA_PERU
      );
      if (sel.tipo === "candidatas") {
        return {
          ok: false,
          requierePestana: true,
          motivo: sel.motivo,
          candidatas: sel.candidatas.map((c) => ({
            nombre: c.nombre,
            desde: c.desde.toISOString().slice(0, 10),
            hasta: c.hasta.toISOString().slice(0, 10),
            filas: c.filas,
          })),
        };
      }
      hoja = sel.hoja;
      nombrePestana = sel.candidata.nombre;
    }
  } catch (e) {
    if (e instanceof ErrorExtracto) return { ok: false, error: e.message };
    throw e;
  }

  let lectura;
  try {
    // Perú: la moneda de la cuenta solo se usaría si faltara la columna Moneda; abajo eso se rechaza. Chase: todo USD.
    lectura = lecturaHistorica
      ? lecturaHistorica
      : config.lector === "brou"
      ? leerBrou(hoja, { cuentaPorMoneda: config.numeroCuentaPorMoneda ?? {} })
      : config.lector === "chase" ? leerChase(hoja, { crudo }) : leerHavannaPeru(hoja, { monedaCuenta: "PEN" });
  } catch (e) {
    if (e instanceof ErrorExtracto) return { ok: false, error: e.message };
    throw e;
  }
  // REGLA DURA: si el lector marcó algún error (incluye el pie que no cuadra), no se carga nada.
  const errorLectura = errorDeLectura(lectura, config, nombrePestana);
  if (errorLectura) return { ok: false, error: errorLectura, control: lectura.control };

  // BROU: las cuentas de ESTE archivo (la de su moneda) tienen que existir, estar activas y ser de la empresa.
  const monedas = archivoDeUnaCuenta(config) || esHistorico ? [...new Set(lectura.filas.map((f) => f.moneda))] : monedasDeConfig(config);
  if (cuentasSeResuelvenDespues) {
    const lim = verificarCantidadFilasHavannaPeru(lectura.filas.length);
    if (!lim.ok) return { ok: false, error: lim.error };
    const resCuentas = resolverCuentasForzadas(config, empresa.id, cuentasDeLaBase, monedas);
    if (!resCuentas.ok) return { ok: false, error: resCuentas.error };
    cuentas = resCuentas.cuentas;
  }

  const filas = armarFilasACargar(lectura, config, cuentas);
  const fuera = errorFechasFueraDelPeriodo(filas, ejecucion.periodo);
  if (fuera) return { ok: false, error: fuera };

  const nombresCuentas = monedas.map((m) => cuentas[m].nombre);
  const { desde, hasta } = rangoDelPeriodo(periodo);

  // 6) Locks + reconocimiento + carga, en UNA transacción (mismos locks que subirExtracto: por cuenta y por período).
  const resultado = await prisma.$transaction(
    async (tx) => {
      for (const n of [...nombresCuentas].map(normalizarCuenta).sort()) {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${"ejecucion:cuenta:" + n}))`;
      }
      await bloquearPeriodo(tx, ejecucion.periodo);

      const vigente = await tx.ejecucionSemanal.findUnique({ where: { id: ejecucion.id }, select: { estado: true } });
      if (!vigente || vigente.estado === "CERRADA") {
        return { ok: false as const, error: "La semana ya está cerrada, no se pueden subir más movimientos." };
      }

      // Por NOMBRE EXACTO de la cuenta (el mismo que se guarda): el nombre lleva tilde y la comparación
      // normalizada de subirExtracto no la contempla.
      const existentes = await tx.$queryRaw<FilaExistente[]>`
        SELECT mb.fecha, mb.importe::text AS importe, mb."bancoYCuenta", mb.concepto,
               mb."nroReferencia", mb.saldo::text AS saldo, mb.moneda
        FROM "MovimientoBancario" mb
        WHERE mb.fecha >= ${desde.toISOString().slice(0, 10)}::date
          AND mb.fecha < (${hasta.toISOString().slice(0, 10)}::date + 1)
          AND mb."bancoYCuenta" = ANY(${nombresCuentas}::text[])
      `;
      const plan = planificarCarga(filas, existentes, config.etiqueta);
      if (plan.bloqueo) return { ok: false as const, error: plan.bloqueo };

      const porCuenta = monedas.map((m) => ({
        cuenta: cuentas[m].nombre,
        moneda: m,
        filas: filas.filter((f) => f.moneda === m).length,
        nuevas: plan.nuevas.filter((f) => f.moneda === m).length,
      }));
      const avisos = [...lectura.avisos, ...plan.avisos];

      // Sugerencias de clasificación (solo las empresas con `sugerenciasPorHistorial`): del historial de ESTA empresa y de SU lista,
      // sin respaldo global. Se leen acá, dentro de la transacción, antes de armar lo que se muestra y lo que se escribe.
      let nuevas = plan.nuevas;
      let sugeridas = 0;
      if (config.sugerenciasPorHistorial && nuevas.length > 0) {
        const indice = await cargarIndiceDeEmpresa(tx, empresa.id, slugDeEmpresa(empresa.nombre), config.unidad);
        if (indice !== null) {
          const aplicado = aplicarSugerenciasAFilas(nuevas, indice);
          nuevas = aplicado.filas;
          sugeridas = aplicado.sugeridas;
        }
        avisos.push(
          sugeridas > 0
            ? `${sugeridas} de ${nuevas.length} movimientos nuevos tienen una clasificación sugerida por el historial de ${config.etiqueta}: quedan para confirmar en el panel de sugerencias.`
            : `Ninguno de los ${nuevas.length} movimientos nuevos tiene historial suficiente para sugerirle clasificación: entran SIN CLASIFICAR.`
        );
      }

      if (!opciones.confirmarVistaPrevia && plan.nuevas.length > 0) {
        return {
          ok: false as const,
          requiereVistaPrevia: true as const,
          vista: {
            pestana: nombrePestana,
            // Fechas del ARCHIVO (no del período).
            desde: new Date(Math.min(...filas.map((f) => f.fecha.getTime()))).toISOString().slice(0, 10),
            hasta: new Date(Math.max(...filas.map((f) => f.fecha.getTime()))).toISOString().slice(0, 10),
            filas: filas.length,
            nuevas: plan.nuevas.length,
            yaCargadas: plan.cantidadYaCargadas,
            sugeridas,
            porCuenta,
            control: lectura.control,
            avisos,
            ...(lecturaHistorica ? { detalleArchivos: lecturaHistorica.detalleArchivos } : {}),
          },
        };
      }

      if (plan.nuevas.length > 0) {
        await tx.movimientoBancario.createMany({ data: nuevas.map((f) => datosParaCrear(f, ejecucion.id)) });
      }
      return {
        ok: true as const,
        filasNuevas: plan.nuevas.length,
        filasYaCargadas: plan.cantidadYaCargadas,
        sugeridas,
        pestana: nombrePestana,
        control: lectura.control,
        avisos,
      };
    },
    { maxWait: 10_000, timeout: 120_000 }
  );

  if (resultado.ok && resultado.filasNuevas > 0) {
    revalidatePath(`/ejecucion/${periodo}/${numeroSemana}`);
    revalidatePath("/[empresa]/[periodo]/ejecucion/[numeroSemana]", "page");
  }
  return resultado;
}
