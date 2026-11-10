-- Tipo de cambio por período (Havanna Perú). SOLO ADITIVA: crea una tabla nueva, no toca ninguna existente.
-- Soles por 1 unidad de `moneda` (hoy USD) en el período AAAA-MM; lo carga ADMIN o FINANZAS.

-- CreateTable
CREATE TABLE "TipoCambio" (
    "id" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "moneda" TEXT NOT NULL,
    "valor" DECIMAL(18,6) NOT NULL,
    "cargadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoCambio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TipoCambio_periodo_moneda_key" ON "TipoCambio"("periodo", "moneda");

-- AddForeignKey
ALTER TABLE "TipoCambio" ADD CONSTRAINT "TipoCambio_cargadoPorId_fkey" FOREIGN KEY ("cargadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
