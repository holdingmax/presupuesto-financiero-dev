import type { EstadoPresupuesto, Usuario } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { esAdminOFinanzas, puedeRevisarPresupuesto } from "@/lib/auth";
import { esViewer } from "@/lib/permisosViewer";
import { puedeCargarRealEmpresa } from "@/lib/cargaRealEmpresa";
import { cargaEnReporteActiva, mostrarFlujoEnReporte } from "@/lib/estadoPresupuesto";
import { esPeriodoHabilitado } from "@/lib/periodosHabilitados";
import { obtenerEstadoFlujo } from "@/lib/presupuestoAcceso";
import { periodoActual } from "@/lib/reporte/bloqueo";
import type { DatosMes, Plantilla, Reporte } from "@/lib/reporte/motor";
import { dispComoSaldoDelReporte } from "@/lib/reporte/descargaExcel";
import { tipeoDirectoActivo } from "@/lib/reporte/tipeoDirecto";
import { semanasDelPeriodo } from "@/lib/reporte/valoresManuales";
import { edicionDelReporte, type MarcaModo } from "@/lib/reporte/vistaReporte";

// Las dos decisiones de la pantalla del Reporte que el Excel necesita y que no salen del Reporte armado:
//  - el estado del presupuesto del mes de la URL (el badge «Validado / En revisión / Abierto»), que la pantalla
//    muestra solo cuando `flujo` no es null, y
//  - si Disponibilidades se dibuja como el «Saldo» de solo lectura del gerente.
// Replican, con las mismas funciones y los mismos argumentos, lo que arma reporte/page.tsx (ReportePorPlantilla):
// si se cambia allá, se cambia acá. Solo leen: no crean nada.

export type ContextoExcelReporte = {
  // null = la pantalla no muestra el estado para este usuario / período.
  estado: EstadoPresupuesto | null;
  dispComoSaldo: boolean;
};

export async function leerContextoExcelReporte(e: {
  usuario: Usuario;
  empresaId: string;
  empresaSlug: string;
  plantillaReporte: Plantilla;
  periodo: string;
  marcaModo: MarcaModo;
  meses: DatosMes[];
  reporte: Reporte;
}): Promise<ContextoExcelReporte> {
  const { usuario, empresaId, empresaSlug, plantillaReporte, periodo, marcaModo, meses, reporte } = e;
  const adminOFinanzas = esAdminOFinanzas(usuario);
  const puedeCargarReal = await puedeCargarRealEmpresa(usuario, empresaId);
  const edicion = edicionDelReporte({ periodo, marca: marcaModo, esAdminOFinanzas: adminOFinanzas, puedeCargarReal });
  // VIEWER: igual que la pantalla (reporte/page.tsx), sin flujo de Presupuesto ni estado.
  const soloLectura = esViewer(usuario);
  const esRevisor = soloLectura ? false : await puedeRevisarPresupuesto(usuario, empresaId);
  const flujo =
    !soloLectura &&
    edicion.flujo &&
    mostrarFlujoEnReporte({
      esAdminOFinanzas: adminOFinanzas,
      esRevisor,
      cargaActiva: cargaEnReporteActiva(empresaSlug),
      periodoHabilitado: esPeriodoHabilitado(periodo),
    })
      ? await obtenerEstadoFlujo(empresaId, periodo, esRevisor, usuario.rol)
      : null;

  // Solo la bandera `disponibilidades` del tipeo cuenta para el Saldo; la decisión es pura (descargaExcel.ts) y las
  // consultas solo se hacen si la pantalla armaría el tipeo.
  const hayTipeo = edicion.tipeo && tipeoDirectoActivo(empresaSlug);
  const ultimoMes = meses[meses.length - 1];
  const [semanas, presupuestoDelMes] = hayTipeo
    ? await Promise.all([
        semanasDelPeriodo([periodo]),
        prisma.presupuestoMensual.findUnique({
          where: { empresaId_periodo: { empresaId, periodo } },
          select: { estado: true },
        }),
      ])
    : [null, null];
  const dispComoSaldo = dispComoSaldoDelReporte({
    sinBloquesReservados: reporte.sinBloquesReservados,
    edicionTipeo: edicion.tipeo,
    empresaSlug,
    entradaTipeo: () => ({
      plantilla: plantillaReporte,
      esAdminOFinanzas: adminOFinanzas,
      puedeCargarReal,
      periodo,
      actual: periodoActual(),
      semanas: semanas!.get(periodo)!,
      valoresReales: ultimoMes.manuales?.real ?? new Map(),
      calculados: new Map(
        reporte.filas.flatMap((f) => {
          const c = f.celdas[f.celdas.length - 1];
          return c?.realCalculado === undefined ? [] : [[f.fila.clave, c.realCalculado] as const];
        })
      ),
      valoresPresupuesto: ultimoMes.manuales?.presupuesto ?? new Map(),
      presupuestoValidado: presupuestoDelMes?.estado === "VALIDADO",
    }),
  });

  return { estado: flujo?.estado ?? null, dispComoSaldo };
}
