import { prisma } from "@/lib/prisma";
import { buscarTipoCambio, type ResultadoTipoCambio } from "@/lib/tipoCambio";

// Lectura del tipo de cambio de un período (solo lectura; no crea nada). Para armar el Reporte: si no hay
// fila devuelve { ok: false, aviso } y quien arma el Reporte muestra el aviso, no inventa un valor.
export async function obtenerTipoCambio(periodo: string, moneda: string): Promise<ResultadoTipoCambio> {
  const filas = await prisma.tipoCambio.findMany({
    where: { periodo, moneda: moneda.trim().toUpperCase() },
    select: { periodo: true, moneda: true, valor: true },
  });
  return buscarTipoCambio(
    filas.map((f) => ({ periodo: f.periodo, moneda: f.moneda, valor: f.valor.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") })),
    periodo,
    moneda
  );
}
