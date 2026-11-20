import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Test ESTÁTICO (lee el código fuente; no ejecuta nada ni toca la base) de lib/dashboard: el alcance es la única puerta a
// los datos. Si agregás una función que consulta la base sin recibir un Alcance, o un archivo nuevo que toca la base, este
// test falla y obliga a decidirlo a la vista. Los chequeos tienen su propia prueba con fuentes de ejemplo (más abajo) para
// que un analizador que no encuentra nada no pase en silencio.

const RAIZ = join(__dirname, "..", "..", "..");
const DIR = join(RAIZ, "lib", "dashboard");

function archivosFuente(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "__tests__") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosFuente(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

function archivosDe(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next" || nombre === ".git") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosDe(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

const rel = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");
const leer = (ruta: string) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
// Sin comentarios, para que el texto de una explicación no cuente como código.
const sinComentarios = (fuente: string) => fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

type Funcion = { nombre: string; parametros: string; cuerpo: string };

// Funciones exportadas de nivel superior: su lista de parámetros (con paréntesis balanceados) y su cuerpo hasta la próxima
// declaración de nivel superior.
function funcionesExportadas(fuente: string): Funcion[] {
  const texto = sinComentarios(fuente);
  const re = /^export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>\n]*>)?\s*\(/gm;
  const inicios: { nombre: string; desde: number; abre: number }[] = [];
  for (let m = re.exec(texto); m; m = re.exec(texto)) inicios.push({ nombre: m[1], desde: m.index, abre: m.index + m[0].length - 1 });
  return inicios.map((f, i) => {
    let nivel = 0;
    let cierra = f.abre;
    for (; cierra < texto.length; cierra++) {
      if (texto[cierra] === "(") nivel++;
      else if (texto[cierra] === ")" && --nivel === 0) break;
    }
    const hasta = i + 1 < inicios.length ? inicios[i + 1].desde : texto.length;
    return { nombre: f.nombre, parametros: texto.slice(f.abre + 1, cierra), cuerpo: texto.slice(cierra, hasta) };
  });
}

const primerParametro = (parametros: string) => {
  let nivel = 0;
  for (let i = 0; i < parametros.length; i++) {
    const c = parametros[i];
    if ("([{<".includes(c)) nivel++;
    else if (")]}>".includes(c)) nivel--;
    else if (c === "," && nivel === 0) return parametros.slice(0, i).trim();
  }
  return parametros.trim();
};

const importaPrisma = (fuente: string) => /from\s+["']@\/lib\/prisma["']/.test(fuente);

// Excepciones: funciones exportadas de un archivo que importa Prisma y que NO reciben un Alcance. "archivo:función" -> motivo.
const EXCEPCIONES: Record<string, string> = {
  "lib/dashboard/alcance.ts:exigirAlcance": "solo valida el objeto, no consulta nada",
  "lib/dashboard/alcance.ts:resolverAlcance": "ES el resolvedor: recibe el usuario de la sesión y devuelve el Alcance",
  "lib/dashboard/alcance.ts:resolverAlcanceDeSesion": "ES el resolvedor de la sesión: no recibe ningún dato del navegador",
};

// Devuelve los problemas de una fuente que importa Prisma: toda función exportada tiene que recibir un Alcance como PRIMER
// parámetro y validarlo (exigirAlcance) antes de cualquier acceso a la base.
export function problemasDeConsulta(archivo: string, fuente: string, excepciones: Record<string, string> = EXCEPCIONES): string[] {
  const problemas: string[] = [];
  for (const f of funcionesExportadas(fuente)) {
    if (`${archivo}:${f.nombre}` in excepciones) continue;
    if (!/^\w+\s*:\s*Alcance$/.test(primerParametro(f.parametros))) {
      problemas.push(`${archivo}:${f.nombre} no recibe un Alcance como primer parámetro`);
      continue;
    }
    const iValida = f.cuerpo.indexOf("exigirAlcance(");
    const iBase = f.cuerpo.search(/\bprisma\b|\$queryRaw|\$executeRaw/);
    if (iValida === -1) problemas.push(`${archivo}:${f.nombre} no llama a exigirAlcance`);
    else if (iBase !== -1 && iBase < iValida) problemas.push(`${archivo}:${f.nombre} toca la base ANTES de exigirAlcance`);
  }
  return problemas;
}

// ---- Las pruebas del analizador ---------------------------------------------------------------------------------

test("el analizador: acepta una consulta correcta y detecta las tres formas de saltearse el Alcance", () => {
  const bien = `import { prisma } from "@/lib/prisma";
export async function leer(alcance: Alcance, rango: { desde: string }): Promise<number[]> {
  exigirAlcance(alcance);
  return prisma.$queryRaw\`SELECT 1\`;
}`;
  assert.deepEqual(problemasDeConsulta("x.ts", bien), []);

  const sinAlcance = `import { prisma } from "@/lib/prisma";
export async function leer(unidades: string[]) { return prisma.$queryRaw\`SELECT 1\`; }`;
  assert.match(problemasDeConsulta("x.ts", sinAlcance).join(" "), /no recibe un Alcance/);

  const sinValidar = `import { prisma } from "@/lib/prisma";
export async function leer(alcance: Alcance) { return prisma.$queryRaw\`SELECT 1\`; }`;
  assert.match(problemasDeConsulta("x.ts", sinValidar).join(" "), /no llama a exigirAlcance/);

  const validaTarde = `import { prisma } from "@/lib/prisma";
export async function leer(alcance: Alcance) { await prisma.$queryRaw\`SELECT 1\`; exigirAlcance(alcance); }`;
  assert.match(problemasDeConsulta("x.ts", validaTarde).join(" "), /ANTES de exigirAlcance/);

  const alcanceNoPrimero = `import { prisma } from "@/lib/prisma";
export async function leer(rango: string, alcance: Alcance) { exigirAlcance(alcance); return prisma.$queryRaw\`SELECT 1\`; }`;
  assert.match(problemasDeConsulta("x.ts", alcanceNoPrimero).join(" "), /primer parámetro/);

  // un Alcance mencionado en un comentario no cuenta
  const enComentario = `import { prisma } from "@/lib/prisma";
// recibe un alcance: Alcance
export async function leer(unidades: readonly string[]) { return prisma.$queryRaw\`SELECT 1\`; }`;
  assert.match(problemasDeConsulta("x.ts", enComentario).join(" "), /no recibe un Alcance/);
});

test("el analizador encuentra las funciones exportadas reales (si no encontrara ninguna, los chequeos de abajo no probarían nada)", () => {
  const consultas = funcionesExportadas(leer(join(DIR, "consultas.ts"))).map((f) => f.nombre);
  assert.deepEqual(consultas, ["leerMovimientosPorSemana", "leerControlDepositosDeCheques"]);
  const alcance = funcionesExportadas(leer(join(DIR, "alcance.ts"))).map((f) => f.nombre).sort();
  assert.deepEqual(alcance, ["exigirAlcance", "resolverAlcance", "resolverAlcanceDeSesion"]);
});

// ---- El código real de lib/dashboard ---------------------------------------------------------------------------------

const FUENTES = archivosFuente(DIR);

test("toda función exportada de lib/dashboard que vive en un archivo con acceso a la base recibe un Alcance y lo valida antes de consultar", () => {
  const problemas = FUENTES.filter((f) => importaPrisma(leer(f))).flatMap((f) => problemasDeConsulta(rel(f), leer(f)));
  assert.deepEqual(problemas, []);
});

test("solo alcance.ts, consultas.ts y consultasMes.ts importan Prisma: un archivo nuevo con acceso a la base se agrega acá, a la vista", () => {
  const conPrisma = FUENTES.filter((f) => importaPrisma(leer(f))).map(rel).sort();
  assert.deepEqual(conPrisma, ["lib/dashboard/alcance.ts", "lib/dashboard/consultas.ts", "lib/dashboard/consultasMes.ts"]);
  for (const f of FUENTES.filter((x) => !importaPrisma(leer(x)))) {
    assert.doesNotMatch(sinComentarios(leer(f)), /\$queryRaw|\$executeRaw|\bprisma\./, `${rel(f)} toca la base sin importarla`);
  }
});

test("las excepciones son exactamente las del resolvedor y existen (ninguna quedó huérfana)", () => {
  const reales = new Set(
    FUENTES.filter((f) => importaPrisma(leer(f))).flatMap((f) => funcionesExportadas(leer(f)).map((fn) => `${rel(f)}:${fn.nombre}`))
  );
  for (const clave of Object.keys(EXCEPCIONES)) assert.ok(reales.has(clave), `la excepción ${clave} ya no existe`);
});

test("SQL solo con parámetros: ni $queryRawUnsafe ni $executeRawUnsafe, ni armado de SQL con texto", () => {
  for (const f of FUENTES) {
    const codigo = sinComentarios(leer(f));
    assert.doesNotMatch(codigo, /Unsafe\s*\(/, rel(f));
    assert.doesNotMatch(codigo, /Prisma\.raw\(|Prisma\.sql`/, rel(f));
  }
});

// Funciones que reciben una lista de textos de unidades PERO no filtran ni consultan nada: solo normalizan texto. "archivo:función" -> motivo.
const LISTAS_SUELTAS_PERMITIDAS: Record<string, string> = {
  "lib/dashboard/unidades.ts:unidadesNormalizadas": "normaliza texto (mayúsculas, espacios, repetidas); no filtra datos ni crea un Alcance",
};

test("ninguna función exportada recibe una lista suelta de unidades ni de empresas: solo un Alcance", () => {
  const suelta = /\b(unidades|unidadesNegocio|empresaIds|empresas|slugs)\s*\??\s*:\s*(readonly\s+)?(string\[\]|Array<string>|ReadonlyArray<string>)/;
  const vistas = new Set<string>();
  for (const f of FUENTES) {
    for (const fn of funcionesExportadas(leer(f))) {
      const clave = `${rel(f)}:${fn.nombre}`;
      if (clave in LISTAS_SUELTAS_PERMITIDAS) {
        vistas.add(clave);
        assert.match(fn.parametros, suelta, `${clave}: ya no recibe una lista suelta, sacala de la lista de permitidas`);
        continue;
      }
      assert.doesNotMatch(fn.parametros, suelta, clave);
    }
  }
  assert.deepEqual([...vistas].sort(), Object.keys(LISTAS_SUELTAS_PERMITIDAS).sort());
});

test("las funciones que normalizan listas de unidades no consultan la base ni reciben ni devuelven un Alcance", () => {
  const unidades = leer(join(DIR, "unidades.ts"));
  assert.ok(!importaPrisma(unidades));
  assert.doesNotMatch(sinComentarios(unidades), /\bAlcance\b/);
});

test("el Alcance se crea solo en alcance.ts: nadie más lo fabrica con un cast ni toca el registro", () => {
  for (const f of FUENTES.filter((x) => rel(x) !== "lib/dashboard/alcance.ts")) {
    const codigo = sinComentarios(leer(f));
    assert.doesNotMatch(codigo, /\bas\s+(unknown\s+as\s+)?Alcance\b/, rel(f));
    assert.doesNotMatch(codigo, /\bconstruirAlcance\b|\bCREADOS\b|\bmarcaAlcance\b/, rel(f));
  }
  // y el registro no se exporta
  const alcance = sinComentarios(leer(join(DIR, "alcance.ts")));
  assert.doesNotMatch(alcance, /export\s+(const|let|var)\s+CREADOS|export\s*\{[^}]*\bCREADOS\b/);
  assert.doesNotMatch(alcance, /export\s+(async\s+)?function\s+construirAlcance/);
  assert.doesNotMatch(alcance, /export\s+declare\s+const\s+marcaAlcance/);
});

test("el resolvedor lo llaman solo alcance.ts (la sesión) y los tests: ninguna pantalla, ruta ni acción lo invoca con un usuario propio", () => {
  const llamadores = [...archivosDe(join(RAIZ, "app")), ...archivosDe(join(RAIZ, "lib")), ...archivosDe(join(RAIZ, "components"))]
    .filter((f) => !f.includes(`${sep}__tests__${sep}`))
    .filter((f) => /\bresolverAlcance\s*\(/.test(sinComentarios(leer(f))))
    .map(rel)
    .sort();
  assert.deepEqual(llamadores, ["lib/dashboard/alcance.ts"]);
});

test("el resolvedor no tiene otro parámetro de entrada que el usuario (y el lector, solo para pruebas)", () => {
  const fns = funcionesExportadas(leer(join(DIR, "alcance.ts")));
  const resolver = fns.find((f) => f.nombre === "resolverAlcance")!;
  assert.match(resolver.parametros, /^\s*usuario:\s*UsuarioParaAlcance,\s*lector:\s*LectorDeEmpresas\s*=\s*LECTOR_PRISMA\s*$/);
  const sesion = fns.find((f) => f.nombre === "resolverAlcanceDeSesion")!;
  assert.equal(sesion.parametros.trim(), "");
  assert.match(sesion.cuerpo, /requireUsuarioAlDia\(\)/);
});

test("el dashboard nunca expone la cantidad de empresas ni de unidades del alcance (no hay .length ni .size de empresas)", () => {
  for (const f of FUENTES) {
    assert.doesNotMatch(sinComentarios(leer(f)), /\bempresas\.(length|size)\b|\bcantidadDeEmpresas\b|\bempresas\.reduce\(\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>\s*\w+\s*\+\s*1/, rel(f));
  }
});

test("cada consulta de datos aplica el filtro de unidad y de prorrateo en las dos ramas, y excluye ignorados", () => {
  const fuente = leer(join(DIR, "consultas.ts"));
  // Una consulta por función exportada: cada una con su propio SQL de movimientos.
  const funciones = fuente.split(/^export async function /m).slice(1);
  assert.equal(funciones.length, 2, "se esperan las dos consultas de movimientos (por semana y control de depósitos)");
  for (const sql of funciones) {
    const nombre = sql.slice(0, sql.indexOf("("));
    assert.equal((sql.match(/upper\(btrim\(m\."unidadNegocio"\)\) = ANY\(\$\{unidades\}::text\[\]\)/g) ?? []).length, 1, nombre);
    assert.equal((sql.match(/upper\(btrim\(d\."unidadNegocio"\)\) = ANY\(\$\{unidades\}::text\[\]\)/g) ?? []).length, 1, nombre);
    assert.match(sql, /NOT EXISTS \(SELECT 1 FROM "MovimientoBancarioDesglose" d WHERE d\."movimientoId" = m\.id\)/, nombre);
    assert.match(sql, /JOIN "MovimientoBancarioDesglose" d ON d\."movimientoId" = m\.id/, nombre);
    assert.match(sql, /WHERE NOT mb\.ignorado/, nombre);
    // ninguna rama de la consulta final lee los movimientos sin filtrar por unidad
    assert.doesNotMatch(sql, /FROM mov m\s*\n\s*(UNION|\)\s*x)/, nombre);
    // las unidades salen del Alcance validado, no de otro lado
    assert.match(sql, /const unidades = \[\.\.\.alcance\.unidades\];/, nombre);
  }
});

test("lib/auth.ts no se toca desde lib/dashboard: solo alcance.ts lo importa (para la sesión) y solo requireUsuarioAlDia", () => {
  for (const f of FUENTES) {
    const importa = /from\s+["']@\/lib\/auth["']/.test(leer(f));
    assert.equal(importa, rel(f) === "lib/dashboard/alcance.ts", rel(f));
  }
  const auth = leer(join(DIR, "alcance.ts")).match(/import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/auth["']/)?.[1].trim();
  assert.equal(auth, "requireUsuarioAlDia");
});
