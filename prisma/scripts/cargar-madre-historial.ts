// Carga del archivo madre histórico (ej. "EJECUCION FINANCIERA 31.07.xlsx", 16.521 movimientos entre
// 30/6 y 31/7/2026) directo a la base, SIN pasar por la web: la subida por pantalla agotó los 512 MB
// de memoria de la instancia de testing en Render. Hace lo mismo que subirExtracto
// (app/ejecucion/actions.ts) para un archivo madre: lee, clasifica, asigna unidad, reconoce lo ya
// cargado CONTANDO y deja cada movimiento en la semana ABIERTA de su mes (la crea si el mes no
// tiene ninguna). NO cierra ninguna semana.
//
// Uso (DRY-RUN por defecto, no escribe nada):
//   npx tsx prisma/scripts/cargar-madre-historial.ts --host-esperado <host> --archivo <ruta.xlsx>
// Para escribir:
//   npx tsx prisma/scripts/cargar-madre-historial.ts --host-esperado <host> --archivo <ruta.xlsx> --aplicar
// Opcionales: --hoja <nombre> (archivo con varias hojas), --sin-base (solo dry-run: lee y
// clasifica el archivo sin consultar la base; no reconoce duplicados ni aplica los cruces con las
// planillas de referencia — sirve para verificar la lectura con una DATABASE_URL falsa).
//
// - --host-esperado es OBLIGATORIO: se compara contra el host de DATABASE_URL ANTES de abrir
//   ninguna conexión; si no coincide, aborta. Nunca se imprime la URL ni la contraseña.
// - --aplicar corre TODO dentro de UNA transacción (con los mismos locks por período que la
//   subida): si algo falla, rollback completo y no queda nada a medias.
// - Inserta con createMany en lotes (no fila por fila).
// - Idempotente: una segunda corrida reconoce todo como ya cargado y no inserta nada.
//
// Las funciones marcadas "copiado de actions.ts" son copias SIN cambios de lógica (solo el cliente
// de base pasa por parámetro): mantener sincronizadas con app/ejecucion/actions.ts.

import { readFileSync } from "node:fs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { quitarDiacriticos } from "@/lib/slug";
import { normalizarCuenta } from "@/lib/unidadesNegocio";
import {
  centavosDeNumero,
  centavosDeDecimalTexto,
  monedaParaClave,
  decimalTextoDeCentavos,
  claveMovimiento,
  contarPorClave,
  separarNuevas,
} from "@/lib/conteoMovimientos";
import type { FilaMadre } from "@/lib/extractos/madre";

type Db = PrismaClient | Prisma.TransactionClient;

const LOTE = 1000;
// Lo que se espera del archivo de Kike (solo para comparar en el reporte).
const ESPERADO_POR_PERIODO: Record<string, number> = { "2026-06": 54, "2026-07": 16467 };
const ESPERADO_TOTAL = 16521;

function leerArgumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre);
  if (i === -1) return null;
  return process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : "";
}

// DATABASE_URL del entorno; si no está, la de .env (mismo archivo que usa Prisma por defecto).
function leerDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const m = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m.exec(readFileSync(".env", "utf8"));
    return m ? m[1].replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

function hostDe(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null; // sin incluir la URL en ningún mensaje
  }
}

function abortar(mensaje: string): never {
  console.error(`ABORTO: ${mensaje}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Copiado de actions.ts, mantener sincronizado: claveDuplicado
// ---------------------------------------------------------------------------------------------
function claveDuplicado(fecha: Date, importe: number) {
  return `${fecha.toISOString().slice(0, 10)}|${importe.toFixed(2)}`;
}

// Copiado de actions.ts, mantener sincronizado: FilaClaveDb / claveDeFilaDb
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

// Copiado de actions.ts, mantener sincronizado: claveFechaImporteCuenta
function claveFechaImporteCuenta(fecha: Date, importeCentavos: number, bancoYCuenta: string, moneda?: string | null) {
  return JSON.stringify([
    fecha.toISOString().slice(0, 10),
    importeCentavos,
    normalizarCuenta(bancoYCuenta),
    ...monedaParaClave(moneda),
  ]);
}

// Copiado de actions.ts, mantener sincronizado: aplicarCruceLiquidacionFinal (única diferencia:
// el cliente `db` entra por parámetro en vez del `prisma` global).
async function aplicarCruceLiquidacionFinal(
  db: Db,
  filas: {
    numeroFila: number;
    fecha: Date;
    importe: number;
    clasificacion: string;
    sugeridaPorSistema: boolean;
  }[]
): Promise<number> {
  if (filas.length === 0) return 0;

  const fechas = filas.map((f) => f.fecha.getTime());
  const referencias = await db.pagoReferencia.findMany({
    where: { fecha: { gte: new Date(Math.min(...fechas)), lte: new Date(Math.max(...fechas)) } },
  });
  if (referencias.length === 0) return 0;

  const porClave = new Map<string, typeof referencias>();
  for (const r of referencias) {
    const clave = claveDuplicado(r.fecha, Math.abs(Number(r.importe)));
    const grupo = porClave.get(clave);
    if (grupo) grupo.push(r);
    else porClave.set(clave, [r]);
  }

  let ambiguas = 0;

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

    if (candidatos.some((c) => c.esLiquidacionFinal)) ambiguas++;
  }

  return ambiguas;
}

// Copiado de actions.ts, mantener sincronizado: aplicarCruceChequeIva (única diferencia: el
// cliente `db` entra por parámetro).
async function aplicarCruceChequeIva(
  db: Db,
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

  const numeros = [...new Set(elegibles.map((e) => e.numeroCheque))];
  const referencias = await db.chequeIvaReferencia.findMany({
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
    const mismoMes =
      fila.fecha.getUTCFullYear() === referencia.fecha.getUTCFullYear() &&
      fila.fecha.getUTCMonth() === referencia.fecha.getUTCMonth();
    fila.clasificacion = mismoMes ? "IVA" : "CH DIFERIDOS IVA";
    fila.sugeridaPorSistema = true;
    fila.chequeIvaAmbiguo = referencia.duplicadoAmbiguo;
  }
}

type FilaConClave = {
  fila: FilaMadre;
  importeCentavos: number;
  saldoCentavos: number | null;
  clave: string;
};

// Copiado de actions.ts, mantener sincronizado: armado de filasConClave (camino madre: importe y
// saldo con centavosDeNumero).
function conClave(filas: FilaMadre[]): FilaConClave[] {
  return filas.map((f) => {
    const importeCentavos = centavosDeNumero(f.importe);
    const saldoCentavos = f.saldo === null ? null : centavosDeNumero(f.saldo);
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
}

// Copiado de actions.ts, mantener sincronizado: query de lo ya cargado + separarNuevas +
// casi-duplicados (rango de fechas del archivo, por cuenta normalizada, en todos los períodos).
async function reconocerNuevas(db: Db, filasConClave: FilaConClave[]) {
  const fechasDelArchivo = filasConClave.map((f) => f.fila.fecha.getTime());
  const desde = new Date(Math.min(...fechasDelArchivo));
  const hasta = new Date(Math.max(...fechasDelArchivo));
  const cuentasDelArchivo = Array.from(new Set(filasConClave.map((f) => normalizarCuenta(f.fila.bancoYCuenta))));

  const existentes = await db.$queryRaw<FilaClaveDb[]>`
    SELECT mb.fecha, mb.importe::text AS importe, mb."bancoYCuenta", mb.concepto,
           mb."nroReferencia", mb.saldo::text AS saldo, mb.moneda
    FROM "MovimientoBancario" mb
    WHERE mb.fecha >= ${desde.toISOString().slice(0, 10)}::date
      AND mb.fecha < (${hasta.toISOString().slice(0, 10)}::date + 1)
      AND regexp_replace(upper(trim(mb."bancoYCuenta")), '[[:space:]]+', ' ', 'g') = ANY(${cuentasDelArchivo}::text[])
  `;
  const yaCargadas = contarPorClave(existentes.map(claveDeFilaDb));
  const { nuevas, cantidadYaCargadas } = separarNuevas(filasConClave, (f) => f.clave, yaCargadas);

  const fechaImporteCuenta = new Set(
    existentes.map((m) => claveFechaImporteCuenta(m.fecha, centavosDeDecimalTexto(m.importe), m.bancoYCuenta, m.moneda))
  );
  const casiDuplicados = nuevas.filter((n) =>
    fechaImporteCuenta.has(claveFechaImporteCuenta(n.fila.fecha, n.importeCentavos, n.fila.bancoYCuenta))
  ).length;

  return { nuevas, cantidadYaCargadas, casiDuplicados };
}

// Copiado de actions.ts, mantener sincronizado: data de cada fila del createMany.
function datosDeMovimiento({ fila, importeCentavos, saldoCentavos }: FilaConClave, ejecucionId: string) {
  return {
    ejecucionId,
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
  };
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const sinBase = process.argv.includes("--sin-base");
  const hostEsperado = leerArgumento("--host-esperado")?.trim().toLowerCase();
  const archivo = leerArgumento("--archivo");
  const hojaElegida = leerArgumento("--hoja") || undefined;
  if (!hostEsperado) abortar("falta --host-esperado <host>. No toqué la base.");
  if (!archivo) abortar("falta --archivo <ruta.xlsx>. No toqué la base.");
  if (sinBase && aplicar) abortar("--sin-base no se puede combinar con --aplicar. No toqué la base.");

  // 1) Guardia de host, antes de cualquier acceso a la base.
  const url = leerDatabaseUrl();
  if (!url) abortar("no encontré DATABASE_URL (ni en el entorno ni en .env). No toqué la base.");
  const host = hostDe(url);
  if (!host) abortar("DATABASE_URL no es una URL válida. No toqué la base.");
  if (host !== hostEsperado) {
    abortar(`el host de DATABASE_URL no coincide con el esperado (${hostEsperado}). No toqué la base.`);
  }
  process.env.DATABASE_URL = url;
  console.log(`Host verificado: coincide con ${hostEsperado}.`);
  console.log(
    aplicar
      ? "MODO: APLICAR (escribe en la base)\n"
      : sinBase
        ? "MODO: DRY-RUN SIN BASE (solo lee el archivo; no consulta la base)\n"
        : "MODO: DRY-RUN (no escribe nada; usar --aplicar para cargar)\n"
  );

  // Imports que cargan lib/prisma (cliente con DATABASE_URL): recién después de la guardia.
  const { leerArchivoSubido } = await import("@/lib/extractos/archivo");
  const { periodoDeFecha, ordenarPeriodos, resolverDestinos, repartoPorPeriodo, mensajeMesesCerrados } =
    await import("@/lib/ejecucionSemanas");
  const { bloquearPeriodo, obtenerOCrearAbiertaEnTx } = await import("@/lib/ejecucion");

  // 2) Lectura: mismo lector que la subida. Solo se acepta un archivo madre.
  const leido = await leerArchivoSubido(new Uint8Array(readFileSync(archivo)), hojaElegida);
  if (leido.tipo === "error") abortar(leido.error);
  if (leido.tipo === "seleccionHoja") abortar(`el archivo tiene varias hojas (${leido.hojas.join(", ")}): pasar --hoja <nombre>.`);
  if (leido.tipo !== "madre") abortar("el archivo no es un archivo madre (se detectó un extracto crudo de un banco).");
  const filas = leido.filas;
  if (filas.length === 0) abortar("no encontré ninguna fila con datos para importar.");
  const periodos = ordenarPeriodos(filas.map((f) => periodoDeFecha(f.fecha)));
  console.log(`Archivo leído (hoja "${leido.hoja}"): ${filas.length} filas.`);

  const prisma = new PrismaClient();

  // Misma decisión que subirExtracto, sobre `db` (cliente normal en dry-run, tx en --aplicar).
  async function calcular(db: Db) {
    const filasConClave = conClave(filas);
    if (sinBase) {
      return { nuevas: filasConClave, cantidadYaCargadas: 0, casiDuplicados: 0, ambiguas: 0, destinos: [] as ReturnType<typeof resolverDestinos> };
    }
    const { nuevas, cantidadYaCargadas, casiDuplicados } = await reconocerNuevas(db, filasConClave);

    const semanas = await db.ejecucionSemanal.findMany({
      where: { periodo: { in: periodos } },
      select: { periodo: true, estado: true },
    });
    const semanasPorPeriodo = new Map<string, ("ABIERTA" | "CERRADA")[]>();
    for (const s of semanas) {
      semanasPorPeriodo.set(s.periodo, [...(semanasPorPeriodo.get(s.periodo) ?? []), s.estado]);
    }
    const reparto = repartoPorPeriodo(nuevas.map((n) => n.fila.fecha));
    // "" como período actual: acá no hay semana "de la URL", todos los meses van a la abierta del suyo.
    const destinos = resolverDestinos("", reparto.map((r) => r.periodo), semanasPorPeriodo);
    const bloqueados = destinos
      .filter((d) => d.tipo === "bloqueado")
      .map((d) => ({ periodo: d.periodo, filas: reparto.find((r) => r.periodo === d.periodo)?.filas ?? 0 }));
    if (bloqueados.length > 0) throw new Error(mensajeMesesCerrados(bloqueados));

    // Ambas mutan fila.clasificacion in-place, solo sobre las nuevas (igual que subirExtracto).
    const filasNuevas = nuevas.map((n) => n.fila);
    const ambiguas = filasNuevas.length > 0 ? await aplicarCruceLiquidacionFinal(db, filasNuevas) : 0;
    if (filasNuevas.length > 0) await aplicarCruceChequeIva(db, filasNuevas);

    return { nuevas, cantidadYaCargadas, casiDuplicados, ambiguas, destinos };
  }

  function imprimir(c: Awaited<ReturnType<typeof calcular>>) {
    console.log("=== Reporte ===");
    console.log(`Total de filas del archivo: ${filas.length} (esperado ${ESPERADO_TOTAL})${filas.length === ESPERADO_TOTAL ? " OK" : " ≠ DIFERENTE"}`);
    const reparto = repartoPorPeriodo(filas.map((f) => f.fecha));
    for (const r of reparto) {
      const esp = ESPERADO_POR_PERIODO[r.periodo];
      console.log(`  ${r.periodo}: ${r.filas}${esp === undefined ? " (período no esperado)" : ` (esperado ${esp})${esp === r.filas ? " OK" : " ≠ DIFERENTE"}`}`);
    }
    const aInsertar = c.nuevas.map((n) => n.fila);
    if (sinBase) {
      console.log("Ya existen (duplicadas): no calculado (--sin-base)");
    } else {
      console.log(`Ya existen (duplicadas): ${c.cantidadYaCargadas}`);
      console.log(`Nuevas a insertar: ${aInsertar.length}`);
      console.log(`Casi-duplicados entre las nuevas (aviso, se cargan igual): ${c.casiDuplicados}`);
      console.log(`Liquidaciones ambiguas (cruce con PagoReferencia): ${c.ambiguas}`);
      for (const r of repartoPorPeriodo(aInsertar.map((f) => f.fecha))) console.log(`  nuevas ${r.periodo}: ${r.filas}`);
      for (const d of c.destinos) {
        console.log(`  ${d.periodo}: ${d.tipo === "crear" ? "se CREARÍA la semana 1 (abierta)" : "va a su semana abierta existente"}`);
      }
    }
    const sobre = sinBase ? filas : aInsertar;
    const sinClasificar = sobre.filter((f) => f.clasificacion === "SIN CLASIFICAR").length;
    const conUnidad = sobre.filter((f) => f.unidadNegocio !== "SIN ASIGNAR").length;
    const unidadSugerida = sobre.filter((f) => f.unidadSugeridaPorSistema).length;
    console.log(`Sobre ${sinBase ? "todas las filas" : "las nuevas"}:`);
    console.log(`  sin clasificar: ${sinClasificar}`);
    console.log(`  con unidad asignada: ${conUnidad} (de ellas, sugeridas por el sistema: ${unidadSugerida}); SIN ASIGNAR: ${sobre.length - conUnidad}`);
  }

  try {
    if (!aplicar) {
      imprimir(await calcular(prisma));
      console.log("\nDry-run: no se escribió nada.");
      return;
    }

    // Una sola transacción: locks por período (mismo orden y mismo mecanismo que subirExtracto),
    // se recalcula todo con los locks tomados, se crean las semanas que falten (abiertas, nunca se
    // cierra ninguna) y se inserta por lotes. Cualquier excepción ⇒ rollback completo.
    await prisma.$transaction(
      async (tx) => {
        for (const p of periodos) await bloquearPeriodo(tx, p);
        const c = await calcular(tx);
        imprimir(c);

        const semanaDeCadaPeriodo = new Map<string, { id: string; numeroSemana: number }>();
        for (const d of c.destinos) semanaDeCadaPeriodo.set(d.periodo, await obtenerOCrearAbiertaEnTx(tx, d.periodo));

        let insertadas = 0;
        for (const [p, semana] of semanaDeCadaPeriodo) {
          const delMes = c.nuevas.filter((n) => periodoDeFecha(n.fila.fecha) === p);
          const antes = await tx.movimientoBancario.count({ where: { ejecucionId: semana.id } });
          for (let i = 0; i < delMes.length; i += LOTE) {
            await tx.movimientoBancario.createMany({
              data: delMes.slice(i, i + LOTE).map((n) => datosDeMovimiento(n, semana.id)),
            });
          }
          const despues = await tx.movimientoBancario.count({ where: { ejecucionId: semana.id } });
          if (despues - antes !== delMes.length) {
            throw new Error(`${p}: se esperaban ${delMes.length} filas nuevas y la semana ${semana.numeroSemana} sumó ${despues - antes}. Rollback.`);
          }
          insertadas += delMes.length;
          console.log(`${p}: semana ${semana.numeroSemana} +${delMes.length} (total en la semana: ${despues})`);
        }
        console.log(`\nInsertadas en total: ${insertadas}. Transacción lista para confirmar.`);
      },
      { maxWait: 10_000, timeout: 900_000 }
    );
    console.log("COMMIT hecho.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : "desconocido");
  process.exit(1);
});
