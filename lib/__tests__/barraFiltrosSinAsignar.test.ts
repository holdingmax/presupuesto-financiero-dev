import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UNIDADES_NEGOCIO } from "@/lib/unidadesNegocio";
import { UNIDAD_SIN_ASIGNAR } from "@/lib/filtrosEjecucion";

const barra = readFileSync("app/ejecucion/BarraFiltros.tsx", "utf8");
const panel = readFileSync("app/ejecucion/PanelImputacion.tsx", "utf8");

test("SIN ASIGNAR es solo del filtro: no entra en la lista cerrada de unidades", () => {
  assert.equal((UNIDADES_NEGOCIO as readonly string[]).includes(UNIDAD_SIN_ASIGNAR), false);
});

test("BarraFiltros ofrece la opción fija SIN ASIGNAR en el select de unidad", () => {
  assert.match(barra, /<option value=\{UNIDAD_SIN_ASIGNAR\}>/);
});

test("el aviso rojo enlaza cada unidad a la base con ?unidad=", () => {
  assert.match(panel, /sinUnidadAsignada\.map\(\(s, i\)/);
  assert.match(panel, /aQuery\(\{ soloSinClasificar: false, unidad: s\.unidad \}\)/);
});

test("el form de BarraFiltros se remonta cuando cambian los filtros de la URL (defaultValue no se actualiza solo)", () => {
  assert.match(barra, /<form key=\{aQuery\(filtros\)\}/);
});
