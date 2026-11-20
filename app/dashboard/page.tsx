import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { requireUsuarioAlDia } from "@/lib/auth";
import { resolverAlcanceDeSesion, type Alcance } from "@/lib/dashboard/alcance";
import { periodoDelDashboard } from "@/lib/dashboard/encabezado";
import { iniciarCargasDelDashboard } from "@/lib/dashboard/iniciarCargas";
import { ordenarFilas } from "@/lib/dashboard/avance";
import { CalidadCargada, ControlCargado, EncabezadoCargado, FilaDeEmpresaCargada, PieCargado, SinAsignarCargado } from "./cargas";
import { IndicadorDeProgreso, ProgresoProvider } from "./Progreso";
import { FilaCargandoVista, ListaDeEmpresas, SeccionCargandoVista, SelectorDeMes, TotalesCargandoVista, ZonaAdminVista } from "./vistas";

export const metadata: Metadata = { title: "Dashboard semanal · HoldingMax" };

type Props = { searchParams: Promise<{ [clave: string]: string | string[] | undefined }> };

// Dashboard semanal: lo ven TODOS los roles (ADMIN, FINANZAS, GERENTE y VIEWER), calculado SOLO con las empresas del usuario.
// Es de solo lectura: no hay Server Actions ni formularios. El servidor decide todo:
//  - el Alcance sale de la sesión (resolverAlcanceDeSesion), nunca de la URL: el único dato que viene del navegador es el mes,
//    y se limita a los períodos habilitados;
//  - cada empresa se carga en su propio <Suspense>, con a lo sumo 2 lecturas a la vez (iniciarCargasDelDashboard);
//  - «Sin asignar» y el control de depósitos de cheques existen solo para ADMIN, juntos en una zona aparte: para el resto ni
//    siquiera se consultan, y el HTML no trae ni el título;
//  - al navegador solo llega HTML y el contador «Cargando N de M» con las empresas del propio alcance.
export default async function DashboardPage({ searchParams }: Props) {
  const usuario = await requireUsuarioAlDia();
  const { periodo: pedido } = await searchParams;
  const periodo = periodoDelDashboard(pedido);

  let alcance: Alcance;
  try {
    alcance = await resolverAlcanceDeSesion();
  } catch {
    return (
      <Marco>
        <p className="rounded-md border border-line bg-paper-raised px-3 py-3 text-sm text-negative">
          No se pudo armar tu resumen: hay una configuración de unidades de negocio para revisar. Avisale al administrador.
        </p>
      </Marco>
    );
  }

  if (alcance.vacio) {
    return (
      <Marco>
        <p className="text-sm text-ink-secondary">Todavía no tenés empresas asignadas. Pedile acceso al administrador.</p>
      </Marco>
    );
  }

  const cargas = iniciarCargasDelDashboard(alcance, usuario, periodo);
  const empresas = ordenarFilas(alcance.empresas);

  return (
    <Marco>
      <ProgresoProvider total={alcance.empresas.length}>
        <section aria-labelledby="resumen" className="dash-hero">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <Suspense fallback={<h1 id="resumen" className="font-serif text-[1.75rem] leading-tight font-semibold tracking-tight text-white sm:text-4xl">Avance del mes</h1>}>
                <EncabezadoCargado cargas={cargas} />
              </Suspense>
            </div>
            <SelectorDeMes periodo={periodo} />
          </div>
          <IndicadorDeProgreso />
          <Suspense fallback={<TotalesCargandoVista />}>
            <PieCargado alcance={alcance} cargas={cargas} />
          </Suspense>
        </section>

        <section aria-labelledby="avance" className="mt-12">
          <h2 id="avance" className="font-serif text-2xl font-semibold tracking-tight text-marino-dark">Avance por empresa</h2>
          <p className="mt-1 mb-5 max-w-prose text-sm text-ink-secondary">
            Egresos operativos e ingresos del mes contra el presupuesto, tal como figuran en el Reporte de cada empresa. La marca
            de cada barra es el ritmo del mes (días con datos sobre días del mes): una referencia, no una meta.
          </p>
          <ListaDeEmpresas>
            {empresas.map((empresa) => (
              <Suspense key={empresa.id} fallback={<FilaCargandoVista nombre={empresa.nombre} />}>
                <FilaDeEmpresaCargada empresa={empresa} cargas={cargas} />
              </Suspense>
            ))}
          </ListaDeEmpresas>
        </section>

        <section aria-labelledby="calidad" className="mt-12">
          <Suspense fallback={<SeccionCargandoVista titulo="Calidad del dato" texto="Cargando la calidad del dato…" />}>
            <CalidadCargada cargas={cargas} />
          </Suspense>
        </section>

        {/* Solo ADMIN: para el resto cargas.control es null y esta zona no se genera. */}
        {cargas.control && (
          <div className="mt-12">
            <ZonaAdminVista>
              <Suspense fallback={<SeccionCargandoVista texto="Cargando «Sin asignar»…" />}>
                <SinAsignarCargado cargas={cargas} />
              </Suspense>
              <Suspense fallback={<SeccionCargandoVista texto="Cargando el control de depósitos de cheques…" />}>
                <ControlCargado cargas={cargas} />
              </Suspense>
            </ZonaAdminVista>
          </div>
        )}
      </ProgresoProvider>
    </Marco>
  );
}

function Marco({ children }: { children: ReactNode }) {
  return (
    <div className="dash-fondo flex flex-1 flex-col">
      <header className="dash-noprint bg-marino-dark text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <p className="flex items-center gap-2 text-xs text-white/80">
              <span aria-hidden="true" className="h-2 w-2 bg-plata" />
              HoldingMax
            </p>
            <p className="font-serif text-lg font-semibold tracking-tight text-white">Dashboard semanal</p>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-white/85 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            ← Mis empresas
          </Link>
        </div>
      </header>
      <main className="dash-pagina mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
