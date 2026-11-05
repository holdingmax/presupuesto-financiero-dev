import {
  camposManuales,
  clasificacionesDePlantilla,
  esBloqueReservado,
  pendientesDe,
  type DatosMes,
  type Plantilla,
  type Reporte,
} from "@/lib/reporte/motor";

// Datos de prueba deterministas para comparar el Reporte del gerente: dos meses (el primero es el de
// contexto) con Real por clasificación, Presupuesto por categoría y valores manuales en TODAS las
// filas. Los de bloques reservados llevan un valor "centinela" enorme, para que se note si algo se filtra.

export const CENTINELA = 7_000_000_000_000;

// SAC de Brillante, Conexión y Mantenor: desde 2026-10 suma su Real tipeado (sumarManual). Sin numerar esas celdas, el resto conserva los valores de las fotos JSON.
const CELDAS_SIN_NUMERAR_SAC = ["br.sac|REAL", "cx.sac|REAL", "mn.sac|REAL"];

// «Cheques en cartera» (nov-2026) también queda sin numerar: es una fila nueva de Disponibilidades y no debe correr los valores de las demás.
const CELDAS_SIN_NUMERAR_HAVANNA = ["hv.cobranzasLocales|REAL", "hv.acreditacionTarjetas|REAL", "hv.acreditacionTarjetas|PRESUPUESTADO", "hv.dChequesEnCartera|REAL"];

// Las ocho celdas que Mantenor sumó con el neteo de cobranzas (Otros Clientes Jujuy / Tucuman, MSM COLUMNAS / PINTURA VIAL, Real y
// Presupuestado): sin numerarlas, el resto conserva los valores de las fotos JSON.
const FILAS_SIN_INDICE_MANTENOR = ["mn.otrosClientesJujuy", "mn.otrosClientesTucuman", "mn.msmColumnas", "mn.msmPinturaVial"];

const CELDAS_SIN_NUMERAR_MANTENOR = FILAS_SIN_INDICE_MANTENOR.flatMap((k) => [
  `${k}|REAL`,
  `${k}|PRESUPUESTADO`,
]);

// La foto JSON del gerente (gerenteSinReservados.json) no se regenera: para Mantenor se le agregan, en su lugar (entre «Cobranza
// Mantenor Jujuy» y «Cobranza MSNT»), las cuatro filas de cobranza neteada, sin valor porque mesesDePrueba no numera sus celdas.
// Devuelve una copia; para otra empresa, la foto tal cual.
export function fotoConFilasNuevas<T extends { filas: [string, unknown][] }>(slug: string, foto: T): T {
  if (slug !== "mantenor") return foto;
  const copia = JSON.parse(JSON.stringify(foto)) as T;
  const i = copia.filas.findIndex(([clave]) => clave === "mn.cobranzaMsnt");
  copia.filas.splice(i, 0, ...FILAS_SIN_INDICE_MANTENOR.map((clave): [string, unknown] => [clave, [[null, null, null, null, false, false]]]));
  return copia;
}

// El Reporte sin las filas de Cierre (y con los pendientes que salen de las demás): para comparar lo que NO es
// Cierre contra las fotos de antes de que el gerente viera Saldo, Capital y Disponible.
export function sinCierre(r: Reporte): Reporte {
  const filas = r.filas.filter((f) => f.fila.bloque !== "CIERRE");
  const pendientes: Reporte["pendientes"] = [];
  for (const f of filas) for (const k of pendientesDe(f.fila)) if (!pendientes.includes(k)) pendientes.push(k);
  return { ...r, filas, pendientes };
}

// Claves de Cierre que trae un Reporte, en orden.
export const clavesDeCierre = (r: Reporte) => r.filas.filter((f) => f.fila.bloque === "CIERRE").map((f) => f.fila.clave);

export function mesesDePrueba(plantilla: Plantilla): DatosMes[] {
  const real = new Map<string, number>();
  clasificacionesDePlantilla(plantilla).forEach((c, i) => real.set(c, 10_000 + i * 137));
  const presupuesto = new Map<string, number>();
  // El índice no cuenta las cuatro filas que Mantenor sumó con el neteo de cobranzas: así las demás conservan los valores de la foto.
  let i = -1;
  for (const f of plantilla.filas) {
    if (FILAS_SIN_INDICE_MANTENOR.includes(f.clave) || f.clave === "hv.dChequesEnCartera") continue; // Havanna: fila nueva (nov-2026), no corre el índice
    i++;
    if (f.tipo === "linea" && f.presupuesto.tipo === "categorias") {
      for (const c of f.presupuesto.categorias) presupuesto.set(c, 20_000 + i * 11);
    }
  }
  const manualesReal = new Map<string, number>();
  const manualesPresupuesto = new Map<string, number>();
  let n = 0;
  for (const c of camposManuales(plantilla)) {
    // «Gold Salta» de Brillante pasó a Real manual (neteo de cobranzas): su celda no se numera, para que los valores de las
    // demás sigan siendo los de las fotos JSON (que no se regeneran). Queda vacía, como en la foto.
    if (c.clave === "br.goldSalta" && c.columna === "REAL") continue;
    // Lo mismo con las tres celdas que Havanna sumó con el neteo de cobranzas (Cobranzas locales y Acreditación tarjetas):
    // sin numerarlas, el resto conserva los valores de las fotos JSON.
    if (CELDAS_SIN_NUMERAR_HAVANNA.includes(`${c.clave}|${c.columna}`)) continue;
    if (CELDAS_SIN_NUMERAR_SAC.includes(`${c.clave}|${c.columna}`)) continue;
    // Y con las ocho de Mantenor (cobranza neteada): quedan vacías, como las filas que agrega esperado() a la foto.
    if (CELDAS_SIN_NUMERAR_MANTENOR.includes(`${c.clave}|${c.columna}`)) continue;
    const valor = esBloqueReservado(c.bloque) ? CENTINELA + n++ : 1000 + n++;
    (c.columna === "REAL" ? manualesReal : manualesPresupuesto).set(c.clave, valor);
  }
  const mes: DatosMes = {
    periodo: "2026-09",
    real,
    presupuesto,
    mesCerrado: true,
    semanasCerradas: 4,
    manuales: { presupuesto: manualesPresupuesto, real: manualesReal },
  };
  return [{ ...mes, periodo: "2026-08" }, mes];
}
