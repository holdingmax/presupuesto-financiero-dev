// Historial de arranque de las sugerencias de clasificación de Havanna Perú (tabla HistorialClasificacionEmpresa), a partir de las
// pestañas «MOVIMIENTOS …» de los libros PF de Perú: la columna DETALLE es la clasificación que el contador escribió a mano en cada
// movimiento. Las etiquetas se llevan a la lista de la empresa con lib/extractos/etiquetasPeru.ts; las que no tienen equivalencia
// segura se saltean y se informan. NO crea movimientos: no toca Ejecución ni el Reporte.
//
// Uso (DRY-RUN por defecto: lee los libros, NO abre ninguna conexión, no escribe nada):
//   npx tsx prisma/scripts/sembrar-historial-peru.ts --libro "<ruta1.xlsx>" --libro "<ruta2.xlsx>"
// Para escribir:
//   npx tsx --env-file=<archivo-env-de-la-base> prisma/scripts/sembrar-historial-peru.ts --libro "<ruta1.xlsx>" ... --host-esperado <host> --aplicar
//
// - Con --aplicar, --host-esperado es OBLIGATORIO: se compara contra el host de DATABASE_URL ANTES de abrir ninguna conexión; si no
//   coincide, aborta. Nunca se imprime la URL ni la contraseña.
// - Idempotente: reemplaza las `veces` de cada (concepto, signo, clasificación) con lo leído (volver a correrlo no suma de más).
//   No borra nada.
// - Un mismo movimiento que está en dos libros (cada libro arrastra los meses anteriores) se cuenta una sola vez.

import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { agregarHistorialPeru, type FilaLibroPeru } from "@/lib/extractos/historialPeru";
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
const valor = (v: Celda): unknown => (v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v && typeof v === "object" && "richText" in v ? (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("") : v);
const texto = (v: Celda) => String(valor(v) ?? "").replace(/\s+/g, " ").trim();
const encabezado = (v: Celda) => quitarDiacriticos(texto(v)).toUpperCase();

// Pestañas de movimientos: la fila de títulos tiene «F. Operación», «Concepto» e «Importe» (en algunas hay una columna «Moneda»
// adelante, por eso se buscan por nombre y no por posición). La clasificación es la columna «DETALLE» (en las más viejas, «Oficina»
// con texto).
function filasDeLaHoja(ws: ExcelJS.Worksheet): FilaLibroPeru[] {
  let hdr = -1;
  const col: Record<string, number> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 12) && hdr === -1; r++) {
    const cols: Record<string, number> = {};
    ws.getRow(r).eachCell({ includeEmpty: false }, (c, n) => {
      const h = encabezado(c.value);
      if (h.startsWith("F. OPERACION")) cols.fecha = n;
      else if (h === "CONCEPTO") cols.concepto = n;
      else if (h === "IMPORTE") cols.importe = n;
      else if (h.startsWith("N") && h.includes("DOC")) cols.doc = n;
      else if (h === "DETALLE") cols.detalle = n;
      else if (h === "OFICINA") cols.oficina = n;
    });
    if (cols.fecha && cols.concepto && cols.importe) { hdr = r; Object.assign(col, cols); }
  }
  if (hdr === -1) return [];
  const salida: FilaLibroPeru[] = [];
  for (let r = hdr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const f = valor(row.getCell(col.fecha).value);
    if (!(f instanceof Date) || isNaN(f.getTime())) continue;
    const importe = Number(valor(row.getCell(col.importe).value));
    if (!isFinite(importe) || importe === 0) continue;
    let etiqueta = col.detalle ? texto(row.getCell(col.detalle).value) : "";
    if (etiqueta === "" && col.oficina) {
      const o = texto(row.getCell(col.oficina).value);
      if (o !== "" && isNaN(Number(o))) etiqueta = o;
    }
    salida.push({
      fecha: f.toISOString().slice(0, 10),
      nroDoc: col.doc ? texto(row.getCell(col.doc).value) : "",
      concepto: texto(row.getCell(col.concepto).value),
      importe,
      etiqueta,
    });
  }
  return salida;
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const libros = leerArgumentos("--libro");
  if (libros.length === 0) abortar('falta al menos un --libro "<ruta.xlsx>". No toqué nada.');

  // 1) Lectura de los libros (sin base de datos).
  const todas: FilaLibroPeru[] = [];
  for (const ruta of libros) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(ruta);
    const hojas = wb.worksheets.filter((w) => /^MOVIMIENTOS?\b/i.test(w.name.trim()));
    let filasLibro = 0;
    for (const ws of hojas) {
      const f = filasDeLaHoja(ws);
      filasLibro += f.length;
      todas.push(...f);
    }
    console.log(`Libro leído: ${hojas.length} pestañas de movimientos, ${filasLibro} filas.`);
  }
  const r = agregarHistorialPeru(todas);
  console.log(`\nFilas leídas: ${r.leidas}; repetidas entre libros: ${r.repetidas}; sin etiqueta: ${r.sinEtiqueta}; concepto vacío: ${r.conceptoVacio}`);
  console.log(`Usadas para el historial: ${r.usadas} filas → ${r.grupos.length} grupos (concepto + signo + clasificación).`);
  const porClasificacion: Record<string, number> = {};
  for (const g of r.grupos) porClasificacion[g.clasificacion] = (porClasificacion[g.clasificacion] ?? 0) + g.veces;
  console.log("Por clasificación:", JSON.stringify(porClasificacion));
  const sinEq = Object.entries(r.sinEquivalencia).sort((a, b) => b[1] - a[1]);
  console.log(`Etiquetas SIN equivalencia en la lista de Perú (se saltean): ${sinEq.length === 0 ? "ninguna" : JSON.stringify(sinEq)}`);

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
    const empresas = await prisma.empresa.findMany({ where: { unidadesNegocio: { has: "HAVANNA PERU" } }, select: { id: true, nombre: true } });
    if (empresas.length !== 1) abortar(`esperaba UNA empresa con la unidad HAVANNA PERU y encontré ${empresas.length}. No escribí nada.`);
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
