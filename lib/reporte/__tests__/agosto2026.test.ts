import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporte, type DatosMes, type Reporte } from "@/lib/reporte/motor";
import { PLANTILLAS_POR_SLUG } from "@/lib/reporte/plantillas";
import { AGOSTO_2026 } from "./fixtures/agosto2026";

// Agosto 2026 de las 7 empresas contra los Excel de Macchi
// (docs/reporte_etapa2b_plan.md §8.3). Todo en centavos.
//
// D1 (tolerancia): cada dato de entrada de la fixture está redondeado al centavo, como lo
// guardaría la base; cada esperado es el valor cacheado del Excel redondeado al centavo; la
// diferencia permitida (tolP / tolR) es 1 centavo por sumando de entrada con más de 2
// decimales en el Excel, contado al generar la fixture. El test imprime la diferencia de
// cada celda calculada. Si algo supera la tolerancia NO se ajusta nada: se frena y se muestra.

const SLUGS = [
  "conexion-logistica",
  "brillante",
  "havanna",
  "radio",
  "fredy-publicidad",
  "hwc",
  "mantenor",
  "avianor",
  "plate-silver",
  "bradenton",
] as const;

// Desviación aceptada: filas de la plantilla que no existen en la planilla de agosto (fixture sin tocar). La de
// Mantenor viene de la hoja VALORES A MANO del PF de octubre; en agosto no tiene valor, así que no altera ningún total.
const FILAS_SIN_PLANILLA_DE_AGOSTO: Record<string, string[]> = {
  // Havanna: «CHEQUES EN CARTERA» (nov-2026), sin valor en agosto: los totales de agosto siguen siendo los del Excel.
  havanna: ["hv.dChequesEnCartera"],
  mantenor: ["mn.dReservaSac", "mn.otrosClientesJujuy", "mn.otrosClientesTucuman", "mn.msmColumnas", "mn.msmPinturaVial"],
};
const estaEnPlanillaDeAgosto = (slug: string, clave: string) => !(FILAS_SIN_PLANILLA_DE_AGOSTO[slug] ?? []).includes(clave);

function armar(slug: string) {
  const datos = AGOSTO_2026[slug];
  const plantilla = PLANTILLAS_POR_SLUG[slug];
  const filasDeAgosto = plantilla.filas.filter((f) => estaEnPlanillaDeAgosto(slug, f.clave));
  assert.equal(datos.filas.length, filasDeAgosto.length, `${slug}: filas de la fixture y de la plantilla`);
  const presupuesto = new Map<string, number>();
  const manP = new Map<string, number>();
  const manR = new Map<string, number>();
  // Real por clasificación que el Excel ya tiene en agosto (Avianor lo lee de una tabla dinámica de movimientos).
  const realPorClasificacion = new Map<string, number>();
  const filaPorNumero = new Map<number, string>();
  filasDeAgosto.forEach((fila, i) => {
    const e = datos.filas[i];
    assert.equal(e.texto, fila.texto, `${slug}: la fila ${e.fila} no coincide con la plantilla`);
    filaPorNumero.set(e.fila, fila.clave);
    // Capital de trabajo tipeado en el Excel (Mantenor): dato de entrada, reemplaza la regla.
    if (fila.tipo === "capital" && !e.calcP && e.p !== null) manP.set(fila.clave, e.p);
    if (fila.tipo !== "linea") return;
    if (fila.bloque === "DISPONIBILIDADES") {
      // Un solo número por componente: P = R en la planilla.
      assert.equal(e.p, e.r, `${slug}: ${fila.texto} tiene P distinto de R en el Excel`);
      if (e.r !== null) manR.set(fila.clave, e.r);
      return;
    }
    const p = fila.presupuesto;
    if (p.tipo === "categorias" && e.p !== null) presupuesto.set(p.categorias[0], e.p);
    if (p.tipo === "manual" && e.p !== null) manP.set(fila.clave, e.p);
    if (fila.real.tipo === "manual" && e.r !== null) manR.set(fila.clave, e.r);
    // Neto con signo de banco: el motor multiplica por el signo de la fila.
    if (fila.real.tipo === "clasificaciones" && e.r !== null && !e.calcR) {
      realPorClasificacion.set(fila.real.clasificaciones[0], fila.signo * e.r || 0);
    }
    // Una fila que el Excel presupuesta y la plantilla no sabe de dónde sacar no se puede reproducir.
    if (p.tipo === "ninguna") assert.equal(e.p, null, `${slug}: ${fila.texto} tiene P en el Excel y la plantilla no lo carga`);
  });
  // Mes anterior (contexto): lo que una fórmula de agosto toma de julio (Havanna: =-DP21).
  const contexto: DatosMes = {
    periodo: "2026-07",
    real: new Map(),
    presupuesto: null,
    semanasCerradas: 0,
    manuales: { presupuesto: new Map(), real: new Map() },
  };
  for (const previo of datos.previos) {
    const clave = filaPorNumero.get(previo.fila);
    assert.ok(clave, `${slug}: no hay fila ${previo.fila} para el valor previo`);
    assert.equal(previo.mesesAtras, 1);
    (previo.columna === "R" ? contexto.manuales!.real : contexto.manuales!.presupuesto).set(clave, previo.valor);
  }
  const agosto: DatosMes = {
    periodo: "2026-08",
    real: realPorClasificacion,
    presupuesto,
    // El Real de ingresos y egresos de agosto está vacío en los Excel de las 7 empresas; en Avianor ya
    // tiene los movimientos del mes.
    semanasCerradas: realPorClasificacion.size > 0 ? 1 : 0,
    // Agosto está en curso (como cuando se armó el Excel): R de los espejos vacío.
    mesCerrado: false,
    manuales: { presupuesto: manP, real: manR },
  };
  return { datos, plantilla, reporte: armarReporte(plantilla, [contexto, agosto], 1) };
}

const pesos = (c: number | null) => (c === null ? "—" : (c / 100).toFixed(2));

function comparar(slug: string, reporte: Reporte) {
  const datos = AGOSTO_2026[slug];
  const lineas: string[] = [];
  const fallas: string[] = [];
  reporte.filas.filter(({ fila }) => estaEnPlanillaDeAgosto(slug, fila.clave)).forEach(({ fila, celdas }, i) => {
    if (fila.tipo === "titulo") return;
    const e = datos.filas[i];
    const c = celdas[0];
    const revisar = (columna: "P" | "R", excel: number | null, motor: number | null, calc: boolean, tol: number) => {
      // Excel vacío: nada que comparar. Un total con fórmula que da 0 se compara contra null como 0.
      if (excel === null) return;
      const m = motor ?? (calc ? 0 : null);
      const dif = m === null ? null : m - excel;
      const ok = dif !== null && Math.abs(dif) <= tol;
      if (calc || (dif !== null && dif !== 0) || !ok) {
        lineas.push(
          `${slug.padEnd(18)} ${columna} f${String(e.fila).padStart(2)} ${fila.texto.trim().slice(0, 42).padEnd(42)} excel=${pesos(excel).padStart(18)} motor=${pesos(m).padStart(18)} dif=${dif === null ? "—" : (dif / 100).toFixed(2)} tol=${tol / 100}`
        );
      }
      if (!ok) fallas.push(`${slug} ${columna} fila ${e.fila} "${fila.texto.trim()}": excel=${pesos(excel)} motor=${pesos(motor)} dif=${dif === null ? "—" : pesos(dif)} tol=${pesos(tol)}`);
    };
    revisar("P", e.p, c.presupuestado, e.calcP, e.tolP);
    revisar("R", e.r, c.real, e.calcR, e.tolR);
  });
  console.log(lineas.join("\n"));
  return fallas;
}

for (const slug of SLUGS) {
  test(`${slug} ago-26: P, R, totales, cierre, capital y disponible iguales al Excel (tolerancia D1)`, () => {
    const { reporte } = armar(slug);
    const fallas = comparar(slug, reporte);
    assert.deepEqual(fallas, [], "diferencias contra el Excel: NO se ajusta la fixture ni la expectativa");
  });
}

function celdaDe(slug: string, clave: string) {
  const { reporte } = armar(slug);
  const fila = reporte.filas.find((f) => f.fila.clave === clave);
  assert.ok(fila, `no existe la fila ${clave}`);
  return fila.celdas[0];
}

test("ago-26: espejos del plan §8.3", () => {
  // Conexión: Cheques en cartera después del 10 (Ingresos) = menos el componente de Disponibilidades.
  const cheques = celdaDe("conexion-logistica", "cx.chequesDespuesDel10");
  assert.equal(cheques.presupuestado, 19649143618);
  assert.equal(cheques.real, null); // mes en curso: R vacío
  // Havanna: Acreditación tarjetas = menos el R de julio de "Otro tarjeta no ingresada" (−48.071.280).
  const tarjetas = celdaDe("havanna", "hv.acreditacionTarjetas");
  assert.equal(tarjetas.presupuestado, 4807128000);
  assert.equal(tarjetas.real, null);
});

test("ago-26: P = Disponible (Havanna Devolución préstamo MS, Mantenor Prestamos)", () => {
  const havanna = celdaDe("havanna", "hv.devolucionPrestamoMs").presupuestado;
  assert.ok(havanna !== null && Math.abs(havanna - 2300934701) <= 1, `Havanna: ${pesos(havanna)}`);
  assert.equal(havanna, celdaDe("havanna", "hv.disponible").presupuestado);
  const mantenor = celdaDe("mantenor", "mn.prestamos").presupuestado;
  assert.ok(mantenor !== null && Math.abs(mantenor - 23589803618) <= 1, `Mantenor: ${pesos(mantenor)}`);
  assert.equal(mantenor, celdaDe("mantenor", "mn.disponible").presupuestado);
});

test("ago-26: el cierre sin cargar nada queda en '—' (D8), sin rellenar con el cierre anterior", () => {
  const plantilla = PLANTILLAS_POR_SLUG["radio"];
  const vacio = armarReporte(plantilla, [
    { periodo: "2026-08", real: new Map(), presupuesto: new Map(), semanasCerradas: 0 },
  ]);
  // El Capital de Radio (TEO/2) no depende de las Disponibilidades: no entra en la lista.
  for (const clave of ["ra.totalDisponibilidades", "ra.disponibleAntes", "ra.saldo", "ra.disponible"]) {
    const c = vacio.filas.find((f) => f.fila.clave === clave)!.celdas[0];
    assert.equal(c.presupuestado, null, `${clave} P`);
    assert.equal(c.real, null, `${clave} R`);
  }
});

test("R de los espejos: vacío en curso, R = P con el mes cerrado (julio)", () => {
  const plantilla = PLANTILLAS_POR_SLUG["conexion-logistica"];
  const mes = (cerrado: boolean) =>
    armarReporte(plantilla, [
      {
        periodo: "2026-07",
        real: new Map(),
        presupuesto: new Map(),
        semanasCerradas: 2,
        mesCerrado: cerrado,
        manuales: { presupuesto: new Map(), real: new Map([["cx.dChequesDespuesDel10", -19649143618]]) },
      },
    ]).filas.find((f) => f.fila.clave === "cx.chequesDespuesDel10")!.celdas[0];
  assert.equal(mes(true).real, 19649143618);
  assert.equal(mes(false).real, null);
});
