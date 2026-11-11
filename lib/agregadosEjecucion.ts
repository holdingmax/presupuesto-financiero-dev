import { normalizarCuenta } from "@/lib/unidadesNegocio";

// Agregados de la pantalla de Ejecución que dependen de la clasificación / unidad de cada fila:
// paneles de sugerencias, unidades sugeridas y chequeos de suma cero. Parte pura (sin base ni
// auth) de app/ejecucion/actions.ts: la página y la edición desde la tabla arman estos números
// con las MISMAS funciones, así lo que se ve tras reclasificar no puede diferir de lo que muestra
// la página recalculada. Los tipos se re-exportan desde actions.ts.

export type FilaSugerenciaClasificacion = {
  id: string;
  fecha: string;
  concepto: string;
  bancoYCuenta: string;
  importe: number;
  // Moneda del movimiento (código ISO); sin dato es pesos.
  moneda?: string;
  clasificacion: string;
  chequeIvaAmbiguo: boolean;
};

export type GrupoSugerenciaClasificacion = {
  clasificacion: string;
  // Totales de TODA la semana (no de la muestra).
  cantidad: number;
  ambiguas: number;
  // Muestra para revisar/corregir de a una: hasta MUESTRA_POR_GRUPO filas, las
  // ambiguas primero (esas solo se confirman de a una).
  filas: FilaSugerenciaClasificacion[];
};

export const MUESTRA_POR_GRUPO = 50;

export type GrupoUnidadSugerida = {
  // Cuenta normalizada (clave del grupo, lo que se muestra).
  cuenta: string;
  // Grafías crudas tal como están en la base que caen en esta cuenta — es lo
  // que confirmarUnidadesEnLote recibe para su `bancoYCuenta IN (...)`.
  cuentasCrudas: string[];
  unidadNegocio: string;
  cantidad: number;
};

export type ResultadoChequeo = {
  nombre: string;
  clasificacion: string;
  neto: number;
  ok: boolean;
  // Siempre poblado (conteo real), a diferencia de `lineas` — así la UI puede
  // mostrar "N líneas" sin tener que mandar el detalle completo cuando el
  // usuario todavía no lo pidió (colapsado por defecto).
  cantidad: number;
  lineas: { id: string; fecha: string; concepto: string; importe: number }[];
};

// Totales por clasificación de las sugerencias pendientes (entrada: groupBy por
// clasificacion + chequeIvaAmbiguo).
export function totalizarSugerencias(
  conteos: { clasificacion: string; chequeIvaAmbiguo: boolean; _count: number }[]
) {
  const porClasificacion = new Map<string, { cantidad: number; ambiguas: number }>();
  for (const c of conteos) {
    const g = porClasificacion.get(c.clasificacion) ?? { cantidad: 0, ambiguas: 0 };
    g.cantidad += c._count;
    if (c.chequeIvaAmbiguo) g.ambiguas += c._count;
    porClasificacion.set(c.clasificacion, g);
  }
  return porClasificacion;
}

export function ordenarGruposSugerencia(grupos: GrupoSugerenciaClasificacion[]) {
  return grupos.sort((a, b) => a.clasificacion.localeCompare(b.clasificacion, "es"));
}

// Junta por cuenta NORMALIZADA (mismo criterio que proponerUnidadPorCuenta), por si
// la misma cuenta llegó con dos grafías distintas ("Frances 891" / "FRANCES 891").
// La clave incluye la unidad: con el mapa de hoy una cuenta siempre sugiere la misma,
// pero si el mapa cambiara entre dos subidas no se mezclan dos sugerencias distintas
// bajo un mismo botón "Confirmar".
export function agruparUnidadesSugeridas(
  grupos: { bancoYCuenta: string; unidadNegocio: string; _count: number }[]
): GrupoUnidadSugerida[] {
  const porClave = new Map<string, GrupoUnidadSugerida>();
  for (const g of grupos) {
    const cuenta = normalizarCuenta(g.bancoYCuenta);
    const clave = `${cuenta}|${g.unidadNegocio}`;
    const existente = porClave.get(clave);
    if (existente) {
      existente.cuentasCrudas.push(g.bancoYCuenta);
      existente.cantidad += g._count;
    } else {
      porClave.set(clave, {
        cuenta,
        cuentasCrudas: [g.bancoYCuenta],
        unidadNegocio: g.unidadNegocio,
        cantidad: g._count,
      });
    }
  }
  return Array.from(porClave.values()).sort((a, b) => a.cuenta.localeCompare(b.cuenta, "es"));
}

// Controles de suma-cero que Macchi ya hace a mano hoy (confirmado 2026-08-27):
// para estas 3 clasificaciones puntuales, el neto del período tiene que dar $0
// — si un movimiento de ingreso no encuentra su contraparte de salida (o
// viceversa), el neto queda desbalanceado y es señal de algo mal cargado o
// pendiente. No bloquea el cierre, es solo una alerta visual (mismo criterio
// que la detección de posibles duplicados en subirExtracto). Nombres exactos
// confirmados con Macchi — "PREST BRIOS Y TC"/"PRESTAMOS MS" quedan afuera de
// Préstamos a propósito, y "CHEQUES DIFERIDOS"/"CH DIFERIDOS IVA" quedan
// afuera de cheques de terceros — son categorías reales pero distintas.
export const CHEQUEOS_SUMA_CERO: { nombre: string; clasificacion: string }[] = [
  { nombre: "Préstamos", clasificacion: "PRESTAMOS" },
  { nombre: "Transferencias entre bancos", clasificacion: "TRANSF ENTRE BCOS" },
  { nombre: "Depósito de cheques de terceros", clasificacion: "DEP CH 3°" },
];

// `movimientos` ya viene filtrado (clasificacion del chequeo, ignorado:false) y ordenado por
// fecha e id.
export function armarChequeo(
  def: { nombre: string; clasificacion: string },
  movimientos: { id: string; fecha: Date; concepto: string; importe: unknown }[]
): ResultadoChequeo {
  const neto = movimientos.reduce((acc, m) => acc + Number(m.importe), 0);
  const ok = Math.abs(neto) < 0.01;
  return {
    nombre: def.nombre,
    clasificacion: def.clasificacion,
    neto,
    ok,
    cantidad: movimientos.length,
    lineas: ok
      ? []
      : movimientos.map((m) => ({
          id: m.id,
          fecha: m.fecha.toISOString().slice(0, 10),
          concepto: m.concepto,
          importe: Number(m.importe),
        })),
  };
}
