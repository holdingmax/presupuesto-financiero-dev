import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { armarReporte, type FilaReporte, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import { EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE } from "@/lib/config";
import { formatearImporte } from "@/app/ejecucion/formato";
import { mesesDePrueba } from "./fixtures/datosGerente";

// Vista del gerente: en Disponibilidades el saldo se repite bajo Presupuestado y Real (P = R); % Avance y
// Falta ejecutar quedan vacíos. Mismo componente en Mes en curso, Todos los meses y Columnas juntas.

function reporteDelGerente(slug: string): Reporte {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  return armarReporte(plantilla, mesesDePrueba(plantilla), 1, {
    verBloquesReservados: accesoReservadosDelReporte(false, slug),
  });
}

const importe = (centavos: number) => (centavos < 0 ? "-" : "") + formatearImporte(Math.abs(centavos) / 100);

// (a) P = R en cada línea de Disponibilidades del gerente, en todas las empresas con el interruptor.
for (const slug of EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE) {
  test(`${slug}: en Disponibilidades del gerente, presupuestado === real en cada línea`, () => {
    const r = reporteDelGerente(slug);
    assert.equal(r.sinBloquesReservados, true);
    const lineas = r.filas.filter((f) => f.fila.bloque === "DISPONIBILIDADES" && f.fila.tipo === "linea");
    assert.ok(lineas.length > 0);
    let conValor = 0;
    for (const f of lineas) {
      for (const c of f.celdas) {
        assert.equal(c.presupuestado, c.real, f.fila.clave);
        if (c.real !== null) conValor++;
      }
    }
    assert.ok(conValor > 0, "alguna fila trae valor");
  });
}

// (b) Se renderiza FilaTabla con soloSaldo. El componente importa next/font, que no corre fuera de Next:
// se reemplaza solo en este proceso de test.
const req = createRequire(import.meta.url);
const rutaFont = req.resolve("next/font/google");
req.cache[rutaFont] = {
  id: rutaFont,
  filename: rutaFont,
  loaded: true,
  exports: { Poppins: () => ({ variable: "", className: "" }) },
} as unknown as NodeJS.Module;

async function dibujar(filaReporte: FilaReporte, meses: number): Promise<string> {
  const { FilaTabla } = await import("@/app/[empresa]/[periodo]/reporte/ReportePlantilla");
  const elemento = createElement(
    "table",
    null,
    createElement(
      "tbody",
      null,
      createElement(FilaTabla, {
        filaReporte,
        meses,
        verPendientes: false,
        verControl: false,
        carga: null,
        idsEditables: new Set<string>(),
        idsTipeables: new Set<string>(),
        borrable: false,
        empresaSlug: "brillante",
        periodo: "2026-11",
        soloLecturaPorMes: Array.from({ length: meses }, () => false),
        soloSaldo: true,
      })
    )
  );
  return renderToStaticMarkup(elemento);
}

const celdasDe = (html: string) => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());

test("FilaTabla con soloSaldo: una línea de Disponibilidades trae el saldo en Presupuestado y en Real, y % y falta vacíos", async () => {
  const r = reporteDelGerente("brillante");
  const f = r.filas.find((x) => x.fila.tipo === "linea" && x.fila.bloque === "DISPONIBILIDADES" && x.celdas[0].real !== null)!;
  assert.ok(f, "hay una línea de Disponibilidades con valor");
  const esperado = importe(f.celdas[0].real!);
  const celdas = celdasDe(await dibujar(f, r.periodos.length));
  // [rótulo, P, R, %, falta] por mes
  assert.equal(celdas[1], esperado, "Presupuestado");
  assert.equal(celdas[2], esperado, "Real");
  assert.equal(celdas[3], "", "% Avance");
  assert.equal(celdas[4], "", "Falta ejecutar");
});

test("FilaTabla con soloSaldo: el total de Disponibilidades también repite el saldo y deja % y falta vacíos", async () => {
  const r = reporteDelGerente("brillante");
  const f = r.filas.find((x) => x.fila.clave === "br.totalDisponibilidades")!;
  const esperado = importe(f.celdas[0].real!);
  const celdas = celdasDe(await dibujar(f, r.periodos.length));
  assert.equal(celdas[1], esperado);
  assert.equal(celdas[2], esperado);
  assert.equal(celdas[3], "");
  assert.equal(celdas[4], "");
});

test("FilaTabla con soloSaldo: el rótulo «Saldo» queda sobre Presupuestado y sobre Real de cada mes", async () => {
  const r = reporteDelGerente("brillante");
  const titulo = r.filas.find((x) => x.fila.clave === "br.tituloDisponibilidades")!;
  const celdas = celdasDe(await dibujar(titulo, 1));
  assert.deepEqual(celdas.slice(1, 3), ["Saldo", "Saldo"]);
});
