import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Rol } from "@prisma/client";
import { leerCasillaReservados } from "@/lib/usuarioDatos";

// Casilla «ve bloques reservados» (Usuario.veBloquesReservados): lo que NO se prueba en permisosViewer.test.ts —
// el alta y la edición de /admin/usuarios, la migración, el esquema y quién toca la columna. La tabla de verdad de la
// decisión (rol × casilla) está en permisosViewer.test.ts y el Reporte y el Excel de punta a punta en
// lib/reporte/__tests__/viewerBloquesReservados.test.ts.

const RAIZ = join(__dirname, "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const ROLES: Rol[] = ["ADMIN", "GERENTE", "FINANZAS", "VIEWER"];

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

// ---- El servidor decide el valor que se guarda ----------------------------------------------------------------

test("leerCasillaReservados: fuera del VIEWER siempre false, mande lo que mande el formulario (y aunque no mande nada)", () => {
  for (const rol of ROLES.filter((r) => r !== "VIEWER")) {
    const variantes: Record<string, string>[] = [
      {},
      { veBloquesReservados: "on" },
      { veBloquesReservadosIncluida: "1" },
      { veBloquesReservadosIncluida: "1", veBloquesReservados: "on" },
    ];
    for (const campos of variantes) {
      assert.equal(leerCasillaReservados(formulario(campos), rol), false, `${rol} ${JSON.stringify(campos)}`);
    }
  }
});

test("leerCasillaReservados: rol vacío o inventado tampoco la puede tener", () => {
  for (const rol of ["", "viewer", "SUPERADMIN", " VIEWER"]) {
    assert.equal(leerCasillaReservados(formulario({ veBloquesReservadosIncluida: "1", veBloquesReservados: "on" }), rol), false, JSON.stringify(rol));
  }
});

test("leerCasillaReservados: VIEWER sin la marca «incluida» no toca lo guardado (undefined), aunque venga la casilla", () => {
  assert.equal(leerCasillaReservados(formulario({}), "VIEWER"), undefined);
  assert.equal(leerCasillaReservados(formulario({ veBloquesReservados: "on" }), "VIEWER"), undefined);
  assert.equal(leerCasillaReservados(formulario({ veBloquesReservadosIncluida: "0", veBloquesReservados: "on" }), "VIEWER"), undefined);
});

test("leerCasillaReservados: VIEWER con la marca «incluida»: tildada = true, sin tildar = false", () => {
  assert.equal(leerCasillaReservados(formulario({ veBloquesReservadosIncluida: "1", veBloquesReservados: "on" }), "VIEWER"), true);
  assert.equal(leerCasillaReservados(formulario({ veBloquesReservadosIncluida: "1" }), "VIEWER"), false);
  // Solo «on» (lo que manda un checkbox) la prende: cualquier otro texto no.
  assert.equal(leerCasillaReservados(formulario({ veBloquesReservadosIncluida: "1", veBloquesReservados: "true" }), "VIEWER"), false);
});

// ---- /admin/usuarios: alta y edición ---------------------------------------------------------------------------

test("/admin/usuarios: alta y edición leen la casilla con leerCasillaReservados(formData, datos.rol) y solo la escriben si no es undefined", () => {
  const acciones = leer("app/admin/usuarios/actions.ts");
  assert.equal((acciones.match(/leerCasillaReservados\(formData, datos\.rol\)/g) ?? []).length, 2);
  assert.equal((acciones.match(/\.\.\.\(veBloquesReservados === undefined \? \{\} : \{ veBloquesReservados \}\)/g) ?? []).length, 2);
  // Ninguna de las dos lee el campo del formulario por su cuenta: todo pasa por la función con el rol.
  assert.doesNotMatch(acciones, /formData\.get\(["']veBloquesReservados/);
  // La acción que cambia el rol y la casilla es una sola transacción: no hay un momento con rol nuevo y casilla vieja.
  const edicion = acciones.slice(acciones.indexOf("export async function actualizarUsuario"), acciones.indexOf("export type ResultadoReset"));
  assert.match(edicion, /prisma\.\$transaction\(\[\s*prisma\.usuario\.update\(\{[\s\S]*?rol: datos\.rol as Rol,[\s\S]*?\.\.\.\(veBloquesReservados === undefined/);
  // Las dos acciones siguen detrás de requireAdmin (solo un ADMIN da la casilla; nadie se la da a sí mismo).
  assert.match(acciones.slice(acciones.indexOf("export async function crearUsuario")), /await requireAdmin\(\);/);
  assert.match(edicion, /await requireAdmin\(\);/);
});

test("/admin/usuarios: la casilla se muestra solo si el rol elegido es VIEWER y manda la marca «incluida»", () => {
  for (const rel of ["app/admin/usuarios/nuevo/NuevoUsuarioForm.tsx", "app/admin/usuarios/[id]/EditarUsuarioForm.tsx"]) {
    const f = leer(rel);
    const bloque = f.slice(f.indexOf('rol === "VIEWER" && (\n          <div>\n            <input type="hidden" name="veBloquesReservadosIncluida"'));
    assert.ok(f.includes('rol === "VIEWER" && (\n          <div>\n            <input type="hidden" name="veBloquesReservadosIncluida"'), rel);
    assert.match(bloque, /name="veBloquesReservadosIncluida" value="1"/, rel);
    assert.match(bloque, /type="checkbox" name="veBloquesReservados"/, rel);
    // el único checkbox con ese nombre está dentro de ese bloque condicional
    assert.equal((f.match(/name="veBloquesReservados"/g) ?? []).length, 1, rel);
  }
  // La edición parte del valor guardado; el alta, sin tildar.
  assert.match(leer("app/admin/usuarios/[id]/EditarUsuarioForm.tsx"), /name="veBloquesReservados" defaultChecked=\{usuario\.veBloquesReservados\}/);
  assert.match(leer("app/admin/usuarios/[id]/page.tsx"), /veBloquesReservados: usuario\.veBloquesReservados,/);
});

// ---- Quién conoce la columna -----------------------------------------------------------------------------------

function archivos(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next" || nombre === ".git" || nombre === "__tests__") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx|prisma|sql)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

test("la columna veBloquesReservados solo aparece en una lista cerrada de archivos (una referencia nueva obliga a clasificarla acá)", () => {
  const conTexto = [...archivos(join(RAIZ, "app")), ...archivos(join(RAIZ, "lib")), ...archivos(join(RAIZ, "components")), ...archivos(join(RAIZ, "prisma"))]
    .filter((f) => /\bveBloquesReservados\b/.test(readFileSync(f, "utf8")))
    .map((f) => relative(RAIZ, f).split(sep).join("/"))
    .sort();
  assert.deepEqual(conTexto, [
    "app/admin/usuarios/[id]/EditarUsuarioForm.tsx", // casilla (edición)
    "app/admin/usuarios/[id]/page.tsx", // pasa el valor guardado al formulario
    "app/admin/usuarios/actions.ts", // ÚNICO lugar que escribe la columna (junto con el alta)
    "app/admin/usuarios/nuevo/NuevoUsuarioForm.tsx", // casilla (alta)
    "app/admin/usuarios/page.tsx", // marca en el listado
    "lib/permisosViewer.ts", // la decisión
    "lib/usuarioDatos.ts", // lectura del formulario
    "prisma/migrations/20261119120000_usuario_ve_bloques_reservados/migration.sql",
    "prisma/schema.prisma",
  ]);
});

test("veBloquesReservadosDelReporte (la regla por rol) solo se llama desde donde se arma el Reporte, siempre dentro de bloquesReservadosDelUsuario", () => {
  const llamadores = [...archivos(join(RAIZ, "app")), ...archivos(join(RAIZ, "lib")), ...archivos(join(RAIZ, "components"))]
    .filter((f) => /veBloquesReservadosDelReporte\(/.test(readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, "")))
    .map((f) => relative(RAIZ, f).split(sep).join("/"))
    .sort();
  assert.deepEqual(llamadores, [
    "app/[empresa]/[periodo]/reporte/excel/route.ts",
    "app/[empresa]/[periodo]/reporte/page.tsx",
    "lib/permisosEjecucion.ts", // la definición
  ]);
});

// ---- Esquema y migración ---------------------------------------------------------------------------------------

test("esquema: Usuario.veBloquesReservados es Boolean con default false", () => {
  const schema = leer("prisma/schema.prisma");
  const usuario = schema.slice(schema.indexOf("model Usuario {"), schema.indexOf("}", schema.indexOf("model Usuario {")));
  assert.match(usuario, /^\s*veBloquesReservados\s+Boolean\s+@default\(false\)\s*$/m);
});

test("migración: posterior a rol_viewer, aditiva (una sola columna con default false) y sin tocar filas", () => {
  const dirs = readdirSync(join(RAIZ, "prisma", "migrations")).filter((d) => /^\d{14}_/.test(d)).sort();
  const nombre = dirs.find((d) => d.endsWith("_usuario_ve_bloques_reservados"));
  assert.ok(nombre, "falta la carpeta de la migración");
  assert.ok(nombre! > "20261118130000_rol_viewer", "tiene que ser posterior a 20261118130000_rol_viewer");
  assert.equal(dirs.filter((d) => d.endsWith("_usuario_ve_bloques_reservados")).length, 1);
  const sql = leer(`prisma/migrations/${nombre}/migration.sql`);
  const sentencias = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join(" ")
    .split(";")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  assert.deepEqual(sentencias, ['ALTER TABLE "Usuario" ADD COLUMN "veBloquesReservados" BOOLEAN NOT NULL DEFAULT false']);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ""), /\b(DROP|UPDATE|DELETE|INSERT|TRUNCATE|ALTER TYPE|CREATE INDEX)\b/i);
});
