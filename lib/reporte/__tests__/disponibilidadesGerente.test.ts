import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarReporte, camposManuales, esBloqueReservado, esFilaDeCierreVisibleParaGerente, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { accesoReservadosDelReporte } from "@/lib/reporte/visibilidad";
import {
  EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE,
  EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE,
} from "@/lib/config";
import {
  BLOQUES_CARGABLES,
  celdaDeEntrada,
  manualDeEntrada,
  planDeCarga,
  vistaDeCarga,
  type ValorManualParaCarga,
} from "@/lib/reporte/cargaGerente";
import { veBloquesReservadosDelReporte } from "@/lib/permisosEjecucion";
import { CENTINELA, clavesDeCierre, mesesDePrueba } from "./fixtures/datosGerente";

// Etapa 5 B, commit 4: Disponibilidades en SOLO LECTURA para el gerente, prendido solo en Brillante.
// Cada fila reservada de las plantillas lleva el centinela 7.000.000.000.000 (fixtures/datosGerente.ts):
// donde aparezca algo del orden de los billones, es un dato de Disponibilidades.

const GOLDEN = JSON.parse(
  readFileSync(new URL("./fixtures/gerenteSinReservados.json", import.meta.url), "utf-8")
) as Record<string, unknown>;

// En centavos: muy por debajo del centinela (7e12) y muy por encima de cualquier dato de prueba.
const UMBRAL = 1e12;
const PATRON_CENTINELA = /7000000000\d{3}/;

function proyeccion(r: Reporte) {
  return JSON.parse(
    JSON.stringify({
      periodos: r.periodos,
      sinPresupuesto: r.sinPresupuesto,
      sinEjecucion: r.sinEjecucion,
      pendientes: r.pendientes,
      arrastre: r.arrastre,
      sinBloquesReservados: r.sinBloquesReservados,
      filas: r.filas.map((f) => [
        f.fila.clave,
        f.celdas.map((c) => [c.presupuestado, c.real, c.avance, c.faltaEjecutar, c.presupuestoIncompleto, c.realIncompleto]),
      ]),
    })
  );
}

function reporteDelGerente(slug: string): Reporte {
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  // Con los interruptores de producción (lib/config.ts), como lo arma el servidor.
  return armarReporte(plantilla, mesesDePrueba(plantilla), 1, {
    verBloquesReservados: accesoReservadosDelReporte(false, slug),
  });
}

// Empresas cuyo gerente ve Disponibilidades hoy: Brillante y la segunda tanda. Fijada a propósito: sumar otra
// empresa tiene que obligar a tocar este test.
const CON_DISPONIBILIDADES_HOY = ["brillante", "fredy-publicidad", "hwc", "avianor", "mantenor", "havanna", "radio", "conexion-logistica", "bradenton", "plate-silver"];

test("interruptores: Disponibilidades y Cierre en las mismas diez empresas (el alias de testing de Conexión y Havanna Perú, fuera)", () => {
  assert.ok(EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes("brillante"));
  assert.deepEqual([...EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE], CON_DISPONIBILIDADES_HOY);
  assert.deepEqual([...EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE], CON_DISPONIBILIDADES_HOY);
  for (const slug of ["conexion-logistica-spp", "havanna-peru"]) {
    assert.equal(EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE.includes(slug), false, slug);
  }
});

// ---- Las empresas que siguen fuera no cambian ----------------------------------------------------

const FUERA_DEL_INTERRUPTOR = Object.keys(PLANTILLAS_POR_SLUG).filter((s) => !EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE.includes(s));

test("las empresas que siguen fuera incluyen al alias de testing de Conexión y a Havanna Perú", () => {
  for (const slug of ["conexion-logistica-spp", "havanna-peru"]) {
    assert.ok(FUERA_DEL_INTERRUPTOR.includes(slug), slug);
  }
});

for (const slug of FUERA_DEL_INTERRUPTOR) {
  test(`${slug}: con el interruptor apagado el Reporte del gerente sigue idéntico a la foto del commit 3`, () => {
    assert.equal(accesoReservadosDelReporte(false, slug), false);
    assert.deepEqual(proyeccion(reporteDelGerente(slug)), GOLDEN[slug]);
  });
}

// ---- Brillante: solo Disponibilidades ------------------------------------------------------------

test("Brillante: el gerente recibe las filas de Disponibilidades (11 + título + total) y, de Cierre, solo Saldo, Capital y Disponible", () => {
  const plantilla = PLANTILLAS_POR_SLUG["brillante"];
  const r = reporteDelGerente("brillante");
  const deDisp = r.filas.filter((f) => f.fila.bloque === "DISPONIBILIDADES");
  assert.deepEqual(
    deDisp.map((f) => f.fila.clave),
    plantilla.filas.filter((f) => f.bloque === "DISPONIBILIDADES").map((f) => f.clave)
  );
  assert.equal(deDisp.filter((f) => f.fila.tipo === "linea").length, 11);
  assert.equal(deDisp.filter((f) => f.fila.tipo === "total").length, 1); // TOTAL DISPONIBILIDADES
  assert.equal(deDisp.some((f) => f.fila.clave === "br.dRecuperoBlanqueo"), true);
  // De Cierre, las tres filas de la planilla; nunca «Disponible antes de gastos», ni arrastre.
  assert.deepEqual(clavesDeCierre(r), ["br.saldo", "br.capital", "br.disponible"]);
  assert.equal(r.filas.some((f) => f.fila.clave === "br.disponibleAntes"), false);
  assert.ok(r.arrastre.every((a) => a === null));
  // Capital y Disponible solo tienen Presupuestado (como en el Excel): sin Real, % ni falta.
  for (const k of ["br.capital", "br.disponible"]) {
    const c = r.filas.find((f) => f.fila.clave === k)!.celdas[0];
    assert.notEqual(c.presupuestado, null, k);
    assert.equal(c.real, null, k);
    assert.equal(c.avance, null, k);
    assert.equal(c.faltaEjecutar, null, k);
  }
});

test("Brillante: los centinelas de Disponibilidades aparecen SOLO en Disponibilidades y en las tres filas de Cierre que se calculan con ellas", () => {
  const r = reporteDelGerente("brillante");
  const aparece = (valor: number | null) => valor !== null && Math.abs(valor) >= UMBRAL;
  const conCentinela = r.filas.filter((f) => f.celdas.some((c) => aparece(c.presupuestado) || aparece(c.real)));
  assert.ok(conCentinela.length > 0, "las filas de Disponibilidades sí traen su valor");
  for (const f of conCentinela) {
    const permitida = f.fila.bloque === "DISPONIBILIDADES" || (f.fila.bloque === "CIERRE" && esFilaDeCierreVisibleParaGerente(f.fila));
    assert.equal(permitida, true, `${f.fila.clave} no debería traer un centinela`);
  }
  // Y en lo que no es Disponibilidades ni Cierre, ni rastro en lo serializado.
  const resto = JSON.stringify(r.filas.filter((f) => f.fila.bloque !== "DISPONIBILIDADES" && f.fila.bloque !== "CIERRE"));
  assert.equal(PATRON_CENTINELA.test(resto), false);
  // «Disponible antes de gastos» (la suma cruda de Disponibilidades + Ingresos) no está en ninguna parte del reporte.
  assert.equal(r.filas.some((f) => f.fila.clave === "br.disponibleAntes"), false);
});

test("Brillante: Disponibilidades no tiene % de avance ni «falta ejecutar» que mostrar, y el total suma las de la planilla", () => {
  const r = reporteDelGerente("brillante");
  for (const f of r.filas.filter((f) => f.fila.bloque === "DISPONIBILIDADES" && f.fila.tipo !== "titulo")) {
    for (const c of f.celdas) {
      assert.equal(c.avance, null, f.fila.clave);
      assert.equal(c.faltaEjecutar, null, f.fila.clave);
    }
  }
  const total = r.filas.find((f) => f.fila.clave === "br.totalDisponibilidades")!.celdas[0];
  const lineas = r.filas.filter((f) => f.fila.tipo === "linea" && f.fila.bloque === "DISPONIBILIDADES");
  const suma = lineas
    .filter((f) => f.fila.tipo === "linea" && !f.fila.excluidaDelTotal)
    .reduce((a, f) => a + (f.celdas[0].real ?? 0), 0);
  assert.equal(total.real, suma);
  // «Recupero aporte blanqueo» se muestra pero no suma.
  assert.ok(lineas.some((f) => f.fila.clave === "br.dRecuperoBlanqueo" && f.celdas[0].real !== null));
});

// ---- Lo que llega a un componente cliente --------------------------------------------------------

// El Reporte (con Disponibilidades) lo dibuja un componente de SERVIDOR; a los componentes cliente solo
// llega la vista de carga (VistaCarga). Se arma con valores de Disponibilidades "cargados" en TODAS las
// filas (también como Presupuestado, que no es un dato real pero es lo que más cerca está de la carga) y no
// puede contener ninguno.
for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
  test(`${slug}: ningún valor de Disponibilidades llega en la vista de carga (componentes cliente)`, () => {
    const claves = plantilla.filas.filter((f) => f.bloque === "DISPONIBILIDADES").map((f) => f.clave);
    const valores: ValorManualParaCarga[] = claves.map((k, i) => ({
      filaClave: k,
      centavos: CENTINELA + i,
      nota: null,
      cargadoPor: "Finanzas",
      actualizadoEn: new Date("2026-10-01T12:00:00Z"),
    }));
    const plan = planDeCarga(plantilla, [], valores);
    const json = JSON.stringify(vistaDeCarga(plan));
    assert.equal(PATRON_CENTINELA.test(json), false, "viaja un valor de Disponibilidades");
    for (const k of claves) assert.equal(json.includes(k), false, `viaja la fila ${k}`);
  });
}

test("el Reporte y su página son componentes de servidor: nada de Disponibilidades se serializa al navegador", () => {
  for (const archivo of ["ReportePlantilla.tsx", "page.tsx"]) {
    const fuente = readFileSync(new URL(`../../../app/[empresa]/[periodo]/reporte/${archivo}`, import.meta.url), "utf-8");
    assert.equal(/^\s*["']use client["']/m.test(fuente), false, `${archivo} no puede ser un componente cliente`);
  }
});

// ---- Escritura: Disponibilidades nunca se escribe desde el gerente -------------------------------

for (const [slug, plantilla] of Object.entries(PLANTILLAS_POR_SLUG)) {
  test(`${slug}: la carga del gerente no incluye ni acepta claves de Disponibilidades`, () => {
    assert.equal(BLOQUES_CARGABLES.includes("DISPONIBILIDADES"), false);
    const claves = plantilla.filas.filter((f) => f.bloque === "DISPONIBILIDADES").map((f) => f.clave);
    // Aunque haya un valor guardado para esas claves, el plan no las abre.
    const valores: ValorManualParaCarga[] = claves.map((k) => ({
      filaClave: k,
      centavos: 100,
      nota: null,
      cargadoPor: null,
      actualizadoEn: new Date(),
    }));
    const plan = planDeCarga(plantilla, [], valores);
    for (const k of claves) {
      assert.equal(Object.hasOwn(plan.filas, k), false, `plan.filas ${k}`);
      assert.equal(Object.hasOwn(plan.manuales, k), false, `plan.manuales ${k}`);
      // Lo que usa el servidor (aplicarCargaPresupuesto) para aceptar o rechazar una entrada: null = rechaza
      // («no es un campo que se pueda cargar»), sea cual sea el destino que mande un cliente armado a mano.
      for (const destino of ["fila", "sinFila", "manual", "capital"] as const) {
        // «capital» ya no existe como destino (el gerente no carga el Capital): también se rechaza.
        const entrada = { destino: destino as "fila", clave: k };
        assert.equal(celdaDeEntrada(plan, entrada), null, `${destino}|${k}`);
        assert.equal(manualDeEntrada(plan, entrada), null, `${destino}|${k}`);
      }
    }
    // Ninguna celda editable de la vista de carga es de un bloque reservado (ni de Cierre: el Capital lo carga ADMIN).
    const vista = vistaDeCarga(plan);
    const porClave = new Map(plantilla.filas.map((f) => [f.clave, f]));
    for (const c of vista.celdas) {
      const fila = porClave.get(c.clave);
      if (!fila) continue; // categorías sin fila
      assert.equal(esBloqueReservado(fila.bloque), false, `${c.id}`);
    }
  });
}

test("guardarValoresManuales (la única acción que escribe Disponibilidades) exige el permiso de cargar el Real (ADMIN, FINANZAS o gerente con permiso en la empresa) antes de escribir", () => {
  // Sin importar los saltos de línea del archivo (en Windows son CRLF).
  const fuente = readFileSync(new URL("../../../app/[empresa]/[periodo]/reporte/carga/actions.ts", import.meta.url), "utf-8").split("\r\n").join("\n");
  const cuerpo = fuente.slice(fuente.indexOf("export async function guardarValoresManuales"));
  const primera = cuerpo.slice(cuerpo.indexOf("{\n") + 2).trimStart();
  assert.ok(primera.startsWith("await requireUsuarioAlDia();"), "la primera sentencia tiene que ser la sesión al día");
  const guarda = cuerpo.indexOf("await requireCargaRealEmpresa(empresa.id)");
  assert.ok(guarda > 0 && guarda < cuerpo.indexOf("plantillaDeEmpresaConExtras("), "la guarda del permiso va antes de leer la plantilla");
  // Un gerente con permiso solo escribe el Real de lo que ve su empresa; ADMIN y FINANZAS, todo.
  assert.ok(cuerpo.includes("camposRealDelGerente(plantilla, empresaSlug)"));
  // Y un gerente no ve los bloques reservados por rol (los interruptores solo agregan lectura).
  assert.equal(veBloquesReservadosDelReporte({ rol: "GERENTE" }), false);
  // El campo manual de una fila de Disponibilidades es REAL, y la carga del gerente solo escribe PRESUPUESTADO.
  for (const plantilla of Object.values(PLANTILLAS_POR_SLUG)) {
    for (const c of camposManuales(plantilla).filter((c) => c.bloque === "DISPONIBILIDADES")) {
      assert.equal(c.columna, "REAL", c.clave);
    }
  }
});

// ---- Marcas internas solo para ADMIN/FINANZAS ----------------------------------------------------

test("las marcas internas (K, notas, arrastre, «no suma en el total (como la planilla)») siguen siendo de ADMIN/FINANZAS", () => {
  const fuente = readFileSync(new URL("../../../app/[empresa]/[periodo]/reporte/ReportePlantilla.tsx", import.meta.url), "utf-8");
  // Etiquetas K y notas: detrás de verPendientes; marca de la planilla y arrastre: detrás de verControl.
  assert.ok(fuente.includes("verPendientes && fila.tipo === \"linea\" ? fila.nota : undefined"));
  assert.ok(fuente.includes("{verControl && fila.excluidaDelTotal && conValor && ("));
  assert.ok(fuente.includes("{verControl && fila.tipo === \"total\" && fila.rol === \"totalDisponibilidades\" && ("));
  // El gerente ve solo «no suma», y la CeldaSaldo no usa ni la nota ni los pendientes.
  assert.ok(fuente.includes("{!verControl && fila.excluidaDelTotal && conValor && "));
  const celdaSaldo = fuente.slice(fuente.indexOf("function CeldaSaldo"), fuente.indexOf("function Asterisco"));
  assert.equal(/nota|pendiente|Asterisco|title=/.test(celdaSaldo), false);
});
