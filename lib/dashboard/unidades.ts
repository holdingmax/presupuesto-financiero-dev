// Unidades de negocio del Dashboard consolidado (Entrega 1: base de seguridad). Módulo PURO (sin Prisma ni next/*).

// Misma normalización que hacen las consultas del Reporte en la base: upper(btrim(unidadNegocio)). Las unidades son
// nombres en mayúsculas sin tildes (lib/unidadesNegocio.ts), así que no se tocan tildes ni espacios internos.
export function normalizarUnidad(unidad: string): string {
  return unidad.trim().toUpperCase();
}

// Lista de unidades normalizada, sin vacías ni repetidas y en orden estable.
export function unidadesNormalizadas(unidades: readonly string[]): string[] {
  return Array.from(new Set(unidades.map(normalizarUnidad).filter((u) => u !== ""))).sort();
}

export type EmpresaConUnidades = { id: string; unidadesNegocio: readonly string[] };

// Unidades que pertenecen a MÁS DE UNA empresa. El diseño del dashboard depende de que cada unidad sea de una sola
// empresa (si no, un usuario de la empresa A recibiría movimientos que también son de la B), pero eso solo lo controla la
// pantalla /admin/unidades-negocio: la base no lo impide. Una unidad repetida dentro de la MISMA empresa no cuenta.
export function detectarUnidadesRepetidas(
  empresas: readonly EmpresaConUnidades[]
): { unidad: string; empresaIds: string[] }[] {
  const dueños = new Map<string, Set<string>>();
  for (const e of empresas) {
    for (const u of unidadesNormalizadas(e.unidadesNegocio)) {
      const set = dueños.get(u) ?? new Set<string>();
      set.add(e.id);
      dueños.set(u, set);
    }
  }
  return Array.from(dueños.entries())
    .filter(([, ids]) => ids.size > 1)
    .map(([unidad, ids]) => ({ unidad, empresaIds: Array.from(ids).sort() }))
    .sort((a, b) => a.unidad.localeCompare(b.unidad));
}
