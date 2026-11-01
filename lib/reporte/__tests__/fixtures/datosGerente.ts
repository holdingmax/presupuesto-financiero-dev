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
  plantilla.filas.forEach((f, i) => {
    if (f.tipo === "linea" && f.presupuesto.tipo === "categorias") {
      for (const c of f.presupuesto.categorias) presupuesto.set(c, 20_000 + i * 11);
    }
  });
  const manualesReal = new Map<string, number>();
  const manualesPresupuesto = new Map<string, number>();
  let n = 0;
  for (const c of camposManuales(plantilla)) {
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
