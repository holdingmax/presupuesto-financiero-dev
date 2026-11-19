import { resolverAlcance, type EmpresaLeida, type LectorDeEmpresas, type Alcance } from "@/lib/dashboard/alcance";

// Empresas de prueba con la misma forma que testing (2026-11): 12 activas y 2 inactivas (Gold Seguridad y JPS). Ids cortos y
// legibles. Cada unidad es de UNA sola empresa. Conexión Logística tiene dos unidades (LOGISTICA y SPP).
export const E = (id: string, nombre: string, unidadesNegocio: string[], activo = true): EmpresaLeida => ({
  id,
  nombre,
  activo,
  unidadesNegocio,
});

export const EMPRESAS: EmpresaLeida[] = [
  E("avianor", "Avianor", ["AVIANOR"]),
  E("bradenton", "Bradenton", ["BRADENTON"]),
  E("brillante", "Brillante", ["BRILLANTE"]),
  E("conexion", "Conexión Logística", ["LOGISTICA", "SPP"]),
  E("expensas", "Expensas", ["EXPENSAS"]),
  E("fredy", "Fredy Publicidad", ["FREDY"]),
  E("gold", "Gold Seguridad", [], false),
  E("hwc", "Handyway Cargo", ["HWC"]),
  E("havanna", "Havanna", ["HAVANNA"]),
  E("havanna-peru", "Havanna Perú", ["HAVANNA PERU"]),
  E("jps", "JPS", ["JPS"], false),
  E("mantenor", "Mantenor", ["MANTENOR"]),
  E("plate-silver", "Plate Silver", ["PLATE SILVER"]),
  E("radio", "Radio", ["RADIO"]),
];

export const IDS_ACTIVAS = EMPRESAS.filter((e) => e.activo).map((e) => e.id);

// Lector simulado: cuenta las lecturas, para comprobar que un alcance vacío no consulta nada más. `asignadasActivas`
// devuelve las empresas asignadas SIN filtrar por activo a propósito (la consulta real sí filtra): así se prueba también
// que el resolvedor descarta las inactivas por su cuenta.
export function lectorDePrueba(asignaciones: Record<string, string[]>, empresas: EmpresaLeida[] = EMPRESAS) {
  const llamadas = { asignadas: 0, todas: 0 };
  const lector: LectorDeEmpresas = {
    async asignadasActivas(usuarioId) {
      llamadas.asignadas += 1;
      const ids = asignaciones[usuarioId] ?? [];
      return empresas.filter((e) => ids.includes(e.id));
    },
    async todasLasActivas() {
      llamadas.todas += 1;
      return empresas.filter((e) => e.activo);
    },
  };
  return { lector, llamadas };
}

export type RolDePrueba = "ADMIN" | "FINANZAS" | "GERENTE" | "VIEWER";

export async function alcanceDe(
  rol: RolDePrueba,
  empresaIds: string[],
  empresas: EmpresaLeida[] = EMPRESAS
): Promise<Alcance> {
  const { lector } = lectorDePrueba({ u1: empresaIds }, empresas);
  return resolverAlcance({ id: "u1", rol }, lector);
}
