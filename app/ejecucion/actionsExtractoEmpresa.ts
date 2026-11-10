"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireCargaRealEmpresa } from "@/lib/cargaRealEmpresa";
import { errorPeriodoNoHabilitado } from "@/lib/periodosHabilitados";
import { slugDeEmpresa } from "@/lib/slug";
import { bloquearPeriodo, obtenerEjecucionPorSemana } from "@/lib/ejecucion";
import { normalizarCuenta } from "@/lib/unidadesNegocio";
import { verificarTamanoHavannaPeru } from "@/lib/extractos/limites";
import { leerHavannaPeru, type ControlPieMoneda } from "@/lib/extractos/havannaPeru";
import { rangoDelPeriodo } from "@/lib/extractos/cargaEmpresa";
import { seleccionarPestanaHavannaPeru } from "@/lib/extractos/havannaPeruPestanas";
import { ErrorExtracto } from "@/lib/extractos/tipos";
import {
  ERROR_EMPRESA_SIN_EXTRACTO,
  armarFilasACargar,
  configDeEmpresa,
  datosParaCrear,
  errorDeLectura,
  errorFechasFueraDelPeriodo,
  planificarCarga,
  resolverCuentasForzadas,
  type FilaExistente,
} from "@/lib/extractos/cargaEmpresa";

// Extracto de UNA empresa por su propio camino (Etapa 2, Havanna Perú): el libro PF de la empresa, no el extracto de
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
        porCuenta: { cuenta: string; moneda: string; filas: number; nuevas: number }[];
        control: ControlPieMoneda[];
        avisos: string[];
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
  if (!/\.xlsx$/i.test(archivo.name)) return { ok: false, error: "El archivo tiene que ser un .xlsx." };
  const freno = verificarTamanoHavannaPeru(archivo.size);
  if (!freno.ok) return { ok: false, error: freno.error };

  // 4) Cuentas forzadas (no las elige el archivo ni la persona).
  const cuentasDeLaBase = await prisma.cuentaBancaria.findMany({
    select: { id: true, nombre: true, banco: true, activa: true, empresaId: true, moneda: true },
  });
  const resCuentas = resolverCuentasForzadas(config, empresa.id, cuentasDeLaBase);
  if (!resCuentas.ok) return { ok: false, error: resCuentas.error };
  const cuentas = resCuentas.cuentas;

  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) return { ok: false, error: `No encontré la semana ${numeroSemana}.` };
  if (ejecucion.estado === "CERRADA") return { ok: false, error: "La semana ya está cerrada, no se pueden subir más movimientos." };

  // 5) Pestaña por contenido y lectura.
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  let hoja;
  let nombrePestana: string;
  try {
    const sel = seleccionarPestanaHavannaPeru(bytes, rangoDelPeriodo(periodo), opciones.pestana);
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
  } catch (e) {
    if (e instanceof ErrorExtracto) return { ok: false, error: e.message };
    throw e;
  }

  let lectura;
  try {
    // La moneda de la cuenta solo se usaría si faltara la columna Moneda; abajo eso se rechaza.
    lectura = leerHavannaPeru(hoja, { monedaCuenta: "PEN" });
  } catch (e) {
    if (e instanceof ErrorExtracto) return { ok: false, error: e.message };
    throw e;
  }
  // REGLA DURA: si el lector marcó algún error (incluye el pie que no cuadra), no se carga nada.
  const errorLectura = errorDeLectura(lectura, config, nombrePestana);
  if (errorLectura) return { ok: false, error: errorLectura, control: lectura.control };

  const filas = armarFilasACargar(lectura, config, cuentas);
  const fuera = errorFechasFueraDelPeriodo(filas, ejecucion.periodo);
  if (fuera) return { ok: false, error: fuera };

  const nombresCuentas = [cuentas.PEN.nombre, cuentas.USD.nombre];
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
      const plan = planificarCarga(filas, existentes);
      if (plan.bloqueo) return { ok: false as const, error: plan.bloqueo };

      const porCuenta = (["PEN", "USD"] as const).map((m) => ({
        cuenta: cuentas[m].nombre,
        moneda: m,
        filas: filas.filter((f) => f.moneda === m).length,
        nuevas: plan.nuevas.filter((f) => f.moneda === m).length,
      }));
      const avisos = [...lectura.avisos, ...plan.avisos];

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
            porCuenta,
            control: lectura.control,
            avisos,
          },
        };
      }

      if (plan.nuevas.length > 0) {
        await tx.movimientoBancario.createMany({ data: plan.nuevas.map((f) => datosParaCrear(f, ejecucion.id)) });
      }
      return {
        ok: true as const,
        filasNuevas: plan.nuevas.length,
        filasYaCargadas: plan.cantidadYaCargadas,
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
