import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  elegirMesDeEntrada,
  opcionesDeMes,
  resumirMeses,
  semanaParaVer,
  type FilaConteo,
  type SemanaDeMes,
} from "@/lib/mesesEjecucion";

// Selector de mes y regla de entrada de la pestaña Ejecución de la empresa. Lo puro se prueba en memoria;
// lo que habla con la base y las páginas se verifica leyendo la fuente (acá no se toca la base).

const leerFuente = (...partes: string[]) => readFileSync(join(process.cwd(), ...partes), "utf8");
const DIR = ["app", "[empresa]", "[periodo]", "ejecucion"];

const SEMANAS: SemanaDeMes[] = [
  { id: "o1", periodo: "2026-10", numeroSemana: 1, estado: "CERRADA" },
  { id: "o2", periodo: "2026-10", numeroSemana: 2, estado: "CERRADA" },
  { id: "s1", periodo: "2026-09", numeroSemana: 1, estado: "CERRADA" },
  { id: "n1", periodo: "2026-11", numeroSemana: 1, estado: "ABIERTA" }, // noviembre existe pero vacío para la empresa
];
const fila = (ejecucionId: string, clasificacion: string, cantidad: number): FilaConteo => ({ ejecucionId, clasificacion, cantidad });

test("semanaParaVer: la abierta si hay; si no, la última", () => {
  assert.equal(semanaParaVer([]), null);
  assert.equal(semanaParaVer([{ numeroSemana: 1, estado: "CERRADA" }, { numeroSemana: 3, estado: "CERRADA" }]), 3);
  assert.equal(
    semanaParaVer([{ numeroSemana: 1, estado: "ABIERTA" }, { numeroSemana: 2, estado: "CERRADA" }]),
    1
  );
});

test("resumirMeses: un mes por período, nuevo→viejo, con su semana; los meses vacíos no aparecen", () => {
  const meses = resumirMeses(SEMANAS, [fila("o1", "COBRANZAS", 5), fila("o2", "SIN CLASIFICAR", 2), fila("s1", "SUELDOS", 4)]);
  assert.deepEqual(
    meses.map((m) => [m.periodo, m.total, m.sinClasificar, m.numeroSemana]),
    [
      ["2026-10", 7, 2, 2],
      ["2026-09", 4, 0, 1],
    ]
  );
});

test("resumirMeses: las clasificaciones ocultas y los conteos en cero no cuentan", () => {
  const meses = resumirMeses(SEMANAS, [fila("o1", "RESERVADA", 9), fila("s1", "SUELDOS", 0)], ["RESERVADA"]);
  assert.deepEqual(meses, []);
});

test("elegirMesDeEntrada: el mes de la URL manda si tiene movimientos", () => {
  const meses = resumirMeses(SEMANAS, [fila("o1", "SIN CLASIFICAR", 1), fila("s1", "SUELDOS", 4)]);
  assert.equal(elegirMesDeEntrada(meses, "2026-09"), null);
  assert.equal(elegirMesDeEntrada(meses, "2026-10"), null);
});

test("elegirMesDeEntrada: mes vacío → el más reciente con sin clasificar, aunque haya uno más nuevo con movimientos", () => {
  const meses = resumirMeses(SEMANAS, [fila("o1", "COBRANZAS", 8), fila("s1", "SIN CLASIFICAR", 1)]);
  assert.equal(elegirMesDeEntrada(meses, "2026-11")?.periodo, "2026-09");
});

test("elegirMesDeEntrada: mes vacío y nada sin clasificar → el más reciente con movimientos", () => {
  const meses = resumirMeses(SEMANAS, [fila("o2", "COBRANZAS", 8), fila("s1", "SUELDOS", 1)]);
  const elegido = elegirMesDeEntrada(meses, "2026-11");
  assert.equal(elegido?.periodo, "2026-10");
  assert.equal(elegido?.numeroSemana, 2);
});

test("elegirMesDeEntrada: sin movimientos en ningún mes → null (se queda donde está)", () => {
  assert.equal(elegirMesDeEntrada([], "2026-11"), null);
});

test("opcionesDeMes: links a semanas existentes, con el filtro; el mes actual vacío se agrega marcado", () => {
  const meses = resumirMeses(SEMANAS, [fila("o2", "COBRANZAS", 8), fila("s1", "SUELDOS", 1)]);
  const ops = opcionesDeMes("brillante", meses, "2026-11", (b) => `${b}?clasificacion=X`);
  assert.deepEqual(
    ops.map((o) => [o.periodo, o.vacio]),
    [["2026-11", true], ["2026-10", false], ["2026-09", false]]
  );
  assert.equal(ops[1].href, "/brillante/2026-10/ejecucion/2?clasificacion=X");
  // Con el mes de la URL ya en la lista no se duplica.
  assert.equal(opcionesDeMes("brillante", meses, "2026-10", (b) => b).length, 2);
});

test("el selector y la regla de entrada nunca crean semanas ni escriben", () => {
  const datos = leerFuente(...DIR, "datos.ts");
  const desde = datos.indexOf("async function mesesDeLaEmpresa");
  const hasta = datos.indexOf("export async function obtenerDatosSemanaDeEmpresa");
  const bloque = datos.slice(desde, hasta);
  assert.ok(desde > 0 && hasta > desde);
  assert.doesNotMatch(bloque, /\.(create|createMany|upsert|update|updateMany|delete|deleteMany)\(|obtenerOCrear|\$executeRaw/);
  assert.doesNotMatch(leerFuente(...DIR, "SelectorMes.tsx"), /obtenerOCrear|actions/);
  assert.doesNotMatch(leerFuente("lib", "mesesEjecucion.ts"), /prisma|obtenerOCrear/);
});

test("las páginas usan el selector y el índice aplica la regla fuera del try", () => {
  assert.match(leerFuente(...DIR, "[numeroSemana]", "page.tsx"), /<SelectorMes/);
  assert.match(leerFuente(...DIR, "mes", "page.tsx"), /<SelectorMes/);
  const indice = leerFuente(...DIR, "page.tsx");
  assert.match(indice, /obtenerMesDeEntrada/);
  assert.ok(indice.indexOf("if (otroMes) redirect") > indice.indexOf("} catch"));
});
