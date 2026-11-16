import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIN_FILTROS,
  aQuery,
  coincide,
  hayFiltros,
  hayFiltrosAdemasDeSinClasificar,
  parsearFiltros,
  type FilaFiltrable,
} from "@/lib/filtrosEjecucion";

function fila(parcial: Partial<FilaFiltrable> = {}): FilaFiltrable {
  return {
    fecha: "2026-09-10",
    concepto: "TRANSF. PAGO PROVEEDORES",
    bancoYCuenta: "SANT 123",
    clasificacion: "PROV Y SERV",
    unidadNegocio: "SPP",
    unidadesDesglose: [],
    ...parcial,
  };
}

test("sin parámetros no hay filtros y todo coincide", () => {
  const f = parsearFiltros({});
  assert.deepEqual(f, SIN_FILTROS);
  assert.equal(hayFiltros(f), false);
  assert.equal(aQuery(f), "");
  assert.equal(coincide(fila(), f), true);
});

test("el link viejo ?filtro=sin_clasificar sigue andando", () => {
  const f = parsearFiltros({ filtro: "sin_clasificar" });
  assert.equal(f.soloSinClasificar, true);
  assert.equal(aQuery(f), "filtro=sin_clasificar");
  assert.equal(coincide(fila({ clasificacion: "SIN CLASIFICAR" }), f), true);
  assert.equal(coincide(fila(), f), false);
  assert.equal(parsearFiltros({ filtro: "otra-cosa" }).soloSinClasificar, false);
});

test("parseo: descarta fechas inválidas y valores vacíos, toma el primero de los repetidos", () => {
  const f = parsearFiltros({ desde: "2026-02-30", hasta: "no", clasificacion: "  ", unidad: ["SPP", "RADIO"], q: " pago " });
  assert.equal(f.desde, undefined);
  assert.equal(f.hasta, undefined);
  assert.equal(f.clasificacion, undefined);
  assert.equal(f.unidad, "SPP");
  assert.equal(f.texto, "pago");
});

test("aQuery y parsearFiltros son inversos (con caracteres que se escapan)", () => {
  const f = parsearFiltros({
    filtro: "sin_clasificar",
    desde: "2026-09-01",
    hasta: "2026-09-30",
    clasificacion: "DEP CH 3°",
    unidad: "SPP",
    cuenta: "SANT 123",
    q: "a&b=c ñ",
  });
  const q = aQuery(f);
  assert.deepEqual(parsearFiltros(Object.fromEntries(new URLSearchParams(q))), f);
  // La página no forma parte de los filtros pero la paginación la agrega sin perderlos.
  assert.equal(aQuery(f, 3), `${q}&pagina=3`);
  assert.equal(aQuery(f, 1), q);
});

test("fecha: desde y hasta son inclusivos en ambos extremos", () => {
  const f = parsearFiltros({ desde: "2026-09-10", hasta: "2026-09-12" });
  assert.equal(coincide(fila({ fecha: "2026-09-09" }), f), false);
  assert.equal(coincide(fila({ fecha: "2026-09-10" }), f), true);
  assert.equal(coincide(fila({ fecha: "2026-09-12" }), f), true);
  assert.equal(coincide(fila({ fecha: "2026-09-13" }), f), false);
  // Un solo extremo.
  assert.equal(coincide(fila({ fecha: "2026-01-01" }), parsearFiltros({ hasta: "2026-09-10" })), true);
  assert.equal(coincide(fila({ fecha: "2030-01-01" }), parsearFiltros({ desde: "2026-09-10" })), true);
});

test("texto: contenido, sin distinguir mayúsculas ni tildes", () => {
  const f = parsearFiltros({ q: "pagó" });
  assert.equal(coincide(fila({ concepto: "PAGO A PROVEEDOR" }), f), true);
  assert.equal(coincide(fila({ concepto: "Cobro" }), f), false);
  assert.equal(coincide(fila({ concepto: "Débito automático" }), parsearFiltros({ q: "DEBITO AUTO" })), true);
});

test("unidad: la de la fila o cualquiera de las de su desglose", () => {
  const f = parsearFiltros({ unidad: "RADIO" });
  assert.equal(coincide(fila({ unidadNegocio: "RADIO" }), f), true);
  assert.equal(coincide(fila({ unidadNegocio: "SPP", unidadesDesglose: ["HWC", "RADIO"] }), f), true);
  assert.equal(coincide(fila({ unidadNegocio: "SPP", unidadesDesglose: ["HWC"] }), f), false);
});

test("clasificación y cuenta: igualdad exacta", () => {
  assert.equal(coincide(fila(), parsearFiltros({ clasificacion: "PROV Y SERV" })), true);
  assert.equal(coincide(fila(), parsearFiltros({ clasificacion: "OTROS" })), false);
  assert.equal(coincide(fila(), parsearFiltros({ cuenta: "SANT 123" })), true);
  assert.equal(coincide(fila(), parsearFiltros({ cuenta: "SANT 12" })), false);
});

test("los filtros se combinan entre sí y con 'sin clasificar' (todos tienen que cumplirse)", () => {
  const f = parsearFiltros({ filtro: "sin_clasificar", desde: "2026-09-01", unidad: "SPP", q: "transf" });
  const ok = fila({ clasificacion: "SIN CLASIFICAR" });
  assert.equal(coincide(ok, f), true);
  assert.equal(coincide({ ...ok, clasificacion: "OTROS" }, f), false);
  assert.equal(coincide({ ...ok, fecha: "2026-08-31" }, f), false);
  assert.equal(coincide({ ...ok, unidadNegocio: "RADIO" }, f), false);
  assert.equal(coincide({ ...ok, concepto: "COBRO" }, f), false);
});

test("hayFiltrosAdemasDeSinClasificar distingue el caso del mensaje de resultado vacío", () => {
  assert.equal(hayFiltrosAdemasDeSinClasificar(parsearFiltros({ filtro: "sin_clasificar" })), false);
  assert.equal(hayFiltrosAdemasDeSinClasificar(parsearFiltros({ filtro: "sin_clasificar", q: "x" })), true);
  assert.equal(hayFiltrosAdemasDeSinClasificar(parsearFiltros({ unidad: "SPP" })), true);
  assert.equal(hayFiltros(parsearFiltros({ unidad: "SPP" })), true);
});

test("el Total en centavos enteros da lo mismo que la suma decimal de la base (sin filtros)", () => {
  // Misma cuenta que vistaDeLaSemana (centavos enteros / 100) contra el _sum de Prisma (Decimal exacto).
  const importes = ["41478182.01", "-1234.57", "0.10", "0.20", "-0.30", "999999999.99"];
  const centavos = importes.reduce((a, t) => a + Math.round(Number(t) * 100), 0);
  const exacto = (41478182.01 - 1234.57 + 0.1 + 0.2 - 0.3 + 999999999.99).toFixed(2);
  assert.equal((centavos / 100).toFixed(2), exacto);
});

test("unidad: compara igual que el aviso (upper + trim), no solo texto exacto", () => {
  const f = parsearFiltros({ unidad: "SPP" });
  assert.equal(coincide(fila({ unidadNegocio: "spp " }), f), true);
  assert.equal(coincide(fila({ unidadNegocio: "SPPX" }), f), false);
});

test("SIN ASIGNAR: muestra lo que cuenta el aviso — sin ignorados y con desglose por sus porciones", () => {
  const f = parsearFiltros({ unidad: "SIN ASIGNAR" });
  assert.equal(coincide(fila({ unidadNegocio: "SIN ASIGNAR" }), f), true);
  assert.equal(coincide(fila({ unidadNegocio: " sin asignar " }), f), true);
  assert.equal(coincide(fila({ unidadNegocio: "SIN ASIGNAR", ignorado: true }), f), false);
  assert.equal(coincide(fila({ unidadNegocio: "SPP" }), f), false);
  // Prorrateado: vale por sus porciones, no por su unidad propia.
  assert.equal(coincide(fila({ unidadNegocio: "SIN ASIGNAR", unidadesDesglose: ["HWC", "RADIO"] }), f), false);
  assert.equal(coincide(fila({ unidadNegocio: "SPP", unidadesDesglose: ["HWC", "SIN ASIGNAR"] }), f), true);
});

test("un valor viejo fuera de lista (ej. CREAR) también excluye ignorados; una unidad real no", () => {
  assert.equal(coincide(fila({ unidadNegocio: "CREAR", ignorado: true }), parsearFiltros({ unidad: "CREAR" })), false);
  assert.equal(coincide(fila({ unidadNegocio: "SPP", ignorado: true }), parsearFiltros({ unidad: "SPP" })), true);
});
