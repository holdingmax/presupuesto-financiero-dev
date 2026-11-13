// Sugiere clasificación a los movimientos de una empresa que YA están cargados SIN CLASIFICAR (Bradenton, Plate Silver, Havanna Perú),
// con el índice de la empresa (sus movimientos confirmados + su historial de arranque, solo con valores de SU lista) y, si la empresa
// la declara, su regla de respaldo para ingresos (Plate Silver: COBRANZA DE CLIENTE). Las sugerencias quedan marcadas
// sugeridaPorSistema = true: se confirman en el panel de la empresa, nunca solas.
//
// NO toca ningún movimiento que ya esté clasificado (a mano, sugerido o confirmado), ignorado, con prorrateo o de una semana cerrada:
// esa condición va en la lectura Y se repite en cada UPDATE. Solo cambia `clasificacion` y `sugeridaPorSistema`. Correrlo dos veces no
// duplica nada (la segunda no encuentra pendientes).
//
// Uso (DRY-RUN por defecto: LEE la base, no escribe nada). --host-esperado es obligatorio SIEMPRE (también para leer):
//   npx tsx --env-file=<archivo-env-de-la-base> prisma/scripts/aplicar-sugerencias-existentes.ts --empresa <slug> --periodo AAAA-MM [--semana N] --host-esperado <host>
// Para escribir, el mismo comando con --aplicar.
//
// - El host se compara contra DATABASE_URL ANTES de abrir ninguna conexión; si no coincide, aborta. Nunca se imprime la URL.

import { readFileSync } from "node:fs";
import type { PrismaClient as PrismaClientTipo } from "@prisma/client";
import { configDeEmpresa } from "@/lib/extractos/cargaEmpresa";

function leerArgumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre);
  if (i === -1) return null;
  return process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : "";
}

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

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const slug = leerArgumento("--empresa")?.trim();
  const periodo = leerArgumento("--periodo")?.trim();
  const semanaTexto = leerArgumento("--semana")?.trim();
  const hostEsperado = leerArgumento("--host-esperado")?.trim().toLowerCase();

  if (!slug) abortar("falta --empresa <slug>. No toqué la base.");
  const config = configDeEmpresa(slug);
  if (!config) abortar(`la empresa ${slug} no está en la configuración de carga por extracto. No toqué la base.`);
  if (!config.sugerenciasPorHistorial) abortar(`la empresa ${slug} no tiene activadas las sugerencias por historial. No toqué la base.`);
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) abortar("falta --periodo AAAA-MM. No toqué la base.");
  let numeroSemana: number | undefined;
  if (semanaTexto !== undefined && semanaTexto !== null) {
    numeroSemana = Number(semanaTexto);
    if (!Number.isInteger(numeroSemana) || numeroSemana < 1) abortar("--semana tiene que ser un entero positivo. No toqué la base.");
  }
  if (!hostEsperado) abortar("falta --host-esperado <host>. No toqué la base.");

  // 1) Guardia de host, antes de cualquier acceso a la base.
  const url = leerDatabaseUrl();
  if (!url) abortar("no encontré DATABASE_URL (ni en el entorno ni en .env). No toqué la base.");
  const host = hostDe(url);
  if (!host) abortar("DATABASE_URL no es una URL válida. No toqué la base.");
  if (host !== hostEsperado) abortar(`el host de DATABASE_URL no coincide con el esperado (${hostEsperado}). No toqué la base.`);
  process.env.DATABASE_URL = url;
  console.log(`Host verificado: coincide con ${hostEsperado}.`);
  console.log(aplicar ? "MODO: APLICAR (escribe en la base)\n" : "MODO: DRY-RUN (lee la base, no escribe nada; usar --aplicar para sugerir)\n");

  // Los módulos con base de datos se importan DESPUÉS de la guardia.
  const { PrismaClient } = await import("@prisma/client");
  const { sugerirAExistentes } = await import("@/lib/clasificacionHistorialDb");
  const { slugDeEmpresa } = await import("@/lib/slug");
  const prisma: PrismaClientTipo = new PrismaClient();
  try {
    const empresas = await prisma.empresa.findMany({ select: { id: true, nombre: true, unidadesNegocio: true } });
    const candidatas = empresas.filter((e) => slugDeEmpresa(e.nombre) === slug && e.unidadesNegocio.includes(config.unidad));
    if (candidatas.length !== 1) abortar(`esperaba UNA empresa con slug ${slug} y la unidad ${config.unidad} y encontré ${candidatas.length}. No escribí nada.`);
    const empresa = candidatas[0];
    console.log(`Empresa: ${empresa.nombre} · unidad ${config.unidad} · período ${periodo}${numeroSemana !== undefined ? ` · semana ${numeroSemana}` : " · todas las semanas ABIERTAS"}`);
    if (config.ingresoPorDefecto) console.log(`Regla de respaldo para ingresos: «${config.ingresoPorDefecto}»`);
    if (config.umbralesSugerencia) console.log(`Umbrales de la empresa: ${config.umbralesSugerencia.minApariciones} apariciones o más y ${Math.round(config.umbralesSugerencia.minDominancia * 100)} % de dominancia o más`);

    const i = await sugerirAExistentes(prisma, { empresaId: empresa.id, slug, unidad: config.unidad, periodo, numeroSemana, ingresoPorDefecto: config.ingresoPorDefecto, umbrales: config.umbralesSugerencia }, aplicar);

    console.log(`\nMovimientos de la unidad en el alcance: ${i.totalEnAlcance}`);
    console.log(`  ya clasificados (NO se tocan): ${i.yaClasificados}`);
    console.log(`  ya sugeridos sin confirmar (NO se tocan): ${i.sugeridasSinConfirmar}`);
    console.log(`  pendientes (SIN CLASIFICAR, abiertos, sin prorrateo): ${i.pendientes}`);
    console.log(`\nSe sugiere clasificación a ${i.sugeridasPorHistorial + i.sugeridasPorRegla} de ${i.pendientes}:`);
    console.log(`  por historial: ${i.sugeridasPorHistorial}`);
    console.log(`  por regla de respaldo: ${i.sugeridasPorRegla}`);
    console.log(`  quedan SIN CLASIFICAR: ${i.sinSugerencia}`);
    console.log("\nPor clasificación sugerida:");
    for (const [c, n] of Object.entries(i.porClasificacion).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${c}`);
    if (i.conceptosSinSugerencia.length > 0) {
      console.log("\nConceptos que más quedan sin sugerencia:");
      for (const c of i.conceptosSinSugerencia) console.log(`  ${String(c.veces).padStart(4)}  ${c.concepto.slice(0, 90)}`);
    }
    console.log(aplicar ? `\nAPLICADO: ${i.aplicadas} movimientos marcados como sugeridos.` : "\nDRY-RUN: no se escribió nada.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
