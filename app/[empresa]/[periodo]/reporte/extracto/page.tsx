import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { resolverEmpresaPorSlug } from "@/lib/slug";
import { AccesoDenegadoError, PermisoDenegadoError } from "@/lib/auth";
import { requireCargaRealEmpresa } from "@/lib/cargaRealEmpresa";
import { nombreDePeriodo } from "@/lib/ejecucionSemanas";
import { errorPeriodoNoHabilitado } from "@/lib/periodosHabilitados";
import { puedeVerSubidaExtractoEmpresa, semanasParaCargar } from "@/lib/extractos/pantallaExtractoEmpresa";
import { MAX_BYTES_HAVANNA_PERU, MAX_FILAS_HAVANNA_PERU } from "@/lib/extractos/limites";
import { aceptaDeEmpresa, textoSubidaExtractoEmpresa } from "@/lib/extractos/cargaEmpresa";
import SubidaExtractoEmpresa from "./SubidaExtractoEmpresa";

type Props = { params: Promise<{ empresa: string; periodo: string }> };

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

function Aviso({ texto }: { texto: string }) {
  return <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-ink-secondary">{texto}</p>;
}

// Subida del extracto propio de una empresa (hoy Havanna Perú y Bradenton). Vive en la vista de la empresa, no en la
// Ejecución global. Solo se abre para una empresa de EMPRESAS_CON_EXTRACTO_POR_EMPRESA y para quien puede cargar el
// Real de ESA empresa; lo demás lo vuelve a validar el servidor (subirExtractoEmpresa).
export default async function ExtractoEmpresaPage({ params }: Props) {
  const { empresa: slug, periodo } = await params;
  if (!FORMATO_PERIODO.test(periodo)) return null;
  const empresa = await resolverEmpresaPorSlug(slug);
  if (!empresa) return null;

  let permitido = false;
  try {
    await requireCargaRealEmpresa(empresa.id);
    permitido = true;
  } catch (error) {
    if (!(error instanceof AccesoDenegadoError || error instanceof PermisoDenegadoError)) throw error;
  }
  if (!permitido) return <Aviso texto="No tenés permisos para cargar el extracto de esta empresa." />;
  if (!puedeVerSubidaExtractoEmpresa(slug, permitido)) return <Aviso texto="Esta empresa no carga su Real por extracto." />;
  const noHabilitado = errorPeriodoNoHabilitado(periodo);
  if (noHabilitado) return <Aviso texto={noHabilitado} />;

  const semanas = await prisma.ejecucionSemanal.findMany({
    where: { periodo },
    select: { numeroSemana: true, estado: true },
    orderBy: { numeroSemana: "asc" },
  });
  const { abiertas, porDefecto } = semanasParaCargar(semanas);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <p className="text-xs tracking-[0.15em] text-ink-secondary uppercase">
        {empresa.nombre} · {nombreDePeriodo(periodo)}
      </p>
      <h1 className="mt-1 text-3xl font-serif font-semibold tracking-tight">Subir extracto</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        {textoSubidaExtractoEmpresa(slug, MAX_BYTES_HAVANNA_PERU, MAX_FILAS_HAVANNA_PERU)}
      </p>
      <Link href={`/${slug}/${periodo}/reporte`} className="mt-3 inline-block text-sm underline">
        Volver al reporte
      </Link>
      <SubidaExtractoEmpresa
        empresaId={empresa.id}
        periodo={periodo}
        semanasAbiertas={abiertas}
        semanaPorDefecto={porDefecto}
        acepta={aceptaDeEmpresa(slug)}
      />
    </div>
  );
}
