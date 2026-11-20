import { totalesDeEgresosOperativos, type FilaDeAvance } from "@/lib/dashboard/avance";
import type { Alcance, EmpresaDelAlcance } from "@/lib/dashboard/alcance";
import { armarEncabezadoDeAvance } from "@/lib/dashboard/encabezado";
import type { CargasDelDashboard } from "@/lib/dashboard/iniciarCargas";
import { Listo } from "./Progreso";
import {
  CalidadVista,
  ControlDeDepositosVista,
  ErrorDeSeccionVista,
  FilaConErrorVista,
  FilaDeAvanceVista,
  PieDeTotalesVista,
  PieNoDisponibleVista,
  SinAsignarVista,
  TituloDeAvance,
} from "./vistas";

// Componentes ASÍNCRONOS del dashboard (servidor): cada uno espera la promesa que arrancó iniciarCargasDelDashboard y pinta su
// vista. Se montan dentro de un <Suspense>, así cada empresa aparece cuando está lista. No calculan nada.

export async function EncabezadoCargado({ cargas }: { cargas: CargasDelDashboard }) {
  const contexto = await cargas.contexto;
  if (contexto.estado === "error") return <h1 className="font-serif text-3xl font-semibold tracking-tight">Avance del mes</h1>;
  return <TituloDeAvance encabezado={armarEncabezadoDeAvance(contexto.valor.periodo, contexto.valor.semanas)} />;
}

export async function FilaDeEmpresaCargada({ empresa, cargas }: { empresa: EmpresaDelAlcance; cargas: CargasDelDashboard }) {
  const promesa = cargas.empresas.get(empresa.id);
  const resultado = promesa ? await promesa : ({ estado: "error" } as const);
  return (
    <>
      {resultado.estado === "ok" ? (
        <FilaDeAvanceVista fila={resultado.valor} hrefReporte={`/${empresa.slug}/${cargas.periodo}/reporte`} />
      ) : (
        <FilaConErrorVista nombre={empresa.nombre} />
      )}
      <Listo id={empresa.id} />
    </>
  );
}

// Espera a TODAS las empresas del alcance; si alguna falló, no muestra un total parcial.
export async function PieCargado({ alcance, cargas }: { alcance: Alcance; cargas: CargasDelDashboard }) {
  const resultados = await Promise.all(alcance.empresas.map((e) => cargas.empresas.get(e.id)));
  const filas: FilaDeAvance[] = [];
  for (const r of resultados) {
    if (!r || r.estado !== "ok") return <PieNoDisponibleVista />;
    filas.push(r.valor);
  }
  const contexto = await cargas.contexto;
  const ritmo = contexto.estado === "ok" ? armarEncabezadoDeAvance(contexto.valor.periodo, contexto.valor.semanas).ritmo : null;
  return <PieDeTotalesVista totales={totalesDeEgresosOperativos(filas, alcance)} ritmo={ritmo} />;
}

export async function CalidadCargada({ cargas }: { cargas: CargasDelDashboard }) {
  const r = await cargas.calidad;
  if (r.estado === "error") return <ErrorDeSeccionVista texto="No se pudo cargar la calidad del dato. Probá recargar la página." />;
  return <CalidadVista calidad={r.valor} />;
}

// «Sin asignar»: solo ADMIN. Se monta únicamente dentro de la zona de administración (que page.tsx genera solo si cargas.control
// existe); además, para quien no es ADMIN cargarCalidadDelMes devuelve sinAsignar = null y esta vista no pinta nada.
export async function SinAsignarCargado({ cargas }: { cargas: CargasDelDashboard }) {
  const r = await cargas.calidad;
  if (r.estado === "error" || r.valor.sinAsignar === null) return null;
  return <SinAsignarVista sinAsignar={r.valor.sinAsignar} />;
}

// Solo se monta si el usuario puede verlo (cargas.control no es null).
export async function ControlCargado({ cargas }: { cargas: CargasDelDashboard }) {
  if (!cargas.control) return null;
  const r = await cargas.control;
  if (r.estado === "error") return <ErrorDeSeccionVista texto="No se pudo cargar el control de depósitos de cheques." />;
  return <ControlDeDepositosVista control={r.valor} />;
}
