import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  EMPRESAS_CON_FILAS_EXTRA,
  EMPRESAS_CON_TIPEO_DIRECTO,
} from "@/lib/config";
import { armarReporte, clavesCalculables, validarPlantilla, type DatosMes, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { categoriasSinFila, esFilaManualEditable, planDeCarga, vistaDeCarga } from "@/lib/reporte/cargaGerente";
import {
  admiteFilasExtra,
  claveDeFilaExtra,
  conFilasExtra,
  esClaveDeFilaExtra,
  extrasVisibles,
  normalizarNombreFila,
  validarNombreFila,
  type FilaExtra,
} from "@/lib/reporte/filasExtra";
import { plantillaDeEmpresaConExtras, type LectorFilasExtra } from "@/lib/reporte/plantillaConExtras";
import { mesesDePrueba } from "@/lib/reporte/__tests__/fixtures/datosGerente";
import { CON_FILAS_EXTRA_HOY } from "./filasExtraEmpresasLista";

// Tanda 1 de las filas extra del Reporte: modelo + migración, funciones puras, resolver y la lectura de
// manuales. Todavía sin pantalla, sin acciones nuevas y con el interruptor apagado.

const SLUGS = Object.keys(PLANTILLAS_POR_SLUG);
const BRILLANTE = PLANTILLAS_POR_SLUG["brillante"];

const ING: FilaExtra = { id: "i1", bloque: "INGRESOS", nombre: "PRÉSTAMO COCOS", desdePeriodo: "2026-10", hastaPeriodo: null };
const EGR: FilaExtra = { id: "e1", bloque: "EGRESOS", nombre: "PAGOS ESPECIALES", desdePeriodo: "2026-10", hastaPeriodo: null };
const ABA: FilaExtra = { id: "a1", bloque: "ABAJO", nombre: "RETIRO SOCIOS", desdePeriodo: "2026-10", hastaPeriodo: null };
const TRES = [ING, EGR, ABA];

const leer = (extras: FilaExtra[]): LectorFilasExtra => async () => extras;
const noDebeLeer: LectorFilasExtra = async () => {
  throw new Error("no debería consultar la base");
};

// ---- Nombres ---------------------------------------------------------------------------------------

test("normalizarNombreFila: trim, espacios colapsados y mayúsculas", () => {
  assert.equal(normalizarNombreFila("  préstamo   cocos \t"), "PRÉSTAMO COCOS");
  assert.equal(normalizarNombreFila("a\n b"), "A B");
});

test("nombre válido: se guarda normalizado y con su clave sin tildes", () => {
  const r = validarNombreFila("  préstamo  cocos ", BRILLANTE, []);
  assert.deepEqual(r, { ok: true, nombre: "PRÉSTAMO COCOS", nombreClave: "PRESTAMO COCOS" });
});

test("nombres genéricos sueltos: OTRO, OTROS y VARIOS se rechazan, con cualquier forma", () => {
  for (const t of ["otro", "OTROS", " Varios ", "otros.", "Varios!", "O T R O S".replace(/ /g, "")]) {
    const r = validarNombreFila(t, BRILLANTE, []);
    assert.equal(r.ok, false, t);
  }
  // …pero con explicación sí.
  assert.equal(validarNombreFila("Otros gastos de viaje", BRILLANTE, []).ok, true);
});

test("se rechaza el nombre de una FILA que ya existe en la empresa (estática), sin tildes ni mayúsculas", () => {
  for (const t of ["Sueldos", "SUELDOS", " sueldos ", "Gastos Bancarios", "expensas", "Total ingresos", "Resultado FCI"]) {
    const r = validarNombreFila(t, BRILLANTE, []);
    assert.equal(r.ok, false, t);
  }
});

test("se rechaza un nombre equivalente (alias confirmado) al de una fila que existe", () => {
  // «COM Y GTOS BRIOS» es el alias de la fila «Gastos Bancarios» de Brillante.
  const r = validarNombreFila("COM Y GTOS BRIOS", BRILLANTE, []);
  assert.equal(r.ok, false);
});

test("se rechaza un nombre que ya tiene otra fila extra de la empresa (de cualquier bloque, aunque ya no se vea)", () => {
  assert.equal(validarNombreFila("préstamo cocos", BRILLANTE, [ING]).ok, false);
  assert.equal(validarNombreFila("Préstamo Cocos", BRILLANTE, [{ nombre: "PRESTAMO COCOS" }]).ok, false);
});

test("NO se rechaza un nombre por coincidir con una categoría de Presupuesto que no tiene fila", () => {
  const sinFila = categoriasSinFila(BRILLANTE);
  assert.ok(sinFila.length > 0, "Brillante tiene categorías sin fila");
  const genericos = new Set(["OTRO", "OTROS", "VARIOS"]);
  for (const o of sinFila) {
    for (const t of [o.textoVisible, o.valorPersistido]) {
      if (genericos.has(t.trim().toUpperCase())) continue;
      assert.equal(validarNombreFila(t, BRILLANTE, []).ok, true, `«${t}» tiene que poder agregarse`);
    }
  }
  assert.equal(validarNombreFila("Préstamo Cocos", BRILLANTE, []).ok, true);
  assert.equal(validarNombreFila("Pagos especiales", BRILLANTE, []).ok, true);
});

test("el mismo nombre puede existir en otra empresa: depende de las filas de ESA empresa", () => {
  // «Pagos especiales» ya es una fila de Fredy; en Brillante no.
  assert.equal(validarNombreFila("Pagos especiales", PLANTILLAS_POR_SLUG["fredy-publicidad"], []).ok, false);
  assert.equal(validarNombreFila("Pagos especiales", BRILLANTE, []).ok, true);
});

test("largo y caracteres: vacío, muy corto, muy largo, fórmula, no texto", () => {
  for (const t of ["", "   ", "ab", "x".repeat(81), "=SUMA(A1)", "+54", "-1", "@pepe", "con\u0007control", 12, null, undefined]) {
    assert.equal(validarNombreFila(t, BRILLANTE, []).ok, false, String(t));
  }
  assert.equal(validarNombreFila("x".repeat(80), BRILLANTE, []).ok, true);
  assert.equal(validarNombreFila("abc", BRILLANTE, []).ok, true);
});

// ---- Qué filas se ven en cada mes ------------------------------------------------------------------

test("extrasVisibles: desde el mes de creación en adelante, no antes; hasta el fin si lo tiene (inclusive)", () => {
  const f: FilaExtra = { ...ING, desdePeriodo: "2026-10", hastaPeriodo: "2026-11" };
  assert.deepEqual(extrasVisibles([f], "2026-09"), []);
  assert.deepEqual(extrasVisibles([f], "2026-10"), [f]);
  assert.deepEqual(extrasVisibles([f], "2026-11"), [f]);
  assert.deepEqual(extrasVisibles([f], "2026-12"), []);
  assert.deepEqual(extrasVisibles([ING], "2030-01"), [ING]);
});

// ---- Cómo entran en la plantilla y en los totales --------------------------------------------------

test("sin filas extra la plantilla es LA MISMA (misma referencia)", () => {
  for (const slug of SLUGS) assert.equal(conFilasExtra(PLANTILLAS_POR_SLUG[slug], []), PLANTILLAS_POR_SLUG[slug], slug);
});

test("Brillante con una fila por bloque: cada una va antes del total de su bloque y el total la suma", () => {
  const p = conFilasExtra(BRILLANTE, TRES);
  assert.deepEqual(validarPlantilla(p), []);
  assert.equal(new Set(p.filas.map((f) => f.clave)).size, p.filas.length);
  const idx = (clave: string) => p.filas.findIndex((f) => f.clave === clave);
  assert.equal(idx("extra.i1") + 1, idx("br.totalIngresos"));
  assert.equal(idx("extra.e1") + 1, idx("br.totalEgresosOperativos"));
  assert.equal(idx("extra.a1") + 1, idx("br.totalEgresos"));
  const suma = (clave: string) => (p.filas[idx(clave)] as { suma: string[] }).suma;
  assert.ok(suma("br.totalIngresos").includes("extra.i1") && !suma("br.totalIngresos").includes("extra.e1"));
  assert.ok(suma("br.totalEgresosOperativos").includes("extra.e1"));
  assert.ok(suma("br.totalEgresos").includes("extra.a1") && suma("br.totalEgresos").includes("br.totalEgresosOperativos"));
  // Son filas manuales, de Presupuestado y Real, con el signo de su bloque.
  const fila = (clave: string) => p.filas[idx(clave)] as { real: unknown; presupuesto: unknown; signo: number; extra?: true; texto: string };
  for (const [clave, signo] of [["extra.i1", 1], ["extra.e1", -1], ["extra.a1", -1]] as const) {
    assert.deepEqual(fila(clave).real, { tipo: "manual" });
    assert.deepEqual(fila(clave).presupuesto, { tipo: "manual" });
    assert.equal(fila(clave).signo, signo);
    assert.equal(fila(clave).extra, true);
  }
  assert.equal(fila("extra.i1").texto, "PRÉSTAMO COCOS");
  // La plantilla estática no se tocó.
  assert.equal(BRILLANTE.filas.some((f) => esClaveDeFilaExtra(f.clave)), false);
});

test("varias filas del mismo bloque entran en el orden dado", () => {
  const otra: FilaExtra = { ...ING, id: "i2", nombre: "OTRO COBRO" };
  const p = conFilasExtra(BRILLANTE, [ING, otra]);
  const claves = p.filas.map((f) => f.clave);
  assert.deepEqual(claves.slice(claves.indexOf("extra.i1"), claves.indexOf("br.totalIngresos")), ["extra.i1", "extra.i2"]);
});

test("una plantilla sin los totales marcados no admite filas extra y falla fuerte, no suma a medias", () => {
  assert.equal(admiteFilasExtra(BRILLANTE), true);
  // Plate Silver no marca los totales de flujo (Havanna y Conexión sí, desde que tienen filas extra).
  const sinRoles = PLANTILLAS_POR_SLUG["plate-silver"];
  assert.equal(admiteFilasExtra(sinRoles), false);
  assert.throws(() => conFilasExtra(sinRoles, [ING]), /no admite filas extra/);
});

test("una fila repetida falla fuerte", () => {
  assert.throws(() => conFilasExtra(BRILLANTE, [ING, { ...ING, nombre: "OTRA" }]), /repetida/);
});

function mesesConExtras(): { sin: DatosMes[]; con: DatosMes[] } {
  const sin = mesesDePrueba(BRILLANTE);
  const real = new Map(sin[1].manuales!.real);
  const pres = new Map(sin[1].manuales!.presupuesto);
  // Real: ingreso 5.000, egreso 2.000, de abajo −700 (un recupero: baja los egresos). Presupuestado: 3.000 / 1.500 / −400.
  for (const [k, r, p] of [["extra.i1", 5000, 3000], ["extra.e1", 2000, 1500], ["extra.a1", -700, -400]] as const) {
    real.set(k, r);
    pres.set(k, p);
  }
  return { sin, con: [sin[0], { ...sin[1], manuales: { presupuesto: pres, real } }] };
}
const celda = (r: Reporte, clave: string) => r.filas.find((f) => f.fila.clave === clave)!.celdas[0];

test("totales: Total ingresos, Total egresos y Saldo suman las filas extra con el signo del bloque; Capital y Disponible no cambian", () => {
  const { sin, con } = mesesConExtras();
  const antes = armarReporte(BRILLANTE, sin, 1);
  const p = conFilasExtra(BRILLANTE, TRES);
  const despues = armarReporte(p, con, 1);

  for (const col of ["real", "presupuestado"] as const) {
    const [i, e, a] = col === "real" ? [5000, 2000, -700] : [3000, 1500, -400];
    assert.equal(celda(despues, "br.totalIngresos")[col]! - celda(antes, "br.totalIngresos")[col]!, i, `ingresos ${col}`);
    assert.equal(celda(despues, "br.totalEgresosOperativos")[col]! - celda(antes, "br.totalEgresosOperativos")[col]!, e, `operativos ${col}`);
    assert.equal(celda(despues, "br.totalEgresos")[col]! - celda(antes, "br.totalEgresos")[col]!, e + a, `egresos ${col}`);
    assert.equal(celda(despues, "br.saldo")[col]! - celda(antes, "br.saldo")[col]!, i - (e + a), `saldo ${col}`);
    assert.equal(celda(despues, "br.disponibleAntes")[col]! - celda(antes, "br.disponibleAntes")[col]!, i, `antes de gastos ${col}`);
  }
  // Capital (Sueldos + SAC + fijo) y Disponible (Total disp. − Capital) no dependen de las filas extra.
  for (const clave of ["br.capital", "br.disponible", "br.totalDisponibilidades"]) {
    assert.deepEqual(celda(despues, clave), celda(antes, clave), clave);
  }
  // Un negativo en «de abajo» baja los egresos (el valor se muestra tal cual se cargó).
  assert.equal(celda(despues, "extra.a1").real, -700);
});

test("gerente: ve las filas extra en solo lectura (Real y Presupuestado) y la lectura de manuales las incluye", () => {
  const { con } = mesesConExtras();
  const p = conFilasExtra(BRILLANTE, TRES);
  const acceso = accesoReservadosDelReporte(false, "brillante");
  // Lo que se le pide leer a la base: las claves calculables, que ya incluyen las extra (bloques no reservados).
  const claves = clavesCalculables(p, acceso);
  for (const k of ["extra.i1", "extra.e1", "extra.a1"]) assert.equal(claves.has(k), true, k);
  const r = armarReporte(p, con, 1, { verBloquesReservados: acceso });
  assert.equal(celda(r, "extra.i1").real, 5000);
  assert.equal(celda(r, "extra.i1").presupuestado, 3000);
  // Del Cierre, el gerente ve solo Saldo, Capital y Disponible (nunca «Disponible antes de gastos»).
  assert.deepEqual(r.filas.filter((f) => f.fila.bloque === "CIERRE").map((f) => f.fila.clave), ["br.saldo", "br.capital", "br.disponible"]);
  // Y ADMIN las lee todas (sin filtro de claves).
  assert.equal(celda(armarReporte(p, con, 1), "extra.a1").presupuestado, -400);
});

test("claves: «extra.<id>» no choca con ninguna clave de las plantillas", () => {
  for (const slug of SLUGS) {
    for (const f of PLANTILLAS_POR_SLUG[slug].filas) assert.equal(esClaveDeFilaExtra(f.clave), false, f.clave);
  }
  assert.equal(claveDeFilaExtra("abc"), "extra.abc");
});

// ---- La carga del gerente NO ve las filas extra ----------------------------------------------------

test("por eso la carga del gerente usa la plantilla estática: con la otra, la fila extra le abriría una celda", () => {
  const p = conFilasExtra(BRILLANTE, TRES);
  const fila = p.filas.find((f) => f.clave === "extra.i1")!;
  assert.equal(esFilaManualEditable(fila), true, "esFilaManualEditable la tomaría como editable del gerente");
  // La plan de carga con la estática no tiene ninguna.
  const vista = vistaDeCarga(planDeCarga(BRILLANTE, [], []));
  assert.equal(vista.celdas.some((c) => c.id.includes("extra.")), false);
  assert.equal(JSON.stringify(vista).includes("extra."), false);
});

test("page.tsx: la carga del gerente sigue con la plantilla estática y el Reporte usa la plantilla con extras", () => {
  const fuente = readFileSync(new URL("../../app/[empresa]/[periodo]/reporte/page.tsx", import.meta.url), "utf-8");
  assert.match(fuente, /planDeCarga\(plantilla,/);
  assert.doesNotMatch(fuente, /planDeCarga\(plantillaReporte/);
  assert.match(fuente, /armarReporte\(plantillaReporte,/);
  assert.match(fuente, /cargarDatosMeses\(empresaId, unidadesEmpresa, plantillaReporte,/);
  // Desde la Tanda 2 el tipeo directo SÍ conoce las filas extra (Presupuestado y Real): usa la plantilla del Reporte.
  assert.match(fuente, /armarVistaTipeo\(\{\s*empresaSlug,\s*plantilla: plantillaReporte,/);
  assert.match(fuente, /plantillaEstatica: plantilla,\s*plantillaReporte,/);
});

// ---- Resolver ---------------------------------------------------------------------------------------

test("interruptor VACÍO: NO consulta la base y devuelve la plantilla de siempre, en todas las empresas", async () => {
  for (const slug of SLUGS) {
    const r = await plantillaDeEmpresaConExtras("empresa-1", slug, "2026-10", { interruptores: [], leer: noDebeLeer });
    assert.equal(r, PLANTILLAS_POR_SLUG[slug], slug);
  }
  assert.equal(await plantillaDeEmpresaConExtras("e", "no-existe", "2026-10", { interruptores: [], leer: noDebeLeer }), null);
});

test("con la configuración real, solo las empresas del interruptor consultan la base; las demás no", async () => {
  assert.ok(SLUGS.filter((s) => !EMPRESAS_CON_FILAS_EXTRA.includes(s)).includes("plate-silver"), "sanidad: el recorrido no está vacío");
  for (const slug of SLUGS.filter((s) => !EMPRESAS_CON_FILAS_EXTRA.includes(s))) {
    assert.equal(await plantillaDeEmpresaConExtras("e", slug, "2026-10", { leer: noDebeLeer }), PLANTILLAS_POR_SLUG[slug], slug);
  }
});

test("interruptor prendido y tabla vacía: la MISMA plantilla (misma referencia), sin cambio alguno", async () => {
  const r = await plantillaDeEmpresaConExtras("e1", "brillante", "2026-10", { interruptores: ["brillante"], leer: leer([]) });
  assert.equal(r, BRILLANTE);
});

test("tabla vacía: el Reporte del gerente y el de ADMIN dan idéntico a la plantilla estática", async () => {
  const resuelta = (await plantillaDeEmpresaConExtras("e1", "brillante", "2026-10", { interruptores: ["brillante"], leer: leer([]) }))!;
  const meses = mesesDePrueba(BRILLANTE);
  const gerente = { verBloquesReservados: accesoReservadosDelReporte(false, "brillante") };
  assert.deepEqual(armarReporte(resuelta, meses, 1, gerente), armarReporte(BRILLANTE, meses, 1, gerente));
  assert.deepEqual(armarReporte(resuelta, meses, 1), armarReporte(BRILLANTE, meses, 1));
});

test("interruptor prendido con filas: solo las que ya empezaron en el mes", async () => {
  const futura: FilaExtra = { ...EGR, id: "e9", nombre: "FUTURA", desdePeriodo: "2026-12" };
  const lector: LectorFilasExtra = async (_e, periodo) => {
    assert.equal(periodo, "2026-10");
    return [ING, futura];
  };
  const r = (await plantillaDeEmpresaConExtras("e1", "brillante", "2026-10", { interruptores: ["brillante"], leer: lector }))!;
  assert.equal(r.filas.some((f) => f.clave === "extra.i1"), true);
  assert.equal(r.filas.some((f) => f.clave === "extra.e9"), false);
});

// ---- Configuración ----------------------------------------------------------------------------------

// La lista fijada de empresas con filas extra está en filasExtraEmpresasLista.ts (compartida): activar otra empresa
// tiene que obligar a tocarla.
test("config: el interruptor de filas extra es la lista fijada y es subconjunto del tipeo directo, con totales marcados", () => {
  assert.ok(EMPRESAS_CON_FILAS_EXTRA.includes("brillante"));
  assert.deepEqual([...EMPRESAS_CON_FILAS_EXTRA], [...CON_FILAS_EXTRA_HOY]);
  assert.equal(new Set(EMPRESAS_CON_FILAS_EXTRA).size, EMPRESAS_CON_FILAS_EXTRA.length);
  for (const slug of EMPRESAS_CON_FILAS_EXTRA) {
    assert.ok(EMPRESAS_CON_TIPEO_DIRECTO.includes(slug), `${slug} necesita el tipeo directo`);
    assert.ok(Object.hasOwn(PLANTILLAS_POR_SLUG, slug), `${slug} no tiene plantilla`);
    assert.equal(admiteFilasExtra(PLANTILLAS_POR_SLUG[slug]), true, `${slug}: faltan los roles de totales`);
  }
});

// ---- guardarValoresManuales: solo cambió la línea que valida las claves -----------------------------

// Hash (con saltos de línea normalizados) de carga/actions.ts ANTES del cambio de las filas extra. Si este test
// falla, alguien modificó algo más que esas dos líneas en un archivo que no se toca: revisar el diff y, si el
// cambio es legítimo, actualizar el hash.
const HASH_ORIGINAL_CARGA_ACTIONS = "0bd94576c233ba678d5612daf5e50d8b79b6048df6dd69a4d915890b26979b92";

test("guardarValoresManuales: valida las claves con el resolver y el resto del archivo es el de antes", () => {
  const fuente = readFileSync(new URL("../../app/[empresa]/[periodo]/reporte/carga/actions.ts", import.meta.url), "utf-8").replace(/\r\n/g, "\n");
  const importNuevo = 'import { plantillaDeEmpresaConExtras } from "@/lib/reporte/plantillaConExtras";';
  const llamadaNueva = "  const plantilla = await plantillaDeEmpresaConExtras(empresa.id, empresaSlug, periodo);";
  assert.equal(fuente.split(importNuevo).length - 1, 1);
  assert.equal(fuente.split(llamadaNueva).length - 1, 1);
  assert.equal(fuente.includes("plantillaDeEmpresa(empresaSlug)"), false);
  // Deshaciendo exactamente esas dos líneas se obtiene el archivo original.
  const original = fuente
    .replace(importNuevo, 'import { plantillaDeEmpresa } from "@/lib/reporte/plantillas";')
    .replace(llamadaNueva, "  const plantilla = plantillaDeEmpresa(empresaSlug);");
  assert.equal(createHash("sha256").update(original).digest("hex"), HASH_ORIGINAL_CARGA_ACTIONS);
});

// ---- Migración y modelo ----------------------------------------------------------------------------

test("migración a mano: crea el enum, la tabla, el único por empresa+nombre y las dos claves foráneas", () => {
  const sql = readFileSync(new URL("../../prisma/migrations/20261029120000_agregar_fila_extra_reporte/migration.sql", import.meta.url), "utf-8");
  assert.match(sql, /CREATE TYPE "BloqueFilaExtra" AS ENUM \('INGRESOS', 'EGRESOS', 'ABAJO'\)/);
  assert.match(sql, /CREATE TABLE "FilaExtraReporte"/);
  assert.match(sql, /CREATE UNIQUE INDEX "FilaExtraReporte_empresaId_nombreClave_key" ON "FilaExtraReporte"\("empresaId", "nombreClave"\)/);
  assert.match(sql, /"FilaExtraReporte_empresaId_fkey" FOREIGN KEY \("empresaId"\) REFERENCES "Empresa"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"FilaExtraReporte_creadoPorId_fkey" FOREIGN KEY \("creadoPorId"\) REFERENCES "Usuario"\("id"\) ON DELETE RESTRICT/);
  // Solo crea: nada que borre, vacíe o cambie lo que ya existe.
  // (las cláusulas ON DELETE / ON UPDATE de las claves foráneas no son sentencias.)
  const sinClausulas = sql.replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE)/g, "");
  assert.doesNotMatch(sinClausulas, /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/i);
  assert.equal(sql.match(/ALTER TABLE "(?!FilaExtraReporte")/g), null);
});

test("el modelo de Prisma tiene los mismos campos que el SQL", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf-8");
  const modelo = schema.slice(schema.indexOf("model FilaExtraReporte"));
  for (const campo of ["id", "empresaId", "bloque", "nombre", "nombreClave", "desdePeriodo", "hastaPeriodo", "creadoPorId", "createdAt"]) {
    assert.match(modelo, new RegExp(`\\n  ${campo}\\s`), campo);
  }
  assert.match(modelo, /@@unique\(\[empresaId, nombreClave\]\)/);
  assert.match(modelo, /hastaPeriodo\s+String\?/);
});
