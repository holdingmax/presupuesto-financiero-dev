import type { Rol } from "@prisma/client";

// Reabrir una semana cerrada de Ejecución ("Reabrir semana para corregir"): SOLO ADMIN. Ni FINANZAS (que sí cierra) ni
// GERENTE ni VIEWER, tengan las casillas que tengan. Puro (sin Prisma ni next/*), a propósito en un archivo aparte de
// lib/permisosEjecucion.ts y lib/auth.ts. El servidor lo exige con requireAdmin (app/ejecucion/actionsReabrir.ts); esto
// solo decide qué se MUESTRA y lo usan los tests para fijar la regla.
type ConRol = { rol: Rol };

export function puedeReabrirSemana(usuario: ConRol): boolean {
  return usuario.rol === "ADMIN";
}

// Quién ve el indicador "Reabierta por X…" y el historial de reaperturas: solo ADMIN. Gerentes, FINANZAS y visualizadores
// no ven nada distinto (decisión de Kike): el dato ni siquiera se consulta para ellos (lib/reaperturaSemanaDb.ts).
export function veReaperturas(usuario: ConRol): boolean {
  return puedeReabrirSemana(usuario);
}
