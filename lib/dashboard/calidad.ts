import type { Alcance } from "@/lib/dashboard/alcance";
import { sinDepositosDeCheques } from "@/lib/dashboard/controles";
import { datosAl, estadoDeParte, type FilaDeLote } from "@/lib/dashboard/semana";
import { normalizarUnidad } from "@/lib/dashboard/unidades";
import { normalizarClasificacion } from "@/lib/clasificacionesOcultas";
import { claveEquivalencia, clasificacionesDePlantilla, type Plantilla } from "@/lib/reporte/motor";

// CALIDAD DEL DATO (Entrega 2, bloque B). Módulo PURO (sin Prisma ni next/*): arma los indicadores a partir de filas ya
// agregadas por la consulta (lib/dashboard/consultasMes.ts), que filtra todo por el Alcance.
//
// Reglas contra la deducción de otras empresas:
//  - Todo conteo sale de movimientos del ALCANCE. Los lotes (semanas de Ejecución) mezclan empresas: nunca se muestra el
//    tamaño del lote, solo cuántos movimientos DEL ALCANCE están en un lote abierto.
//  - «Sin asignar» (movimientos sin unidad) es del conjunto, sin dueño: solo ADMIN (alcance.esHolding), como línea aparte.
//    Para el resto no existe: ni número ni aviso.
//  - «Saldo faltante» es reservado (los saldos los ve quien ve todo Ejecución): para el resto la clave no existe.
//  - Las clasificaciones que el usuario no puede ver (CLASIFICACIONES_OCULTAS_PARA_GERENTE) no entran en ningún conteo.
//  - Los depósitos de cheques de terceros no entran: son un control aparte, solo ADMIN (lib/dashboard/controles.ts).
//  - Solo conteos, sin nombres de cuentas, de clasificaciones ni de empresas, y sin porcentajes sobre el total del sistema.

export type AccesoDeCalidad = { verSaldos: boolean };

// ---- Filas que llegan de la consulta ---------------------------------------------------------------------------

export type FilaDeCalidadPorLote = {
  estado: "ABIERTA" | "CERRADA";
  movimientos: number;
  sinClasificar: number;
  clasificacionSugerida: number;
  // Solo cuenta si la unidad del movimiento PADRE es del alcance (la marca es del padre; en un movimiento prorrateado no se
  // sabe a qué porción se refiere, y contar la de otra unidad dejaría ver lo ajeno). La consulta ya lo aplica.
  unidadSugerida: number;
  chequeIvaAmbiguo: number;
  // Solo cuentas bancarias reales (BROU, EFECTIVO, CHEQUES, DÓLAR y «(sin banco)» no llevan saldo por diseño: los extractos de BROU no lo traen).
  saldoFaltante: number;
  otraMoneda: number;
};

export type FilaDeClasificacion = { unidad: string; clasificacion: string; movimientos: number };

export type FilaSinAsignar = { moneda: string; movimientos: number; enLotesAbiertos: number; ingresosCentavos: number; egresosCentavos: number };

// ---- Qué clasificaciones tienen fila propia en el Reporte de cada empresa --------------------------------------

export type ReglaDeClasificaciones = Readonly<{
  // claveEquivalencia de todas las clasificaciones que lee alguna fila de la plantilla (incluidas las del espejo).
  claves: ReadonlySet<string>;
  // Clasificaciones (normalizadas) que ESTE usuario no puede ver en esa empresa.
  ocultas: ReadonlySet<string>;
}>;

export function reglaDeClasificaciones(plantilla: Plantilla, ocultasParaElUsuario: readonly string[]): ReglaDeClasificaciones {
  const crudas = [...clasificacionesDePlantilla(plantilla)];
  for (const f of plantilla.filas) {
    if (f.tipo === "linea" && f.real.tipo === "clasificaciones" && f.real.espejoUnidad) crudas.push(...f.real.espejoUnidad.clasificaciones);
  }
  return Object.freeze({
    claves: new Set(crudas.map(claveEquivalencia)),
    ocultas: new Set(ocultasParaElUsuario.map(normalizarClasificacion)),
  });
}

export type ClasificacionesSinFila = Readonly<{ movimientos: number; deMovimientos: number }>;

// Movimientos en pesos cuya clasificación NO tiene fila propia en el Reporte de su empresa (no suman a ninguna línea), sobre el
// total de movimientos en pesos de empresas CON plantilla. `reglas` está indexado por unidad (una unidad = una sola empresa).
export function contarClasificacionesSinFila(
  filas: readonly FilaDeClasificacion[],
  reglasPorUnidad: ReadonlyMap<string, ReglaDeClasificaciones>
): ClasificacionesSinFila {
  let sinFila = 0;
  let total = 0;
  for (const f of sinDepositosDeCheques(filas, (x) => x.clasificacion)) {
    const regla = reglasPorUnidad.get(normalizarUnidad(f.unidad));
    if (!regla) continue; // empresa sin plantilla (Expensas): no hay Reporte contra el que comparar
    const clave = claveEquivalencia(f.clasificacion);
    if (clave === claveEquivalencia("SIN CLASIFICAR")) continue; // ya tiene su propio indicador
    if (regla.ocultas.has(normalizarClasificacion(f.clasificacion))) continue;
    total += f.movimientos;
    if (!regla.claves.has(clave)) sinFila += f.movimientos;
  }
  return Object.freeze({ movimientos: sinFila, deMovimientos: total });
}

// ---- Indicadores -----------------------------------------------------------------------------------------------

export type ClaveDeIndicador =
  | "sinClasificar"
  | "clasificacionSugeridaSinConfirmar"
  | "unidadSugeridaSinConfirmar"
  | "chequeIvaAmbiguo"
  | "saldoFaltante"
  | "otraMoneda";

export const ROTULOS_DE_INDICADOR: Readonly<Record<ClaveDeIndicador, string>> = {
  sinClasificar: "Movimientos sin clasificar",
  clasificacionSugeridaSinConfirmar: "Clasificación sugerida sin confirmar",
  unidadSugeridaSinConfirmar: "Unidad sugerida sin confirmar",
  chequeIvaAmbiguo: "Cheques con IVA ambiguo",
  saldoFaltante: "Movimientos sin saldo (cuentas bancarias)",
  otraMoneda: "Movimientos en otra moneda (fuera de los totales en pesos)",
};

export type Indicador = Readonly<{
  clave: ClaveDeIndicador;
  rotulo: string;
  // Movimientos del alcance en el mes.
  total: number;
  // Cuántos de esos están en lotes todavía abiertos (no entran en el Reporte).
  enLotesAbiertos: number;
}>;

// Quién ve cada indicador: todos, menos «saldo faltante», que es reservado (solo quien ve saldos).
export function indicadoresVisibles(acceso: AccesoDeCalidad): ClaveDeIndicador[] {
  const todos: ClaveDeIndicador[] = [
    "sinClasificar",
    "clasificacionSugeridaSinConfirmar",
    "unidadSugeridaSinConfirmar",
    "chequeIvaAmbiguo",
    "saldoFaltante",
    "otraMoneda",
  ];
  return todos.filter((c) => c !== "saldoFaltante" || acceso.verSaldos);
}

const CAMPO_DE_INDICADOR: Readonly<Record<ClaveDeIndicador, keyof FilaDeCalidadPorLote>> = {
  sinClasificar: "sinClasificar",
  clasificacionSugeridaSinConfirmar: "clasificacionSugerida",
  unidadSugeridaSinConfirmar: "unidadSugerida",
  chequeIvaAmbiguo: "chequeIvaAmbiguo",
  saldoFaltante: "saldoFaltante",
  otraMoneda: "otraMoneda",
};

export type SemanasProvisorias = Readonly<{
  // Semanas del mes con movimientos del alcance todavía en un lote abierto.
  semanas: number;
  // Movimientos del alcance de esas semanas que NO están en el Reporte.
  movimientosAfuera: number;
}>;

export type SinAsignar = Readonly<{
  rotulo: "Sin asignar";
  porMoneda: readonly Readonly<FilaSinAsignar>[];
}>;

export type CalidadDelMes = Readonly<{
  periodo: string;
  // «dd/mm» del último dato en lotes cerrados DEL ALCANCE; null si no hay.
  datosAl: string | null;
  movimientosEnLotesCerrados: number;
  movimientosEnLotesAbiertos: number;
  semanasProvisorias: SemanasProvisorias;
  indicadores: readonly Indicador[];
  clasificacionesSinFila: ClasificacionesSinFila;
  // Solo ADMIN. null para el resto: la clave existe pero vacía, sin número.
  sinAsignar: SinAsignar | null;
}>;

export function armarSemanasProvisorias(filas: readonly FilaDeLote[], periodo: string): SemanasProvisorias {
  const lunes = Array.from(new Set(filas.filter((f) => f.periodo === periodo).map((f) => f.lunes))).sort();
  let semanas = 0;
  let afuera = 0;
  for (const l of lunes) {
    const e = estadoDeParte(filas, l, periodo);
    if (e.tipo === "provisoria") {
      semanas += 1;
      afuera += e.movimientosAfuera;
    }
  }
  return Object.freeze({ semanas, movimientosAfuera: afuera });
}

export type EntradaDeCalidad = {
  alcance: Alcance;
  acceso: AccesoDeCalidad;
  periodo: string;
  porLote: readonly FilaDeCalidadPorLote[];
  semanas: readonly FilaDeLote[];
  clasificaciones: ClasificacionesSinFila;
  // Lo que devolvió la consulta de «sin asignar»; se IGNORA si el alcance no es el holding (ADMIN).
  sinAsignar: readonly FilaSinAsignar[] | null;
};

export function armarCalidadDelMes(e: EntradaDeCalidad): CalidadDelMes {
  for (const f of e.porLote) {
    for (const [campo, valor] of Object.entries(f)) {
      if (campo !== "estado" && (!Number.isInteger(valor) || (valor as number) < 0)) throw new Error("Cantidad de movimientos inválida.");
    }
  }
  const suma = (campo: keyof FilaDeCalidadPorLote, estado?: "ABIERTA" | "CERRADA") =>
    e.porLote.filter((f) => estado === undefined || f.estado === estado).reduce((s, f) => s + (f[campo] as number), 0);
  const indicadores = indicadoresVisibles(e.acceso).map((clave): Indicador =>
    Object.freeze({
      clave,
      rotulo: ROTULOS_DE_INDICADOR[clave],
      total: suma(CAMPO_DE_INDICADOR[clave]),
      enLotesAbiertos: suma(CAMPO_DE_INDICADOR[clave], "ABIERTA"),
    })
  );
  const sinAsignar: SinAsignar | null =
    e.alcance.esHolding && e.sinAsignar
      ? Object.freeze({
          rotulo: "Sin asignar" as const,
          porMoneda: Object.freeze([...e.sinAsignar].sort((a, b) => a.moneda.localeCompare(b.moneda)).map((f) => Object.freeze({ ...f }))),
        })
      : null;
  return Object.freeze({
    periodo: e.periodo,
    datosAl: datosAl(e.semanas.filter((f) => f.periodo === e.periodo)),
    movimientosEnLotesCerrados: suma("movimientos", "CERRADA"),
    movimientosEnLotesAbiertos: suma("movimientos", "ABIERTA"),
    semanasProvisorias: armarSemanasProvisorias(e.semanas, e.periodo),
    indicadores: Object.freeze(indicadores),
    clasificacionesSinFila: e.clasificaciones,
    sinAsignar,
  });
}
