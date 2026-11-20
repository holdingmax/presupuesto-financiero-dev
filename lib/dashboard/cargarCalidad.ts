import { exigirAlcance, type Alcance } from "@/lib/dashboard/alcance";
import { accesoDelDashboard, exigirAlcanceDelUsuario, type UsuarioParaDashboard } from "@/lib/dashboard/accesoUsuario";
import {
  armarCalidadDelMes,
  contarClasificacionesSinFila,
  reglaDeClasificaciones,
  type CalidadDelMes,
  type ReglaDeClasificaciones,
} from "@/lib/dashboard/calidad";
import { rangoDeMes } from "@/lib/dashboard/semana";
import { leerMovimientosPorSemana } from "@/lib/dashboard/consultas";
import { leerCalidadPorLote, leerClasificacionesDelMes, leerSinAsignar } from "@/lib/dashboard/consultasMes";
import { clasificacionesOcultasParaUsuario } from "@/lib/clasificacionesOcultas";
import { PERIODOS_HABILITADOS } from "@/lib/config";
import { plantillaDeEmpresa } from "@/lib/reporte/plantillas";

// CALIDAD DEL DATO (Entrega 2, bloque B): une las consultas por mes (consultasMes.ts) con las reglas puras (calidad.ts).
// Todo sale del Alcance; lo que ve cada rol lo decide accesoDelDashboard y alcance.esHolding (ver calidad.ts).

// Reglas por unidad: una unidad pertenece a una sola empresa (el Alcance no se arma si no). Las empresas sin plantilla de
// Reporte (Expensas) no tienen regla y no cuentan.
function reglasPorUnidad(alcance: Alcance, usuario: UsuarioParaDashboard): Map<string, ReglaDeClasificaciones> {
  const reglas = new Map<string, ReglaDeClasificaciones>();
  for (const empresa of alcance.empresas) {
    const plantilla = plantillaDeEmpresa(empresa.slug);
    if (!plantilla) continue;
    const ocultas = clasificacionesOcultasParaUsuario(empresa.slug, usuario);
    const regla = reglaDeClasificaciones(plantilla, ocultas);
    for (const unidad of empresa.unidades) reglas.set(unidad, regla);
  }
  return reglas;
}

export async function cargarCalidadDelMes(alcance: Alcance, usuario: UsuarioParaDashboard, periodo: string): Promise<CalidadDelMes> {
  exigirAlcance(alcance);
  exigirAlcanceDelUsuario(alcance, usuario);
  const rango = rangoDeMes(periodo);
  if (!PERIODOS_HABILITADOS.includes(periodo)) throw new Error(`El período ${periodo} no está habilitado.`);
  const acceso = accesoDelDashboard(usuario);
  // Una consulta a la vez (pool de 5 conexiones).
  const porLote = await leerCalidadPorLote(alcance, periodo, { verSaldos: acceso.verSaldos });
  const filasDeClasificacion = await leerClasificacionesDelMes(alcance, periodo);
  const semanas = await leerMovimientosPorSemana(alcance, rango);
  // Solo ADMIN: para el resto leerSinAsignar devuelve null sin consultar.
  const sinAsignar = await leerSinAsignar(alcance, periodo);
  return armarCalidadDelMes({
    alcance,
    acceso: { verSaldos: acceso.verSaldos },
    periodo,
    porLote,
    semanas,
    clasificaciones: contarClasificacionesSinFila(filasDeClasificacion, reglasPorUnidad(alcance, usuario)),
    sinAsignar,
  });
}
