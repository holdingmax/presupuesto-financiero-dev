-- Historial de arranque de las sugerencias de clasificación por empresa (Havanna Perú). SOLO ADITIVA: crea una tabla nueva,
-- no toca ninguna existente. Se llena con prisma/scripts/sembrar-historial-peru.ts.

-- CreateTable
CREATE TABLE "HistorialClasificacionEmpresa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "signo" INTEGER NOT NULL,
    "clasificacion" TEXT NOT NULL,
    "veces" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistorialClasificacionEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HistClasifEmpresa_unico" ON "HistorialClasificacionEmpresa"("empresaId", "concepto", "signo", "clasificacion");

-- AddForeignKey
ALTER TABLE "HistorialClasificacionEmpresa" ADD CONSTRAINT "HistorialClasificacionEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
