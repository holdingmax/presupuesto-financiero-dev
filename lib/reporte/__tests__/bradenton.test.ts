import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, clasificacionesDePlantilla, type DatosMes, type FilaLinea, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { CLASIFICACIONES_PRESUPUESTO_TODAS } from "@/app/[empresa]/[periodo]/presupuesto/clasificacionesPresupuesto";
import { ARRASTRE_EXCEL_BRADENTON, MARZO_2026_BRADENTON } from "./fixtures/bradentonExcel";

// Plantilla de Bradenton (USD; importes en centavos de dólar). El agosto contra el Excel lo cubre
// agosto2026.test.ts; acá: marzo completo (el mes con más datos reales), las fórmulas de Cierre, el Capital
// tipeado, la ausencia de control de arrastre (con las diferencias del Excel como documentación) y la lista
// exacta de categorías de Presupuesto sin fila. Si algo no cierra NO se ajusta nada: se frena y se muestra la
// diferencia.

const plantilla = PLANTILLAS_POR_SLUG["bradenton"];

// Arma el mes de marzo con los datos de ENTRADA de la fixture (las filas que no son fórmula).
function marzo(): Reporte {
  assert.equal(MARZO_2026_BRADENTON.length, plantilla.filas.length);
  const presupuesto = new Map<string, number>();
  const manP = new Map<string, number>();
  const manR = new Map<string, number>();
  plantilla.filas.forEach((fila, i) => {
    const e = MARZO_2026_BRADENTON[i];
    assert.equal(e.texto, fila.texto, `la fila ${e.fila} no coincide con la plantilla`);
    if (fila.tipo !== "linea") return;
    if (fila.bloque === "DISPONIBILIDADES") {
      assert.equal(e.p, e.r, `${fila.texto}: P distinto de R`);
      if (e.r !== null) manR.set(fila.clave, e.r);
      return;
    }
    if (fila.presupuesto.tipo === "categorias" && e.p !== null) presupuesto.set(fila.presupuesto.categorias[0], e.p);
    if (fila.presupuesto.tipo === "manual" && e.p !== null) manP.set(fila.clave, e.p);
    if (fila.real.tipo === "manual" && e.r !== null) manR.set(fila.clave, e.r);
  });
  const mes: DatosMes = {
    periodo: "2026-03",
    real: new Map(),
    presupuesto,
    mesCerrado: true,
    manuales: { presupuesto: manP, real: manR },
  };
  return armarReporte(plantilla, [mes]);
}

const celda = (r: Reporte, clave: string) => {
  const f = r.filas.find((x) => x.fila.clave === clave);
  assert.ok(f, `no existe la fila ${clave}`);
  return f.celdas[0];
};

test("bradenton marzo: P y R de todas las filas iguales al Excel (tolerancia de redondeo)", () => {
  const reporte = marzo();
  const fallas: string[] = [];
  reporte.filas.forEach(({ fila, celdas }, i) => {
    if (fila.tipo === "titulo") return;
    const e = MARZO_2026_BRADENTON[i];
    const revisar = (col: "P" | "R", excel: number | null, motor: number | null, tol: number) => {
      if (excel === null) return;
      const m = motor ?? (e.calc ? 0 : null);
      if (m === null || Math.abs(m - excel) > tol) {
        fallas.push(`${col} f${e.fila} "${fila.texto.trim()}": excel=${excel} motor=${motor} tol=${tol}`);
      }
    };
    revisar("P", e.p, celdas[0].presupuestado, e.tolP);
    revisar("R", e.r, celdas[0].real, e.tolR);
  });
  assert.deepEqual(fallas, [], "diferencias contra el Excel: NO se ajusta la fixture ni la expectativa");
});

test("bradenton: Capital de trabajo es un valor tipeado en P y en R (no se calcula) y sin cargar queda en '—'", () => {
  const r = marzo();
  assert.equal(celda(r, "bd.capital").presupuestado, 3000000);
  assert.equal(celda(r, "bd.capital").real, 3000000);
  // Sin valores manuales, el capital no se inventa a partir de los gastos operativos.
  const vacio = armarReporte(plantilla, [{ periodo: "2026-03", real: new Map(), presupuesto: new Map(), mesCerrado: true }]);
  assert.equal(celda(vacio, "bd.capital").presupuestado, null);
  assert.equal(celda(vacio, "bd.capital").real, null);
  // La planilla tiene los dos campos tipeables: el REAL de agosto a diciembre es 30.001, distinto del P.
  const campos = plantilla.filas.filter((f): f is FilaLinea => f.tipo === "linea" && f.clave === "bd.capital");
  assert.equal(campos.length, 1);
  assert.equal(campos[0].real.tipo, "manual");
  assert.equal(campos[0].presupuesto.tipo, "manual");
});

test("bradenton: Excedente = TOTAL DISPONIBILIDADES − Capital de trabajo, y NO es Posición − Capital", () => {
  const r = marzo();
  for (const col of ["presupuestado", "real"] as const) {
    const excedente = celda(r, "bd.excedente")[col]!;
    const totalDisp = celda(r, "bd.totalDisponibilidades")[col]!;
    const capital = celda(r, "bd.capital")[col]!;
    const posicion = celda(r, "bd.saldo")[col]!;
    assert.equal(excedente, totalDisp - capital, `${col}: Excedente = Total disponibilidades − Capital`);
    assert.notEqual(excedente, posicion - capital, `${col}: Excedente ≠ Posición − Capital`);
  }
  // Excel de marzo: Excedente 50.560,20 en P y en R; Posición − Capital sería 57.530,20 (P) y 122.565,50 (R).
  assert.ok(Math.abs(celda(r, "bd.excedente").presupuestado! - 5056020) <= 1);
  assert.ok(Math.abs(celda(r, "bd.excedente").real! - 5056020) <= 1);
  assert.ok(Math.abs(celda(r, "bd.saldo").real! - celda(r, "bd.capital").real! - 12256550) <= 5);
});

test("bradenton: Posición = Disponible antes de gastos − Total gastos, y los totales suman lo que dice la planilla", () => {
  const r = marzo();
  for (const col of ["presupuestado", "real"] as const) {
    assert.equal(celda(r, "bd.disponibleAntes")[col], celda(r, "bd.totalDisponibilidades")[col]! + celda(r, "bd.totalIngresos")[col]!);
    assert.equal(celda(r, "bd.saldo")[col], celda(r, "bd.disponibleAntes")[col]! - celda(r, "bd.totalGastos")[col]!);
    // Total gastos = los 13 operativos + Reembolsos + Dividendos + Inversion Food Truck + Otro.
    assert.equal(
      celda(r, "bd.totalGastos")[col],
      celda(r, "bd.totalGastosOperativos")[col]! +
        (celda(r, "bd.reembolsosPrestamos")[col] ?? 0) +
        (celda(r, "bd.dividendos")[col] ?? 0) +
        (celda(r, "bd.inversionFoodTruck")[col] ?? 0) +
        (celda(r, "bd.otroAbajo")[col] ?? 0)
    );
  }
  const operativos = plantilla.filas.filter((f) => f.tipo === "linea" && f.bloque === "EGRESOS");
  assert.equal(operativos.length, 13, "el total de gastos operativos suma 13 filas");
  const debajo = plantilla.filas.filter((f) => f.tipo === "linea" && f.bloque === "ABAJO");
  assert.equal(debajo.length, 4);
});

// Sin control de arrastre (como Avianor): el Banco sale del extracto Chase, no de la Posición del mes anterior.
test("bradenton: la plantilla no tiene control de arrastre (sin rol totalDisponibilidades ni saldo)", () => {
  // Los únicos roles son los tres de flujo (solo ubican las filas extra); ninguno arma el control de arrastre.
  assert.equal(plantilla.filas.some((f) => f.tipo === "total" && (f.rol === "totalDisponibilidades" || f.rol === "saldo")), false);
  assert.deepEqual(
    plantilla.filas.flatMap((f) => (f.tipo === "total" && f.rol !== undefined ? [f.rol] : [])),
    ["totalIngresos", "totalEgresosOperativos", "totalEgresos"]
  );
  // Aunque haya datos cargados en dos meses seguidos, el motor no arma ningún control.
  const mes = (periodo: string, banco: number): DatosMes => ({
    periodo,
    real: new Map(),
    presupuesto: new Map(),
    mesCerrado: true,
    manuales: { presupuesto: new Map(), real: new Map([["bd.dBanco", banco]]) },
  });
  const reporte = armarReporte(plantilla, [mes("2026-02", 5_000_000), mes("2026-03", 7_000_000)]);
  assert.deepEqual(reporte.arrastre, [null, null]);
});

// Documentación: el Excel NO cuadra de febrero a julio (solo agosto, porque su hoja Presup 08-2026 se arma con el cierre
// de julio). Si esto cambia, que sea a propósito: probablemente haya que revisar la decisión de no tener control.
test("bradenton: diferencias del Excel entre Total Disponibilidades y la Posición real del mes anterior (feb–jul no cuadran, agosto sí)", () => {
  const diferencias = ARRASTRE_EXCEL_BRADENTON.map((m) => ({
    periodo: m.periodo,
    dif: m.totalDisponibilidadesReal - m.posicionRealMesAnterior,
  }));
  assert.deepEqual(diferencias, [
    { periodo: "2026-02", dif: -3538658 },
    { periodo: "2026-03", dif: -1332603 },
    { periodo: "2026-04", dif: -9802134 },
    { periodo: "2026-05", dif: -7936612 },
    { periodo: "2026-06", dif: 3081251 },
    { periodo: "2026-07", dif: -5346421 },
    { periodo: "2026-08", dif: 0 },
  ]);
});

test("bradenton: ninguna fila lee su Real de la Ejecución (todo manual)", () => {
  assert.deepEqual(clasificacionesDePlantilla(plantilla), []);
  const lineas = plantilla.filas.filter((f): f is FilaLinea => f.tipo === "linea");
  assert.ok(lineas.every((f) => f.real.tipo === "manual"));
});

// Categorías de Presupuesto que ninguna fila de la plantilla suma: el motor las ignora sin avisar
// (motor.ts, indicePresupuesto). Esta lista tiene que cambiar a propósito, no por accidente.
test("bradenton: categorías de Presupuesto sin fila — lista exacta (9)", () => {
  const conFila = new Set(
    plantilla.filas.flatMap((f) => (f.tipo === "linea" && f.presupuesto.tipo === "categorias" ? f.presupuesto.categorias : []))
  );
  const sinFila = Array.from(new Set(CLASIFICACIONES_PRESUPUESTO_TODAS.map((o) => o.valorPersistido)))
    .filter((c) => !conFila.has(c))
    .sort();
  assert.deepEqual(
    sinFila,
    [
      "COMISIONES ESPECIALES",
      "INVERSIONES",
      "IVA",
      "Intereses FCI",
      "OTROS",
      "PAGOS ESPECIALES",
      "Préstamo Cocos",
      "Préstamo MS",
      "SAC",
    ].sort()
  );
});
