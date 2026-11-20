import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Test ESTÁTICO (lee el código fuente, no ejecuta nada ni toca la base): recorre TODOS los archivos "use server" del
// proyecto y exige que cada función exportada llame, ANTES de tocar la base, a un guard que deja afuera al VIEWER, o
// figure en la lista explícita de excepciones de abajo. Si agregás una acción nueva sin guard, este test falla.
//
// Qué cuenta como guard (GUARDS_QUE_EXCLUYEN_VIEWER): cada uno rechaza al VIEWER por sí mismo.
//  - requireEscritura: el candado explícito (lib/permisosViewer.ts).
//  - requireAdmin / requireAdminOFinanzas / requireCierreEjecucion / requireCargaMadreEjecucion: por rol.
//  - requireOperadorEjecucionGlobal / requireVerEjecucionGlobal: puedeOperarEjecucionGlobal y veTodoEjecucion dan false.
//  - requireCargaRealEmpresa: llama a requireEscritura adentro.
//  - resolverEmpresaYPresupuesto: llama a requireEscritura adentro (punto único de las acciones de Presupuesto).
// requireUsuario, requireUsuarioAlDia y requireAccesoEmpresa NO están: dejan pasar a un VIEWER, así que solas no alcanzan
// (hay que sumarles requireEscritura).
const GUARDS_QUE_EXCLUYEN_VIEWER = [
  "requireEscritura",
  "requireAdmin",
  "requireAdminOFinanzas",
  "requireCierreEjecucion",
  "requireCargaMadreEjecucion",
  "requireOperadorEjecucionGlobal",
  "requireVerEjecucionGlobal",
  "requireCargaRealEmpresa",
  "resolverEmpresaYPresupuesto",
];

// Excepciones: acciones que un usuario sin rol de escritura TIENE que poder llamar (o que ni siquiera tienen sesión).
// "archivo (relativo a la raíz):función" -> motivo. Una excepción nueva se agrega acá, a la vista, y no en silencio.
const EXCEPCIONES: Record<string, string> = {
  "app/login/actions.ts:login": "todavía no hay sesión",
  "app/login/actions.ts:logout": "cerrar la propia sesión",
  "app/olvide/actions.ts:pedirRecuperacion": "recuperación de contraseña: no hay sesión",
  "app/restablecer/actions.ts:restablecer": "recuperación de contraseña: no hay sesión (token de un solo uso)",
  "app/cuenta/actions.ts:cambiarPassword": "cada usuario cambia SU contraseña, también un VIEWER",
};

const RAIZ = join(__dirname, "..", "..");

function archivos(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next" || nombre === ".git") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

// "use server" como PRIMERA sentencia del archivo (directiva real); ignora el texto dentro de comentarios.
function esArchivoUseServer(fuente: string): boolean {
  const sinComentariosIniciales = fuente.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use server["']/.test(sinComentariosIniciales);
}

type Funcion = { nombre: string; exportada: boolean; cuerpo: string };

// Funciones de nivel superior (export async function f / async function f / function f), con su cuerpo hasta la
// siguiente función de nivel superior. Alcanza para este código (todas empiezan en la columna 0).
function funciones(fuente: string): Funcion[] {
  const texto = fuente.replace(/\r\n/g, "\n");
  const re = /^(export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm;
  const hits: { nombre: string; exportada: boolean; ini: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) hits.push({ nombre: m[2], exportada: Boolean(m[1]), ini: m.index });
  return hits.map((h, i) => ({
    nombre: h.nombre,
    exportada: h.exportada,
    cuerpo: texto.slice(h.ini, i + 1 < hits.length ? hits[i + 1].ini : texto.length),
  }));
}

function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function posicionDeLlamada(codigo: string, nombre: string): number {
  const m = new RegExp(`\\b${nombre}\\s*\\(`).exec(codigo);
  return m ? m.index : -1;
}

// Posición (en el cuerpo) del primer guard que excluye al VIEWER, mirando también las funciones locales que la
// función llama (un nivel o más). -1 si no hay.
function posicionDelGuard(fn: Funcion, todas: Map<string, Funcion>, vistas: Set<string> = new Set()): number {
  if (vistas.has(fn.nombre)) return -1;
  vistas.add(fn.nombre);
  const codigo = sinComentarios(fn.cuerpo);
  const cuerpoSinFirma = codigo; // la firma no contiene llamadas a guards
  const posiciones: number[] = [];
  for (const guard of GUARDS_QUE_EXCLUYEN_VIEWER) {
    const p = posicionDeLlamada(cuerpoSinFirma, guard);
    if (p >= 0) posiciones.push(p);
  }
  for (const local of todas.values()) {
    if (local.nombre === fn.nombre || local.exportada) continue;
    const p = posicionDeLlamada(cuerpoSinFirma, local.nombre);
    if (p < 0) continue;
    if (posicionDelGuard(local, todas, new Set(vistas)) >= 0) posiciones.push(p);
  }
  return posiciones.length ? Math.min(...posiciones) : -1;
}

const todosLosArchivos = archivos(join(RAIZ, "app")).concat(archivos(join(RAIZ, "lib")));
const archivosUseServer = todosLosArchivos.filter((f) => esArchivoUseServer(readFileSync(f, "utf8")));

test("el recorrido encuentra los archivos 'use server' conocidos (si esto falla, el test no está mirando nada)", () => {
  const rel = archivosUseServer.map((f) => relative(RAIZ, f).replace(/\\/g, "/"));
  assert.ok(rel.length >= 19, `se esperaban al menos 19 archivos use server y hay ${rel.length}`);
  for (const esperado of [
    "app/ejecucion/actions.ts",
    "app/[empresa]/[periodo]/presupuesto/actions.ts",
    "app/admin/usuarios/actions.ts",
    "app/login/actions.ts",
  ]) {
    assert.ok(rel.includes(esperado), `falta ${esperado}`);
  }
});

test("TODA función exportada de un archivo 'use server' llama a un guard que excluye al VIEWER (o es una excepción listada)", () => {
  const sinGuard: string[] = [];
  let revisadas = 0;
  for (const archivo of archivosUseServer) {
    const rel = relative(RAIZ, archivo).replace(/\\/g, "/");
    const todas = new Map(funciones(readFileSync(archivo, "utf8")).map((f) => [f.nombre, f]));
    for (const fn of todas.values()) {
      if (!fn.exportada) continue;
      revisadas++;
      if (`${rel}:${fn.nombre}` in EXCEPCIONES) continue;
      if (posicionDelGuard(fn, todas) < 0) sinGuard.push(`${rel}:${fn.nombre}`);
    }
  }
  assert.ok(revisadas >= 50, `se esperaban al menos 50 funciones exportadas y se revisaron ${revisadas}`);
  assert.deepEqual(sinGuard, [], `acciones sin guard (agregá requireEscritura o un guard conocido):\n${sinGuard.join("\n")}`);
});

test("el guard va ANTES de la primera consulta a la base (prisma.) de la propia función", () => {
  const tarde: string[] = [];
  for (const archivo of archivosUseServer) {
    const rel = relative(RAIZ, archivo).replace(/\\/g, "/");
    const todas = new Map(funciones(readFileSync(archivo, "utf8")).map((f) => [f.nombre, f]));
    for (const fn of todas.values()) {
      if (!fn.exportada || `${rel}:${fn.nombre}` in EXCEPCIONES) continue;
      const guard = posicionDelGuard(fn, todas);
      const prisma = sinComentarios(fn.cuerpo).search(/\bprisma\./);
      if (guard >= 0 && prisma >= 0 && prisma < guard) tarde.push(`${rel}:${fn.nombre}`);
    }
  }
  assert.deepEqual(tarde, [], `el guard viene después de tocar la base en:\n${tarde.join("\n")}`);
});

test("las excepciones listadas existen de verdad (no queda una excepción vieja que ya no corresponde)", () => {
  for (const clave of Object.keys(EXCEPCIONES)) {
    const [rel, nombre] = clave.split(":");
    const fuente = readFileSync(join(RAIZ, rel), "utf8");
    assert.ok(esArchivoUseServer(fuente), `${rel} ya no es un archivo use server`);
    assert.ok(funciones(fuente).some((f) => f.exportada && f.nombre === nombre), `${clave} no existe`);
  }
});

test("los guards 'débiles' (sin VIEWER) no se cuelan en la lista de guards", () => {
  for (const debil of ["requireUsuario", "requireUsuarioAlDia", "requireAccesoEmpresa"]) {
    assert.ok(!GUARDS_QUE_EXCLUYEN_VIEWER.includes(debil), `${debil} deja pasar al VIEWER, no puede contar como guard`);
  }
});

test("los guards 'compuestos' realmente llaman a requireEscritura o excluyen al VIEWER por su regla", () => {
  const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
  // requireCargaRealEmpresa y resolverEmpresaYPresupuesto delegan en requireEscritura.
  assert.match(sinComentarios(leer("lib/cargaRealEmpresa.ts")), /requireEscritura\(\s*await requireAccesoEmpresa/);
  assert.match(sinComentarios(leer("lib/presupuestoAcceso.ts")), /requireEscritura\(\s*await requireAccesoEmpresa/);
  // Los de Ejecución dependen de las reglas puras (probadas en permisosViewer.test.ts): operar nunca para VIEWER.
  assert.match(sinComentarios(leer("lib/permisosEjecucion.ts")), /if \(esViewer\(usuario\)\) return false;/);
  // Y el orden en resolverEmpresaYPresupuesto: el candado va antes de obtenerOCrearPresupuesto (que crea la fila del mes).
  const resolver = sinComentarios(leer("lib/presupuestoAcceso.ts"));
  assert.ok(resolver.indexOf("requireEscritura(") < resolver.indexOf("obtenerOCrearPresupuesto(empresa.id"));
});

// ---------------------------------------------------------------------------------------------------------------------
// Exports que el test no sabría revisar: un archivo "use server" solo puede exportar funciones async (Next lo exige),
// pero si alguien escribe `export const x = async () => ...`, `export default`, `export { a, b }` o un re-export, el
// recorrido de arriba (que solo ve `function nombre`) no lo vería y la acción quedaría sin revisar EN SILENCIO. Acá
// cualquier export de valor que no sea `export async function` hace fallar el test. `export type` e `interface` se
// borran al compilar y no son acciones, así que se aceptan.
function exportsNoReconocidos(fuente: string): string[] {
  const codigo = sinComentarios(fuente.replace(/\r\n/g, "\n"));
  const malos: string[] = [];
  const re = /^export\s+(?!async\s+function\b|type\b|interface\b)([^\n]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo))) malos.push(`export ${m[1].trim()}`.slice(0, 80));
  return malos;
}

test("ningún archivo 'use server' exporta algo que el test no reconoce como función async (export const/default/{…}/re-export)", () => {
  const malos: string[] = [];
  for (const archivo of archivosUseServer) {
    const rel = relative(RAIZ, archivo).replace(/\\/g, "/");
    for (const e of exportsNoReconocidos(readFileSync(archivo, "utf8"))) malos.push(`${rel}: ${e}`);
  }
  assert.deepEqual(malos, [], `exports sin revisar (usá "export async function" o ampliá este test):\n${malos.join("\n")}`);
});

test("exportsNoReconocidos detecta cada forma de export que se le puede escapar al recorrido", () => {
  for (const fuente of [
    "export const a = async () => {};",
    "export let b = 1;",
    "export default async function () {}",
    "export { c, d };",
    'export * from "./otro";',
    'export { e } from "./otro";',
    "export class F {}",
    "export function sincrona() {}",
  ]) {
    assert.equal(exportsNoReconocidos(fuente).length, 1, `no detectó: ${fuente}`);
  }
  for (const fuente of ["export async function ok() {}", "export type T = string;", "export interface I { a: 1 }", "const x = 1;"]) {
    assert.deepEqual(exportsNoReconocidos(fuente), [], `falso positivo: ${fuente}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Rutas (route.ts). Cada método exportado (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) tiene que:
//  1) pedir sesión/acceso con un guard conocido (GUARDS_DE_SESION_EN_RUTAS), y
//  2) excluir al VIEWER (un guard de GUARDS_QUE_EXCLUYEN_VIEWER o un `esViewer(` explícito), o figurar en
//     RUTAS_ABIERTAS_AL_VIEWER con el motivo. Un método que ESCRIBE (todo menos GET/HEAD/OPTIONS) nunca puede estar en esa lista.
const METODOS_HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const METODOS_DE_LECTURA = ["GET", "HEAD", "OPTIONS"];
const GUARDS_DE_SESION_EN_RUTAS = [
  ...GUARDS_QUE_EXCLUYEN_VIEWER,
  "requireUsuario",
  "requireUsuarioAlDia",
  "requireAccesoEmpresa",
  "obtenerUsuarioActual",
];
// "archivo:MÉTODO" -> motivo. El VIEWER descarga: (1) el Excel del Reporte, pero SIN los bloques reservados
// (sinBloquesReservados + verBloquesReservadosSiNoEsViewer, verificado por permisosViewer.test.ts); (2) los dos Excel del
// Historial de ejecución de su empresa (semana y todo el mes), idénticos a los de un gerente de esa empresa: solo sus
// unidades, sin saldo, sin reservados ni ocultas del gerente (verificado por excelEjecucionViewer.test.ts).
const RUTAS_ABIERTAS_AL_VIEWER: Record<string, string> = {
  "app/[empresa]/[periodo]/reporte/excel/route.ts:GET": "el Reporte es de solo lectura para el VIEWER; el Excel sale sin Disponibilidades ni Cierre",
  "app/[empresa]/[periodo]/ejecucion/[numeroSemana]/excel/route.ts:GET": "el Historial de ejecución de su empresa es de solo lectura para el VIEWER; el Excel sale igual que el del gerente",
  "app/[empresa]/[periodo]/ejecucion/mes/excel/route.ts:GET": "el Historial de ejecución de su empresa es de solo lectura para el VIEWER; el Excel sale igual que el del gerente",
};

const archivosRoute = todosLosArchivos.filter((f) => /[\\/]route\.(ts|tsx)$/.test(f));

type MetodoRuta = { nombre: string; cuerpo: string };

// Métodos exportados de una route. Las formas que no son `export async function METODO` (const, re-export, default,
// función no async o con otro nombre) se devuelven en `raros` y hacen fallar el test.
function metodosDeRuta(fuente: string): { metodos: MetodoRuta[]; raros: string[] } {
  const texto = sinComentarios(fuente.replace(/\r\n/g, "\n"));
  const raros: string[] = [];
  const hits: { nombre: string; ini: number }[] = [];
  const re = /^export\s+(?!type\b|interface\b)(?:(async\s+)?function\s+([A-Za-z0-9_]+)|([^\n]*))/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    if (m[2] && m[1] && METODOS_HTTP.includes(m[2])) hits.push({ nombre: m[2], ini: m.index });
    else if (m[2]) raros.push(`export ${m[1] ?? ""}function ${m[2]}`);
    else raros.push(`export ${(m[3] ?? "").trim()}`.slice(0, 80));
  }
  // Cuerpo = hasta el próximo export de nivel superior (o el final del archivo).
  const inicios = Array.from(texto.matchAll(/^export\s/gm)).map((x) => x.index ?? 0);
  const metodos = hits.map((h) => {
    const siguiente = inicios.find((i) => i > h.ini);
    return { nombre: h.nombre, cuerpo: texto.slice(h.ini, siguiente ?? texto.length) };
  });
  return { metodos, raros };
}

function llamaA(codigo: string, nombres: string[]): boolean {
  return nombres.some((n) => posicionDeLlamada(codigo, n) >= 0);
}

test("el recorrido encuentra los route.ts conocidos (si esto falla, el test de rutas no está mirando nada)", () => {
  const rel = archivosRoute.map((f) => relative(RAIZ, f).replace(/\\/g, "/"));
  assert.ok(rel.length >= 5, `se esperaban al menos 5 route.ts y hay ${rel.length}`);
  assert.ok(rel.includes("app/[empresa]/[periodo]/reporte/excel/route.ts"));
});

test("cada route.ts: solo exporta métodos HTTP async reconocibles (nada de export const GET, default, re-exports)", () => {
  const malos: string[] = [];
  for (const archivo of archivosRoute) {
    const rel = relative(RAIZ, archivo).replace(/\\/g, "/");
    const { metodos, raros } = metodosDeRuta(readFileSync(archivo, "utf8"));
    for (const r of raros) malos.push(`${rel}: ${r}`);
    if (metodos.length === 0) malos.push(`${rel}: no exporta ningún método HTTP reconocible`);
  }
  assert.deepEqual(malos, [], `routes sin revisar:\n${malos.join("\n")}`);
});

test("TODO método de un route.ts pide sesión con un guard conocido y excluye al VIEWER (o figura en la lista de rutas abiertas)", () => {
  const malos: string[] = [];
  for (const archivo of archivosRoute) {
    const rel = relative(RAIZ, archivo).replace(/\\/g, "/");
    for (const metodo of metodosDeRuta(readFileSync(archivo, "utf8")).metodos) {
      const clave = `${rel}:${metodo.nombre}`;
      if (!llamaA(metodo.cuerpo, GUARDS_DE_SESION_EN_RUTAS)) malos.push(`${clave}: sin guard de sesión`);
      const excluye = llamaA(metodo.cuerpo, [...GUARDS_QUE_EXCLUYEN_VIEWER, "esViewer"]);
      const abierta = clave in RUTAS_ABIERTAS_AL_VIEWER;
      if (!excluye && !abierta) malos.push(`${clave}: no excluye al VIEWER ni está en RUTAS_ABIERTAS_AL_VIEWER`);
      if (abierta && !METODOS_DE_LECTURA.includes(metodo.nombre)) malos.push(`${clave}: un método que escribe no puede estar abierto al VIEWER`);
    }
  }
  assert.deepEqual(malos, [], `routes con problemas:\n${malos.join("\n")}`);
});

test("las rutas abiertas al VIEWER existen de verdad (no queda una entrada vieja)", () => {
  for (const clave of Object.keys(RUTAS_ABIERTAS_AL_VIEWER)) {
    const [rel, metodo] = clave.split(":");
    const { metodos } = metodosDeRuta(readFileSync(join(RAIZ, rel), "utf8"));
    assert.ok(metodos.some((x) => x.nombre === metodo), `${clave} no existe`);
  }
});

test("metodosDeRuta: reconoce los métodos bien exportados y marca las formas que no puede revisar", () => {
  const ok = metodosDeRuta("export async function GET() { await requireUsuario(); }\nexport async function POST() {}");
  assert.deepEqual(ok.metodos.map((m) => m.nombre), ["GET", "POST"]);
  assert.deepEqual(ok.raros, []);
  for (const fuente of [
    "export const GET = async () => {};",
    "export default async function () {}",
    'export { GET } from "./otro";',
    "export function GET() {}",
  ]) {
    const r = metodosDeRuta(fuente);
    assert.ok(r.raros.length >= 1, `no marcó: ${fuente}`);
  }
});
