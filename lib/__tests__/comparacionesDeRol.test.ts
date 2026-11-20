import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Rol } from "@prisma/client";
import { clasificacionesOcultasParaUsuario } from "@/lib/clasificacionesOcultas";
import { puedeClasificarEnEmpresa } from "@/lib/clasificarPorEmpresa";
import { puedeConfirmarComoGerente, puedeConfirmarEnNombreDelGerente } from "@/lib/confirmacionFinal";
import { puedeCargarRealConAcceso } from "@/lib/permisosReal";
import { puedeCargarTipoCambio } from "@/lib/tipoCambio";
import { puedeCerrarEjecucion, puedeCargarMadreEjecucion, puedeOperarEjecucionGlobal, veTodoEjecucion } from "@/lib/permisosEjecucion";

// INVENTARIO de las comparaciones sobre el rol del usuario (app, lib, components, prisma/seed.ts), clasificadas para un
// VIEWER: CIERRA (le deniega) o ABRE (le da un permiso). Hoy NINGUNA abre. El test cuenta, por archivo, cuántas veces
// aparece un rol escrito como texto ("ADMIN", "FINANZAS", "GERENTE", "VIEWER", fuera de los <option> y los tests): si
// alguien agrega una comparación nueva (o un archivo nuevo con una), el conteo cambia y el test falla hasta que esa
// comparación se clasifique acá, a la vista. No detecta una comparación sin literal (por ejemplo `rol === otroRol`),
// pero esas no existen hoy (ver la nota de cada archivo).
//
// "cierra" = un VIEWER NO obtiene el permiso. "abre" = un VIEWER lo obtendría (no se admite hoy).
// "neutra" = no decide ningún permiso (texto, valor de un formulario, alta de datos).
type Clase = "cierra" | "neutra";
const INVENTARIO: Record<string, { cantidad: number; clase: Clase; nota: string }> = {
  "app/[empresa]/[periodo]/presupuesto/actions.ts": { cantidad: 1, clase: "neutra", nota: 'modo: "GERENTE" es el MODO de confirmación, no el rol del usuario' },
  "app/admin/usuarios/[id]/EditarUsuarioForm.tsx": { cantidad: 4, clase: "neutra", nota: "UI del formulario de admin (oculta casillas, y muestra la de «ve bloques reservados» solo si el rol elegido es VIEWER); el servidor decide (lib/usuarioDatos.ts: leerCasillaReservados fuerza false fuera del VIEWER), y /admin/usuarios es solo ADMIN" },
  "app/admin/usuarios/actions.ts": { cantidad: 5, clase: "cierra", nota: "ROLES_VALIDOS (incluye VIEWER) y ramas por rol del alta/edición; requireAdmin; el VIEWER recibe permisos forzados en false" },
  "app/admin/usuarios/layout.tsx": { cantidad: 1, clase: "cierra", nota: "rol !== ADMIN => panel de sin permiso" },
  "app/admin/usuarios/nuevo/NuevoUsuarioForm.tsx": { cantidad: 3, clase: "neutra", nota: "UI del formulario de admin (la casilla de «ve bloques reservados» se muestra solo con el rol VIEWER; el servidor la fuerza a false si no lo es)" },
  "app/admin/usuarios/page.tsx": { cantidad: 2, clase: "neutra", nota: "muestra el rol en la lista (solo ADMIN llega) y la marca «ve reservados» solo en un VIEWER; no decide ningún permiso" },
  "app/page.tsx": { cantidad: 4, clase: "cierra", nota: "home: lo de ADMIN/FINANZAS (admin, ejecución global) no le aparece al VIEWER; ve solo sus empresas con el Reporte" },
  "lib/auth.ts": { cantidad: 4, clase: "cierra", nota: "puedeAccederEmpresa y puedeRevisarPresupuesto (ADMIN), requireAdmin, esAdminOFinanzas: el VIEWER no es ADMIN ni FINANZAS. puedeRevisarPresupuesto mira la casilla de la fila para no-ADMIN: se cubre porque quien lo llama pasa antes por requireEscritura o por soloLectura" },
  "lib/cargaRealEmpresa.ts": { cantidad: 1, clase: "cierra", nota: "rol !== GERENTE => false; y requireCargaRealEmpresa llama a requireEscritura" },
  "lib/clasificacionesOcultas.ts": { cantidad: 1, clase: "cierra", nota: "CORREGIDA: antes un VIEWER con operaEjecucion=true en la base veía todo; ahora esViewer va primero y ve lo mismo que un gerente" },
  "lib/clasificarPorEmpresa.ts": { cantidad: 1, clase: "cierra", nota: "solo GERENTE con la casilla" },
  "lib/confirmacionFinal.ts": { cantidad: 5, clase: "cierra", nota: "confirmar como gerente = GERENTE; en nombre = ADMIN o FINANZAS revisor (los 'GERENTE' restantes son el modo, no el rol)" },
  "lib/permisosReapertura.ts": { cantidad: 1, clase: "cierra", nota: "reabrir una semana cerrada y ver sus reaperturas: SOLO ADMIN (el VIEWER no es ADMIN); el servidor exige requireAdmin" },
  "lib/permisosEjecucion.ts": { cantidad: 3, clase: "cierra", nota: "ADMIN/FINANZAS por rol; operar y ver todo: esViewer primero" },
  "lib/permisosReal.ts": { cantidad: 2, clase: "cierra", nota: "ADMIN/FINANZAS o GERENTE con la casilla" },
  "lib/permisosViewer.ts": { cantidad: 1, clase: "cierra", nota: "esViewer: la definición" },
  "lib/tipoCambio.ts": { cantidad: 1, clase: "cierra", nota: "solo ADMIN y FINANZAS" },
  "prisma/seed.ts": { cantidad: 1, clase: "neutra", nota: "alta del usuario administrador inicial" },
};

const RAIZ = join(__dirname, "..", "..");

function archivos(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === ".next" || nombre === ".git" || nombre === "__tests__") continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

function contarLiterales(): Record<string, number> {
  const cuenta: Record<string, number> = {};
  const todos = [...archivos(join(RAIZ, "app")), ...archivos(join(RAIZ, "lib")), ...archivos(join(RAIZ, "components")), join(RAIZ, "prisma", "seed.ts")];
  for (const archivo of todos) {
    const lineas = readFileSync(archivo, "utf8").split(/\r?\n/);
    let n = 0;
    for (const linea of lineas) {
      if (/^\s*(\/\/|\*|\/\*)/.test(linea) || /<option/.test(linea)) continue;
      n += (linea.match(/["'](ADMIN|FINANZAS|GERENTE|VIEWER)["']/g) ?? []).length > 0 ? 1 : 0;
    }
    if (n > 0) cuenta[relative(RAIZ, archivo).replace(/\\/g, "/")] = n;
  }
  return cuenta;
}

test("inventario de comparaciones de rol: ninguna nueva sin clasificar para el VIEWER (si falla, clasificá el sitio nuevo en INVENTARIO)", () => {
  const real = contarLiterales();
  const esperado = Object.fromEntries(Object.entries(INVENTARIO).map(([k, v]) => [k, v.cantidad]));
  assert.deepEqual(real, esperado, "cambió la cantidad de líneas con un rol escrito: revisá si el sitio nuevo ABRE algo para un VIEWER y sumalo a INVENTARIO");
});

test("el inventario no admite sitios que abran: todos son 'cierra' o 'neutra'", () => {
  for (const [archivo, e] of Object.entries(INVENTARIO)) {
    assert.ok(e.clase === "cierra" || e.clase === "neutra", `${archivo}: clase inválida`);
    assert.ok(e.nota.length > 10, `${archivo}: falta la nota`);
  }
});

test("lectura de usuario.rol pasada como dato (sin comparar en el lugar): los sitios conocidos y su destino", () => {
  // usuario.rol se pasa a funciones puras que SÍ comparan (todas en INVENTARIO). Si aparece un uso nuevo, hay que mirarlo.
  const patron = /\.usuario\.rol\b|\busuario\.rol\b(?!\s*(===|!==))/;
  const usos: string[] = [];
  for (const archivo of [...archivos(join(RAIZ, "app")), ...archivos(join(RAIZ, "lib"))]) {
    const lineas = readFileSync(archivo, "utf8").split(/\r?\n/);
    lineas.forEach((linea) => {
      if (/^\s*(\/\/|\*)/.test(linea)) return;
      if (patron.test(linea)) usos.push(relative(RAIZ, archivo).replace(/\\/g, "/"));
    });
  }
  assert.deepEqual(usos.sort(), [
    "app/[empresa]/[periodo]/presupuesto/actions.ts", // puedeConfirmarComoGerente(usuario.rol)
    "app/[empresa]/[periodo]/presupuesto/actions.ts", // puedeConfirmarEnNombreDelGerente(usuario.rol, esRevisor)
    "app/[empresa]/[periodo]/reporte/page.tsx", // obtenerEstadoFlujo(..., usuario.rol)
    "app/admin/usuarios/[id]/EditarUsuarioForm.tsx", // useState(usuario.rol): valor inicial del select (admin)
    "app/admin/usuarios/[id]/page.tsx", // rol: usuario.rol (solo para mostrar en el formulario)
    "app/admin/usuarios/page.tsx", // {usuario.rol} (texto)
    "lib/confirmacionFinal.ts", // e.usuario.rol => puedeConfirmarComoGerente (probada arriba: VIEWER false)
    "lib/confirmacionFinal.ts", // e.usuario.rol => puedeConfirmarEnNombreDelGerente (probada arriba: VIEWER false)
    "lib/reporte/contextoExcelReporte.ts", // obtenerEstadoFlujo(..., usuario.rol)
  ]);
});

const ROLES: Rol[] = ["ADMIN", "FINANZAS", "GERENTE", "VIEWER"];
const BOOLS = [false, true];

test("VIEWER con TODAS las casillas en true: ninguna regla pura de rol le da un permiso", () => {
  for (const operaEjecucion of BOOLS) {
    const v = { rol: "VIEWER" as Rol, operaEjecucion };
    const conAcceso = { puedeOperarEjecucion: true };
    assert.equal(puedeOperarEjecucionGlobal(v), false);
    assert.equal(veTodoEjecucion(v), false, "ver todo Ejecución: por ROL, no solo por la casilla");
    assert.equal(puedeCerrarEjecucion(v), false);
    assert.equal(puedeCargarMadreEjecucion(v), false);
    assert.equal(puedeCargarTipoCambio(v), false);
    assert.equal(puedeClasificarEnEmpresa(v, conAcceso), false);
    assert.equal(puedeCargarRealConAcceso(v, conAcceso), false);
    assert.equal(puedeConfirmarComoGerente(v.rol), false);
    for (const esRevisor of BOOLS) assert.equal(puedeConfirmarEnNombreDelGerente(v.rol, esRevisor), false);
  }
});

test("clasificacionesOcultasParaUsuario: un VIEWER con operaEjecucion=true en la base NO ve lo oculto (corregido); el resto, como antes", () => {
  const mapa = { conexion: ["AVION", "MS"] };
  const ocultas = (rol: Rol, operaEjecucion: boolean) => clasificacionesOcultasParaUsuario("conexion", { rol, operaEjecucion }, mapa);
  for (const operaEjecucion of BOOLS) {
    assert.deepEqual(ocultas("VIEWER", operaEjecucion), ["AVION", "MS"], `VIEWER opera=${operaEjecucion}`);
    assert.deepEqual(ocultas("ADMIN", operaEjecucion), []);
    assert.deepEqual(ocultas("FINANZAS", operaEjecucion), []);
  }
  assert.deepEqual(ocultas("GERENTE", true), [], "quien opera (Flavia) ve todo, como siempre");
  assert.deepEqual(ocultas("GERENTE", false), ["AVION", "MS"]);
});

test("las guardas de auth.ts de Ejecución usan las reglas por rol (no la casilla sola)", () => {
  const auth = readFileSync(join(RAIZ, "lib", "auth.ts"), "utf8");
  assert.match(auth, /requireVerEjecucionGlobal[\s\S]*?veTodoEjecucion\(usuario\)/);
  assert.match(auth, /requireOperadorEjecucionGlobal[\s\S]*?puedeOperarEjecucionGlobal\(usuario\)/);
  assert.match(auth, /requireCierreEjecucion[\s\S]*?puedeCerrarEjecucion\(usuario\)/);
  assert.match(auth, /requireCargaMadreEjecucion[\s\S]*?puedeCargarMadreEjecucion\(usuario\)/);
  // Y las reglas puras no leen operaEjecucion sin pasar antes por el rol.
  const reglas = readFileSync(join(RAIZ, "lib", "permisosEjecucion.ts"), "utf8");
  assert.match(reglas, /puedeOperarEjecucionGlobal[\s\S]*?if \(esViewer\(usuario\)\) return false;[\s\S]*?usuario\.operaEjecucion/);
});

test("todos los roles están en la matriz de pruebas (si se agrega un rol al enum, este test obliga a mirarlo)", () => {
  const schema = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
  const bloque = /enum Rol \{([^}]*)\}/.exec(schema)?.[1] ?? "";
  const enEnum = bloque.split(/\s+/).filter((x) => /^[A-Z_]+$/.test(x)).sort();
  assert.deepEqual(enEnum, [...ROLES].sort());
});

test("puedeRevisarPresupuesto: un VIEWER nunca revisa, y la respuesta sale ANTES de consultar la base (sin tocar la fila de UsuarioEmpresa)", async () => {
  const { puedeRevisarPresupuesto } = await import("@/lib/auth");
  // Si llegara a consultar la base, este test fallaría o colgaría: el VIEWER tiene que salir con false sin ir a prisma.
  const viewer = { id: "u-viewer", rol: "VIEWER" } as unknown as Parameters<typeof puedeRevisarPresupuesto>[0];
  assert.equal(await puedeRevisarPresupuesto(viewer, "empresa-1"), false);
  const admin = { id: "u-admin", rol: "ADMIN" } as unknown as Parameters<typeof puedeRevisarPresupuesto>[0];
  assert.equal(await puedeRevisarPresupuesto(admin, "empresa-1"), true, "ADMIN sigue revisando sin mirar la base");
  const fuente = readFileSync(join(RAIZ, "lib", "auth.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.match(fuente, /export async function puedeRevisarPresupuesto[^\n]*\n  if \(esViewer\(usuario\)\) return false;\n  if \(usuario\.rol === "ADMIN"\) return true;/);
});
