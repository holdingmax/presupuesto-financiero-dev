"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUsuarioAlDia, esAdminOFinanzas } from "@/lib/auth";
import { errorPeriodoNoHabilitado } from "@/lib/periodosHabilitados";
import { requireCargaRealEmpresa } from "@/lib/cargaRealEmpresa";
import { resolverEmpresaPorSlug } from "@/lib/slug";
import { decimalTextoDeCentavos, centavosDeDecimalTexto } from "@/lib/conteoMovimientos";
import { camposManuales } from "@/lib/reporte/motor";
import { camposRealDelGerente } from "@/lib/reporte/camposRealGerente";
import { plantillaDeEmpresaConExtras } from "@/lib/reporte/plantillaConExtras";
import { motivoBloqueo, motivoRechazoCambio, periodoActual } from "@/lib/reporte/bloqueo";
import { leerCuenta } from "@/lib/importes";
import { semanasDelPeriodo } from "@/lib/reporte/valoresManuales";

export type EntradaCarga = { filaClave: string; columna: "PRESUPUESTADO" | "REAL"; texto: string };
export type ResultadoCarga = { ok: true; guardados: number; borrados: number } | { ok: false; error: string };

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

// Guarda los valores manuales del Reporte de UNA empresa y mes (plan 2b §7.4). ADMIN/FINANZAS con acceso a la
// empresa (todos los campos) o un GERENTE con permiso de cargar el Real de ESA empresa (solo Real). Valida cada fila contra la plantilla, aplica la
// regla de bloqueo (lo cerrado no se modifica para atrás; la primera carga sí) sobre lo que CAMBIA, y hace todo en
// una transacción: texto vacío borra el valor; una cuenta ("a+b-c") se guarda resuelta y la
// cuenta va a `nota`.
export async function guardarValoresManuales(
  empresaSlug: string,
  periodo: string,
  entradas: EntradaCarga[]
): Promise<ResultadoCarga> {
  await requireUsuarioAlDia();
  if (!FORMATO_PERIODO.test(periodo)) return { ok: false, error: "Período inválido." };
  // Fuera de PERIODOS_HABILITADOS no se escribe nada, para ningún rol (lib/periodosHabilitados.ts).
  const noHabilitado = errorPeriodoNoHabilitado(periodo);
  if (noHabilitado) return { ok: false, error: noHabilitado };
  const empresa = await resolverEmpresaPorSlug(empresaSlug);
  if (!empresa) return { ok: false, error: "No encontré esa empresa." };
  // ADMIN y FINANZAS, o un GERENTE con puedeOperarEjecucion en ESTA empresa (lib/permisosReal.ts).
  const usuario = await requireCargaRealEmpresa(empresa.id);
  const plantilla = await plantillaDeEmpresaConExtras(empresa.id, empresaSlug, periodo);
  if (!plantilla) return { ok: false, error: "Esta empresa no tiene reporte por plantilla." };

  // ADMIN y FINANZAS: todos los campos manuales. Gerente con permiso: solo el Real de los bloques que ve su empresa.
  const camposPermitidos = esAdminOFinanzas(usuario)
    ? camposManuales(plantilla)
    : camposRealDelGerente(plantilla, empresaSlug);
  const campos = new Map(camposPermitidos.map((c) => [`${c.clave}|${c.columna}`, c]));
  const vistos = new Set<string>();
  const cambios: { filaClave: string; columna: "PRESUPUESTADO" | "REAL"; centavos: number | null; nota: string | null }[] = [];
  for (const e of entradas) {
    const k = `${e.filaClave}|${e.columna}`;
    const campo = campos.get(k);
    if (!campo) return { ok: false, error: `"${e.filaClave}" no es un campo manual de esta plantilla.` };
    if (vistos.has(k)) return { ok: false, error: `Campo repetido: ${campo.texto.trim()}.` };
    vistos.add(k);
    if (e.texto.trim() === "") {
      cambios.push({ filaClave: e.filaClave, columna: e.columna, centavos: null, nota: null });
      continue;
    }
    const cuenta = leerCuenta(e.texto);
    if (!cuenta.ok) return { ok: false, error: `${campo.texto.trim()}: ${cuenta.error}` };
    cambios.push({ filaClave: e.filaClave, columna: e.columna, centavos: cuenta.centavos, nota: cuenta.nota });
  }

  const hoy = periodoActual();
  let guardados = 0;
  let borrados = 0;
  // La regla de bloqueo se valida DENTRO de la transacción, contra lo que hay guardado en ese
  // momento: en un período bloqueado se puede crear un valor que no existe, pero no modificar
  // ni borrar uno ya cargado.
  const rechazo = await prisma.$transaction(async (tx) => {
    const existentes = await tx.valorManualReporte.findMany({
      where: { empresaId: empresa.id, periodo },
      select: { filaClave: true, columna: true, importe: true },
    });
    const actual = new Map(
      existentes.map((v) => [`${v.filaClave}|${v.columna}`, centavosDeDecimalTexto(v.importe.toFixed(2))])
    );
    const cambiados = cambios.filter((c) => (actual.get(`${c.filaClave}|${c.columna}`) ?? null) !== c.centavos);
    if (cambiados.length === 0) return null;

    const [presupuesto, semanas] = await Promise.all([
      tx.presupuestoMensual.findUnique({
        where: { empresaId_periodo: { empresaId: empresa.id, periodo } },
        select: { estado: true },
      }),
      semanasDelPeriodo([periodo]),
    ]);
    for (const c of cambiados) {
      const campo = campos.get(`${c.filaClave}|${c.columna}`)!;
      const motivo = motivoRechazoCambio(
        motivoBloqueo({
          periodo,
          actual: hoy,
          columna: c.columna,
          bloque: campo.bloque,
          presupuestoValidado: presupuesto?.estado === "VALIDADO",
          semanas: semanas.get(periodo)!,
        }),
        actual.has(`${c.filaClave}|${c.columna}`)
      );
      if (motivo) {
        const accion = c.centavos === null ? "borrar" : "modificar";
        return `"${campo.texto.trim()}": no se puede ${accion} un valor ya cargado (${motivo})`;
      }
    }

    for (const c of cambiados) {
      if (c.centavos === null) {
        await tx.valorManualReporte.deleteMany({
          where: { empresaId: empresa.id, periodo, filaClave: c.filaClave, columna: c.columna },
        });
        borrados++;
      } else {
        const importe = decimalTextoDeCentavos(c.centavos);
        await tx.valorManualReporte.upsert({
          where: {
            empresaId_periodo_filaClave_columna: {
              empresaId: empresa.id,
              periodo,
              filaClave: c.filaClave,
              columna: c.columna,
            },
          },
          create: {
            empresaId: empresa.id,
            periodo,
            filaClave: c.filaClave,
            columna: c.columna,
            importe,
            nota: c.nota,
            cargadoPorId: usuario.id,
          },
          update: { importe, nota: c.nota, cargadoPorId: usuario.id },
        });
        guardados++;
      }
    }
    return null;
  });
  if (rechazo) return { ok: false, error: rechazo };

  revalidatePath(`/${empresaSlug}/${periodo}/reporte`);
  revalidatePath(`/${empresaSlug}/${periodo}/reporte/carga`);
  return { ok: true, guardados, borrados };
}
