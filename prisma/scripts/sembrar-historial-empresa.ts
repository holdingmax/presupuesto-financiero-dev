// Historial de arranque de las sugerencias de clasificación de UNA empresa (tabla HistorialClasificacionEmpresa), a partir de las pestañas
// de movimientos de sus libros PF, donde el contador clasificó a mano cada movimiento. Las etiquetas se llevan a la lista de la empresa
// con las equivalencias aprobadas (lib/extractos/etiquetas*.ts); las que no tienen equivalencia se saltean y se informan. NO crea
// movimientos: no toca Ejecución ni el Reporte.
//
//   --empresa havanna-peru   pestañas «MOVIMIENTOS …» (columna DETALLE)
//   --empresa bradenton      pestaña «CHASE» (columna «Check or Slip #»; los cheques, por Type = CHECK_PAID)
//   --empresa plate-silver   pestañas «BANCO …» (columna «Detalle»; PROVEEDORES e IMPUESTOS no se siembran)
//
// Uso (DRY-RUN por defecto: lee los libros, NO abre ninguna conexión, no escribe nada):
//   npx tsx prisma/scripts/sembrar-historial-empresa.ts --empresa <slug> --libro "<ruta1.xlsx>" --libro "<ruta2.xlsx>"
// Para escribir:
//   npx tsx --env-file=<archivo-env-de-la-base> prisma/scripts/sembrar-historial-empresa.ts --empresa <slug> --libro "<ruta1.xlsx>" ... --host-esperado <host> --aplicar
//
// - Con --aplicar, --host-esperado es OBLIGATORIO: se compara contra el host de DATABASE_URL ANTES de abrir ninguna conexión; si no
//   coincide, aborta. Nunca se imprime la URL ni la contraseña.
// - Idempotente: reemplaza las `veces` de cada (concepto, signo, clasificación) con lo leído (volver a correrlo no suma de más). No borra.
// - Un mismo movimiento que está en dos libros (cada libro arrastra los meses anteriores) se cuenta una sola vez.

import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { configDeEmpresa } from "@/lib/extractos/cargaEmpresa";
import { agregarHistorial, type EquivalenciaFila, type FilaLibro } from "@/lib/extractos/historialEmpresa";
import { equivalenciaEtiquetaPeru } from "@/lib/extractos/etiquetasPeru";
import { equivalenciaBradenton } from "@/lib/extractos/etiquetasBradenton";
import { equivalenciaEtiquetaPlateSilver } from "@/lib/extractos/etiquetasPlateSilver";
import { quitarDiacriticos } from "@/lib/texto";

function leerArgumentos(nombre: string): string[] {
  const r: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === nombre && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) r.push(process.argv[i + 1]);
  });
  return r;
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

type Celda = ExcelJS.CellValue;
const valor = (v: Celda): unknown =>
  v && typeof v === "object" && "result" in v
    ? (v as { result: unknown }).result
    : v && typeof v === "object" && "richText" in v
      ? (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("")
      : v;
const texto = (v: Celda) => String(valor(v) ?? "").replace(/\s+/g, " ").trim();
const encabezado = (v: Celda) => quitarDiacriticos(texto(v)).toUpperCase();

// Fecha de la celda: Date (Excel) o texto dd/mm/aaaa o aaaa-mm-dd. null si no es una fecha.
function fechaISO(v: Celda): string | null {
  const x = valor(v);
  if (x instanceof Date) return isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
  if (typeof x === "string") {
    const a = x.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (a) return `${a[3]}-${a[2]}-${a[1]}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(x.trim())) return x.trim().slice(0, 10);
  }
  return null;
}

type Columnas = Record<string, number>;

// Busca, en las primeras filas, la de títulos: la que tiene todas las columnas obligatorias. `reglas` dice cómo reconocer cada columna.
function buscarEncabezado(
  ws: ExcelJS.Worksheet,
  reglas: Record<string, (h: string) => boolean>,
  obligatorias: string[]
): { fila: number; col: Columnas } | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
    const col: Columnas = {};
    ws.getRow(r).eachCell({ includeEmpty: false }, (c, n) => {
      const h = encabezado(c.value);
      for (const [nombre, esa] of Object.entries(reglas)) if (col[nombre] === undefined && esa(h)) col[nombre] = n;
    });
    if (obligatorias.every((o) => col[o] !== undefined)) return { fila: r, col };
  }
  return null;
}

type LectorLibro = {
  slug: string;
  hojas: (nombre: string) => boolean;
  leer: (ws: ExcelJS.Worksheet, origen: string) => FilaLibro[];
  equivalencia: EquivalenciaFila;
  dedup: "global" | "entre-origenes";
};

// Havanna Perú: la columna DETALLE (en las pestañas viejas, «Oficina» con texto) es la clasificación; hay pestañas con una columna
// «Moneda» adelante, por eso todo se busca por nombre.
function leerPeru(ws: ExcelJS.Worksheet, origen: string): FilaLibro[] {
  const enc = buscarEncabezado(
    ws,
    {
      fecha: (h) => h.startsWith("F. OPERACION"),
      concepto: (h) => h === "CONCEPTO",
      importe: (h) => h === "IMPORTE",
      doc: (h) => h.startsWith("N") && h.includes("DOC"),
      detalle: (h) => h === "DETALLE",
      oficina: (h) => h === "OFICINA",
    },
    ["fecha", "concepto", "importe"]
  );
  if (!enc) return [];
  const { col } = enc;
  const salida: FilaLibro[] = [];
  for (let r = enc.fila + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const fecha = fechaISO(row.getCell(col.fecha).value);
    if (!fecha) continue;
    const importe = Number(valor(row.getCell(col.importe).value));
    if (!isFinite(importe) || importe === 0) continue;
    let etiqueta = col.detalle ? texto(row.getCell(col.detalle).value) : "";
    if (etiqueta === "" && col.oficina) {
      const o = texto(row.getCell(col.oficina).value);
      if (o !== "" && isNaN(Number(o))) etiqueta = o;
    }
    salida.push({ origen, fecha, nroDoc: col.doc ? texto(row.getCell(col.doc).value) : "", concepto: texto(row.getCell(col.concepto).value), importe, etiqueta });
  }
  return salida;
}

// Bradenton: pestaña CHASE. La columna «Check or Slip #» está pisada, en el libro de Kike, con la etiqueta de clasificación a mano.
function leerChase(ws: ExcelJS.Worksheet, origen: string): FilaLibro[] {
  const enc = buscarEncabezado(
    ws,
    {
      fecha: (h) => h === "POSTING DATE",
      concepto: (h) => h === "DESCRIPTION",
      importe: (h) => h === "AMOUNT",
      tipo: (h) => h === "TYPE",
      etiqueta: (h) => h.startsWith("CHECK OR SLIP"),
    },
    ["fecha", "concepto", "importe", "etiqueta"]
  );
  if (!enc) return [];
  const { col } = enc;
  const salida: FilaLibro[] = [];
  for (let r = enc.fila + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const fecha = fechaISO(row.getCell(col.fecha).value);
    if (!fecha) continue; // la fila del saldo inicial y el bloque RESUMEN de abajo no tienen fecha
    const importe = Number(valor(row.getCell(col.importe).value));
    if (!isFinite(importe) || importe === 0) continue;
    salida.push({
      origen,
      fecha,
      nroDoc: "",
      concepto: texto(row.getCell(col.concepto).value),
      importe,
      etiqueta: texto(row.getCell(col.etiqueta).value),
      tipo: col.tipo ? texto(row.getCell(col.tipo).value) : undefined,
    });
  }
  return salida;
}

// Plate Silver: pestañas BANCO (una por cuenta y mes). El concepto es EL MISMO que arma el lector del BROU al cargar:
// «Descripción — Asunto». La clasificación es la columna «Detalle»; una fila con un número ahí es un saldo, no una etiqueta.
function leerBrou(ws: ExcelJS.Worksheet, origen: string): FilaLibro[] {
  const enc = buscarEncabezado(
    ws,
    {
      fecha: (h) => h === "FECHA",
      descripcion: (h) => h === "DESCRIPCION",
      doc: (h) => h.startsWith("NUMERO DE DOC"),
      asunto: (h) => h === "ASUNTO",
      movimiento: (h) => h === "MOVIMIENTO",
      detalle: (h) => h === "DETALLE",
    },
    ["fecha", "descripcion", "movimiento", "detalle"]
  );
  if (!enc) return [];
  const { col } = enc;
  const salida: FilaLibro[] = [];
  for (let r = enc.fila + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const fecha = fechaISO(row.getCell(col.fecha).value);
    if (!fecha) continue;
    const importe = Number(valor(row.getCell(col.movimiento).value));
    if (!isFinite(importe) || importe === 0) continue;
    const etiqueta = texto(row.getCell(col.detalle).value);
    if (etiqueta !== "" && !isNaN(Number(etiqueta))) continue;
    const concepto = [texto(row.getCell(col.descripcion).value), col.asunto ? texto(row.getCell(col.asunto).value) : ""].filter((x) => x !== "").join(" — ") || "(sin concepto)";
    salida.push({ origen, fecha, nroDoc: col.doc ? texto(row.getCell(col.doc).value) : "", concepto, importe, etiqueta });
  }
  return salida;
}

const LECTORES: Record<string, LectorLibro> = {
  "havanna-peru": { slug: "havanna-peru", hojas: (n) => /^MOVIMIENTOS?\b/i.test(n.trim()), leer: leerPeru, equivalencia: (f) => equivalenciaEtiquetaPeru(f.etiqueta), dedup: "global" },
  bradenton: { slug: "bradenton", hojas: (n) => n.trim().toUpperCase() === "CHASE", leer: leerChase, equivalencia: (f) => equivalenciaBradenton(f.etiqueta, f.tipo), dedup: "entre-origenes" },
  "plate-silver": { slug: "plate-silver", hojas: (n) => /^BANCO\b/i.test(n.trim()), leer: leerBrou, equivalencia: (f) => equivalenciaEtiquetaPlateSilver(f.etiqueta), dedup: "entre-origenes" },
};

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const slug = leerArgumentos("--empresa")[0];
  const lector = slug ? LECTORES[slug] : undefined;
  if (!lector) abortar(`falta --empresa <${Object.keys(LECTORES).join("|")}>. No toqué nada.`);
  const config = configDeEmpresa(lector.slug);
  if (!config) abortar(`la empresa ${lector.slug} no está en la configuración de carga por extracto. No toqué nada.`);
  const libros = leerArgumentos("--libro");
  if (libros.length === 0) abortar('falta al menos un --libro "<ruta.xlsx>". No toqué nada.');

  // 1) Lectura de los libros (sin base de datos).
  const todas: FilaLibro[] = [];
  for (const ruta of libros) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(ruta);
    const hojas = wb.worksheets.filter((w) => lector.hojas(w.name));
    let filasLibro = 0;
    for (const ws of hojas) {
      const f = lector.leer(ws, ruta);
      filasLibro += f.length;
      todas.push(...f);
    }
    console.log(`Libro leído: ${hojas.length} pestañas de movimientos, ${filasLibro} filas.`);
  }
  const r = agregarHistorial(todas, lector.equivalencia, { dedup: lector.dedup });
  console.log(`\nEmpresa: ${lector.slug} (unidad ${config.unidad})`);
  console.log(`Filas leídas: ${r.leidas}; repetidas entre libros: ${r.repetidas}; sin etiqueta: ${r.sinEtiqueta}; concepto vacío: ${r.conceptoVacio}`);
  console.log(`Usadas para el historial: ${r.usadas} filas → ${r.grupos.length} grupos (concepto + signo + clasificación).`);
  const porClasificacion: Record<string, number> = {};
  for (const g of r.grupos) porClasificacion[g.clasificacion] = (porClasificacion[g.clasificacion] ?? 0) + g.veces;
  console.log("Por clasificación:", JSON.stringify(porClasificacion));
  const sinEq = Object.entries(r.sinEquivalencia).sort((a, b) => b[1] - a[1]);
  console.log(`Etiquetas SIN equivalencia (se saltean): ${sinEq.length === 0 ? "ninguna" : JSON.stringify(sinEq)}`);

  if (!aplicar) {
    console.log("\nMODO: DRY-RUN (no abrí ninguna conexión ni escribí nada; usar --aplicar --host-esperado <host> para cargar).");
    return;
  }

  // 2) Guardia de host, antes de cualquier acceso a la base.
  const hostEsperado = leerArgumentos("--host-esperado")[0]?.trim().toLowerCase();
  if (!hostEsperado) abortar("falta --host-esperado <host>. No toqué la base.");
  const url = leerDatabaseUrl();
  if (!url) abortar("no encontré DATABASE_URL (ni en el entorno ni en .env). No toqué la base.");
  const host = hostDe(url);
  if (!host) abortar("DATABASE_URL no es una URL válida. No toqué la base.");
  if (host !== hostEsperado) abortar(`el host de DATABASE_URL no coincide con el esperado (${hostEsperado}). No toqué la base.`);
  process.env.DATABASE_URL = url;
  console.log(`\nHost verificado: coincide con ${hostEsperado}.\nMODO: APLICAR (escribe en la base)`);

  const prisma = new PrismaClient();
  try {
    const empresas = await prisma.empresa.findMany({ where: { unidadesNegocio: { has: config.unidad } }, select: { id: true, nombre: true } });
    if (empresas.length !== 1) abortar(`esperaba UNA empresa con la unidad ${config.unidad} y encontré ${empresas.length}. No escribí nada.`);
    const empresa = empresas[0];
    console.log(`Empresa: ${empresa.nombre}`);
    await prisma.$transaction(
      async (tx) => {
        for (const g of r.grupos) {
          await tx.historialClasificacionEmpresa.upsert({
            where: { empresaId_concepto_signo_clasificacion: { empresaId: empresa.id, concepto: g.concepto, signo: g.signo, clasificacion: g.clasificacion } },
            create: { empresaId: empresa.id, concepto: g.concepto, signo: g.signo, clasificacion: g.clasificacion, veces: g.veces },
            update: { veces: g.veces },
          });
        }
      },
      { maxWait: 10_000, timeout: 120_000 }
    );
    const total = await prisma.historialClasificacionEmpresa.count({ where: { empresaId: empresa.id } });
    console.log(`Listo: ${r.grupos.length} grupos escritos; la empresa tiene ${total} grupos de historial.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
