import { CLASIFICACIONES_FUERA_DEL_REPORTE_INTENCIONAL, CLASIFICACIONES_SE_CARGAN_A_MANO } from "@/lib/config";
import { centavosDeNumero } from "@/lib/conteoMovimientos";
import { claveEquivalencia } from "@/lib/reporte/motor";
import { normalizarTexto } from "@/lib/texto";
import type { FilaDescartadaMadre, FilaMadre } from "./madre";

// Avisos de la vista previa del archivo madre (pedido de Kike: que nada quede afuera de los Reportes sin
// avisar). Parte pura, sin base ni ExcelJS. Solo AVISAN: no cambian qué se guarda, a qué unidad va cada
// fila ni ninguna suma del Reporte.

const CLASIFICACION_VACIA = "SIN CLASIFICAR";
const UNIDAD_VACIA = "SIN ASIGNAR";

// 1) Unidades escritas en el archivo que no se reconocieron: texto original y unidad a la que cayó la fila.
export type UnidadNoReconocida = { texto: string; columna: "UNIDAD DE NEG" | "EMPRESA"; cayoEn: string; filas: number };

export function unidadesNoReconocidas(filas: readonly FilaMadre[]): UnidadNoReconocida[] {
  const grupos = new Map<string, UnidadNoReconocida>();
  for (const f of filas) {
    const u = f.unidadNoReconocida;
    if (!u) continue;
    const clave = `${u.columna}|${normalizarTexto(u.texto)}|${f.unidadNegocio}`;
    const previo = grupos.get(clave);
    if (previo) previo.filas++;
    else grupos.set(clave, { texto: u.texto, columna: u.columna, cayoEn: f.unidadNegocio, filas: 1 });
  }
  return [...grupos.values()].sort((a, b) => b.filas - a.filas || a.texto.localeCompare(b.texto, "es"));
}

// 2) Clasificaciones del archivo que ninguna plantilla ni la lista de intencionales reconoce, por empresa.
// `empresas`: las activas, con sus unidades y las claves de clasificación que pide su plantilla (null = la
// empresa no tiene Reporte por plantilla: no se avisa nada de ella, su Reporte es el de la Fase 1).
export type EmpresaParaAvisos = { nombre: string; unidades: readonly string[]; clasificacionesDePlantilla: readonly string[] | null };

export type ClasificacionSinFila = { empresa: string; clasificacion: string; filas: number; centavos: number };

// Devuelve DOS grupos con los mismos datos (empresa, clasificación, cantidad, importe):
//   - noEncajan: ninguna plantilla ni la lista de intencionales las reconoce. Exigen confirmar la carga.
//   - seCarganAMano: están en CLASIFICACIONES_SE_CARGAN_A_MANO (IVA, INVERSIONES…): no suman solas, su fila es
//     manual. Es un recordatorio, no exige confirmar.
export type ClasificacionesSinFila = { noEncajan: ClasificacionSinFila[]; seCarganAMano: ClasificacionSinFila[] };

export function clasificacionesSinFila(
  filas: readonly FilaMadre[],
  empresas: readonly EmpresaParaAvisos[],
  intencionales: readonly string[] = CLASIFICACIONES_FUERA_DEL_REPORTE_INTENCIONAL,
  aMano: readonly string[] = CLASIFICACIONES_SE_CARGAN_A_MANO
): ClasificacionesSinFila {
  const fuera = new Set(intencionales.map(claveEquivalencia));
  const manuales = new Set(aMano.map(claveEquivalencia));
  const empresaDeUnidad = new Map<string, { nombre: string; pedidas: Set<string> }>();
  for (const e of empresas) {
    if (e.clasificacionesDePlantilla === null) continue;
    const pedidas = new Set(e.clasificacionesDePlantilla.map(claveEquivalencia));
    for (const u of e.unidades) empresaDeUnidad.set(normalizarTexto(u), { nombre: e.nombre, pedidas });
  }
  const grupos = new Map<string, ClasificacionSinFila & { aMano: boolean }>();
  for (const f of filas) {
    // SIN CLASIFICAR y SIN ASIGNAR ya tienen su propio aviso; una unidad sin empresa también.
    if (f.clasificacion === CLASIFICACION_VACIA || f.unidadNegocio === UNIDAD_VACIA) continue;
    const empresa = empresaDeUnidad.get(normalizarTexto(f.unidadNegocio));
    if (!empresa) continue;
    const clave = claveEquivalencia(f.clasificacion);
    if (empresa.pedidas.has(clave) || fuera.has(clave)) continue;
    const id = `${empresa.nombre}|${clave}`;
    const g = grupos.get(id) ?? { empresa: empresa.nombre, clasificacion: f.clasificacion.trim(), filas: 0, centavos: 0, aMano: manuales.has(clave) };
    g.filas++;
    g.centavos += centavosDeNumero(f.importe);
    grupos.set(id, g);
  }
  const ordenados = [...grupos.values()].sort(
    (a, b) => a.empresa.localeCompare(b.empresa, "es") || Math.abs(b.centavos) - Math.abs(a.centavos)
  );
  const sinMarca = (g: ClasificacionSinFila): ClasificacionSinFila => ({
    empresa: g.empresa,
    clasificacion: g.clasificacion,
    filas: g.filas,
    centavos: g.centavos,
  });
  return {
    noEncajan: ordenados.filter((g) => !g.aMano).map(sinMarca),
    seCarganAMano: ordenados.filter((g) => g.aMano).map(sinMarca),
  };
}

// 3) Filas descartadas por importe ilegible: no entran a la base. Se muestran las primeras y el total.
export type DescartadasPorImporte = { total: number; primeras: FilaDescartadaMadre[] };

export const MAX_DESCARTADAS_VISIBLES = 10;

export function descartadasPorImporte(descartadas: readonly FilaDescartadaMadre[]): DescartadasPorImporte {
  return { total: descartadas.length, primeras: descartadas.slice(0, MAX_DESCARTADAS_VISIBLES) };
}

// Grupo (a) "No encajan": unidades no reconocidas, clasificaciones que ninguna plantilla ni lista reconoce y filas
// descartadas. Es lo que hay que confirmar antes de cargar. Grupo (b) "Se cargan a mano": solo recordatorio.
export type AvisosFueraDelReporte = {
  unidadesNoReconocidas: UnidadNoReconocida[];
  clasificacionesSinFila: ClasificacionSinFila[];
  descartadas: DescartadasPorImporte;
  seCarganAMano: ClasificacionSinFila[];
};

// Solo el grupo (a): el recordatorio del grupo (b) NO cuenta.
export function hayAvisosQueNoEncajan(a: AvisosFueraDelReporte): boolean {
  return a.unidadesNoReconocidas.length > 0 || a.clasificacionesSinFila.length > 0 || a.descartadas.total > 0;
}
