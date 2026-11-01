import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decimalTextoDeCentavos } from "@/lib/conteoMovimientos";
import type { Plantilla } from "@/lib/reporte/motor";
import { puedeEditarPresupuestoAhora } from "@/lib/estadoPresupuesto";
import { mensajePeriodoSoloLectura, puedeEditarPeriodoComoGerente } from "@/lib/periodosHabilitados";
import {
  DETALLE_CARGA_DESDE_REPORTE,
  cambioMientrasEditaba,
  celdaDeEntrada,
  manualDeEntrada,
  nombreDeEntrada,
  planDeCarga,
  validarAclaracion,
  validarImporteCarga,
  type EntradaCarga,
  type LineaParaCarga,
  type ValorManualParaCarga,
} from "@/lib/reporte/cargaGerente";

// Escritura de la carga del Presupuestado en el Reporte (Etapas 2 y 3). SIN autorización ni
// next/*: la hace guardarPresupuestoDelReporte (A/reporte/actionsCarga.ts) antes de llamar acá.
// Está separado para poder probar la concurrencia contra una base de prueba (prisma/scripts/
// probar-carga-reporte.ts) sin una sesión.

const MAX_ENTRADAS = 200;

export type ResultadoCarga =
  | { ok: true; creadas: number; actualizadas: number; borradas: number }
  | { ok: false; error: string };

// Las líneas del mes con lo que necesita el plan. Solo lee: sin PresupuestoMensual no hay líneas.
export async function leerLineasParaCarga(empresaId: string, periodo: string): Promise<LineaParaCarga[]> {
  const presupuesto = await prisma.presupuestoMensual.findUnique({
    where: { empresaId_periodo: { empresaId, periodo } },
    select: { id: true },
  });
  return presupuesto ? leerLineas(prisma, presupuesto.id) : [];
}

async function leerLineas(db: Prisma.TransactionClient | typeof prisma, presupuestoId: string): Promise<LineaParaCarga[]> {
  const lineas = await db.lineaPresupuesto.findMany({
    where: { presupuestoId },
    orderBy: { createdAt: "asc" },
    select: { id: true, clasificacion: true, detalle: true, importe: true, _count: { select: { desglose: true } } },
  });
  return lineas.map((l) => ({
    id: l.id,
    clasificacion: l.clasificacion,
    detalle: l.detalle,
    importeCentavos: Math.round(Number(l.importe.toFixed(2)) * 100),
    tieneDesglose: l._count.desglose > 0,
  }));
}

// Los ValorManualReporte PRESUPUESTADO del mes (filas manuales), con quién
// los cargó. Se leen para TODA la empresa y mes: el plan se queda solo con las claves editables.
// Es independiente del PresupuestoMensual (el valor puede existir sin que el presupuesto exista).
export async function leerValoresManualesParaCarga(
  empresaId: string,
  periodo: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<ValorManualParaCarga[]> {
  const valores = await db.valorManualReporte.findMany({
    where: { empresaId, periodo, columna: "PRESUPUESTADO" },
    select: { filaClave: true, importe: true, nota: true, updatedAt: true, cargadoPor: { select: { nombre: true } } },
  });
  return valores.map((v) => ({
    filaClave: v.filaClave,
    centavos: Math.round(Number(v.importe.toFixed(2)) * 100),
    nota: v.nota,
    cargadoPor: v.cargadoPor.nombre,
    actualizadoEn: v.updatedAt,
  }));
}

function esClaveUnicaDuplicada(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// Guarda el valor final de cada celda que cambió. Una LineaPresupuesto por clasificación:
//   - sin línea y valor → la crea (concepto = texto de la fila, detalle "Carga desde el Reporte");
//   - con línea y valor → actualiza su importe (respeta concepto y detalle);
//   - vacío o 0 → borra la línea.
// Las filas manuales (destino "manual") van a
// ValorManualReporte, columna PRESUPUESTADO: upsert con el valor, o se borra si queda vacío o 0.
// Esas entradas traen la `base` (lo que la pantalla mostraba): si el valor guardado cambió desde
// entonces —lo cargó otra persona— se rechaza TODO el guardado en vez de pisarlo.
// Todo se valida ANTES de escribir y se escribe en una transacción: o entra todo o nada.
//
// Sin duplicados por doble clic ni por dos personas a la vez: la transacción toma un bloqueo de
// fila sobre el PresupuestoMensual (FOR UPDATE), así que dos guardados del mismo presupuesto se
// serializan; el segundo lee recién cuando el primero terminó, encuentra la línea y la
// actualiza en vez de crear otra. (LineaPresupuesto no tiene índice único por clasificación y
// no se agrega uno: sería una migración.)
export async function aplicarCargaPresupuesto(p: {
  empresaId: string;
  periodo: string;
  plantilla: Plantilla;
  entradas: EntradaCarga[];
  esAdminOFinanzas: boolean;
  esRevisor: boolean;
  // Quien guarda: queda como `cargadoPorId` de los valores manuales.
  usuarioId: string;
  // Período que el gerente puede editar. Por defecto, el de lib/config.ts; solo lo cambia el script
  // de prueba (que trabaja en un período de mentira).
  periodoEnCarga?: string;
}): Promise<ResultadoCarga> {
  const { entradas } = p;
  // Antes de leer o crear nada: el gerente solo escribe en el mes en curso de carga. Acá además de
  // actionsCarga porque esta es la única función que escribe (y la que prueba el script de carga).
  if (!puedeEditarPeriodoComoGerente(p.periodo, p.esAdminOFinanzas, p.periodoEnCarga)) {
    return { ok: false, error: mensajePeriodoSoloLectura() };
  }
  if (!Array.isArray(entradas) || entradas.length === 0) return { ok: true, creadas: 0, actualizadas: 0, borradas: 0 };
  if (entradas.length > MAX_ENTRADAS) return { ok: false, error: "Demasiados cambios en un solo guardado." };

  // 1) Lo tipeado, validado: no depende de la base.
  const vistos = new Set<string>();
  const importes: (number | null)[] = [];
  const notas: (string | null)[] = [];
  for (const e of entradas) {
    if (!e || typeof e !== "object" || typeof e.clave !== "string") return { ok: false, error: "Entrada inválida." };
    if (e.destino !== "fila" && e.destino !== "sinFila" && e.destino !== "manual") {
      return { ok: false, error: "Entrada inválida." };
    }
    // Sin `base` no se puede saber si el valor cambió mientras se editaba.
    if (e.destino === "manual" && typeof e.base !== "string") {
      return { ok: false, error: "Entrada inválida." };
    }
    const k = `${e.destino}|${e.clave}`;
    if (vistos.has(k)) return { ok: false, error: `Campo repetido: ${nombreDeEntrada(p.plantilla, e)}.` };
    vistos.add(k);
    const importe = validarImporteCarga(e.importe, p.esAdminOFinanzas);
    if (!importe.ok) return { ok: false, error: `${nombreDeEntrada(p.plantilla, e)}: ${importe.error}` };
    importes.push(importe.centavos);
    notas.push(importe.nota);
  }

  // 2) El presupuesto del mes se crea en el PRIMER guardado con algo que escribir, no al abrir
  //    la pantalla ni al guardar todo vacío.
  let presupuesto = await prisma.presupuestoMensual.findUnique({
    where: { empresaId_periodo: { empresaId: p.empresaId, periodo: p.periodo } },
    select: { id: true },
  });
  if (!presupuesto) {
    // Sin presupuesto no hay líneas que borrar: todo vacío en categorías es no hacer nada. Los
    // valores manuales sí pueden existir sin presupuesto, así que con ellos se sigue.
    const hayManuales = entradas.some((e) => e.destino === "manual");
    if (!hayManuales && importes.every((c) => c === null)) return { ok: true, creadas: 0, actualizadas: 0, borradas: 0 };
    try {
      presupuesto = await prisma.presupuestoMensual.create({
        data: { empresaId: p.empresaId, periodo: p.periodo },
        select: { id: true },
      });
    } catch (error) {
      // Otro guardado lo creó en el mismo instante (clave única empresa+período).
      if (!esClaveUnicaDuplicada(error)) throw error;
      presupuesto = await prisma.presupuestoMensual.findUnique({
        where: { empresaId_periodo: { empresaId: p.empresaId, periodo: p.periodo } },
        select: { id: true },
      });
      if (!presupuesto) throw error;
    }
  }
  const presupuestoId = presupuesto.id;

  return prisma.$transaction(
    async (tx): Promise<ResultadoCarga> => {
      // Bloqueo: desde acá, otro guardado de este presupuesto espera a que este termine.
      await tx.$queryRaw`SELECT id FROM "PresupuestoMensual" WHERE id = ${presupuestoId} FOR UPDATE`;

      // 3) El estado se lee DENTRO del bloqueo: si en el medio se envió a revisión o se
      //    validó, no se escribe nada.
      const actual = await tx.presupuestoMensual.findUniqueOrThrow({
        where: { id: presupuestoId },
        select: { estado: true },
      });
      if (actual.estado === "VALIDADO") {
        return { ok: false, error: "Este presupuesto ya está validado, no se puede editar." };
      }
      if (!puedeEditarPresupuestoAhora(actual.estado, p.esRevisor)) {
        return {
          ok: false,
          error: "Este presupuesto está en revisión — mientras dure, solo quien lo revisa puede modificarlo.",
        };
      }

      // 4) El plan se recalcula con lo que hay AHORA en la base.
      const plan = planDeCarga(
        p.plantilla,
        await leerLineas(tx, presupuestoId),
        await leerValoresManualesParaCarga(p.empresaId, p.periodo, tx)
      );
      type Operacion =
        | { tipo: "crear"; concepto: string; detalle: string; centavos: number; clasificacion: string }
        | { tipo: "actualizar"; id: string; centavos: number; detalle?: string }
        | { tipo: "borrar"; id: string }
        | { tipo: "manualGuardar"; clave: string; centavos: number; nota: string | null; existia: boolean }
        | { tipo: "manualBorrar"; clave: string };
      const operaciones: Operacion[] = [];
      for (let i = 0; i < entradas.length; i++) {
        const e = entradas[i];
        if (e.destino === "manual") {
          const m = manualDeEntrada(plan, e);
          if (!m) return { ok: false, error: `${nombreDeEntrada(p.plantilla, e)}: no es un campo que se pueda cargar.` };
          const nuevo = importes[i];
          // Ya está guardado justo así (típico de un doble clic o un reintento): no hay nada que
          // hacer ni conflicto que avisar, aunque la pantalla se haya cargado antes.
          if (nuevo !== null && nuevo === m.valorCentavos && notas[i] === m.nota) continue;
          if (cambioMientrasEditaba(e.base, m.valorCentavos)) {
            return {
              ok: false,
              error: `${nombreDeEntrada(p.plantilla, e)}: cambió mientras lo editabas (${m.leyenda ?? "ahora está vacío"}). Recargá la pantalla y volvé a cargarlo.`,
            };
          }
          if (nuevo === null) {
            if (m.valorCentavos !== null) operaciones.push({ tipo: "manualBorrar", clave: e.clave });
          } else if (nuevo !== m.valorCentavos || notas[i] !== m.nota) {
            operaciones.push({
              tipo: "manualGuardar",
              clave: e.clave,
              centavos: nuevo,
              nota: notas[i],
              existia: m.valorCentavos !== null,
            });
          }
          continue;
        }
        const celda = celdaDeEntrada(plan, e);
        if (!celda) return { ok: false, error: `${nombreDeEntrada(p.plantilla, e)}: no es un campo que se pueda cargar.` };
        if (celda.modo === "soloLectura") {
          return {
            ok: false,
            error: `${nombreDeEntrada(p.plantilla, e)}: ya no se puede editar desde acá (${celda.motivo}). Recargá la pantalla.`,
          };
        }
        const centavos = importes[i];
        if (centavos === null) {
          if (celda.lineaId) operaciones.push({ tipo: "borrar", id: celda.lineaId });
          continue;
        }
        let detalle = DETALLE_CARGA_DESDE_REPORTE;
        if (celda.requiereAclaracion) {
          const aclaracion = validarAclaracion(e.aclaracion);
          if (!aclaracion.ok) return { ok: false, error: `${nombreDeEntrada(p.plantilla, e)}: ${aclaracion.error}` };
          detalle = aclaracion.detalle;
        }
        if (!celda.lineaId) {
          operaciones.push({ tipo: "crear", concepto: celda.texto, detalle, centavos, clasificacion: celda.categoria });
        } else if (centavos !== celda.valorCentavos || (celda.requiereAclaracion && detalle !== celda.aclaracionInicial)) {
          operaciones.push({
            tipo: "actualizar",
            id: celda.lineaId,
            centavos,
            ...(celda.requiereAclaracion ? { detalle } : {}),
          });
        }
      }

      // 5) Recién ahora se escribe.
      let creadas = 0;
      let actualizadas = 0;
      let borradas = 0;
      for (const op of operaciones) {
        if (op.tipo === "crear") {
          await tx.lineaPresupuesto.create({
            data: {
              presupuestoId,
              concepto: op.concepto,
              detalle: op.detalle,
              importe: decimalTextoDeCentavos(op.centavos),
              clasificacion: op.clasificacion,
            },
          });
          creadas++;
        } else if (op.tipo === "actualizar") {
          await tx.lineaPresupuesto.update({
            where: { id: op.id },
            data: {
              importe: decimalTextoDeCentavos(op.centavos),
              ...(op.detalle !== undefined ? { detalle: op.detalle } : {}),
            },
          });
          actualizadas++;
        } else if (op.tipo === "borrar") {
          await tx.lineaPresupuesto.delete({ where: { id: op.id } });
          borradas++;
        } else if (op.tipo === "manualBorrar") {
          await tx.valorManualReporte.deleteMany({
            where: { empresaId: p.empresaId, periodo: p.periodo, filaClave: op.clave, columna: "PRESUPUESTADO" },
          });
          borradas++;
        } else {
          const importe = decimalTextoDeCentavos(op.centavos);
          await tx.valorManualReporte.upsert({
            where: {
              empresaId_periodo_filaClave_columna: {
                empresaId: p.empresaId,
                periodo: p.periodo,
                filaClave: op.clave,
                columna: "PRESUPUESTADO",
              },
            },
            create: {
              empresaId: p.empresaId,
              periodo: p.periodo,
              filaClave: op.clave,
              columna: "PRESUPUESTADO",
              importe,
              nota: op.nota,
              cargadoPorId: p.usuarioId,
            },
            update: { importe, nota: op.nota, cargadoPorId: p.usuarioId },
          });
          if (op.existia) actualizadas++;
          else creadas++;
        }
      }
      // Lo que hace el revisor en EN_REVISION se avisa al gerente y obliga a volver a marcar
      // "Terminé de revisar" (igual que marcarComoModificadoSiEnRevision en Presupuesto).
      if (operaciones.length > 0 && actual.estado === "EN_REVISION") {
        await tx.presupuestoMensual.update({
          where: { id: presupuestoId },
          data: { fueModificadoPorRevisor: true, revisionCompletada: false },
        });
      }
      return { ok: true, creadas, actualizadas, borradas };
    },
    { maxWait: 10_000, timeout: 20_000 }
  );
}
