import { prisma } from "@/lib/prisma";
import { resolverEmpresaPorSlug } from "@/lib/slug";
import { requireAccesoEmpresa, puedeOperarEjecucionGlobal, veTodoEjecucion } from "@/lib/auth";
import { obtenerEjecucionPorSemana, obtenerUltimaEjecucion } from "@/lib/ejecucion";
import { FILAS_POR_PAGINA, filtroDeUnidades, mapearMovimiento, sumarImporteDeUnidades } from "@/lib/ejecucionVista";
import { opcionesDeClasificacion, whereMovimientosDeEmpresa } from "@/lib/filtroClasificacionEmpresa";
import { obtenerValoresOcultos } from "@/lib/ocultasGerenteDb";
import { slugDeEmpresa } from "@/lib/slug";
import { avisoSemanasAbiertas, sumarTotalesSemanalesPorMoneda, whereMovimientosDelMes } from "@/lib/ejecucionMes";
import { totalEnPesos } from "@/lib/moneda";
import { clasificacionesOcultasParaUsuario, valoresGuardadosOcultos } from "@/lib/clasificacionesOcultas";
import { elegirMesDeEntrada, resumirMeses } from "@/lib/mesesEjecucion";
import { puedeClasificarEnEmpresa } from "@/lib/clasificarPorEmpresa";
import { clasificacionesParaEditar, contarSugerenciasDeEmpresa } from "@/lib/clasificarPorEmpresaDb";

// Pestaña "Ejecución financiera" de cada empresa (docs/ejecucion_global_plan.md §3.4 y §6): SOLO
// LECTURA y filtrada. Ejecución se opera en el módulo global (/ejecucion); acá se ve, de cada
// semana del período, únicamente lo que es de esta empresa: los movimientos cuya unidad (o porción
// de prorrateo) pertenece a ella, vengan de la cuenta que vengan. Sin saldo (el campo no existe en
// lo que se devuelve), sin movimientos de otras unidades. Todo se filtra en la consulta, no en
// pantalla — también para ADMIN y FINANZAS, que ven todo en el módulo global.
//
// No es un archivo "use server": solo lo importan las páginas (servidor), no se expone como
// endpoint. Nunca crea nada.

const FORMATO_PERIODO = /^\d{4}-\d{2}$/;

async function resolverEmpresaParaLeer(empresaSlug: string, periodo: string) {
  const empresa = await resolverEmpresaPorSlug(empresaSlug);
  if (!empresa) {
    throw new Error(`No existe una empresa para "${empresaSlug}".`);
  }
  if (!FORMATO_PERIODO.test(periodo)) {
    throw new Error(`"${periodo}" no es un período válido (AAAA-MM).`);
  }
  const usuario = await requireAccesoEmpresa(empresa.id);
  return { empresa, usuario };
}

// Última semana del período (la abierta, si hay), sin crear ninguna. null si el período todavía no
// tiene semanas.
export async function obtenerNumeroSemanaParaVer(empresaSlug: string, periodo: string) {
  await resolverEmpresaParaLeer(empresaSlug, periodo);
  const ultima = await obtenerUltimaEjecucion(periodo);
  return ultima?.numeroSemana ?? null;
}

// Meses con movimientos de ESTA empresa (sin ignorados, sin las clasificaciones que este usuario no ve), del más
// nuevo al más viejo, cada uno con la semana a la que lleva (la abierta, o la última). SOLO LECTURA: lee las
// semanas que ya existen y cuenta movimientos en dos consultas; nunca crea una semana, así que el selector solo
// puede llevar a semanas que ya están.
async function mesesDeLaEmpresa(
  empresa: { nombre: string; unidadesNegocio: string[] },
  usuario: { rol: string; operaEjecucion: boolean }
) {
  const unidades = empresa.unidadesNegocio;
  if (unidades.length === 0) return [];
  const [semanas, filas] = await Promise.all([
    prisma.ejecucionSemanal.findMany({ select: { id: true, periodo: true, numeroSemana: true, estado: true } }),
    prisma.movimientoBancario.groupBy({
      by: ["ejecucionId", "clasificacion"],
      where: { ...filtroDeUnidades(unidades), ignorado: false },
      _count: { _all: true },
    }),
  ]);
  const ocultas = valoresGuardadosOcultos(
    filas.map((f) => f.clasificacion),
    clasificacionesOcultasParaUsuario(slugDeEmpresa(empresa.nombre), usuario)
  );
  return resumirMeses(
    semanas,
    filas.map((f) => ({ ejecucionId: f.ejecucionId, clasificacion: f.clasificacion, cantidad: f._count._all })),
    ocultas
  );
}

// Para el índice de la pestaña: si el mes de la URL no tiene movimientos de la empresa, a qué mes y semana
// ir (el más reciente con movimientos sin clasificar o, si no hay, el más reciente con movimientos). null =
// quedarse en el mes de la URL.
export async function obtenerMesDeEntrada(empresaSlug: string, periodo: string) {
  const { empresa, usuario } = await resolverEmpresaParaLeer(empresaSlug, periodo);
  return elegirMesDeEntrada(await mesesDeLaEmpresa(empresa, usuario), periodo);
}

export async function obtenerDatosSemanaDeEmpresa(
  empresaSlug: string,
  periodo: string,
  numeroSemana: number,
  pagina: number = 1,
  clasificacion?: string
) {
  const { empresa, usuario } = await resolverEmpresaParaLeer(empresaSlug, periodo);
  const ejecucion = await obtenerEjecucionPorSemana(periodo, numeroSemana);
  if (!ejecucion) return null;

  const unidades = empresa.unidadesNegocio;
  // Clasificaciones que ESTE usuario no ve (config.ts, solo gerentes de algunas empresas): se excluyen en
  // el servidor de la lista, la cantidad, el Total y el desplegable. Lo demás del sistema no pasa por acá.
  const ocultas = await obtenerValoresOcultos(ejecucion.id, slugDeEmpresa(empresa.nombre), usuario);
  // Semana + unidades de la empresa (AND) + clasificación elegida, si hay (menos las ocultas).
  const where = whereMovimientosDeEmpresa(ejecucion.id, unidades, clasificacion, ocultas);

  const [totalMovimientos, totalesPorMoneda, semanas, clasificacionesDeLaEmpresa, cantidadOcultos, meses] = await Promise.all([
    prisma.movimientoBancario.count({ where }),
    sumarImporteDeUnidades(ejecucion.id, unidades, clasificacion, ocultas),
    prisma.ejecucionSemanal.findMany({
      where: { periodo },
      orderBy: { numeroSemana: "asc" },
      select: { numeroSemana: true, estado: true },
    }),
    // Opciones del desplegable: solo las clasificaciones de ESTA empresa en ESTA semana (sin el
    // filtro elegido, para poder cambiar de opción). Nunca la lista global de la base.
    unidades.length === 0
      ? Promise.resolve([])
      : prisma.movimientoBancario.groupBy({
          by: ["clasificacion"],
          where: whereMovimientosDeEmpresa(ejecucion.id, unidades, undefined, ocultas),
        }),
    // Solo para mostrar la nota «No incluye movimientos reservados» (nunca viaja el número ni nada de ellos).
    ocultas.length === 0 || unidades.length === 0
      ? Promise.resolve(0)
      : prisma.movimientoBancario.count({
          where: { ejecucionId: ejecucion.id, ...filtroDeUnidades(unidades), clasificacion: { in: ocultas } },
        }),
    mesesDeLaEmpresa(empresa, usuario),
  ]);
  const totalPaginas = Math.max(1, Math.ceil(totalMovimientos / FILAS_POR_PAGINA));
  const paginaEfectiva = Math.min(Math.max(1, pagina), totalPaginas);

  // Clasificar desde acá: solo un gerente con la casilla de ESTA empresa y solo con la semana ABIERTA. Para cualquier otro
  // usuario (ADMIN, FINANZAS, quien opera, gerente sin la casilla) `edicion` es null y la pantalla queda de solo lectura,
  // exactamente como siempre. Lo que decide el servidor al escribir (lib/clasificarPorEmpresaDb.ts) no depende de esto.
  let edicion: {
    unidades: string[];
    clasificaciones: string[];
    sugeridasClasificacion: number;
    sugeridasUnidad: number;
  } | null = null;
  if (ejecucion.estado === "ABIERTA" && unidades.length > 0) {
    const acceso = await prisma.usuarioEmpresa.findUnique({
      where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: empresa.id } },
      select: { puedeOperarEjecucion: true },
    });
    if (puedeClasificarEnEmpresa(usuario, acceso)) {
      const [clasificaciones, sugeridas] = await Promise.all([
        clasificacionesParaEditar(unidades, clasificacionesOcultasParaUsuario(slugDeEmpresa(empresa.nombre), usuario), slugDeEmpresa(empresa.nombre)),
        contarSugerenciasDeEmpresa(ejecucion.id, unidades, ocultas),
      ]);
      edicion = {
        unidades,
        clasificaciones,
        sugeridasClasificacion: sugeridas.clasificacion,
        sugeridasUnidad: sugeridas.unidad,
      };
    }
  }

  // Mismo desempate estable por id que el módulo global.
  const movimientos = await prisma.movimientoBancario.findMany({
    where,
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    skip: (paginaEfectiva - 1) * FILAS_POR_PAGINA,
    take: FILAS_POR_PAGINA,
    include: { desglose: { orderBy: { createdAt: "asc" } } },
  });

  return {
    empresaId: empresa.id,
    edicion,
    empresaNombre: empresa.nombre,
    numeroSemana: ejecucion.numeroSemana,
    estado: ejecucion.estado,
    cierre: ejecucion.fechaCierre
      ? {
          fecha: ejecucion.fechaCierre.toISOString(),
          por: ejecucion.cerradoPorId
            ? ((await prisma.usuario.findUnique({ where: { id: ejecucion.cerradoPorId }, select: { nombre: true } }))?.nombre ?? null)
            : null,
        }
      : null,
    // Para el enlace "Operar en Ejecución global" (quien opera, ADMIN o FINANZAS).
    puedeIrAlModuloGlobal: puedeOperarEjecucionGlobal(usuario) || veTodoEjecucion(usuario),
    semanas,
    meses,
    sinUnidades: unidades.length === 0,
    movimientos: movimientos.map((m) => mapearMovimiento(m, unidades)),
    totalMovimientos,
    // Total en pesos (como siempre) y el Total por moneda que muestra la pantalla.
    totalImporte: totalEnPesos(totalesPorMoneda),
    totalesPorMoneda,
    hayReservados: cantidadOcultos > 0,
    pagina: paginaEfectiva,
    totalPaginas,
    clasificacion: clasificacion ?? null,
    clasificacionesDisponibles: opcionesDeClasificacion(clasificacionesDeLaEmpresa.map((c) => c.clasificacion)),
  };
}

// Solo para el enlace de la pestaña, cuando el período todavía no tiene ninguna semana.
export async function puedeIrAlModuloGlobal(empresaSlug: string, periodo: string) {
  const { usuario } = await resolverEmpresaParaLeer(empresaSlug, periodo);
  return veTodoEjecucion(usuario);
}

// Vista "Todo el mes": los movimientos de TODAS las semanas del período, con las mismas reglas que
// obtenerDatosSemanaDeEmpresa (permiso por empresa, unidades de la empresa, sin saldo, clasificaciones
// ocultas, filtro de Clasificación, paginación), sin los movimientos ignorados. El Total es la suma de
// los totales de cada semana (la misma consulta de siempre, una vez por semana). null si el período no
// tiene semanas.
export async function obtenerDatosMesDeEmpresa(
  empresaSlug: string,
  periodo: string,
  pagina: number = 1,
  clasificacion?: string
) {
  const { empresa, usuario } = await resolverEmpresaParaLeer(empresaSlug, periodo);
  const semanas = await prisma.ejecucionSemanal.findMany({
    where: { periodo },
    orderBy: { numeroSemana: "asc" },
    select: { id: true, numeroSemana: true, estado: true },
  });
  if (semanas.length === 0) return null;

  const unidades = empresa.unidadesNegocio;
  const slug = slugDeEmpresa(empresa.nombre);
  // Las ocultas se calculan por semana (como siempre) y se juntan: solo pueden ser variantes guardadas de
  // las clasificaciones que ESTE usuario no ve, así que aplicarlas a todo el mes no oculta nada de más.
  const ocultasPorSemana = await Promise.all(semanas.map((s) => obtenerValoresOcultos(s.id, slug, usuario)));
  const ocultas = Array.from(new Set(ocultasPorSemana.flat()));
  const ids = semanas.map((s) => s.id);
  const where = whereMovimientosDelMes(ids, unidades, clasificacion, ocultas);

  const [totalMovimientos, totalesSemanales, clasificacionesDeLaEmpresa, cantidadOcultos, meses] = await Promise.all([
    prisma.movimientoBancario.count({ where }),
    Promise.all(semanas.map((s, i) => sumarImporteDeUnidades(s.id, unidades, clasificacion, ocultasPorSemana[i]))),
    unidades.length === 0
      ? Promise.resolve([])
      : prisma.movimientoBancario.groupBy({
          by: ["clasificacion"],
          where: whereMovimientosDelMes(ids, unidades, undefined, ocultas),
        }),
    // Solo para la nota «No incluye movimientos reservados» (igual que por semana).
    ocultas.length === 0 || unidades.length === 0
      ? Promise.resolve(0)
      : prisma.movimientoBancario.count({
          where: { ejecucionId: { in: ids }, ...filtroDeUnidades(unidades), ignorado: false, clasificacion: { in: ocultas } },
        }),
    mesesDeLaEmpresa(empresa, usuario),
  ]);
  const totalPaginas = Math.max(1, Math.ceil(totalMovimientos / FILAS_POR_PAGINA));
  const paginaEfectiva = Math.min(Math.max(1, pagina), totalPaginas);
  const totalesDelMes = sumarTotalesSemanalesPorMoneda(totalesSemanales);

  const movimientos = await prisma.movimientoBancario.findMany({
    where,
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    skip: (paginaEfectiva - 1) * FILAS_POR_PAGINA,
    take: FILAS_POR_PAGINA,
    include: { desglose: { orderBy: { createdAt: "asc" } } },
  });
  const semanaDe = new Map(semanas.map((s) => [s.id, s.numeroSemana]));

  return {
    empresaNombre: empresa.nombre,
    puedeIrAlModuloGlobal: puedeOperarEjecucionGlobal(usuario) || veTodoEjecucion(usuario),
    semanas: semanas.map((s) => ({ numeroSemana: s.numeroSemana, estado: s.estado })),
    meses,
    todasCerradas: semanas.every((s) => s.estado === "CERRADA"),
    avisoAbiertas: avisoSemanasAbiertas(semanas),
    sinUnidades: unidades.length === 0,
    movimientos: movimientos.map((m) => ({ ...mapearMovimiento(m, unidades), semana: semanaDe.get(m.ejecucionId) })),
    totalMovimientos,
    // Total en pesos (como siempre) y el Total por moneda que muestra la pantalla.
    totalImporte: totalEnPesos(totalesDelMes),
    totalesPorMoneda: totalesDelMes,
    hayReservados: cantidadOcultos > 0,
    pagina: paginaEfectiva,
    totalPaginas,
    clasificacion: clasificacion ?? null,
    clasificacionesDisponibles: opcionesDeClasificacion(clasificacionesDeLaEmpresa.map((c) => c.clasificacion)),
  };
}
