-- Registro de reaperturas de semanas de Ejecución ("Reabrir semana para corregir", solo ADMIN).
-- Migración ADITIVA: crea UNA tabla nueva con su índice y su clave foránea. No toca ninguna fila ni ninguna tabla existente.
-- ReaperturaSemana_ejecucionId_fkey va con ON DELETE RESTRICT: una semana con reaperturas registradas no se puede borrar.
-- Se aplica ANTES de desplegar el código que la lee (la pantalla de Ejecución del ADMIN consulta esta tabla).

-- CreateTable
CREATE TABLE "ReaperturaSemana" (
    "id" TEXT NOT NULL,
    "ejecucionId" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "numeroSemana" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "usuarioNombre" TEXT NOT NULL,
    "fechaCierreAnterior" TIMESTAMP(3),
    "cerradoPorIdAnterior" TEXT,
    "movimientosAlReabrir" INTEGER NOT NULL,
    "semanaVaciaEliminada" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReaperturaSemana_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReaperturaSemana_ejecucionId_idx" ON "ReaperturaSemana"("ejecucionId");

-- AddForeignKey
ALTER TABLE "ReaperturaSemana" ADD CONSTRAINT "ReaperturaSemana_ejecucionId_fkey" FOREIGN KEY ("ejecucionId") REFERENCES "EjecucionSemanal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
