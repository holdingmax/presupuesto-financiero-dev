import { test } from "node:test";
import assert from "node:assert/strict";
import { exigirAlcance, resolverAlcance, type Alcance } from "@/lib/dashboard/alcance";
import { leerMovimientosPorSemana } from "@/lib/dashboard/consultas";
import { detectarUnidadesRepetidas, normalizarUnidad } from "@/lib/dashboard/unidades";
import { E, EMPRESAS, IDS_ACTIVAS, alcanceDe, lectorDePrueba } from "@/lib/dashboard/__tests__/fixturesAlcance";

// Alcance por usuario: qué empresas y qué unidades de negocio puede mirar cada rol. Sin base: el lector de empresas es
// simulado (el de producción se prueba con la verificación de solo lectura contra testing, fuera de la suite).

const nombres = (a: Alcance) => a.empresas.map((e) => e.id).sort();
const RANGO = { desde: "2026-11-02", hasta: "2026-11-16" };

test("ADMIN: todas las empresas activas (12) y la unión de sus unidades; es el holding", async () => {
  const { lector, llamadas } = lectorDePrueba({});
  const a = await resolverAlcance({ id: "admin", rol: "ADMIN" }, lector);
  assert.deepEqual(nombres(a), [...IDS_ACTIVAS].sort());
  assert.equal(a.empresas.length, 12);
  assert.deepEqual(a.unidades, [
    "AVIANOR", "BRADENTON", "BRILLANTE", "EXPENSAS", "FREDY", "HAVANNA", "HAVANNA PERU", "HWC", "LOGISTICA",
    "MANTENOR", "PLATE SILVER", "RADIO", "SPP",
  ]);
  assert.equal(a.esHolding, true);
  assert.equal(a.vacio, false);
  // ADMIN no depende de las asignaciones: no se consultan.
  assert.equal(llamadas.asignadas, 0);
});

test("ADMIN: las empresas inactivas (Gold Seguridad, JPS) y sus unidades quedan afuera", async () => {
  const a = await alcanceDe("ADMIN", []);
  assert.ok(!nombres(a).includes("gold"));
  assert.ok(!nombres(a).includes("jps"));
  assert.ok(!a.unidades.includes("JPS"));
});

test("FINANZAS con 10 empresas asignadas: solo esas 10 y sus unidades; nunca es el holding", async () => {
  const diez = IDS_ACTIVAS.filter((id) => id !== "avianor" && id !== "expensas");
  const a = await alcanceDe("FINANZAS", diez);
  assert.deepEqual(nombres(a), [...diez].sort());
  assert.ok(!a.unidades.includes("AVIANOR"));
  assert.ok(!a.unidades.includes("EXPENSAS"));
  assert.equal(a.esHolding, false);
});

test("GERENTE con 2 empresas: solo esas 2", async () => {
  const a = await alcanceDe("GERENTE", ["brillante", "radio"]);
  assert.deepEqual(nombres(a), ["brillante", "radio"]);
  assert.deepEqual(a.unidades, ["BRILLANTE", "RADIO"]);
  assert.equal(a.esHolding, false);
});

test("VIEWER con las 12 empresas (como Vigo): ve las mismas empresas que ADMIN pero su alcance NO es el holding", async () => {
  const v = await alcanceDe("VIEWER", IDS_ACTIVAS);
  const admin = await alcanceDe("ADMIN", []);
  assert.deepEqual(nombres(v), nombres(admin));
  assert.deepEqual(v.unidades, admin.unidades);
  assert.equal(v.esHolding, false);
  assert.equal(admin.esHolding, true);
});

test("usuario con una sola empresa: solo sus unidades, y ninguna unidad de otra empresa", async () => {
  for (const empresa of EMPRESAS.filter((e) => e.activo)) {
    for (const rol of ["FINANZAS", "GERENTE", "VIEWER"] as const) {
      const a = await alcanceDe(rol, [empresa.id]);
      assert.deepEqual(nombres(a), [empresa.id], `${rol} ${empresa.id}`);
      assert.deepEqual(a.unidades, [...empresa.unidadesNegocio.map(normalizarUnidad)].sort(), `${rol} ${empresa.id}`);
      const ajenas = EMPRESAS.filter((e) => e.id !== empresa.id).flatMap((e) => e.unidadesNegocio.map(normalizarUnidad));
      assert.deepEqual(a.unidades.filter((u) => ajenas.includes(u)), [], `${rol} ${empresa.id}: unidad ajena en el alcance`);
    }
  }
});

test("Conexión Logística tiene dos unidades (LOGISTICA y SPP) y su usuario recibe las dos", async () => {
  const a = await alcanceDe("GERENTE", ["conexion"]);
  assert.deepEqual(a.unidades, ["LOGISTICA", "SPP"]);
  assert.equal(a.empresas[0].slug, "conexion-logistica");
});

test("el slug de una empresa renombrada se conserva (Handyway Cargo = hwc)", async () => {
  const a = await alcanceDe("GERENTE", ["hwc"]);
  assert.equal(a.empresas[0].slug, "hwc");
});

test("sin empresas asignadas: alcance vacío, sin unidades y SIN leer el resto de las empresas", async () => {
  for (const rol of ["FINANZAS", "GERENTE", "VIEWER"] as const) {
    const { lector, llamadas } = lectorDePrueba({});
    const a = await resolverAlcance({ id: "sin-nada", rol }, lector);
    assert.equal(a.vacio, true, rol);
    assert.deepEqual(a.empresas, [], rol);
    assert.deepEqual(a.unidades, [], rol);
    assert.equal(a.esHolding, false, rol);
    assert.equal(llamadas.todas, 0, `${rol}: no debe consultar nada más`);
  }
});

test("una empresa asignada pero inactiva no cuenta; si son todas inactivas, el alcance queda vacío", async () => {
  const a = await alcanceDe("GERENTE", ["brillante", "gold", "jps"]);
  assert.deepEqual(nombres(a), ["brillante"]);
  assert.deepEqual(a.unidades, ["BRILLANTE"]);
  const { lector, llamadas } = lectorDePrueba({ u1: ["gold", "jps"] });
  const vacio = await resolverAlcance({ id: "u1", rol: "GERENTE" }, lector);
  assert.equal(vacio.vacio, true);
  assert.equal(llamadas.todas, 0);
});

test("un usuario no recibe empresas por pedir otra: solo cuentan sus asignaciones (el resolvedor no tiene otro dato de entrada)", async () => {
  const { lector } = lectorDePrueba({ ana: ["brillante"], beto: ["radio"] });
  const ana = await resolverAlcance({ id: "ana", rol: "GERENTE" }, lector);
  const beto = await resolverAlcance({ id: "beto", rol: "GERENTE" }, lector);
  assert.deepEqual(nombres(ana), ["brillante"]);
  assert.deepEqual(nombres(beto), ["radio"]);
});

test("las unidades del alcance vienen normalizadas, sin vacías ni repetidas, en orden", async () => {
  const a = await alcanceDe("GERENTE", ["x"], [E("x", "Empresa X", [" spp ", "SPP", "", "logistica", "LOGISTICA "])]);
  assert.deepEqual(a.unidades, ["LOGISTICA", "SPP"]);
  assert.deepEqual(a.empresas[0].unidades, ["LOGISTICA", "SPP"]);
});

// ---- Las unidades no se repiten entre empresas ----------------------------------------------------------------

test("detectarUnidadesRepetidas: la lista de testing no repite ninguna unidad entre empresas", () => {
  assert.deepEqual(detectarUnidadesRepetidas(EMPRESAS), []);
});

test("detectarUnidadesRepetidas: encuentra una unidad en dos empresas (ignora mayúsculas y espacios) y no cuenta la repetida dentro de la misma", () => {
  const con = [
    E("a", "A", ["BRILLANTE", "brillante "]),
    E("b", "B", [" Brillante"]),
    E("c", "C", ["RADIO", "RADIO"]),
  ];
  assert.deepEqual(detectarUnidadesRepetidas(con), [{ unidad: "BRILLANTE", empresaIds: ["a", "b"] }]);
});

test("unidad repetida entre empresas: el alcance de ADMIN NO se arma (falla cerrado) y el mensaje no nombra unidades ni empresas", async () => {
  const roto = [...EMPRESAS, E("clon", "Clon", ["BRILLANTE"])];
  const { lector } = lectorDePrueba({}, roto);
  await assert.rejects(resolverAlcance({ id: "admin", rol: "ADMIN" }, lector), (e: Error) => {
    assert.match(e.message, /unidad de negocio asignada a más de una empresa/);
    assert.doesNotMatch(e.message, /BRILLANTE|Clon|Brillante/);
    return true;
  });
});

test("unidad repetida que toca a este usuario (la comparte con una empresa que NO tiene asignada): no se arma el alcance", async () => {
  const roto = [...EMPRESAS, E("clon", "Clon", ["RADIO"])];
  const { lector } = lectorDePrueba({ u1: ["radio"] }, roto);
  await assert.rejects(resolverAlcance({ id: "u1", rol: "GERENTE" }, lector), /más de una empresa/);
});

test("unidad repetida entre dos empresas que NO tocan a este usuario: su alcance se arma igual", async () => {
  const roto = [...EMPRESAS, E("clon", "Clon", ["RADIO"])];
  const { lector } = lectorDePrueba({ u1: ["brillante"] }, roto);
  const a = await resolverAlcance({ id: "u1", rol: "GERENTE" }, lector);
  assert.deepEqual(a.unidades, ["BRILLANTE"]);
});

// ---- Solo el resolvedor crea un Alcance ------------------------------------------------------------------------

test("exigirAlcance: acepta el que sale del resolvedor y rechaza literales, copias y valores raros", async () => {
  const real = await alcanceDe("GERENTE", ["brillante"]);
  assert.equal(exigirAlcance(real), real);
  const literal = { empresas: [], unidades: ["BRILLANTE", "RADIO"], vacio: false, esHolding: true } as unknown as Alcance;
  assert.throws(() => exigirAlcance(literal), /Alcance inválido/);
  assert.throws(() => exigirAlcance({ ...real } as unknown as Alcance), /Alcance inválido/);
  assert.throws(() => exigirAlcance(JSON.parse(JSON.stringify(real)) as Alcance), /Alcance inválido/);
  assert.throws(() => exigirAlcance(null as unknown as Alcance), /Alcance inválido/);
  assert.throws(() => exigirAlcance(undefined as unknown as Alcance), /Alcance inválido/);
  assert.throws(() => exigirAlcance(["BRILLANTE"] as unknown as Alcance), /Alcance inválido/);
});

test("el Alcance no se puede modificar: ni sus listas ni sus propiedades", async () => {
  const a = await alcanceDe("GERENTE", ["brillante", "radio"]);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.unidades) && Object.isFrozen(a.empresas));
  assert.ok(Object.isFrozen(a.empresas[0]) && Object.isFrozen(a.empresas[0].unidades));
  assert.throws(() => (a.unidades as string[]).push("AVIANOR"), TypeError);
  assert.throws(() => ((a as unknown as { esHolding: boolean }).esHolding = true), TypeError);
  assert.throws(() => ((a.empresas as unknown as unknown[]).length = 0), TypeError);
});

test("una consulta con un Alcance falsificado se rechaza ANTES de tocar la base", async () => {
  const literal = { empresas: [], unidades: ["BRILLANTE"], vacio: false, esHolding: true } as unknown as Alcance;
  await assert.rejects(leerMovimientosPorSemana(literal, RANGO), /Alcance inválido/);
});

test("alcance vacío o sin unidades: la consulta devuelve [] sin consultar (en este test no hay base: si consultara, fallaría)", async () => {
  const vacio = await alcanceDe("GERENTE", []);
  assert.deepEqual(await leerMovimientosPorSemana(vacio, RANGO), []);
  const sinUnidades = await alcanceDe("GERENTE", ["x"], [E("x", "Sin unidades", [])]);
  assert.equal(sinUnidades.vacio, false);
  assert.deepEqual(sinUnidades.unidades, []);
  assert.deepEqual(await leerMovimientosPorSemana(sinUnidades, RANGO), []);
});

test("rango inválido: se rechaza antes de consultar (nada de texto libre en el SQL)", async () => {
  const a = await alcanceDe("GERENTE", ["brillante"]);
  for (const desde of ["2026-13-01", "2026-11-31", "x'; DROP TABLE \"Usuario\"; --", "", "2026-1-1"]) {
    await assert.rejects(leerMovimientosPorSemana(a, { desde, hasta: "2026-11-16" }), /AAAA-MM-DD/, desde);
  }
  await assert.rejects(leerMovimientosPorSemana(a, { desde: "2026-11-02", hasta: "mañana" }), /AAAA-MM-DD/);
});
