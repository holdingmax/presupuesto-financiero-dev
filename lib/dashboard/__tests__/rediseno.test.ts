import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalidadDelMes, Indicador } from "@/lib/dashboard/calidad";
import type { CeldaDeAvance, FilaDeAvance, TotalDeAvance } from "@/lib/dashboard/avance";
import { importeEnMillones } from "@/lib/dashboard/formato";
import { geometriaDeBarra, indicadoresConValor } from "@/lib/dashboard/presentacion";
import { armarEncabezadoDeAvance } from "@/lib/dashboard/encabezado";
import { BarraDeAvance, CalidadVista, FilaCargandoVista, FilaDeAvanceVista, PieDeTotalesVista, SelectorDeMes, TituloDeAvance, ZonaAdminVista } from "@/app/dashboard/vistas";

// Rediseño visual de /dashboard: geometría de la barra, formato en millones y reglas de estilo (sin degradados, un solo
// movimiento, impresión, foco, accesibilidad). Los tests de seguridad (qué existe en el HTML de cada rol) están en pantalla.test.ts
// y no se tocan.

const RAIZ = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const texto = (h: string) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

const celda = (p: number | null, r: number | null): CeldaDeAvance => ({
  presupuestado: p,
  real: r,
  avance: p !== null && r !== null && p !== 0 ? (r / p) * 100 : null,
  presupuestoIncompleto: false,
  realIncompleto: false,
});
const RITMO = { diasConDatos: 13, diasDelMes: 30, porcentaje: (13 / 30) * 100 };
const fila = (extra: Partial<FilaDeAvance> = {}): FilaDeAvance => ({
  empresaId: "brillante", nombre: "Brillante", slug: "brillante", moneda: "ARS", sinReporte: false, estadoPresupuesto: "validado", cartelPresupuesto: null,
  incluyePartesManualesOParciales: false, realManualPendiente: false, corte: "2026-11-13", ritmo: RITMO,
  ingresos: celda(74_258_000_00, 10_009_000_00), egresosOperativos: celda(67_496_000_00, 39_429_000_00), ...extra,
});

// ---- Montos en millones ----------------------------------------------------------------------------------------

test("montos en millones: «$2.189 M», un decimal por debajo de 100 M, entero por debajo de un millón, «—» si falta", () => {
  assert.equal(importeEnMillones(218_900_000_000, "ARS"), "$2.189 M");
  assert.equal(importeEnMillones(507_531_000_000, "ARS"), "$5.075 M");
  assert.equal(importeEnMillones(67_496_000_00, "ARS"), "$67,5 M");
  assert.equal(importeEnMillones(10_000_000_00, "ARS"), "$10 M");
  assert.equal(importeEnMillones(100_000_000_00, "ARS"), "$100 M");
  assert.equal(importeEnMillones(100_000_00, "USD"), "US$ 100.000");
  assert.equal(importeEnMillones(250_000_000_00, "PEN"), "S/ 250 M");
  assert.equal(importeEnMillones(-150_000_000_00, "ARS"), "-$150 M");
  assert.equal(importeEnMillones(0, "ARS"), "$0");
  assert.equal(importeEnMillones(null, "ARS"), "—");
});

// ---- Geometría de la barra -------------------------------------------------------------------------------------

test("barra: el relleno es el avance y la marca el ritmo, recortados a la pista; sin dato no hay relleno", () => {
  assert.deepEqual({ ...geometriaDeBarra(58, 43.3) }, { relleno: 58, marca: 43.3, excede: false, sinDato: false });
  assert.deepEqual({ ...geometriaDeBarra(130, 100) }, { relleno: 100, marca: 100, excede: true, sinDato: false });
  assert.deepEqual({ ...geometriaDeBarra(-5, 120) }, { relleno: 0, marca: 100, excede: false, sinDato: false });
  assert.deepEqual({ ...geometriaDeBarra(null, 43) }, { relleno: 0, marca: 43, excede: false, sinDato: true });
  assert.deepEqual({ ...geometriaDeBarra(50, null) }, { relleno: 50, marca: null, excede: false, sinDato: false });
  assert.equal(geometriaDeBarra(Number.NaN, Number.NaN).sinDato, true);
  assert.equal(geometriaDeBarra(Number.NaN, Number.NaN).marca, null);
});

test("la barra se dibuja con ancho y posición de la marca, y dice lo mismo con texto (el color no es el único portador)", () => {
  const b = html(createElement(BarraDeAvance, { avance: 58.4, ritmo: 43.3, tono: "egresos", etiqueta: "Egresos operativos" }));
  assert.match(b, /role="progressbar"/);
  assert.match(b, /aria-valuemin="0"/);
  assert.match(b, /aria-valuemax="100"/);
  assert.match(b, /aria-valuenow="58\.4"/);
  assert.match(b, /width:58\.4%/);
  assert.match(b, /left:43\.3%/);
  assert.match(b, /aria-valuetext="Egresos operativos: avance 58%, ritmo del mes 43%"/);
  const sobre = html(createElement(BarraDeAvance, { avance: 130, ritmo: 43.3, tono: "ingresos", etiqueta: "Ingresos" }));
  assert.match(sobre, /width:100%/);
  assert.match(sobre, /dash-bar--excede/);
  assert.match(sobre, /supera el presupuesto/);
  const sin = html(createElement(BarraDeAvance, { avance: null, ritmo: 43.3, tono: "egresos", etiqueta: "Egresos" }));
  assert.doesNotMatch(sin, /dash-bar__relleno|aria-valuenow/);
  assert.match(sin, /sin dato/);
  assert.doesNotMatch(html(createElement(BarraDeAvance, { avance: 50, ritmo: null, tono: "egresos", etiqueta: "x" })), /dash-bar__marca/);
});

test("la barra no usa semáforo: no hay clases ni estilos de alerta que dependan del avance", () => {
  const f = sinComentarios(leer("app/dashboard/vistas.tsx"));
  assert.doesNotMatch(f, /text-positive|bg-(positive|negative)|bg-red|bg-green|text-red|text-green|bg-verde|text-verde/);
  const lineas = f.split(/\r?\n/).filter((l) => /text-negative/.test(l));
  assert.equal(lineas.length, 2, "text-negative solo en los mensajes de «no se pudo cargar»");
  for (const l of lineas) assert.match(l, /No se pudo|texto/, l);
});

// ---- Tarjetas y resumen ----------------------------------------------------------------------------------------

test("tarjeta de empresa: dos barras con la marca, Real en grande en millones con el exacto en el title, enlace al Reporte y orden de lectura", () => {
  const f = fila({ egresosOperativos: celda(507_531_000_000, 218_900_000_000) });
  const t = html(createElement(FilaDeAvanceVista, { fila: f, hrefReporte: "/brillante/2026-11/reporte" }));
  assert.equal((t.match(/role="progressbar"/g) ?? []).length, 2);
  assert.equal((t.match(/dash-bar__marca/g) ?? []).length, 2);
  assert.match(t, /dash-bar--egresos/);
  assert.match(t, /dash-bar--ingresos/);
  assert.match(t, /title="\$2\.189\.000\.000">\$2\.189 M</);
  assert.match(t, /title="\$5\.075\.310\.000">\$5\.075 M</);
  assert.match(t, /Egresos operativos/);
  assert.match(t, /Ingresos/);
  assert.match(t, /href="\/brillante\/2026-11\/reporte"/);
  assert.match(texto(t), /Real\s*\$2\.189 M\s*de \$5\.075 M presupuestado/);
  assert.match(texto(t), /Marca: ritmo del mes 43% · 13 de 30 días con datos/);
  assert.match(t, /<article/);
  assert.ok(t.indexOf("Egresos operativos") < t.indexOf("Ingresos"));
});

test("las etiquetas de estado se muestran como lista de etiquetas suaves", () => {
  const t = html(createElement(FilaDeAvanceVista, { fila: fila({ cartelPresupuesto: "presupuesto sin validar", incluyePartesManualesOParciales: true, realManualPendiente: true }), hrefReporte: "/b" }));
  assert.equal((t.match(/class="dash-etiqueta"/g) ?? []).length, 3);
  assert.match(t, /presupuesto sin validar/);
  assert.match(t, /incluye partes manuales o parciales/);
  assert.match(t, /Real manual pendiente/);
  assert.doesNotMatch(html(createElement(FilaDeAvanceVista, { fila: fila({ ritmo: null }), hrefReporte: "/b" })), /<footer/, "sin ritmo ni etiquetas, sin pie");
});

test("el esqueleto de una empresa que llega es quieto y solo nombra a la empresa del propio alcance", () => {
  const t = html(createElement(FilaCargandoVista, { nombre: "Radio" }));
  assert.match(t, /aria-busy="true"/);
  assert.match(t, /Radio/);
  assert.doesNotMatch(t, /\$|%/);
});

test("resumen del mes: el total en grande, la barra grande con su marca y la leyenda; «—» elegante si es null", () => {
  const total: TotalDeAvance = { moneda: "ARS", rotulo: "Total de tus empresas", presupuestado: 507_531_000_000, real: 218_932_000_000, avance: 43.1 };
  const t = html(createElement(PieDeTotalesVista, { totales: [total], ritmo: RITMO }));
  assert.match(t, /text-6xl[^>]*>43%</);
  assert.match(t, /dash-bar--grande/);
  assert.match(t, /left:43\.33/);
  assert.match(texto(t), /Total de tus empresas · egresos operativos \(\$\)/);
  assert.match(texto(t), /\$2\.189 M de \$5\.075 M/);
  assert.match(texto(t), /Marca: ritmo del mes 43%/);
  const nulo = texto(html(createElement(PieDeTotalesVista, { totales: [{ ...total, presupuestado: null, real: null, avance: null }], ritmo: RITMO })));
  assert.match(nulo, /—\s*—\s*de\s*—/);
  assert.match(nulo, /no se muestra una suma parcial/);
  assert.doesNotMatch(nulo, /\$\d/);
});

test("el título y el selector: mes segmentado con el actual marcado, y nada de impresión para los controles", () => {
  const s = html(createElement(SelectorDeMes, { periodo: "2026-11" }));
  assert.match(s, /class="dash-seg dash-noprint"/);
  assert.match(s, /href="\/dashboard\?periodo=2026-10"/);
  assert.match(s, /aria-current="page"[^>]*>Noviembre 2026</);
  assert.equal((s.match(/aria-current/g) ?? []).length, 1);
  const t = html(createElement(TituloDeAvance, { encabezado: armarEncabezadoDeAvance("2026-11", []) }));
  assert.match(t, /<h1 id="resumen"/);
  assert.match(texto(t), /Avance de Noviembre 2026/);
});

// ---- Calidad: sobria y colapsable ------------------------------------------------------------------------------

function calidad(indicadores: Indicador[], sinFila = 0): CalidadDelMes {
  return {
    periodo: "2026-11", datosAl: "13/11", movimientosEnLotesCerrados: 8416, movimientosEnLotesAbiertos: 0,
    semanasProvisorias: { semanas: 0, movimientosAfuera: 0 }, indicadores, clasificacionesSinFila: { movimientos: sinFila, deMovimientos: 8266 }, sinAsignar: null,
  };
}
const ind = (clave: Indicador["clave"], total: number): Indicador => ({ clave, rotulo: clave, total, enLotesAbiertos: 0 });

test("calidad: es un <details> abierto; resume cuántos indicadores tienen movimientos y destaca solo los distintos de cero", () => {
  const c = calidad([ind("sinClasificar", 0), ind("unidadSugeridaSinConfirmar", 508), ind("otraMoneda", 0)], 205);
  const t = html(createElement(CalidadVista, { calidad: c }));
  assert.match(t, /<details class="dash-calidad[^"]*" open="">/);
  assert.match(t, /<summary/);
  assert.match(texto(t), /2 indicadores con movimientos/);
  assert.equal((t.match(/font-medium text-ink"/g) ?? []).length, 2, "solo los dos distintos de cero van destacados");
  assert.equal((t.match(/text-ink-muted"><span>/g) ?? []).length, 2, "los ceros quedan tenues");
  assert.match(texto(html(createElement(CalidadVista, { calidad: calidad([ind("sinClasificar", 0)]) }))), /Sin observaciones en el mes/);
  assert.match(texto(html(createElement(CalidadVista, { calidad: calidad([ind("sinClasificar", 1)]) }))), /1 indicador con movimientos/);
});

test("lo distinto de cero lo dice el texto (negrita y la cuenta), no solo el color", () => {
  const nuevo = indicadoresConValor([ind("sinClasificar", 0), ind("otraMoneda", 3), ind("chequeIvaAmbiguo", 0)]);
  assert.deepEqual(nuevo.map((i) => i.clave), ["otraMoneda"]);
});

// ---- Zona de administración ------------------------------------------------------------------------------------

test("la zona de administración es una pieza aparte con su propio título y solo se genera si existe el control (ADMIN)", () => {
  const z = html(createElement(ZonaAdminVista, null, createElement("p", null, "contenido")));
  assert.match(z, /class="dash-admin"/);
  assert.match(z, /Solo administración/);
  const page = sinComentarios(leer("app/dashboard/page.tsx"));
  const iCondicion = page.indexOf("{cargas.control && (");
  assert.ok(iCondicion > -1);
  for (const nombre of ["<ZonaAdminVista>", "<SinAsignarCargado", "<ControlCargado"]) {
    assert.equal((page.match(new RegExp(nombre, "g")) ?? []).length, 1, nombre);
    assert.ok(page.indexOf(nombre) > iCondicion, `${nombre} solo dentro de la condición del control`);
  }
  // la vista de calidad no pinta «Sin asignar» ni importa su vista
  assert.doesNotMatch(sinComentarios(leer("app/dashboard/vistas.tsx")).split("export function ZonaAdminVista")[0], /SinAsignarVista|Sin asignar/);
});

// ---- Reglas de estilo ------------------------------------------------------------------------------------------

const CSS = leer("app/globals.css");
// Desde el comentario que abre la sección (con su «/*»), hasta el final del archivo: todo lo agregado por el dashboard.
const DASH_CSS = CSS.slice(CSS.lastIndexOf("/*", CSS.indexOf("Dashboard (/dashboard)")));
const TSX = readdirSync(join(RAIZ, "app", "dashboard")).filter((a) => a.endsWith(".tsx")).map((a) => [a, sinComentarios(leer(`app/dashboard/${a}`))] as const);

test("estilo: sin degradados decorativos, sin sombras difusas y sin mayúsculas con espaciado en los títulos", () => {
  assert.ok(DASH_CSS.length > 1000);
  assert.doesNotMatch(DASH_CSS, /gradient\(/);
  for (const m of DASH_CSS.matchAll(/box-shadow:([^;]+);/g)) assert.doesNotMatch(m[1], /\d+px \d+px \d+px/, "solo anillos de 1px, sin sombra difusa");
  for (const [archivo, f] of TSX) {
    assert.doesNotMatch(f, /\buppercase\b|tracking-\[|tracking-(wide|wider|widest)\b/, archivo);
    assert.doesNotMatch(f, /\bshadow(-[a-z0-9/]+)?\b/, `${archivo}: sin sombras de utilidades`);
    assert.doesNotMatch(f, /bg-gradient|from-|to-\w+\/?/, archivo);
  }
});

test("estilo: los radios no son todos iguales (hero, tarjeta, zona de administración, etiquetas y barras difieren)", () => {
  const radios = new Set([...DASH_CSS.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim()));
  assert.ok(radios.size >= 4, [...radios].join(" | "));
});

test("movimiento: un solo @keyframes (el llenado de las barras), solo con prefers-reduced-motion: no-preference, y sin animate-* en ninguna vista", () => {
  assert.equal((DASH_CSS.match(/@keyframes/g) ?? []).length, 1);
  assert.match(DASH_CSS, /@keyframes dash-llenar/);
  const bloque = DASH_CSS.slice(DASH_CSS.indexOf("@media (prefers-reduced-motion: no-preference)"));
  assert.ok(bloque.indexOf("animation: dash-llenar") > -1 && bloque.indexOf("animation: dash-llenar") < bloque.indexOf("@keyframes"), "la animación vive dentro del bloque de no-preference");
  const fuera = DASH_CSS.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/, "");
  assert.doesNotMatch(fuera.replace(/animation: none !important;/g, ""), /animation\s*:|transition\s*:/);
  for (const [archivo, f] of TSX) {
    assert.doesNotMatch(f, /animate-|motion-safe:|transition\b/, archivo);
  }
});

test("accesibilidad: foco visible en enlaces y resumen, barras con rol y valor en texto, regiones con título", () => {
  assert.match(DASH_CSS, /\.dash-pagina a:focus-visible,\s*\.dash-pagina summary:focus-visible\s*\{\s*outline: 2px solid/);
  const vistas = sinComentarios(leer("app/dashboard/vistas.tsx"));
  assert.match(vistas, /role="progressbar"/);
  assert.match(vistas, /aria-valuetext=\{texto\}/);
  const page = sinComentarios(leer("app/dashboard/page.tsx"));
  for (const id of ["resumen", "avance", "calidad"]) assert.match(page, new RegExp(`aria-labelledby="${id}"`));
  assert.match(page, /<main className="dash-pagina /);
});

test("impresión: hay @media print, se ocultan banda, selector y progreso, y las tarjetas no se cortan", () => {
  const impresion = DASH_CSS.slice(DASH_CSS.indexOf("@media print"));
  assert.match(impresion, /\.dash-noprint \{\s*display: none !important;/);
  assert.match(impresion, /break-inside: avoid/);
  assert.match(impresion, /print-color-adjust: exact/);
  assert.match(sinComentarios(leer("app/dashboard/page.tsx")), /<header className="dash-noprint /);
  assert.match(sinComentarios(leer("app/dashboard/Progreso.tsx")), /dash-noprint/);
  assert.match(sinComentarios(leer("app/dashboard/vistas.tsx")), /className="dash-seg dash-noprint"/);
});

test("responsive: la grilla de empresas se adapta al ancho (1, 2 o 3 columnas) y los márgenes son de 16 px en el celular", () => {
  assert.match(DASH_CSS, /\.dash-grilla \{[^}]*repeat\(auto-fill, minmax\(min\(100%, 21rem\), 1fr\)\)/);
  assert.match(sinComentarios(leer("app/dashboard/page.tsx")), /px-4 py-6 sm:px-6 sm:py-10/);
});

// Todos los selectores de un CSS, también los anidados en @media. Los @-reglas no cuentan, ni los pasos (from/to) de un @keyframes.
function selectoresDe(css: string): string[] {
  const texto = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const pila: ("keyframes" | "otra")[] = [];
  const selectores: string[] = [];
  let preludio = "";
  for (const c of texto) {
    if (c === "{") {
      const p = preludio.trim();
      if (p.startsWith("@")) pila.push(/^@(-\w+-)?keyframes/.test(p) ? "keyframes" : "otra");
      else {
        if (!pila.includes("keyframes")) selectores.push(...p.split(",").map((s) => s.trim()));
        pila.push("otra");
      }
      preludio = "";
    } else if (c === "}") {
      pila.pop();
      preludio = "";
    } else if (c === ";") {
      preludio = "";
    } else {
      preludio += c;
    }
  }
  return selectores;
}

test("el estilo vive solo en globals.css con prefijo .dash-: TODOS los selectores nuevos (también los de @media print) lo llevan; ninguno toca body, :root ni otras pantallas", () => {
  const selectores = selectoresDe(DASH_CSS);
  assert.ok(selectores.length > 30, `se analizaron ${selectores.length} selectores`);
  for (const s of selectores) {
    assert.match(s, /\.dash-/, `selector sin el prefijo .dash-: «${s}»`);
    assert.doesNotMatch(s, /^(body|html|:root|\*|main|a|h[1-6])\b/, s);
  }
  // el analizador ve también lo anidado: la sección de impresión aporta sus selectores
  assert.ok(selectores.includes(".dash-noprint") && selectores.includes(".dash-pagina a"));
  // las variables propias llevan el mismo prefijo
  assert.deepEqual([...DASH_CSS.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]).sort(), ["--dash-acero", "--dash-dorado"]);
  assert.doesNotMatch(DASH_CSS, /var\(--(acero|dorado)\)/);
  // el analizador no se queda mudo: detecta un selector sin prefijo escondido en un @media
  assert.deepEqual(selectoresDe("@media print { body { color: red; } .dash-x { color: blue; } } @keyframes k { from { a: b } to { a: c } }"), ["body", ".dash-x"]);
});
