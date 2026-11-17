import { prisma } from "@/lib/prisma";
import type { AlmacenRecuperacion } from "@/lib/recuperacion";

// Almacenamiento real (Prisma) de la recuperación de contraseña. La lógica y sus reglas están en
// lib/recuperacion.ts.
export const almacenPrisma: AlmacenRecuperacion = {
  contarIntentos: (clave, desde) => prisma.intentoRecuperacion.count({ where: { clave, createdAt: { gte: desde } } }),

  async registrarIntento(clave, ahora) {
    await prisma.intentoRecuperacion.create({ data: { clave, createdAt: ahora } });
  },

  async limpiarViejos(antesDe) {
    await prisma.intentoRecuperacion.deleteMany({ where: { createdAt: { lt: antesDe } } });
    await prisma.tokenRecuperacion.deleteMany({ where: { expiresAt: { lt: antesDe } } });
  },

  // Sin distinguir mayúsculas: tolera emails viejos guardados con mayúsculas (igual que el login).
  buscarUsuarioPorEmail: (emailNormalizado) =>
    prisma.usuario.findFirst({
      where: { email: { equals: emailNormalizado, mode: "insensitive" } },
      select: { id: true, email: true, activo: true },
    }),

  async reemplazarToken(usuarioId, tokenHash, expiresAt) {
    await prisma.$transaction([
      prisma.tokenRecuperacion.deleteMany({ where: { usuarioId, usadoAt: null } }),
      prisma.tokenRecuperacion.create({ data: { usuarioId, tokenHash, expiresAt } }),
    ]);
  },

  async buscarTokenVigente(tokenHash, ahora) {
    const t = await prisma.tokenRecuperacion.findUnique({
      where: { tokenHash },
      select: { id: true, usuarioId: true, usadoAt: true, expiresAt: true, usuario: { select: { activo: true } } },
    });
    if (!t || t.usadoAt || t.expiresAt <= ahora || !t.usuario.activo) return null;
    return { id: t.id, usuarioId: t.usuarioId };
  },

  consumirYCambiar: (tokenId, usuarioId, passwordHash, ahora) =>
    prisma.$transaction(async (tx) => {
      // updateMany con usadoAt:null garantiza un solo uso aun con dos pedidos a la vez.
      const marcado = await tx.tokenRecuperacion.updateMany({
        where: { id: tokenId, usadoAt: null, expiresAt: { gt: ahora } },
        data: { usadoAt: ahora },
      });
      if (marcado.count !== 1) return false;
      await tx.usuario.update({ where: { id: usuarioId }, data: { passwordHash, debeActualizarPassword: false } });
      await tx.tokenRecuperacion.deleteMany({ where: { usuarioId, usadoAt: null } });
      await tx.sesion.deleteMany({ where: { usuarioId } });
      return true;
    }),
};
