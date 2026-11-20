import { exigirAlcance, type Alcance } from "@/lib/dashboard/alcance";
import { accesoDelDashboard, exigirAlcanceDelUsuario, type UsuarioParaDashboard } from "@/lib/dashboard/accesoUsuario";
import {
  armarFilaDeAvance,
  conConcurrencia,
  corteDeEmpresa,
  filaSinReporte,
  ordenarFilas,
  totalesDeEgresosOperativos,
  type FilaDeAvance,
  type PresupuestoLeido,
  type TotalDeAvance,
} from "@/lib/dashboard/avance";
import { datosAl, rangoDeMes, type FilaDeLote } from "@/lib/dashboard/semana";
import { leerMovimientosPorSemana } from "@/lib/dashboard/consultas";
import { leerCortesPorUnidad, leerPresupuestosDelMes } from "@/lib/dashboard/consultasMes";
import { armarSemanasProvisorias, type SemanasProvisorias } from "@/lib/dashboard/calidad";
import { PERIODOS_HABILITADOS } from "@/lib/config";
import { armarReporteDePlantilla } from "@/lib/reporte/armarReporteDePlantilla";
import { plantillaDeEmpresa } from "@/lib/reporte/plantillas";

// AVANCE DEL MES (Entrega 2, bloque A): une las consultas por mes (consultasMes.ts) con el Reporte de cada empresa.
//
// El cálculo es SIEMPRE armarReporteDePlantilla (el único camino del Reporte, pantalla y Excel), con los flags de
// bloques reservados del usuario (accesoDelDashboard = bloquesReservadosDelUsuario). Acá NO se llama a armarReporte ni a
// cargarDatosMeses (lo controla un test). Se carga EMPRESA POR EMPRESA, con a lo sumo 2 a la vez (pool de 5 conexiones), para
// poder mostrar cada fila apenas está lista (Suspense por empresa en la pantalla).

// Lo que se lee UNA vez por mes y por alcance (3 consultas): cortes por unidad, presupuestos y semanas.
export type ContextoDeAvance = Readonly<{
  periodo: string;
  ultimaPorUnidad: ReadonlyMap<string, string>;
  presupuestos: ReadonlyMap<string, PresupuestoLeido>;
  semanas: readonly FilaDeLote[];
}>;

// Ningún rol, ADMIN incluido, mira períodos que no estén habilitados (mismo criterio que el Reporte).
function exigirPeriodoHabilitado(periodo: string): void {
  rangoDeMes(periodo);
  if (!PERIODOS_HABILITADOS.includes(periodo)) throw new Error(`El período ${periodo} no está habilitado.`);
}

export async function leerContextoDeAvance(alcance: Alcance, periodo: string): Promise<ContextoDeAvance> {
  exigirAlcance(alcance);
  exigirPeriodoHabilitado(periodo);
  const { desde, hasta } = rangoDeMes(periodo);
  // Una consulta a la vez: son 3 y el pool es de 5.
  const cortes = await leerCortesPorUnidad(alcance, periodo);
  const presupuestos = await leerPresupuestosDelMes(alcance, periodo);
  const semanas = await leerMovimientosPorSemana(alcance, { desde, hasta });
  return Object.freeze({
    periodo,
    ultimaPorUnidad: new Map(cortes.map((c) => [c.unidad, c.ultima])),
    presupuestos,
    semanas,
  });
}

// UNA empresa del alcance. La empresa se busca EN el alcance: un id ajeno no existe.
export async function cargarAvanceDeEmpresa(
  alcance: Alcance,
  empresaId: string,
  usuario: UsuarioParaDashboard,
  contexto: ContextoDeAvance
): Promise<FilaDeAvance> {
  exigirAlcance(alcance);
  exigirAlcanceDelUsuario(alcance, usuario);
  exigirPeriodoHabilitado(contexto.periodo);
  const empresa = alcance.empresas.find((e) => e.id === empresaId);
  if (!empresa) throw new Error("La empresa no está en tu alcance.");
  const plantilla = plantillaDeEmpresa(empresa.slug);
  if (!plantilla) return filaSinReporte(empresa);
  const acceso = accesoDelDashboard(usuario);
  const { reporte } = await armarReporteDePlantilla({
    plantilla,
    empresaId: empresa.id,
    empresaSlug: empresa.slug,
    unidadesEmpresa: [...empresa.unidades],
    periodo: contexto.periodo,
    vista: "actual",
    esAdminOFinanzas: acceso.esAdminOFinanzas,
    verBloquesReservados: acceso.verBloquesReservados,
    sinBloquesReservados: acceso.sinBloquesReservados,
  });
  return armarFilaDeAvance(empresa, contexto.periodo, {
    reporte,
    presupuesto: contexto.presupuestos.get(empresa.id),
    corte: corteDeEmpresa(empresa.unidades, contexto.ultimaPorUnidad),
  });
}

export type AvanceDelMes = Readonly<{
  periodo: string;
  // «dd/mm» del último dato en lotes cerrados del alcance; null si no hay.
  datosAl: string | null;
  semanasProvisorias: SemanasProvisorias;
  filas: readonly FilaDeAvance[];
  // Egresos operativos por moneda. Sin total de ingresos.
  totales: readonly TotalDeAvance[];
}>;

export async function cargarAvanceDelMes(
  alcance: Alcance,
  usuario: UsuarioParaDashboard,
  periodo: string,
  opciones: { concurrencia?: number; alTerminarEmpresa?: (fila: FilaDeAvance) => void } = {}
): Promise<AvanceDelMes> {
  exigirAlcance(alcance);
  exigirAlcanceDelUsuario(alcance, usuario);
  const contexto = await leerContextoDeAvance(alcance, periodo);
  const filas = await conConcurrencia(alcance.empresas, opciones.concurrencia ?? 2, async (empresa) => {
    const fila = await cargarAvanceDeEmpresa(alcance, empresa.id, usuario, contexto);
    opciones.alTerminarEmpresa?.(fila);
    return fila;
  });
  const ordenadas = ordenarFilas(filas);
  return Object.freeze({
    periodo,
    datosAl: datosAl(contexto.semanas.filter((f) => f.periodo === periodo)),
    semanasProvisorias: armarSemanasProvisorias(contexto.semanas, periodo),
    filas: Object.freeze(ordenadas),
    totales: Object.freeze(totalesDeEgresosOperativos(ordenadas, alcance)),
  });
}
