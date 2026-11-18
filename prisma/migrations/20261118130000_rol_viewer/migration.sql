-- Rol VIEWER (solo lectura). Migración ADITIVA: agrega un valor al enum "Rol". No toca ninguna tabla ni
-- ninguna fila. Mismo mecanismo que EN_REVISION (20260923194752_presupuesto_revision_intermedia).
-- IMPORTANTE: se aplica ANTES de desplegar el código que escribe 'VIEWER' (crear/cambiar usuarios).

-- AlterEnum
ALTER TYPE "Rol" ADD VALUE 'VIEWER';
