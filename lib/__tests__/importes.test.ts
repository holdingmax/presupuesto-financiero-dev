import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ERROR_MAX_DECIMALES,
  leerCuenta,
  leerImporte,
  leerTermino,
  mensajeDeImporte,
} from "@/lib/importes";
import { parsearImporteArgentino } from "@/lib/numero";
import { formatearCentavos, parsearCuenta } from "@/lib/reporte/bloqueo";
import { parsearMontoACentavos } from "@/lib/prorrateo";
import { validarImporteCarga } from "@/lib/reporte/cargaGerente";
import { formatearImporte } from "@/app/ejecucion/formato";

// Importes tipeados (formato argentino): un solo módulo (lib/importes.ts) y los viejos parsers como
// envoltorios. Lo que ya funcionaba tiene que dar EXACTAMENTE lo mismo; lo ambiguo se rechaza.

// ---------------------------------------------------------------------------------------------
// Oráculo: copia TEXTUAL del código de antes del módulo único (lib/numero.ts, lib/reporte/bloqueo.ts y
// lib/prorrateo.ts). Solo sirve para comparar; no se usa en producción.
// ---------------------------------------------------------------------------------------------

function viejoParsearImporteArgentino(texto: string): number {
  const limpio = texto.trim().replace(/[$\s]/g, "");
  if (limpio.includes(",")) {
    return Number(limpio.replace(/\./g, "").replace(",", "."));
  }
  return Number(limpio.replace(/\./g, ""));
}

function viejoTerminoACentavos(texto: string): number | null {
  const limpio = texto.replace(/[$\s]/g, "");
  if (!/^\d[\d.]*(,\d+)?$/.test(limpio) && !/^\d+(\.\d+)?$/.test(limpio)) return null;
  let normal: string;
  if (limpio.includes(",")) normal = limpio.replace(/\./g, "").replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(limpio)) normal = limpio;
  else normal = limpio.replace(/\./g, "");
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function viejoParsearCuenta(texto: string): { centavos: number; nota: string | null } | null {
  const t = texto.trim().replace(/−/g, "-").replace(/^=/, "");
  if (t === "") return null;
  const partes = t.split(/([+-])/).map((x) => x.trim());
  let signo = 1;
  let total = 0;
  let terminos = 0;
  let esperaTermino = true;
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i];
    if (p === "+" || p === "-") {
      if (!esperaTermino && i > 0) {
        signo = p === "-" ? -1 : 1;
        esperaTermino = true;
      } else if (p === "-") signo = -signo;
      continue;
    }
    if (p === "") continue;
    const c = viejoTerminoACentavos(p);
    if (c === null) return null;
    total += signo * c;
    terminos++;
    signo = 1;
    esperaTermino = false;
  }
  if (terminos === 0 || esperaTermino) return null;
  return { centavos: total === 0 ? 0 : total, nota: terminos > 1 || /[+-]/.test(t.slice(1)) ? t : null };
}

function viejoParsearMontoACentavos(texto: string): number | null {
  if (!texto.trim()) return null;
  const n = viejoParsearImporteArgentino(texto);
  if (!Number.isFinite(n)) return null;
  const centavos = Math.abs(n) * 100;
  const redondeado = Math.round(centavos);
  if (Math.abs(centavos - redondeado) > 1e-6) return null;
  return Number.isSafeInteger(redondeado) ? redondeado : null;
}

// ---------------------------------------------------------------------------------------------
// Las 4 formas de Kike: todas dan cien mil, en cada pantalla.
// ---------------------------------------------------------------------------------------------

const CUATRO_FORMAS = ["100000", "100.000", "100.000,00", "100000,00"];

// ¿Es una cuenta (tiene un + o un - que no sea el signo del principio)? Un solo campo de importe no la admite.
const esCuenta = (t: string) => /[+\-−]/.test(t.replace(/^[\s$=]*[-−]?/, ""));

for (const texto of CUATRO_FORMAS) {
  test(`«${texto}» = cien mil en todos los lugares donde se tipea un importe`, () => {
    assert.deepEqual(leerTermino(texto), { ok: true, centavos: 10_000_000 });
    assert.deepEqual(leerImporte(texto), { ok: true, centavos: 10_000_000 });
    assert.equal(parsearImporteArgentino(texto), 100000); // Presupuesto, desglose, total de referencia
    assert.deepEqual(parsearCuenta(texto), { centavos: 10_000_000, nota: null }); // Reporte y Valores del reporte
    assert.equal(parsearMontoACentavos(texto), 10_000_000); // prorrateo en Ejecución
    const carga = validarImporteCarga(texto, false); // Reporte del gerente
    assert.deepEqual(carga, { ok: true, centavos: 10_000_000, nota: null });
  });
}

test("Total de referencia: usa el módulo común, no Number() crudo (que leía «100.000» como 100)", () => {
  const fuente = readFileSync(
    new URL("../../app/[empresa]/[periodo]/presupuesto/PresupuestoForm.tsx", import.meta.url),
    "utf-8"
  );
  assert.equal(fuente.includes("Number(totalReferencia)"), false);
  assert.ok(fuente.includes("parsearImporteArgentino(totalReferencia)"));
  for (const texto of CUATRO_FORMAS) assert.equal(parsearImporteArgentino(texto), 100000);
});

// ---------------------------------------------------------------------------------------------
// Regresión: lo que ya funcionaba da EXACTAMENTE lo mismo que antes.
// ---------------------------------------------------------------------------------------------

const VALIDOS_DE_SIEMPRE = [
  "1.500.000,50",
  "$ 1.000",
  "0,5",
  "0,50",
  "1.234,56",
  "1.234.567",
  "1234567",
  "1234,5",
  "$1.500.000",
  " 1.000 ",
  "$ 1.500.000,25",
  "-1.000",
  "-5.000",
  "+1.000",
  "- 1.000",
  "0",
  "00,10",
  "1,05",
  "9.999.999.999,99",
  // Cuentas con + y -
  "321.235,44+17.755,22",
  "-136.170.039+78.411.842,93-6.316.335,37+64.074.531",
  "100−30",
  "100.000,00+50",
  "1.000-500",
  "=1.000+2.000",
  "1.000 + 2.000 - 3,50",
  "-24.743.730,39",
  "$ 1.000 + $ 2.000",
  "--5",
  "5--3",
];

test("regresión: los casos válidos de siempre dan EXACTAMENTE lo mismo que el código anterior", () => {
  for (const texto of VALIDOS_DE_SIEMPRE) {
    // Reporte y Valores del reporte (centavos y nota de la cuenta).
    assert.deepEqual(parsearCuenta(texto), viejoParsearCuenta(texto), `parsearCuenta(${JSON.stringify(texto)})`);
    assert.notEqual(parsearCuenta(texto), null, `${texto} sigue siendo válido`);
    // Un solo importe (Presupuesto, desglose): solo los que no son cuentas.
    if (!esCuenta(texto)) {
      const nuevo = parsearImporteArgentino(texto);
      const viejo = viejoParsearImporteArgentino(texto);
      assert.ok(Object.is(nuevo, viejo) || (nuevo === 0 && viejo === 0), `parsearImporteArgentino(${JSON.stringify(texto)}): ${nuevo} vs ${viejo}`);
      assert.equal(parsearMontoACentavos(texto), viejoParsearMontoACentavos(texto), `parsearMontoACentavos(${JSON.stringify(texto)})`);
    }
  }
});

// Generador determinístico (sin Math.random): mismos casos en cada corrida.
function lcg(semilla: number) {
  let s = semilla;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function conMiles(entero: string): string {
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

test("regresión (aleatoria y determinística): importes bien formados dan lo mismo que antes, en pesos y en centavos", () => {
  const azar = lcg(2026);
  let comparados = 0;
  const rechazosErroneosDelViejo: string[] = [];
  for (let i = 0; i < 4000; i++) {
    const digitos = 1 + Math.floor(azar() * 10); // hasta 10 dígitos enteros
    const entero = String(Math.floor(azar() * 10 ** digitos));
    const cantDecimales = Math.floor(azar() * 3); // 0, 1 o 2 decimales
    const decimales = Array.from({ length: cantDecimales }, () => String(Math.floor(azar() * 10))).join("");
    const parteEntera = azar() < 0.5 ? entero : conMiles(entero);
    const base = decimales === "" ? parteEntera : `${parteEntera},${decimales}`;
    const negativo = azar() < 0.2 && !/^0+(,0*)?$/.test(base);
    const texto = `${azar() < 0.2 ? "$ " : ""}${negativo ? "-" : ""}${base}`;

    const viejoA = viejoParsearImporteArgentino(texto);
    const nuevoA = parsearImporteArgentino(texto);
    assert.ok(Object.is(viejoA, nuevoA) || (viejoA === 0 && nuevoA === 0), `A ${texto}: ${nuevoA} vs ${viejoA}`);
    assert.deepEqual(parsearCuenta(texto), viejoParsearCuenta(texto), `B ${texto}`);
    // Prorrateo: igual que antes, con UNA diferencia que es un arreglo (ver el test siguiente): el código
    // viejo multiplicaba en coma flotante y a veces rechazaba un importe válido.
    const nuevoMonto = parsearMontoACentavos(texto);
    const viejoMonto = viejoParsearMontoACentavos(texto);
    const esperado = Number(entero) * 100 + Number(decimales.padEnd(2, "0"));
    if (nuevoMonto !== viejoMonto) {
      assert.equal(viejoMonto, null, `prorrateo ${texto}: solo puede diferir si el viejo lo rechazaba`);
      assert.equal(nuevoMonto, esperado, `prorrateo ${texto}: el nuevo da el valor exacto`);
      rechazosErroneosDelViejo.push(texto);
    } else {
      assert.equal(nuevoMonto, esperado, `prorrateo ${texto}`);
    }
    comparados++;
  }
  assert.equal(comparados, 4000);
  // El arreglo existe y es real (con esta semilla: 53 de 4000 importes bien formados que el viejo rechazaba);
  // en TODOS esos casos el nuevo da el valor exacto (verificado arriba).
  assert.ok(rechazosErroneosDelViejo.length > 0);
});

test("el prorrateo viejo rechazaba por error de coma flotante un importe válido; ahora se lee exacto", () => {
  // Hallado por el test de regresión: 619.583.520,7 × 100 no daba un entero exacto en coma flotante.
  assert.equal(viejoParsearMontoACentavos("619.583.520,7"), null);
  assert.equal(parsearMontoACentavos("619.583.520,7"), 61_958_352_070);
  assert.equal(parsearMontoACentavos("619583520,70"), 61_958_352_070);
});

test("regresión (aleatoria): cuentas con + y - dan lo mismo que antes, con la misma nota", () => {
  const azar = lcg(7);
  const termino = () => {
    const entero = String(Math.floor(azar() * 10 ** (1 + Math.floor(azar() * 8))));
    const dec = azar() < 0.5 ? `,${String(Math.floor(azar() * 100)).padStart(2, "0")}` : "";
    return `${azar() < 0.5 ? entero : conMiles(entero)}${dec}`;
  };
  for (let i = 0; i < 2000; i++) {
    const n = 2 + Math.floor(azar() * 3);
    let texto = azar() < 0.2 ? "-" : "";
    for (let k = 0; k < n; k++) texto += `${k > 0 ? (azar() < 0.5 ? "+" : "-") : ""}${termino()}`;
    assert.deepEqual(parsearCuenta(texto), viejoParsearCuenta(texto), texto);
    assert.notEqual(parsearCuenta(texto), null);
  }
});

test("las cuentas de la pantalla de Valores del reporte siguen funcionando", () => {
  assert.deepEqual(parsearCuenta("321.235,44+17.755,22"), { centavos: 33_899_066, nota: "321.235,44+17.755,22" });
  assert.deepEqual(leerCuenta("321.235,44+17.755,22"), { ok: true, centavos: 33_899_066, nota: "321.235,44+17.755,22" });
  assert.equal(parsearCuenta("100.000,00+50")?.centavos, 10_005_000);
  assert.equal(parsearCuenta("1.000-500")?.centavos, 50_000);
  assert.equal(parsearCuenta("1.000 + 2.000 - 3,50")?.centavos, 299_650);
  // Un solo importe no lleva nota.
  assert.equal(parsearCuenta("1.234,56")?.nota, null);
});

// ---------------------------------------------------------------------------------------------
// Lo nuevo: lo ambiguo se rechaza con un mensaje claro (son plata).
// ---------------------------------------------------------------------------------------------

test("«1.234» y los miles bien formados se aceptan: el punto cuenta como miles solo con grupos de 3", () => {
  assert.deepEqual(leerTermino("1.234"), { ok: true, centavos: 123_400 });
  assert.deepEqual(leerTermino("123.456"), { ok: true, centavos: 12_345_600 });
  assert.deepEqual(leerTermino("1.234.567"), { ok: true, centavos: 123_456_700 });
  assert.deepEqual(leerTermino("999.999.999,99"), { ok: true, centavos: 99_999_999_999 });
});

const AMBIGUOS = ["100.5", "1.5", "123.45", "1000.50", "1.2345", "12.34.56", ".5", "1.", "1.234.56", "1.23.456", "1,234.56", "1.5,20"];

for (const texto of AMBIGUOS) {
  test(`ambiguo «${texto}»: se rechaza en todos los lugares, con un mensaje que lo explica`, () => {
    const r = leerTermino(texto);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : "", /ambiguo|no es un importe válido/);
    assert.equal(parsearCuenta(texto), null);
    assert.ok(Number.isNaN(parsearImporteArgentino(texto)));
    assert.equal(parsearMontoACentavos(texto), null);
    assert.equal(validarImporteCarga(texto, false).ok, false);
    assert.ok(mensajeDeImporte(texto) !== null);
  });
}

test("mensaje de lo ambiguo: dice qué hacer", () => {
  const r = leerTermino("100.5");
  assert.equal(r.ok, false);
  assert.equal(
    !r.ok && r.error,
    "«100.5» es ambiguo: los puntos son miles en grupos de 3 (1.234) y los decimales van con coma (100,50)."
  );
});

test("más de 2 decimales: «Máximo 2 decimales.» (no se redondea en silencio)", () => {
  assert.deepEqual(leerTermino("1234,567"), { ok: false, error: ERROR_MAX_DECIMALES });
  assert.equal(ERROR_MAX_DECIMALES, "Máximo 2 decimales.");
  assert.deepEqual(leerTermino("0,123"), { ok: false, error: "Máximo 2 decimales." });
  assert.deepEqual(leerTermino("1.234,5678"), { ok: false, error: "Máximo 2 decimales." });
  assert.equal(parsearCuenta("1234,567"), null);
  assert.equal(parsearMontoACentavos("1234,567"), null);
  assert.ok(Number.isNaN(parsearImporteArgentino("1234,567")));
});

test("«100,000»: también por decimales de más, con la pista de escribir los miles con punto", () => {
  const r = leerTermino("100,000");
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /^Máximo 2 decimales\./);
  assert.match(!r.ok ? r.error : "", /100\.000/);
  assert.equal(parsearCuenta("100,000"), null);
  assert.ok(Number.isNaN(parsearImporteArgentino("100,000")));
});

test("«1,5,2», «1e5» y basura se rechazan", () => {
  for (const texto of ["1,5,2", "1e5", "abc", "1,", "--", "1 2 3a", "1,234,567", "12a"]) {
    assert.equal(leerTermino(texto).ok, false, texto);
    assert.equal(parsearCuenta(texto), null, texto);
  }
  assert.equal(
    (leerTermino("1,5,2") as { error: string }).error,
    "«1,5,2» no es un importe válido. Ejemplos: 100000, 100.000, 100.000,00, 100000,50."
  );
});

test("«,5» es 0,50 y «.5» se rechaza", () => {
  assert.deepEqual(leerTermino(",5"), { ok: true, centavos: 50 });
  assert.deepEqual(leerTermino(",50"), { ok: true, centavos: 50 });
  assert.equal(parsearImporteArgentino(",5"), 0.5);
  assert.equal(parsearCuenta(",5")?.centavos, 50);
  assert.equal(parsearMontoACentavos(",5"), 50);
  assert.equal(leerTermino(".5").ok, false);
  assert.equal(parsearCuenta(".5"), null);
});

test("un importe demasiado grande se rechaza (no entra en centavos exactos)", () => {
  const r = leerTermino("99999999999999");
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, "El importe es demasiado grande.");
  assert.equal(leerTermino("9.999.999.999.999,99").ok, true); // 13 dígitos: entra
});

test("vacío: lo trata cada pantalla; el módulo lo informa y mensajeDeImporte no lo marca como error", () => {
  assert.deepEqual(leerTermino(""), { ok: false, error: "El importe está vacío." });
  assert.equal(parsearCuenta(""), null);
  assert.equal(parsearImporteArgentino(""), 0); // como antes
  assert.equal(parsearImporteArgentino("  $ "), 0);
  assert.equal(parsearMontoACentavos(""), null);
  assert.equal(mensajeDeImporte(""), null);
  assert.equal(mensajeDeImporte("   "), null);
  assert.equal(mensajeDeImporte("1.234"), null);
  assert.ok(mensajeDeImporte("1.5")?.includes("ambiguo"));
});

// ---------------------------------------------------------------------------------------------
// Cuentas con "+" y negativos
// ---------------------------------------------------------------------------------------------

test("cuentas: un término ambiguo o con más de 2 decimales rechaza toda la cuenta, con el mensaje del término", () => {
  const a = leerCuenta("100.5+1");
  assert.equal(a.ok, false);
  assert.match(!a.ok ? a.error : "", /«100\.5» es ambiguo/);
  const b = leerCuenta("1.000+2,3456");
  assert.deepEqual(b, { ok: false, error: "Máximo 2 decimales." });
  assert.equal(parsearCuenta("1.000+"), null); // operador al final
  assert.equal(parsearCuenta("+"), null);
  assert.equal(parsearCuenta("1.000++"), null);
});

test("negativos: -1.000, -100.000,50 y restas", () => {
  assert.deepEqual(leerImporte("-1.000"), { ok: true, centavos: -100_000 });
  assert.deepEqual(leerImporte("−1.000"), { ok: true, centavos: -100_000 }); // menos tipográfico
  assert.deepEqual(leerImporte("-100.000,50"), { ok: true, centavos: -10_000_050 });
  assert.equal(parsearImporteArgentino("-1.000"), -1000);
  assert.equal(parsearCuenta("-100.000,50")?.centavos, -10_000_050);
  assert.equal(parsearCuenta("1.000-1.500")?.centavos, -50_000);
  assert.equal(parsearCuenta("-1.000+400")?.centavos, -60_000);
  assert.equal(parsearCuenta("-1.000+400")?.nota, "-1.000+400");
  // Un negativo ambiguo se rechaza igual.
  assert.equal(leerImporte("-100.5").ok, false);
  assert.equal(leerImporte("-0").ok && (leerImporte("-0") as { centavos: number }).centavos, 0);
  // El prorrateo trabaja en magnitud (el signo del movimiento lo pone el servidor): igual que antes.
  assert.equal(parsearMontoACentavos("-1.000"), 100_000);
});

test("el Reporte acepta negativos para el gerente y para ADMIN/FINANZAS (decisión de Kike, 2026-11)", () => {
  assert.deepEqual(validarImporteCarga("-1.000", false), { ok: true, centavos: -100_000, nota: null });
  assert.deepEqual(validarImporteCarga("-1.000", true), { ok: true, centavos: -100_000, nota: null });
  assert.deepEqual(validarImporteCarga("100.000,00+50", false), { ok: true, centavos: 10_005_000, nota: "100.000,00+50" });
  assert.deepEqual(validarImporteCarga("", false), { ok: true, centavos: null, nota: null });
  assert.deepEqual(validarImporteCarga("0", false), { ok: true, centavos: null, nota: null });
});

test("el Reporte del gerente da el mensaje específico, no un genérico", () => {
  assert.deepEqual(validarImporteCarga("100.5", false), {
    ok: false,
    error: "«100.5» es ambiguo: los puntos son miles en grupos de 3 (1.234) y los decimales van con coma (100,50).",
  });
  assert.deepEqual(validarImporteCarga("1234,567", false), { ok: false, error: "Máximo 2 decimales." });
});

// ---------------------------------------------------------------------------------------------
// Coherencia entre pantallas
// ---------------------------------------------------------------------------------------------

test("coherencia: lo que acepta un parser lo aceptan todos con el mismo valor; lo que rechaza uno lo rechazan todos", () => {
  const textos = [
    ...CUATRO_FORMAS,
    ...VALIDOS_DE_SIEMPRE.filter((t) => !esCuenta(t)),
    ...AMBIGUOS,
    "1234,567",
    "100,000",
    "1,5,2",
    ",5",
    "1.234",
    "abc",
    "-100.5",
  ];
  for (const t of textos) {
    const A = parsearImporteArgentino(t);
    const B = parsearCuenta(t);
    const C = parsearMontoACentavos(t);
    if (Number.isNaN(A)) {
      assert.equal(B, null, `${t}: A rechaza y B acepta`);
      assert.equal(C, null, `${t}: A rechaza y el prorrateo acepta`);
    } else {
      assert.notEqual(B, null, `${t}: A acepta y B rechaza`);
      assert.equal(Math.round(A * 100), B!.centavos, `${t}: A y B no coinciden`);
      assert.equal(Math.abs(B!.centavos), C, `${t}: B y el prorrateo no coinciden`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Lo que se muestra no cambia (formateadores intactos) y vuelve a leerse igual
// ---------------------------------------------------------------------------------------------

test("lo que se muestra sigue igual: 1.234.567 en la tabla y 1.234.567,00 en los campos de importe", () => {
  assert.equal(formatearImporte(1234567), "1.234.567");
  assert.equal(formatearCentavos(123_456_700), "1.234.567,00");
  assert.equal(formatearCentavos(10_000_000), "100.000,00");
  assert.equal(formatearCentavos(-12_345), "-123,45");
});

test("ida y vuelta: lo que se muestra se vuelve a leer igual", () => {
  for (const centavos of [0, 1, 50, 99, 100, 12_345, 123_456_700, 10_000_000, 99_999_999_999]) {
    const texto = formatearCentavos(centavos);
    assert.equal(parsearCuenta(texto)?.centavos, centavos, texto);
    assert.equal(leerTermino(texto).ok && (leerTermino(texto) as { centavos: number }).centavos, centavos, texto);
  }
  assert.equal(parsearCuenta(formatearCentavos(-12_345))?.centavos, -12_345);
});
