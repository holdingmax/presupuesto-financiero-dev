import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FilaDeAvance, CeldaDeAvance, RitmoDelMes, TotalDeAvance } from "@/lib/dashboard/avance";
import { etiquetasDeFila, mostrarRitmoPropio } from "@/lib/dashboard/presentacion";
import { FilaCargandoVista, FilaConErrorVista, FilaDeAvanceVista, PieDeTotalesVista, TituloDeAvance, ZonaAdminVista } from "@/app/dashboard/vistas";
import { armarEncabezadoDeAvance } from "@/lib/dashboard/encabezado";

// SEGUNDA PASADA visual de /dashboard: color con significado, hero oscuro, tarjetas con personalidad, contrastes MEDIDOS desde los
// valores reales del CSS (no desde una tabla aparte) y que el color no sea un veredicto. Los tests de seguridad están en
// pantalla.test.ts y no se tocan.

const RAIZ = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const CSS = leer("app/globals.css");
const DASH_CSS = CSS.slice(CSS.lastIndexOf("/*", CSS.indexOf("Dashboard (/dashboard)")));

// ---- Lectura del CSS -------------------------------------------------------------------------------------------

function variable(nombre: string): string {
  const m = new RegExp(`${nombre}:\\s*(#[0-9a-fA-F]{6})`).exec(DASH_CSS);
  assert.ok(m, `falta la variable ${nombre}`);
  return m[1].toLowerCase();
}
// Propiedades de la PRIMERA regla cuyo selector es exactamente `selector`.
function regla(selector: string): Record<string, string> {
  const i = DASH_CSS.indexOf(`\n${selector} {`);
  assert.ok(i > -1, `falta la regla ${selector}`);
  const cuerpo = DASH_CSS.slice(DASH_CSS.indexOf("{", i) + 1, DASH_CSS.indexOf("}", i));
  return Object.fromEntries(cuerpo.split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).replace(/\/\*.*?\*\//g, "").trim()]));
}
const hexDe = (valor: string): string => {
  const m = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/.exec(valor);
  assert.ok(m, valor);
  const h = m[0].toLowerCase();
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h; // #fff -> #ffffff
};

// ---- Contraste WCAG --------------------------------------------------------------------------------------------

const canal = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
const lineal = (c: number) => ((c / 255) <= 0.03928 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4);
const luz = (h: string) => 0.2126 * lineal(canal(h, 0)) + 0.7152 * lineal(canal(h, 1)) + 0.0722 * lineal(canal(h, 2));
const contraste = (a: string, b: string) => {
  const [x, y] = [luz(a), luz(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const mezcla = (frente: string, fondo: string, alfa: number) =>
  "#" + [0, 1, 2].map((i) => Math.round(canal(frente, i) * alfa + canal(fondo, i) * (1 - alfa)).toString(16).padStart(2, "0")).join("");

const BLANCO = "#ffffff";
const MARINO = variable("--dash-marino");
const AZUL = variable("--dash-azul");
const AZUL_CLARO = variable("--dash-azul-claro");
const AZUL_PISTA = variable("--dash-azul-pista");
const TEAL = variable("--dash-teal");
const TEAL_TEXTO = variable("--dash-teal-texto");
const TEAL_PISTA = variable("--dash-teal-pista");
const DORADO = variable("--dash-dorado");
const DORADO_VIVO = variable("--dash-dorado-vivo");

const TEXTO_MIN = 4.5;
const GRAFICO_MIN = 3;
const ok = (valor: number, minimo: number, que: string) => assert.ok(valor >= minimo, `${que}: ${valor.toFixed(2)}:1 (mínimo ${minimo}:1)`);

test("la paleta: 6 colores con significado fijo y valores exactos (azul egresos, teal ingresos, dorado ritmo, marino, pistas)", () => {
  assert.deepEqual([MARINO, AZUL, TEAL, DORADO, DORADO_VIVO].map((h) => h.length), [7, 7, 7, 7, 7]);
  assert.equal(AZUL, "#2563c9");
  assert.equal(TEAL, "#0e8c7f");
  assert.equal(MARINO, "#14233a");
});

test("contraste de TEXTO >= 4,5:1 sobre sus fondos reales", () => {
  ok(contraste(BLANCO, MARINO), TEXTO_MIN, "blanco sobre marino profundo (el % del hero)");
  ok(contraste(mezcla(BLANCO, MARINO, 0.85), MARINO), TEXTO_MIN, "blanco 85% sobre marino (rótulos del hero)");
  ok(contraste(mezcla(BLANCO, MARINO, 0.75), MARINO), TEXTO_MIN, "blanco 75% sobre marino (notas del hero)");
  ok(contraste(AZUL, BLANCO), TEXTO_MIN, "% de egresos sobre la tarjeta");
  ok(contraste(TEAL_TEXTO, BLANCO), TEXTO_MIN, "% de ingresos sobre la tarjeta");
  ok(contraste("#5b645f", "#eef2f7"), TEXTO_MIN, "tinta secundaria sobre el fondo de la página");
  ok(contraste("#14233a", "#eef2f7"), TEXTO_MIN, "título marino sobre el fondo de la página");
  ok(contraste("#14233a", hexDe(regla(".dash-admin").background)), TEXTO_MIN, "título de la zona de administración");
  ok(contraste("#5b645f", hexDe(regla(".dash-admin").background)), TEXTO_MIN, "texto secundario en la zona de administración");
  ok(contraste(hexDe(regla(".dash-calidad li:not([data-con-valor])").color), BLANCO), TEXTO_MIN, "indicadores en cero");
  ok(contraste(MARINO, hexDe(regla(".dash-dato").background)), TEXTO_MIN, "datos de calidad");
  ok(contraste(hexDe(regla(".dash-calidad__resumen").color), hexDe(regla(".dash-calidad__resumen").background)), TEXTO_MIN, "píldora de calidad");
  ok(contraste(MARINO, hexDe(regla(".dash-seg a[aria-current=\"page\"]").background)), TEXTO_MIN, "mes activo del selector");
  ok(contraste(mezcla(BLANCO, MARINO, 0.88 * 1 + 0), mezcla(BLANCO, MARINO, 0.12)), TEXTO_MIN, "meses inactivos del selector (blanco 88% sobre la pastilla translúcida)");
  ok(contraste(BLANCO, MARINO), TEXTO_MIN, "monograma (iniciales blancas)");
});

test("contraste de las ETIQUETAS de estado >= 4,5:1 (ámbar, celeste y gris)", () => {
  for (const categoria of ["ambar", "celeste", "gris"]) {
    const r = regla(`.dash-etiqueta[data-categoria="${categoria}"]`);
    ok(contraste(hexDe(r.color), hexDe(r.background)), TEXTO_MIN, `etiqueta ${categoria}`);
  }
  const base = regla(".dash-etiqueta");
  ok(contraste(hexDe(base.color), hexDe(base.background)), TEXTO_MIN, "etiqueta base (moneda)");
  const aviso = leer("app/dashboard/vistas.tsx").match(/border-\[#e0a82e\] bg-\[(#[0-9a-f]{6})\][^"]*text-\[(#[0-9a-f]{6})\]/);
  assert.ok(aviso);
  ok(contraste(aviso[2], aviso[1]), TEXTO_MIN, "aviso de semanas provisorias");
});

test("contraste de los GRÁFICOS >= 3:1: relleno vs pista, relleno vs tarjeta, y la marca del ritmo en claro y en oscuro", () => {
  ok(contraste(AZUL, AZUL_PISTA), GRAFICO_MIN, "relleno de egresos vs su pista");
  ok(contraste(TEAL, TEAL_PISTA), GRAFICO_MIN, "relleno de ingresos vs su pista");
  ok(contraste(AZUL, BLANCO), GRAFICO_MIN, "relleno de egresos vs tarjeta");
  ok(contraste(TEAL, BLANCO), GRAFICO_MIN, "relleno de ingresos vs tarjeta");
  const pistaHero = mezcla(BLANCO, MARINO, 0.16);
  ok(contraste(AZUL_CLARO, pistaHero), GRAFICO_MIN, "relleno del hero vs su pista");
  ok(contraste(AZUL_CLARO, MARINO), GRAFICO_MIN, "relleno del hero vs el marino");
  // marca sobre fondos CLAROS: el núcleo oscuro contra la pista y la tarjeta; el anillo blanco la separa de los rellenos
  ok(contraste(DORADO, AZUL_PISTA), GRAFICO_MIN, "marca vs pista de egresos");
  ok(contraste(DORADO, TEAL_PISTA), GRAFICO_MIN, "marca vs pista de ingresos");
  ok(contraste(DORADO, BLANCO), GRAFICO_MIN, "marca vs tarjeta");
  ok(contraste(BLANCO, AZUL), GRAFICO_MIN, "anillo blanco de la marca vs relleno de egresos");
  ok(contraste(BLANCO, TEAL), GRAFICO_MIN, "anillo blanco de la marca vs relleno de ingresos");
  // marca sobre el hero OSCURO
  ok(contraste(DORADO_VIVO, MARINO), GRAFICO_MIN, "marca vs hero");
  ok(contraste(DORADO_VIVO, pistaHero), GRAFICO_MIN, "marca vs pista del hero");
  ok(contraste(MARINO, AZUL_CLARO), GRAFICO_MIN, "anillo oscuro de la marca vs relleno del hero");
  ok(contraste(AZUL, AZUL_PISTA), GRAFICO_MIN, "filo azul de la tarjeta (egresos)");
  assert.match(DASH_CSS, /\.dash-bar__marca \{[^}]*box-shadow: 0 0 0 2px #fff;/);
  assert.match(DASH_CSS, /\.dash-hero \.dash-bar__marca \{[^}]*box-shadow: 0 0 0 2px var\(--dash-marino\);/);
});

// ---- El color es identidad, no veredicto -----------------------------------------------------------------------

test("sin semáforo: ningún color depende del avance; el relleno es siempre el del tono (egresos azul, ingresos teal)", () => {
  const vistas = sinComentarios(leer("app/dashboard/vistas.tsx"));
  // la clase de la barra solo cambia con el tono, el tamaño y «excede» (que solo agrega un contorno blanco)
  assert.match(vistas, /className=\{`dash-bar dash-bar--\$\{tono\}\$\{grande \? " dash-bar--grande" : ""\}\$\{g\.excede \? " dash-bar--excede" : ""\}`\}/);
  assert.match(DASH_CSS, /\.dash-bar--excede \.dash-bar__relleno \{\s*box-shadow: inset 0 0 0 2px rgba\(255, 255, 255, 0\.55\);\s*\}/);
  assert.doesNotMatch(vistas, /avance\s*[<>]=?\s*\d|porcentaje\s*[<>]=?\s*\d|ritmo[^;\n]*[<>]=?\s*avance|avance[^;\n]*[<>]=?\s*ritmo/, "ningún umbral ni comparación entre avance y ritmo");
  assert.doesNotMatch(vistas, /text-positive|text-red|text-green|bg-red|bg-green|bg-verde|text-verde/);
  assert.equal(regla(".dash-bar__relleno").background, "var(--dash-azul)");
  assert.equal(regla(".dash-bar--ingresos .dash-bar__relleno").background, "var(--dash-teal)");
  // las únicas referencias a rojo/verde del sistema: el borde de «no se pudo cargar» (un error, no un veredicto)
  const usos = [...DASH_CSS.matchAll(/var\(--(negative|positive|verde|terracota)\)/g)].map((m) => m[1]);
  assert.deepEqual(usos, ["negative", "negative"], "solo el borde y el filo de la tarjeta con error de carga");
});

test("color con significado constante: egresos azul y ingresos teal en la muestra, el % y la barra de cada tarjeta", () => {
  const t = html(createElement(FilaDeAvanceVista, { fila: fila(), hrefReporte: "/b" }));
  assert.match(t, /dash-pct--egresos">\d+%</);
  assert.match(t, /dash-pct--ingresos">\d+%</);
  assert.equal((t.match(/dash-muestra dash-muestra--ingresos/g) ?? []).length, 1);
  assert.equal((t.match(/dash-bar--egresos/g) ?? []).length, 1);
  assert.equal((t.match(/dash-bar--ingresos/g) ?? []).length, 1);
  assert.equal(regla(".dash-pct--egresos").color, "var(--dash-azul)");
  assert.equal(regla(".dash-pct--ingresos").color, "var(--dash-teal-texto)");
  assert.equal(regla(".dash-muestra--ingresos").background, "var(--dash-teal)");
});

// ---- Hero ------------------------------------------------------------------------------------------------------

test("hero: azul marino profundo con un degradé sobrio, texto blanco, bordes redondeados; el resto de la página con un tinte, no blanco puro", () => {
  const hero = regla(".dash-hero");
  assert.match(hero.background, /^linear-gradient\(135deg, #0f1d33 0%, #14233a 55%, #1f3a63 100%\)$/);
  assert.equal(hero.color, "#fff");
  assert.equal(regla(".dash-fondo").background, "#eef2f7");
  assert.notEqual(regla(".dash-fondo").background, "#fff");
  const page = sinComentarios(leer("app/dashboard/page.tsx"));
  assert.match(page, /<div className="dash-fondo flex flex-1 flex-col">/);
  assert.match(page, /<section aria-labelledby="resumen" className="dash-hero">/);
  assert.match(page, /<SelectorDeMes periodo=\{periodo\} \/>/);
  // dentro del hero: título blanco, datos al y selector claros
  const e = html(createElement(TituloDeAvance, { encabezado: armarEncabezadoDeAvance("2026-11", [{ lunes: "2026-11-09", periodo: "2026-11", estado: "CERRADA", movimientos: 1, ultimaFecha: "2026-11-13" }]) }));
  assert.match(e, /<h1 id="resumen" class="[^"]*text-white/);
  assert.match(e, /class="dash-hero__chip">datos al/);
  assert.match(regla(".dash-hero__chip").color, /rgba\(255, 255, 255, 0\.9\)/);
});

test("el porcentaje del hero es blanco y enorme; la barra gruesa lleva la marca; la leyenda de la marca aparece UNA sola vez", () => {
  const t: TotalDeAvance = { moneda: "ARS", rotulo: "Total de tus empresas", presupuestado: 507_531_000_000, real: 218_932_000_000, avance: 43.1 };
  const h = html(createElement(PieDeTotalesVista, { totales: [t], ritmo: RITMO }));
  assert.match(h, /class="dash-num font-serif text-6xl leading-none font-semibold text-white sm:text-\[6\.5rem\]">43%</);
  assert.match(h, /dash-bar--grande/);
  assert.match(h, /dash-bar__marca/);
  assert.equal((texto(h).match(/Marca:/g) ?? []).length, 1);
  // Una pantalla completa: hero + tarjetas con el mismo ritmo => la leyenda aparece una sola vez en total.
  const tarjetas = ["Brillante", "Radio", "Fredy Publicidad"].map((n) => html(createElement(FilaDeAvanceVista, { fila: fila({ nombre: n }), hrefReporte: "/x", ritmoGeneral: RITMO })));
  const pantalla = texto([h, ...tarjetas].join(" "));
  assert.equal((pantalla.match(/Marca:/g) ?? []).length, 1, "una sola leyenda en toda la pantalla");
  for (const tj of tarjetas) assert.doesNotMatch(tj, /Marca:|<footer/);
});

test("la leyenda vuelve a la tarjeta solo si el ritmo de esa empresa difiere del general (ej. Avianor 40 %, 12 de 30)", () => {
  const avianor = fila({ nombre: "Avianor", ritmo: { diasConDatos: 12, diasDelMes: 30, porcentaje: 40 } });
  const t = texto(html(createElement(FilaDeAvanceVista, { fila: avianor, hrefReporte: "/a", ritmoGeneral: RITMO })));
  assert.match(t, /Marca: ritmo del mes 40% · 12 de 30 días con datos/);
  assert.equal(mostrarRitmoPropio(avianor.ritmo, RITMO), true);
  assert.equal(mostrarRitmoPropio(RITMO, RITMO), false);
  assert.equal(mostrarRitmoPropio({ ...RITMO }, { ...RITMO }), false);
  assert.equal(mostrarRitmoPropio(null, RITMO), false);
  assert.equal(mostrarRitmoPropio(RITMO, null), true, "sin ritmo general no se puede afirmar que sea igual");
  assert.equal(mostrarRitmoPropio(RITMO, undefined), true);
});

test("sin totales (una sola empresa por moneda) el hero conserva la leyenda de la marca, para que la marca de las barras se entienda", () => {
  const t = texto(html(createElement(PieDeTotalesVista, { totales: [], ritmo: RITMO })));
  assert.match(t, /Marca: ritmo del mes 43% · 13 de 30 días con datos/);
  assert.equal(html(createElement(PieDeTotalesVista, { totales: [], ritmo: null })), "");
});

test("un total sin datos («— de —») pasa a una línea compacta, sin barra ni número grande; el total con datos conserva la barra", () => {
  const sin: TotalDeAvance = { moneda: "USD", rotulo: "Total de tus empresas", presupuestado: null, real: null, avance: null };
  const h = html(createElement(PieDeTotalesVista, { totales: [sin], ritmo: RITMO }));
  assert.doesNotMatch(h, /progressbar|dash-bar|text-6xl/);
  assert.match(texto(h), /— — de —/);
  assert.match(texto(h), /no se muestra una suma parcial/);
  assert.doesNotMatch(texto(h), /\$\d|US\$ \d/);
  // principal completo + moneda secundaria sin datos: la secundaria es compacta (sin su propia barra)
  const completo: TotalDeAvance = { moneda: "ARS", rotulo: "Total de tus empresas", presupuestado: 507_531_000_000, real: 218_932_000_000, avance: 43.1 };
  const mixto = html(createElement(PieDeTotalesVista, { totales: [completo, sin], ritmo: RITMO }));
  assert.equal((mixto.match(/role="progressbar"/g) ?? []).length, 1, "solo la moneda con datos tiene barra");
  assert.match(texto(mixto), /\(US\$\)\s*— — de —/);
});

// ---- Tarjetas --------------------------------------------------------------------------------------------------

test("tarjeta: monograma con las iniciales (como en la home), nombre-enlace a todo el Reporte y jerarquía Real grande / presupuestado secundario", () => {
  const t = html(createElement(FilaDeAvanceVista, { fila: fila({ nombre: "Conexión Logística" }), hrefReporte: "/conexion-logistica/2026-11/reporte" }));
  assert.match(t, /<span class="dash-monograma" aria-hidden="true">CL<\/span>/);
  assert.match(t, /<a class="dash-card__enlace" href="\/conexion-logistica\/2026-11\/reporte">/);
  assert.match(t, /<article class="dash-card dash-card--enlace">/);
  assert.match(t, /font-serif text-\[2rem\][^>]*>\$39,4 M</, "el Real, en grande");
  assert.match(t, /text-sm text-ink-secondary">de <span[^>]*>\$67,5 M<\/span> presupuestado/, "el presupuestado, secundario");
  assert.match(t, /dash-pct--egresos">58%</, "el % en el color de su barra");
  assert.ok(t.indexOf("Egresos operativos") < t.indexOf("Ingresos"));
  // el filo de color de arriba y el hover viven en el CSS, solo en la tarjeta que lleva al Reporte
  assert.match(regla(".dash-card::before").background, /linear-gradient\(90deg, var\(--dash-azul\) 0 50%, var\(--dash-teal\) 50% 100%\)/);
  assert.equal(regla(".dash-card--enlace:hover")["border-color"], "var(--dash-azul)");
  assert.doesNotMatch(DASH_CSS, /\.dash-card:hover/, "el hover no está en todas las tarjetas");
  for (const cargando of [html(createElement(FilaCargandoVista, { nombre: "Radio" })), html(createElement(FilaConErrorVista, { nombre: "Radio" }))]) {
    assert.doesNotMatch(cargando, /dash-card--enlace|dash-card__enlace|<a /, "esqueleto y error no son enlaces ni tienen hover");
    assert.match(cargando, /dash-monograma/);
  }
});

test("el hover y el foco son discretos, sin transición, y el foco de la tarjeta-enlace rodea toda la tarjeta", () => {
  assert.doesNotMatch(DASH_CSS, /transition\s*:/);
  assert.match(DASH_CSS, /\.dash-card__enlace::after \{\s*content: "";\s*position: absolute;\s*inset: 0;/);
  assert.match(DASH_CSS, /\.dash-card__enlace:focus-visible::after \{\s*outline: 2px solid var\(--dash-azul\);/);
  assert.equal(regla(".dash-card__enlace:hover")["text-decoration"], "underline");
});

test("etiquetas de estado por CATEGORÍA: ámbar (Real manual pendiente, presupuesto sin validar), celeste (partes manuales o parciales), gris (sin Reporte por plantilla)", () => {
  const todas = etiquetasDeFila(fila({ cartelPresupuesto: "presupuesto sin validar", incluyePartesManualesOParciales: true, realManualPendiente: true }));
  assert.deepEqual(todas.map((e) => [e.texto, e.categoria]), [
    ["presupuesto sin validar", "ambar"],
    ["incluye partes manuales o parciales", "celeste"],
    ["Real manual pendiente", "ambar"],
  ]);
  assert.deepEqual(etiquetasDeFila(filaSinReporte()).map((e) => [e.texto, e.categoria]), [["sin Reporte por plantilla", "gris"]]);
  assert.deepEqual(etiquetasDeFila(fila({ cartelPresupuesto: "sin presupuesto" })).map((e) => e.categoria), ["ambar"]);
  const t = html(createElement(FilaDeAvanceVista, { fila: fila({ cartelPresupuesto: "presupuesto sin validar", incluyePartesManualesOParciales: true }), hrefReporte: "/b" }));
  assert.match(t, /<li class="dash-etiqueta" data-categoria="ambar">presupuesto sin validar<\/li>/);
  assert.match(t, /<li class="dash-etiqueta" data-categoria="celeste">incluye partes manuales o parciales<\/li>/);
  assert.match(html(createElement(FilaDeAvanceVista, { fila: filaSinReporte(), hrefReporte: "/e" })), /data-categoria="gris">sin Reporte por plantilla</);
  // son categorías: el estado va escrito y no hay ninguna etiqueta de «bien» o «mal»
  for (const e of todas) assert.doesNotMatch(e.texto, /bien|mal|atrasad|riesgo|alerta|crític/i);
});

// ---- Calidad y zona de administración --------------------------------------------------------------------------

test("calidad y zona de administración comparten el lenguaje de la tarjeta (borde, radio, colores) y la zona solo-admin se distingue con claridad", () => {
  const tarjeta = regla(".dash-card");
  const calidad = regla(".dash-calidad");
  assert.equal(calidad.border, tarjeta.border);
  assert.equal(calidad["border-radius"], tarjeta["border-radius"]);
  assert.equal(regla(".dash-calidad__resumen").background, regla('.dash-etiqueta[data-categoria="celeste"]').background, "píldora de calidad = celeste de las etiquetas");
  assert.equal(regla(".dash-calidad li[data-con-valor]")["box-shadow"], "inset 3px 0 0 var(--dash-azul)");
  const admin = regla(".dash-admin");
  assert.match(admin.border, /^2px dashed var\(--dash-marino\)$/);
  assert.notEqual(admin.background, calidad.background);
  assert.notEqual(admin.background, "#eef2f7", "distinto del fondo de la página");
  assert.notEqual(admin["border-radius"], tarjeta["border-radius"]);
  const z = html(createElement(ZonaAdminVista, null, createElement("p", null, "x")));
  assert.match(z, /<svg[^>]*role="presentation"/, "candado");
  assert.match(texto(z), /Solo administración/);
  assert.match(texto(z), /No se suman a ningún total/);
});

// ---- Se mantienen: responsive, foco, movimiento, impresión -----------------------------------------------------

test("se mantienen foco visible, un solo movimiento (el llenado de las barras), grilla adaptable e impresión", () => {
  assert.match(DASH_CSS, /\.dash-pagina a:focus-visible,\s*\.dash-pagina summary:focus-visible \{\s*outline: 2px solid var\(--dash-azul\);/);
  assert.match(DASH_CSS, /\.dash-pagina \.dash-hero a:focus-visible,\s*\.dash-pagina \.dash-hero summary:focus-visible \{\s*outline-color: #fff;/);
  assert.equal((DASH_CSS.match(/@keyframes/g) ?? []).length, 1);
  assert.match(DASH_CSS, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.dash-bar__relleno \{\s*animation: dash-llenar/);
  assert.match(DASH_CSS, /repeat\(auto-fill, minmax\(min\(100%, 21rem\), 1fr\)\)/);
  const impresion = DASH_CSS.slice(DASH_CSS.indexOf("@media print"));
  assert.match(impresion, /\.dash-fondo \{\s*background: #fff;/);
  assert.match(impresion, /\.dash-hero,\s*\.dash-card::before,\s*\.dash-monograma,[\s\S]*print-color-adjust: exact/, "el hero oscuro y los colores se imprimen");
  assert.match(impresion, /break-inside: avoid/);
  assert.doesNotMatch(sinComentarios(leer("app/dashboard/vistas.tsx")), /animate-|transition\b|motion-safe:/);
});

test("los degradés son solo dos y sobrios: el del hero y el filo de dos colores de la tarjeta; el resto es plano", () => {
  const gradientes = [...DASH_CSS.matchAll(/(linear|radial|conic)-gradient\(/g)];
  assert.equal(gradientes.length, 2);
  assert.doesNotMatch(DASH_CSS, /radial-gradient|conic-gradient/);
  for (const [archivo, f] of [["vistas.tsx", leer("app/dashboard/vistas.tsx")], ["page.tsx", leer("app/dashboard/page.tsx")], ["Progreso.tsx", leer("app/dashboard/Progreso.tsx")]]) {
    assert.doesNotMatch(sinComentarios(f), /gradient|\buppercase\b|tracking-\[|tracking-(wide|wider|widest)\b|\bshadow\b/, archivo);
  }
});

// ---- Datos de prueba -------------------------------------------------------------------------------------------

const RITMO: RitmoDelMes = { diasConDatos: 13, diasDelMes: 30, porcentaje: (13 / 30) * 100 };
const celda = (p: number | null, r: number | null): CeldaDeAvance => ({
  presupuestado: p, real: r, avance: p !== null && r !== null && p !== 0 ? (r / p) * 100 : null, presupuestoIncompleto: false, realIncompleto: false,
});
function fila(extra: Partial<FilaDeAvance> = {}): FilaDeAvance {
  return {
    empresaId: "brillante", nombre: "Brillante", slug: "brillante", moneda: "ARS", sinReporte: false, estadoPresupuesto: "validado", cartelPresupuesto: null,
    incluyePartesManualesOParciales: false, realManualPendiente: false, corte: "2026-11-13", ritmo: RITMO,
    ingresos: celda(74_258_000_00, 10_009_000_00), egresosOperativos: celda(67_496_000_00, 39_429_000_00), ...extra,
  };
}
function filaSinReporte(): FilaDeAvance {
  return fila({ empresaId: "expensas", nombre: "Expensas", slug: "expensas", sinReporte: true, ritmo: null, ingresos: null, egresosOperativos: null, estadoPresupuesto: null });
}
