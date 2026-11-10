import { prisma } from "@/lib/prisma";
import { requireAdminOFinanzas, PermisoDenegadoError } from "@/lib/auth";
import TipoCambioForm, { type FilaTipoCambioVista } from "./TipoCambioForm";

// Tipo de cambio por mes (Etapa 2, Havanna Perú): soles por 1 dólar. Solo ADMIN y FINANZAS.
export default async function TipoCambioPage() {
  let filas: FilaTipoCambioVista[];
  try {
    await requireAdminOFinanzas();
    const registros = await prisma.tipoCambio.findMany({
      orderBy: [{ periodo: "desc" }, { moneda: "asc" }],
      include: { cargadoPor: { select: { nombre: true } } },
    });
    filas = registros.map((r) => ({
      periodo: r.periodo,
      moneda: r.moneda,
      valor: r.valor.toFixed(6).replace(/0+$/, "").replace(/\.$/, "").replace(".", ","),
      cargadoPor: r.cargadoPor.nombre,
      cuando: r.updatedAt.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }),
    }));
  } catch (error) {
    if (error instanceof PermisoDenegadoError) return null;
    // Tabla todavía no creada en esta base (falta aplicar la migración de TipoCambio).
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2021") {
      return (
        <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-terracota">
          Falta crear la tabla de tipo de cambio en esta base (migración 20261111120000_tipo_cambio).
        </p>
      );
    }
    throw error;
  }
  return <TipoCambioForm filas={filas} />;
}
