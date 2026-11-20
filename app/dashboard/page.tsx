import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { requireUsuarioAlDia } from "@/lib/auth";
import { resolverAlcanceDeSesion, type Alcance } from "@/lib/dashboard/alcance";
import { periodoDelDashboard } from "@/lib/dashboard/encabezado";
import { iniciarCargasDelDashboard } from "@/lib/dashboard/iniciarCargas";
import { ordenarFilas } from "@/lib/dashboard/avance";
import { CalidadCargada, ControlCargado, EncabezadoCargado, FilaDeEmpresaCargada, PieCargado } from "./cargas";
import { IndicadorDeProgreso, ProgresoProvider } from "./Progreso";
import { FilaCargandoVista, SeccionCargandoVista, SelectorDeMes, TablaDeAvance } from "./vistas";

export const metadata: Metadata = { title: "Dashboard semanal · HoldingMax" };

const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marino";

type Props = { searchParams: Promise<{ [clave: string]: string | string[] | undefined }> };

// Dashboard semanal: lo ven TODOS los roles (ADMIN, FINANZAS, GERENTE y VIEWER), calculado SOLO con las empresas del usuario.
// Es de solo lectura: no hay Server Actions ni formularios. El servidor decide todo:
//  - el Alcance sale de la sesión (resolverAlcanceDeSesion), nunca de la URL: el único dato que viene del navegador es el mes,
//    y se limita a los períodos habilitados;
//  - cada empresa se carga en su propio <Suspense>, con a lo sumo 2 lecturas a la vez (iniciarCargasDelDashboard);
//  - «Sin asignar» y el control de depósitos de cheques existen solo para ADMIN: para el resto ni siquiera se consultan, y el
//    HTML no trae ni el título;
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
        <div className="mb-6 border-b border-line-strong pb-4">
          <Suspense fallback={<h1 className="font-serif text-3xl font-semibold tracking-tight">Avance del mes</h1>}>
            <EncabezadoCargado cargas={cargas} />
          </Suspense>
          <div className="mt-4">
            <SelectorDeMes periodo={periodo} />
          </div>
          <IndicadorDeProgreso />
        </div>

        <section aria-labelledby="avance" className="mb-10">
          <h2 id="avance" className="mb-3 font-serif text-xl font-semibold tracking-tight">Avance del mes</h2>
          <TablaDeAvance
            pie={
              <Suspense fallback={null}>
                <PieCargado alcance={alcance} cargas={cargas} />
              </Suspense>
            }
          >
            {empresas.map((empresa) => (
              <Suspense key={empresa.id} fallback={<FilaCargandoVista nombre={empresa.nombre} />}>
                <FilaDeEmpresaCargada empresa={empresa} cargas={cargas} />
              </Suspense>
            ))}
          </TablaDeAvance>
          <p className="mt-2 text-xs text-ink-muted">
            Egresos operativos e ingresos del mes contra el presupuesto, tal como figuran en el Reporte de cada empresa. El ritmo del
            mes son los días con datos sobre los días del mes: es solo una referencia.
          </p>
        </section>

        <section aria-labelledby="calidad" className="mb-10">
          <h2 id="calidad" className="mb-3 font-serif text-xl font-semibold tracking-tight">Calidad del dato</h2>
          <Suspense fallback={<SeccionCargandoVista texto="Cargando la calidad del dato…" />}>
            <CalidadCargada cargas={cargas} />
          </Suspense>
        </section>

        {/* Solo ADMIN: para el resto cargas.control es null y esta sección no se genera. */}
        {cargas.control && (
          <section aria-labelledby="solo-administracion" className="mb-10">
            <h2 id="solo-administracion" className="mb-3 font-serif text-xl font-semibold tracking-tight">Controles de administración</h2>
            <Suspense fallback={<SeccionCargandoVista texto="Cargando el control de depósitos de cheques…" />}>
              <ControlCargado cargas={cargas} />
            </Suspense>
          </section>
        )}
      </ProgresoProvider>
    </Marco>
  );
}

function Marco({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-marino text-white">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <p className="flex items-center gap-2 text-xs tracking-[0.15em] text-white/80 uppercase">
              <span aria-hidden="true" className="h-2 w-2 bg-plata" />
              HoldingMax
            </p>
            <p className="font-serif text-xl font-semibold tracking-tight text-white">Dashboard semanal</p>
          </div>
          <Link
            href="/"
            className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-white ${FOCO}`}
          >
            ← Mis empresas
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
