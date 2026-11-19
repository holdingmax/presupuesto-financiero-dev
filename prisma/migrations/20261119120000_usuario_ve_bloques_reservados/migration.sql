-- Casilla "ve bloques reservados" del rol VIEWER (Reporte: Disponibilidades y Cierre, en pantalla y en el Excel).
-- Migración ADITIVA: agrega UNA columna con default false. No toca ninguna fila existente (todos quedan en false: nadie
-- gana ningún permiso al migrar) ni ninguna otra tabla.
-- IMPORTANTE: se aplica ANTES de desplegar el código que lee la columna. obtenerUsuarioActual trae el Usuario completo
-- (include: { usuario: true }): con el código nuevo y la columna sin crear, fallaría el login de TODOS los usuarios.

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "veBloquesReservados" BOOLEAN NOT NULL DEFAULT false;
