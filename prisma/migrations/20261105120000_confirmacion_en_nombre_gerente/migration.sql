-- AlterTable
ALTER TABLE "PresupuestoMensual" ADD COLUMN     "confirmadoEnNombreDeGerente" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "motivoConfirmacionEnNombre" TEXT;
