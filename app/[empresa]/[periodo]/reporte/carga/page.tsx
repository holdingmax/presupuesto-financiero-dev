import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { resolverEmpresaPorSlug } from "@/lib/slug";
import { AccesoDenegadoError, PermisoDenegadoError, requireAccesoEmpresa, requireAdminOFinanzas } from "@/lib/auth";
import { centavosDeDecimalTexto } from "@/lib/conteoMovimientos";
import { nombreDePeriodo } from "@/lib/ejecucionSemanas";
import { esPeriodoHabilitado } from "@/lib/periodosHabilitados";
import { armarReporte, camposManuales, periodosHasta, type DatosMes } from "@/lib/reporte/motor";
import { plantillaDeEmpresa } from "@/lib/reporte/plantillas";
import { cargarDatosMeses } from "@/lib/reporte/cargarMeses";
import { semanasDelPeriodo } from "@/lib/reporte/valoresManuales";
import { formatearCentavos, motivoBloqueo, periodoActual, SUGERENCIA_ESPEJO } from "@/lib/reporte/bloqueo";
import CargaValoresManuales, { type CampoVista } from "./CargaValoresManuales";

type Props = { params: Promise<{ empresa: string; periodo: string }> };

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

function Aviso({ texto }: { texto: string }) {
  return <p className="mx-auto max-w-3xl px-6 py-10 text-sm text-ink-secondary">{texto}</p>;
}

// Pantalla de carga de los valores que Macchi tipea a mano (plan 2b §7.4): solo ADMIN y
// FINANZAS. Muestra todos los campos manuales de la plantilla del mes de la URL, agrupados por
// bloque, con el valor actual, quién lo cargó y los bloqueos de la regla de "lo cerrado no se
// modifica para atrás".
export default async function CargaPage({ params }: Props) {
  const { empresa: slug, periodo } = await params;
  if (!FORMATO_PERIODO.test(periodo)) return null;
  const empresa = await resolverEmpresaPorSlug(slug);
  if (!empresa) return null;
  try {
    await requireAdminOFinanzas();
    await requireAccesoEmpresa(empresa.id);
  } catch (error) {
    if (error instanceof AccesoDenegadoError || error instanceof PermisoDenegadoError) {
      return <Aviso texto="No tenés permisos para cargar valores del reporte." />;
    }
    throw error;
  }
  // Fuera de PERIODOS_HABILITADOS no se abre ni siquiera para ADMIN y FINANZAS.
  if (!esPeriodoHabilitado(periodo)) return <Aviso texto="El reporte de este mes todavía no está habilitado." />;
  const plantilla = plantillaDeEmpresa(slug);
  if (!plantilla) return <Aviso texto="Esta empresa no tiene reporte por plantilla." />;

  const periodos = periodosHasta(periodo, 2);
  const [meses, valores, presupuesto, semanas] = await Promise.all([
    cargarDatosMeses(empresa.id, empresa.unidadesNegocio, plantilla, periodos),
    prisma.valorManualReporte.findMany({
      where: { empresaId: empresa.id, periodo },
      include: { cargadoPor: { select: { nombre: true } } },
    }),
    prisma.presupuestoMensual.findUnique({
      where: { empresaId_periodo: { empresaId: empresa.id, periodo } },
      select: { estado: true },
    }),
    semanasDelPeriodo([periodo]),
  ]);

  // Capital: resultado de la REGLA de la plantilla (sin el valor manual que lo reemplaza).
  const clavesCapital = new Set(plantilla.filas.filter((f) => f.tipo === "capital").map((f) => f.clave));
  const sinCapitalManual: DatosMes[] = meses.map((m, i) =>
    i === 1 && m.manuales
      ? {
          ...m,
          manuales: {
            ...m.manuales,
            presupuesto: new Map([...m.manuales.presupuesto].filter(([k]) => !clavesCapital.has(k))),
          },
        }
      : m
  );
  const reglaCapital = armarReporte(plantilla, sinCapitalManual, 1);
  const reporte = armarReporte(plantilla, meses, 1);

  const porClave = new Map(valores.map((v) => [`${v.filaClave}|${v.columna}`, v]));
  const filaPorClave = new Map(plantilla.filas.map((f) => [f.clave, f]));
  const campos: CampoVista[] = camposManuales(plantilla).map((c) => {
    const v = porClave.get(`${c.clave}|${c.columna}`);
    const fila = filaPorClave.get(c.clave)!;
    const regla = reglaCapital.filas.find((f) => f.fila.clave === c.clave)?.celdas[0].presupuestado ?? null;
    return {
      clave: c.clave,
      columna: c.columna,
      texto: c.texto.trim(),
      bloque: c.bloque,
      valor: v ? formatearCentavos(centavosDeDecimalTexto(v.importe.toFixed(2))) : "",
      nota: v?.nota ?? null,
      cargadoPor: v
        ? `${v.cargadoPor.nombre} · ${v.updatedAt.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}`
        : null,
      bloqueo: motivoBloqueo({
        periodo,
        actual: periodoActual(),
        columna: c.columna,
        bloque: c.bloque,
        presupuestoValidado: presupuesto?.estado === "VALIDADO",
        semanas: semanas.get(periodo)!,
      }),
      componente:
        fila.tipo === "linea" && fila.bloque === "DISPONIBILIDADES"
          ? { arrastre: fila.arrastre ?? "cuadre", enTotal: !fila.excluidaDelTotal }
          : null,
      sugerenciaDesde: SUGERENCIA_ESPEJO[c.clave] ?? null,
      reglaCapital: fila.tipo === "capital" ? (regla === null ? null : formatearCentavos(regla)) : undefined,
    };
  });

  const arrastre = reporte.arrastre[0];
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <p className="text-xs tracking-[0.15em] text-ink-secondary uppercase">
        {empresa.nombre} · {nombreDePeriodo(periodo)}
      </p>
      <h1 className="mt-1 text-3xl font-serif font-semibold tracking-tight">Valores del reporte</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Los números que en la planilla se tipean a mano. Se aceptan cuentas como 321.235,44+17.755,22. Un campo vacío
        borra el valor. Lo que ya cerró no se modifica ni se borra para atrás (la corrección se carga en el período siguiente), pero un campo vacío de un período cerrado se puede cargar una vez.
      </p>
      <Link href={`/${slug}/${periodo}/reporte`} className="mt-3 inline-block text-sm underline">
        Volver al reporte
      </Link>
      <CargaValoresManuales
        empresaSlug={slug}
        periodo={periodo}
        campos={campos}
        cierreRealAnterior={arrastre?.cierreRealAnterior ?? null}
      />
    </div>
  );
}
