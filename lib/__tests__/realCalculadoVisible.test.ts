import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { armarReporte, filaConAjusteManual, type DatosMes, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { armarVistaTipeo, celdaModificada } from "@/lib/reporte/tipeoDirecto";
import { manualDesdeTotal, resolverEntradaReal } from "@/lib/reporte/ajusteManual";

// «Mes en curso»: en las filas con parte calculada + tipeo (sumarManual, desde 2026-11) la casilla de Real muestra el TOTAL
// (calculado + tipeado), igual que «Todos los meses». Al guardar se persiste solo la diferencia: lo escrito menos el calculado
// que se mostró al cargar la pantalla.

const CON_SUMAR: Record<string, string[]> = {
  avianor: ["av.cobranzaClientes", "av.sueldos", "av.expensas", "av.proveedores", "av.tarjetas"],
  brillante: ["br.sac"],
  "conexion-logistica": ["cx.sac"],
  mantenor: ["mn.sac"],
};
const CLASIF: Record<string, number> = {
  "av.cobranzaClientes": 7_000_000,
  "av.sueldos": -3_000_000,
  "av.expensas": -400_000,
  "av.proveedores": -2_000_000,
  "av.tarjetas": -900_000,
  "br.sac": -5_000_000,
  "cx.sac": -5_000_000,
  "mn.sac": -5_000_000,
};
const NOMBRE: Record<string, string> = {
  "av.cobranzaClientes": "COBRANZAS",
  "av.sueldos": "SUELDOS",
  "av.expensas": "EXPENSAS",
  "av.proveedores": "PROV Y SERV",
  "av.tarjetas": "PREST BRIOS Y TC",
  "br.sac": "SAC",
  "cx.sac": "SAC",
  "mn.sac": "SAC",
};
const MANUAL = 1_234_567;
const ABIERTO = { abiertas: 1, cerradas: 0 };

function mes(slug: string, periodo: string, over: Partial<DatosMes> = {}, manual?: number): DatosMes {
  const real = new Map<string, number>();
  const manuales = new Map<string, number>();
  for (const k of CON_SUMAR[slug]) {
    real.set(NOMBRE[k], CLASIF[k]);
    if (manual !== undefined) manuales.set(k, manual);
  }
  return { periodo, real, presupuesto: new Map(), semanasCerradas: 4, manuales: { presupuesto: new Map(), real: manuales }, ...over };
}

// Mapa de calculados como lo arma la página: las filas con celda.realCalculado del último mes.
function calculadosDe(r: Reporte): Map<string, number | null> {
  return new Map(
    r.filas.flatMap((f) => {
      const c = f.celdas[f.celdas.length - 1];
      return c?.realCalculado === undefined ? [] : [[f.fila.clave, c.realCalculado] as const];
    })
  );
}

function vistaDe(slug: string, periodo: string, manual: number | undefined, over: Partial<DatosMes> = {}) {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const datos = mes(slug, periodo, over, manual);
  const reporte = armarReporte(plantilla, [datos], 0);
  const vista = armarVistaTipeo({
    empresaSlug: slug,
    plantilla,
    esAdminOFinanzas: true,
    periodo,
    actual: "2026-11",
    semanas: ABIERTO,
    valoresReales: datos.manuales!.real,
    calculados: calculadosDe(reporte),
  })!;
  return { vista, reporte };
}

const celdaDe = (v: ReturnType<typeof vistaDe>["vista"], clave: string) => v.celdas.find((c) => c.id === `${clave}|REAL`)!;

// ---- Motor: la parte calculada se expone aparte; el total no cambia ----------------------------------------------------------

for (const slug of Object.keys(CON_SUMAR)) {
  test(`${slug}: noviembre expone el calculado aparte; el Real total sigue siendo calculado + tipeado`, () => {
    const r = armarReporte(PLANTILLAS_POR_SLUG[slug], [mes(slug, "2026-11", {}, MANUAL)], 0);
    for (const k of CON_SUMAR[slug]) {
      const c = r.filas.find((f) => f.fila.clave === k)!.celdas[0];
      const esperado = Math.abs(CLASIF[k]);
      assert.equal(c.realCalculado, esperado, k);
      assert.equal(c.real, esperado + MANUAL, k);
    }
  });

  test(`${slug}: sin tipeado el calculado es el Real; sin semanas cerradas es null`, () => {
    const a = armarReporte(PLANTILLAS_POR_SLUG[slug], [mes(slug, "2026-11")], 0);
    const b = armarReporte(PLANTILLAS_POR_SLUG[slug], [mes(slug, "2026-11", { semanasCerradas: 0 }, MANUAL)], 0);
    for (const k of CON_SUMAR[slug]) {
      const ca = a.filas.find((f) => f.fila.clave === k)!.celdas[0];
      assert.equal(ca.realCalculado, ca.real);
      const cb = b.filas.find((f) => f.fila.clave === k)!.celdas[0];
      assert.equal(cb.realCalculado, null);
      assert.equal(cb.real, MANUAL);
    }
  });

  test(`${slug}: octubre y anteriores no cambian (sin realCalculado)`, () => {
    for (const p of ["2026-10", "2026-09"]) {
      const r = armarReporte(PLANTILLAS_POR_SLUG[slug], [mes(slug, p, {}, MANUAL)], 0);
      for (const f of r.filas.filter((x) => x.celdas.length > 0)) assert.ok(!("realCalculado" in f.celdas[0]), `${p} ${f.fila.clave}`);
    }
  });

  test(`${slug}: las filas sin parte calculada no llevan realCalculado`, () => {
    const r = armarReporte(PLANTILLAS_POR_SLUG[slug], [mes(slug, "2026-11", {}, MANUAL)], 0);
    for (const f of r.filas.filter((x) => x.celdas.length > 0)) {
      if (CON_SUMAR[slug].includes(f.fila.clave)) continue;
      assert.ok(!("realCalculado" in f.celdas[0]), f.fila.clave);
    }
  });

  test(`${slug}: la casilla de Real muestra el TOTAL y coincide con el Real del motor («Todos los meses»)`, () => {
    const { vista, reporte } = vistaDe(slug, "2026-11", MANUAL);
    for (const k of CON_SUMAR[slug]) {
      const c = celdaDe(vista, k);
      const real = reporte.filas.find((f) => f.fila.clave === k)!.celdas[0].real;
      assert.equal(c.centavos, real, k);
      assert.equal(c.calculado, Math.abs(CLASIF[k]), k);
      assert.equal(c.centavos, Math.abs(CLASIF[k]) + MANUAL, k);
    }
  });

  test(`${slug}: sin valor tipeado la casilla muestra el calculado; una casilla sin tocar no se modifica ni escribe nada`, () => {
    const { vista } = vistaDe(slug, "2026-11", undefined);
    for (const k of CON_SUMAR[slug]) {
      const c = celdaDe(vista, k);
      assert.equal(c.centavos, Math.abs(CLASIF[k]), k);
      assert.equal(celdaModificada(c, c.importeInicial), false, k);
    }
  });
}

test("sin ejecución y sin valor tipeado la casilla queda vacía; con valor tipeado muestra solo el tipeado (calculado 0)", () => {
  const vacia = celdaDe(vistaDe("avianor", "2026-11", undefined, { semanasCerradas: 0 }).vista, "av.sueldos");
  assert.equal(vacia.importeInicial, "");
  assert.equal(vacia.centavos, null);
  const conManual = celdaDe(vistaDe("avianor", "2026-11", MANUAL, { semanasCerradas: 0 }).vista, "av.sueldos");
  assert.equal(conManual.centavos, MANUAL);
  assert.equal(conManual.calculado, 0);
});

test("la huella cambia si cambia el calculado (la pantalla reemplaza lo tipeado por lo nuevo)", () => {
  const a = vistaDe("avianor", "2026-11", MANUAL).vista.huella;
  const b = vistaDe("avianor", "2026-11", MANUAL, { real: new Map([["SUELDOS", -3_500_000]]) }).vista.huella;
  assert.notEqual(a, b);
});

// ---- Se guarda solo la diferencia --------------------------------------------------------------------------------------------

test("editar el total guarda solo la diferencia con el calculado mostrado", () => {
  // calculado 30.000,00; total escrito 42.345,67 -> manual 12.345,67
  assert.deepEqual(manualDesdeTotal("42.345,67", 3_000_000), { ok: true, centavos: 1_234_567, nota: null });
});

test("expresiones: primero se resuelve la cuenta y después se resta el calculado; respeta centavos y deja la cuenta en la nota", () => {
  const r = manualDesdeTotal("321.235,44+17.755,22", 30_000_000);
  assert.ok(r.ok);
  assert.equal(r.centavos, 32_123_544 + 1_775_522 - 30_000_000);
  assert.ok(r.nota?.startsWith("321.235,44+17.755,22 (total)"));
  const centavos = manualDesdeTotal("100,10-0,05", 0);
  assert.ok(centavos.ok);
  assert.equal(centavos.centavos, 10_005);
});

test("un total igual al calculado, o la casilla vacía, no deja parte manual (null: borra lo guardado o no escribe nada)", () => {
  assert.deepEqual(manualDesdeTotal("30.000", 3_000_000), { ok: true, centavos: null, nota: null });
  assert.deepEqual(manualDesdeTotal("30.000,00", 3_000_000), { ok: true, centavos: null, nota: null });
  assert.deepEqual(manualDesdeTotal("", 3_000_000), { ok: true, centavos: null, nota: null });
});

test("un total menor que el calculado guarda un ajuste negativo; lo que no se entiende se rechaza", () => {
  assert.deepEqual(manualDesdeTotal("29.000", 3_000_000), { ok: true, centavos: -100_000, nota: null });
  assert.equal(manualDesdeTotal("abc", 3_000_000).ok, false);
});

test("el servidor no guarda estas filas sin el calculado mostrado (pantalla vieja: evita duplicar); las demás se guardan como siempre", () => {
  const plantilla = PLANTILLAS_POR_SLUG.avianor;
  const sueldos = plantilla.filas.find((f) => f.clave === "av.sueldos");
  const otra = plantilla.filas.find((f) => f.tipo === "linea" && f.real.tipo === "manual");
  assert.equal(resolverEntradaReal(sueldos, "2026-11", "REAL", "42.345", undefined).tipo, "error");
  assert.deepEqual(resolverEntradaReal(sueldos, "2026-11", "REAL", "42.345", 3_000_000), { tipo: "cambio", centavos: 1_234_500, nota: null });
  assert.equal(resolverEntradaReal(otra, "2026-11", "REAL", "5", undefined).tipo, "no-aplica");
  assert.equal(resolverEntradaReal(sueldos, "2026-11", "PRESUPUESTADO", "5", undefined).tipo, "no-aplica");
  assert.equal(resolverEntradaReal(sueldos, "2026-10", "REAL", "5", undefined).tipo, "no-aplica");
});

test("guardar y recargar: lo guardado es solo la diferencia y la casilla vuelve a mostrar el total escrito (sin duplicar)", () => {
  const escrito = 4_234_567; // 42.345,67 sobre un calculado de 30.000,00
  const guardado = manualDesdeTotal("42.345,67", 3_000_000);
  assert.ok(guardado.ok && guardado.centavos !== null);
  assert.equal(guardado.centavos, escrito - 3_000_000); // lo persistido: la parte manual, no el total
  const { vista, reporte } = vistaDe("avianor", "2026-11", guardado.centavos);
  const c = celdaDe(vista, "av.sueldos");
  assert.equal(c.centavos, escrito);
  assert.equal(reporte.filas.find((f) => f.fila.clave === "av.sueldos")!.celdas[0].real, escrito);
  // Sin tocar la casilla: no se modifica, no escribe.
  assert.equal(celdaModificada(c, c.importeInicial), false);
  // Guardar otra vez el mismo total da la misma diferencia (no se acumula).
  const otra = manualDesdeTotal("42.345,67", c.calculado!);
  assert.ok(otra.ok && otra.centavos === guardado.centavos);
});

test("filaConAjusteManual: solo las filas con sumarManual y desde 2026-11", () => {
  const plantilla = PLANTILLAS_POR_SLUG.avianor;
  const sueldos = plantilla.filas.find((x) => x.clave === "av.sueldos")!;
  assert.equal(filaConAjusteManual(sueldos, "2026-11"), true);
  assert.equal(filaConAjusteManual(sueldos, "2026-12"), true);
  assert.equal(filaConAjusteManual(sueldos, "2026-10"), false);
  assert.equal(filaConAjusteManual(sueldos, "2026-09"), false);
  assert.equal(filaConAjusteManual(plantilla.filas.find((x) => x.tipo === "linea" && x.real.tipo === "manual")!, "2026-11"), false);
});

test("octubre y anteriores no cambian: la casilla muestra solo lo tipeado (como antes), sin calculado", () => {
  for (const p of ["2026-10", "2026-09"]) {
    const c = celdaDe(vistaDe("avianor", p, MANUAL).vista, "av.sueldos");
    assert.equal(c.centavos, MANUAL, p);
    assert.equal(c.calculado, undefined, p);
  }
});

// ---- Render real de la fila (con tipeo vs. sin permiso / vista de solo lectura) -----------------------------------------------

const req = createRequire(import.meta.url);
function reemplazar(modulo: string, exports: Record<string, unknown>) {
  const ruta = req.resolve(modulo);
  req.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports } as unknown as NodeJS.Module;
}
reemplazar("next/font/google", { Poppins: () => ({ variable: "", className: "" }) });
reemplazar("next/navigation", { useRouter: () => ({ refresh() {}, push() {} }) });

const AJUSTE = 1_000_000; // 10.000 tipeados; calculado de av.sueldos = 3.000.000 centavos = 30.000; total 40.000

async function dibujar(clave: string, periodo: string, conTipeo: boolean): Promise<string> {
  const { FilaTabla } = await import("@/app/[empresa]/[periodo]/reporte/ReportePlantilla");
  const { ProveedorTipeo } = await import("@/app/[empresa]/[periodo]/reporte/TipeoDirecto");
  const { vista, reporte } = vistaDe("avianor", periodo, AJUSTE);
  const fila = reporte.filas.find((f) => f.fila.clave === clave)!;
  const tabla = createElement(
    "table",
    null,
    createElement(
      "tbody",
      null,
      createElement(FilaTabla, {
        filaReporte: fila,
        meses: 1,
        verPendientes: false,
        verControl: false,
        carga: null,
        idsEditables: new Set<string>(),
        idsTipeables: new Set<string>(conTipeo ? vista.celdas.map((c) => c.id) : []),
        borrable: false,
        empresaSlug: "avianor",
        periodo,
        soloLecturaPorMes: [false],
        soloSaldo: false,
      })
    )
  );
  return renderToStaticMarkup(
    createElement(ProveedorTipeo, { empresaSlug: "avianor", periodo, celdas: vista.celdas, huella: vista.huella, children: tabla })
  );
}

const celdaReal = (html: string) => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1])[2];

test("render «Mes en curso» con tipeo: el TOTAL está DENTRO de la casilla; sin campo aparte ni rótulo", async () => {
  const celda = celdaReal(await dibujar("av.sueldos", "2026-11", true));
  assert.match(celda, /<input[^>]*aria-label="Real: [^"]*"[^>]*value="40\.000"/);
  assert.equal((celda.match(/<input/g) ?? []).length, 1, "una sola casilla");
  assert.ok(!celda.includes("ajuste a mano") && !celda.includes("Calculado:"));
  assert.equal(celda.replace(/<input[^>]*>/g, "").replace(/<[^>]+>/g, "").trim(), "", "ningún número fuera de la casilla");
});

test("render «Todos los meses» (sin tipeo: gerente sin permiso o vista histórica) muestra el mismo número que la casilla, sin campo", async () => {
  const enCurso = celdaReal(await dibujar("av.sueldos", "2026-11", true)).match(/value="([^"]*)"/)![1];
  const celda = celdaReal(await dibujar("av.sueldos", "2026-11", false));
  assert.equal(celda.replace(/<[^>]+>/g, "").trim(), enCurso);
  assert.ok(!celda.includes("<input"));
  assert.notEqual(enCurso, "0");
});

test("render octubre con tipeo: sin cambios (la casilla trae solo lo tipeado)", async () => {
  const celda = celdaReal(await dibujar("av.sueldos", "2026-10", true));
  assert.match(celda, /<input[^>]*value="10\.000"/);
});
