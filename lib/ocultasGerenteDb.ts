import { prisma } from "@/lib/prisma";
import { clasificacionesOcultasParaUsuario, valoresGuardadosOcultos } from "@/lib/clasificacionesOcultas";

// Valores EXACTOS de clasificación, guardados en esa semana, que este usuario no puede ver en la pestaña
// de su empresa (ver lib/clasificacionesOcultas.ts). [] si no hay nada configurado para él, y entonces ni
// siquiera consulta. Los dos caminos de la pantalla (where de Prisma y SQL del Total) y el Excel usan
// esta misma lista.
export async function obtenerValoresOcultos(
  ejecucionId: string,
  slugEmpresa: string,
  usuario: { rol: string; operaEjecucion: boolean }
): Promise<string[]> {
  const ocultas = clasificacionesOcultasParaUsuario(slugEmpresa, usuario);
  if (ocultas.length === 0) return [];
  const filas = await prisma.movimientoBancario.groupBy({ by: ["clasificacion"], where: { ejecucionId } });
  return valoresGuardadosOcultos(
    filas.map((f) => f.clasificacion),
    ocultas
  );
}
