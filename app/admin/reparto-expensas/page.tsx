import { prisma } from "@/lib/prisma";
import { requireAdminOFinanzas, PermisoDenegadoError } from "@/lib/auth";
import { slugDeEmpresa } from "@/lib/slug";
import { PERIODOS_HABILITADOS, PERIODO_EN_CARGA_GERENTE } from "@/lib/config";
import { centavosDeDecimalTexto } from "@/lib/conteoMovimientos";
import { nombreLegibleDePeriodo } from "@/lib/periodosHabilitados";
import { periodoActual } from "@/lib/reporte/bloqueo";
import { semanasDelPeriodo } from "@/lib/reporte/valoresManuales";
import { empresasConExpensas, estadoEmpresaReparto } from "@/lib/reporte/repartoExpensas";
import RepartoExpensasForm, { type EmpresaReparto } from "./RepartoExpensasForm";

type Props = { searchParams: Promise<{ periodo?: string }> };

// Calculadora de reparto de Expensas (solo ADMIN y FINANZAS): el total del mes y un porcentaje por empresa
// calculan el Real de la fila «Expensas» de cada Reporte. Ver lib/reporte/repartoExpensas.ts.
export default async function RepartoExpensasPage({ searchParams }: Props) {
  const { periodo: periodoUrl } = await searchParams;
  const periodo =
    periodoUrl && PERIODOS_HABILITADOS.includes(periodoUrl)
      ? periodoUrl
      : PERIODOS_HABILITADOS.includes(PERIODO_EN_CARGA_GERENTE)
        ? PERIODO_EN_CARGA_GERENTE
        : PERIODOS_HABILITADOS[PERIODOS_HABILITADOS.length - 1];

  let empresas: EmpresaReparto[];
  try {
    await requireAdminOFinanzas();
    const base = await prisma.empresa.findMany({ where: { activo: true }, select: { id: true, nombre: true } });
    const lista = empresasConExpensas(base.map((e) => ({ ...e, slug: slugDeEmpresa(e.nombre) })));
    const [valores, semanas] = await Promise.all([
      prisma.valorManualReporte.findMany({
        where: {
          periodo,
          columna: "REAL",
          OR: lista.map((e) => ({ empresaId: e.id, filaClave: e.fila.clave })),
        },
        select: { empresaId: true, filaClave: true, importe: true, nota: true, cargadoPor: { select: { nombre: true } } },
      }),
      semanasDelPeriodo([periodo]),
    ]);
    const actual = periodoActual();
    empresas = lista.map((e) => {
      const v = valores.find((x) => x.empresaId === e.id && x.filaClave === e.fila.clave);
      const existenteCentavos = v ? centavosDeDecimalTexto(v.importe.toFixed(2)) : null;
      return {
        id: e.id,
        nombre: e.nombre,
        filaTexto: e.fila.texto,
        existenteCentavos,
        nota: v?.nota ?? null,
        cargadoPor: v?.cargadoPor.nombre ?? null,
        estado: estadoEmpresaReparto({
          periodo,
          actual,
          bloque: e.fila.bloque,
          semanas: semanas.get(periodo)!,
          existenteCentavos,
        }),
      };
    });
  } catch (error) {
    // Ver el comentario equivalente en admin/usuarios/page.tsx.
    if (error instanceof PermisoDenegadoError) return null;
    throw error;
  }

  return (
    <RepartoExpensasForm
      // Al cambiar de mes se descarta lo tipeado.
      key={periodo}
      periodo={periodo}
      periodos={PERIODOS_HABILITADOS.map((p) => ({ periodo: p, nombre: nombreLegibleDePeriodo(p) }))}
      empresas={empresas}
    />
  );
}
