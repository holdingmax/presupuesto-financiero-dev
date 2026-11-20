import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLASIFICACIONES_OCULTAS_PARA_GERENTE } from "@/lib/config";
import { clasificacionesOcultasParaUsuario } from "@/lib/clasificacionesOcultas";
import { whereMovimientosDeEmpresa } from "@/lib/filtroClasificacionEmpresa";
import { obtenerValoresOcultos } from "@/lib/ocultasGerenteDb";
import { prisma } from "@/lib/prisma";

// Excel del Historial de ejecución de una empresa (semana y «Todo el mes»): el VIEWER lo descarga y tiene que recibir
// EXACTAMENTE lo mismo que un GERENTE con acceso a esa empresa. Las rutas no leen el rol: lo único que depende del
// usuario es (1) requireAccesoEmpresa (sin la empresa asignada -> 403) y (2) las clasificaciones ocultas. Acá se prueba (2)
// con datos en memoria (la base queda sin tocar: groupBy se reemplaza) y (1) y el resto leyendo la fuente de las rutas.

const leer = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const RUTAS = [
  "app/[empresa]/[periodo]/ejecucion/[numeroSemana]/excel/route.ts",
  "app/[empresa]/[periodo]/ejecucion/mes/excel/route.ts",
];
const BOOLS = [false, true];
const SLUGS = [...Object.keys(CLASIFICACIONES_OCULTAS_PARA_GERENTE), "bradenton", "otra-empresa"];
const GERENTE = { rol: "GERENTE", operaEjecucion: false };
const UNIDADES = ["UN1", "UN2"];

test("VIEWER: las clasificaciones ocultas son las del gerente, con cualquier casilla (veBloquesReservados no abre nada acá)", () => {
  for (const slug of SLUGS) {
    const esperado = clasificacionesOcultasParaUsuario(slug, GERENTE);
    for (const operaEjecucion of BOOLS) {
      for (const veBloquesReservados of BOOLS) {
        const viewer = { rol: "VIEWER", operaEjecucion, veBloquesReservados };
        assert.deepEqual(clasificacionesOcultasParaUsuario(slug, viewer), esperado, `${slug} op=${operaEjecucion} res=${veBloquesReservados}`);
      }
    }
  }
  // Y en Conexión no es una lista vacía: el VIEWER de verdad no ve AVION, MS ni PRESTAMO MS.
  const viewerConTodo = { rol: "VIEWER", operaEjecucion: true, veBloquesReservados: true };
  assert.deepEqual(clasificacionesOcultasParaUsuario("conexion-logistica", viewerConTodo), ["AVION", "MS", "PRESTAMO MS"]);
});

test("VIEWER: obtenerValoresOcultos y el where del Excel son idénticos a los del gerente (con y sin la casilla)", async () => {
  const guardadas = [{ clasificacion: "Avion" }, { clasificacion: " ms " }, { clasificacion: "PRESTAMO MS" }, { clasificacion: "SUELDOS" }];
  const original = Object.getOwnPropertyDescriptor(prisma, "movimientoBancario");
  Object.defineProperty(prisma, "movimientoBancario", { configurable: true, value: { groupBy: async () => guardadas } });
  try {
    for (const slug of ["conexion-logistica", "conexion-logistica-spp", "bradenton"]) {
      const delGerente = await obtenerValoresOcultos("sem-1", slug, GERENTE);
      const whereGerente = whereMovimientosDeEmpresa("sem-1", UNIDADES, "SUELDOS", delGerente);
      for (const operaEjecucion of BOOLS) {
        for (const veBloquesReservados of BOOLS) {
          const viewer = { rol: "VIEWER", operaEjecucion, veBloquesReservados };
          const ocultas = await obtenerValoresOcultos("sem-1", slug, viewer);
          assert.deepEqual(ocultas, delGerente, `${slug} ocultas`);
          assert.deepEqual(whereMovimientosDeEmpresa("sem-1", UNIDADES, "SUELDOS", ocultas), whereGerente, `${slug} where`);
        }
      }
      if (slug.startsWith("conexion")) assert.deepEqual([...delGerente].sort(), [" ms ", "Avion", "PRESTAMO MS"]);
      else assert.deepEqual(delGerente, []);
    }
  } finally {
    if (original) Object.defineProperty(prisma, "movimientoBancario", original);
    else delete (prisma as unknown as Record<string, unknown>).movimientoBancario;
  }
});

test("rutas del Excel: el acceso lo decide requireAccesoEmpresa (403 sin la empresa asignada) y ya no hay candado por rol", () => {
  for (const rel of RUTAS) {
    const f = leer(rel);
    assert.match(f, /usuario = await requireAccesoEmpresa\(empresa\.id\)/, rel);
    assert.match(f, /if \(error instanceof AccesoDenegadoError\) return new Response\("Sin acceso\.", \{ status: 403 \}\)/, rel);
    assert.equal(/esViewer/.test(f), false, `${rel}: no debe haber candado por rol`);
  }
});

test("rutas del Excel: el contenido no depende del rol ni de la casilla — mismas unidades, sin saldo, mismas ocultas, mismo filtro", () => {
  for (const rel of RUTAS) {
    const f = leer(rel).replace(/^\s*\/\/.*$/gm, "");
    // Lo único que se hace con el usuario es pasárselo a obtenerValoresOcultos (que lo trata como a un gerente).
    const usos = f.match(/\busuario\b/g) ?? [];
    const permitidos = (f.match(/usuario = await requireAccesoEmpresa|let usuario;|, usuario\)/g) ?? []).length;
    assert.equal(usos.length, permitidos, `${rel}: usuario se usa para algo más que acceso y ocultas`);
    assert.equal(/\.rol\b|veBloquesReservados|verSaldo|veTodoEjecucion|operaEjecucion/.test(f), false, rel);
    assert.match(f, /const unidades = empresa\.unidadesNegocio;/, rel);
    assert.match(f, /obtenerValoresOcultos\(/, rel);
    assert.match(f, /leerClasificacion\(\{/, rel);
    assert.match(f, /construirExcelMovimientos\(\s*filas\.map\(\(m\) => [^\n]*\),\s*false/, `${rel}: el Excel de la empresa nunca lleva saldo`);
  }
  // Todo el mes: sin ignorados ni movimientos fuera de las unidades de la empresa (los pone whereMovimientosDelMes).
  assert.match(leer(RUTAS[1]), /whereMovimientosDelMes\(/);
  assert.match(leer(RUTAS[0]), /whereMovimientosDeEmpresa\(ejecucion\.id, unidades, clasificacion, ocultas\)/);
});

test("pantallas: el botón «Descargar Excel» y la nota «el Excel descarga solo lo filtrado» ya no dependen del rol", () => {
  for (const rel of ["app/[empresa]/[periodo]/ejecucion/[numeroSemana]/page.tsx", "app/[empresa]/[periodo]/ejecucion/mes/page.tsx"]) {
    const f = leer(rel);
    assert.equal(/esViewer/.test(f), false, rel);
    assert.match(f, /Descargar Excel/, rel);
    assert.match(f, /el Excel descarga solo lo filtrado/, rel);
  }
  assert.equal(/esViewer/.test(leer("app/[empresa]/[periodo]/ejecucion/datos.ts")), false);
});

test("el VIEWER sigue sin escribir: las rutas del Excel son GET (lectura) y no hay otro método exportado", () => {
  for (const rel of RUTAS) {
    const metodos = [...leer(rel).matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(metodos, ["GET"], rel);
  }
});
