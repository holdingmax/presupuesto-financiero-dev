"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";
import { quitarDiacriticos } from "@/lib/slug";
import { calcularTotalesPresupuesto } from "@/lib/presupuestoTotales";
import { puedeRevisarPresupuesto, esAdminOFinanzas } from "@/lib/auth";
import {
  avisoPeriodoSoloLectura,
  mensajePeriodoSoloLectura,
  puedeEditarPeriodoComoGerente,
} from "@/lib/periodosHabilitados";
import {
  resolverEmpresaYPresupuesto,
  autorizarEdicionLinea,
  marcarComoModificadoSiEnRevision,
} from "@/lib/presupuestoAcceso";
import { normalizarClasificacion, esElegibleParaDesglose } from "@/lib/clasificaciones";
import { parsearImporteArgentino } from "@/lib/numero";
import { mensajeDeImporte } from "@/lib/importes";
import { extraerImporteCelda } from "@/lib/importeCelda";
import { validarMensajePedido, puedePedirCambios } from "@/lib/pedidoCambiosPresupuesto";
import {
  ejecutarConfirmacion,
  puedeConfirmarComoGerente,
  puedeConfirmarEnNombreDelGerente,
  type DbConfirmacion,
} from "@/lib/confirmacionFinal";
import {
  CLASIFICACIONES_PRESUPUESTO_TODAS,
  traducirClasificacionPresupuesto,
} from "./clasificacionesPresupuesto";

// Escritura de la confirmación final (la comparten confirmarVersionFinal y confirmarEnNombreDelGerente).
const dbConfirmacion: DbConfirmacion = {
  updateMany: (args) => prisma.presupuestoMensual.updateMany(args),
};

// Lo que cambia acá se ve en Presupuesto y también en el Reporte (estado, botones del flujo y
// el Presupuestado sumado de las líneas): hay que refrescar las dos pantallas.
function revalidarPresupuesto(empresaSlug: string, periodo: string) {
  revalidatePath(`/${empresaSlug}/${periodo}/presupuesto`);
  revalidatePath(`/${empresaSlug}/${periodo}/reporte`);
}

// Lista cerrada (decisión 2026-10-07, pedido de Kike: los gerentes no cargan
// categorías propias). Una línea NUEVA solo puede usar un valor de la lista; una
// línea vieja con una categoría fuera de lista puede seguir editándose con esa
// misma categoría (ver editarLinea) — no se rompe ni se cambia en silencio.
const VALORES_CLASIFICACION_PRESUPUESTO = new Set(
  CLASIFICACIONES_PRESUPUESTO_TODAS.map((o) => o.valorPersistido)
);
const ERROR_CLASIFICACION_FUERA_DE_LISTA = "Elegí una clasificación de la lista.";

// Mismo mapeo por nombre de columna que ya usa subirExtracto en
// ejecucion/actions.ts, adaptado a las 4 columnas de LineaPresupuesto.
const COLUMNAS_PRESUPUESTO: Record<string, string> = {
  "CONCEPTO": "concepto",
  "DETALLE": "detalle",
  "IMPORTE": "importe",
  "CLASIFICACION": "clasificacion",
};
const CAMPOS_REQUERIDOS = ["concepto", "detalle", "importe", "clasificacion"] as const;
const FILA_HEADERS = 1;

// Tolerante a tildes/mayúsculas/espacios: "Clasificación", "CLASIFICACION" y
// "clasificación" tienen que matchear la misma clave en COLUMNAS_PRESUPUESTO.
// El colapso de espacios múltiples cubre headers de una sola palabra igual
// (no hace nada distinto), pero importa para claves de varias palabras.
function normalizarEncabezado(texto: string) {
  return quitarDiacriticos(texto).trim().toUpperCase().replace(/\s+/g, " ");
}

// Compartida entre agregarLinea y editarLinea: mismas 4 validaciones de
// campo (Reglas de Vigo: importe no puede ser 0 ni vacío; clasificacion no
// puede estar vacía).
function validarCamposLinea(datos: {
  concepto: string;
  detalle: string;
  importe: string;
  clasificacion: string;
}) {
  const concepto = datos.concepto.trim();
  const detalle = datos.detalle.trim();
  const clasificacion = normalizarClasificacion(datos.clasificacion.trim());
  const importe = parsearImporteArgentino(datos.importe);

  const errores: Record<string, string> = {};
  if (!concepto) errores.concepto = "Completá el concepto.";
  if (!detalle) errores.detalle = "Completá el detalle.";
  if (!datos.importe.trim() || importe === 0) {
    errores.importe = "El importe no puede estar vacío ni ser 0.";
  } else if (Number.isNaN(importe)) {
    errores.importe = mensajeDeImporte(datos.importe) ?? "El importe no se entiende.";
  }
  if (!clasificacion) errores.clasificacion = "Elegí una clasificación.";
  // "Otros" sin explicación no le sirve a nadie (decisión 2026-10-07): el detalle
  // ya es obligatorio para todas, pero para "Otros" el mensaje dice por qué.
  if (!detalle && clasificacion === "OTROS") {
    errores.detalle = "Para «Otros» el detalle es obligatorio: explicá qué es este gasto.";
  }

  return { concepto, detalle, clasificacion, importe, errores };
}

export async function obtenerDatos(empresaSlug: string, periodo: string) {
  const { empresa, presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);
  const [lineas, esRevisor, ultimoPedido] = await Promise.all([
    prisma.lineaPresupuesto.findMany({
      where: { presupuestoId: presupuesto.id },
      orderBy: { createdAt: "asc" },
      include: { desglose: { orderBy: { createdAt: "asc" } } },
    }),
    puedeRevisarPresupuesto(usuario, empresa.id),
    // El vigente es el más reciente (el historial queda en la tabla). La pantalla
    // lo muestra solo mientras el presupuesto está ABIERTO.
    prisma.pedidoCambiosPresupuesto.findFirst({
      where: { presupuestoId: presupuesto.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    empresaNombre: empresa.nombre,
    periodo: presupuesto.periodo,
    estado: presupuesto.estado,
    fueModificadoPorRevisor: presupuesto.fueModificadoPorRevisor,
    revisionCompletada: presupuesto.revisionCompletada,
    // "Validado por X el dd/mm". por = null en presupuestos validados antes de
    // que se guardara validadoPorId. enNombreDeGerente/motivo: constancia de la
    // confirmación "en nombre del gerente" (false/null en lo validado antes de esa regla).
    validacion: presupuesto.fechaValidacion
      ? {
          fecha: presupuesto.fechaValidacion.toISOString(),
          por: presupuesto.validadoPorId
            ? ((await prisma.usuario.findUnique({ where: { id: presupuesto.validadoPorId }, select: { nombre: true } }))?.nombre ?? null)
            : null,
          enNombreDeGerente: presupuesto.confirmadoEnNombreDeGerente,
          motivo: presupuesto.motivoConfirmacionEnNombre,
        }
      : null,
    // Qué botón de confirmación final le corresponde a este usuario (por rol; el servidor lo vuelve a exigir).
    puedeConfirmarFinal: puedeConfirmarComoGerente(usuario.rol),
    puedeConfirmarEnNombre: puedeConfirmarEnNombreDelGerente(usuario.rol, esRevisor),
    // "Pedido por X el dd/mm". por = null si el usuario ya no existe.
    pedidoCambios: ultimoPedido
      ? {
          mensaje: ultimoPedido.mensaje,
          fecha: ultimoPedido.createdAt.toISOString(),
          por:
            (await prisma.usuario.findUnique({ where: { id: ultimoPedido.solicitadoPorId }, select: { nombre: true } }))
              ?.nombre ?? null,
        }
      : null,
    esRevisor,
    // null = editable; un texto = el gerente ve este mes en solo lectura (lib/periodosHabilitados.ts).
    avisoSoloLectura: avisoPeriodoSoloLectura(presupuesto.periodo, esAdminOFinanzas(usuario)),
    // Suma simple de las líneas guardadas, en el servidor: se recalcula en cada refresh.
    totales: calcularTotalesPresupuesto(lineas.map((l) => ({ clasificacion: l.clasificacion, importe: Number(l.importe) }))),
    lineas: lineas.map((l) => ({
      id: l.id,
      concepto: l.concepto,
      detalle: l.detalle,
      importe: Number(l.importe),
      clasificacion: l.clasificacion,
      desglose: l.desglose.map((d) => ({
        id: d.id,
        detalle: d.detalle,
        importe: Number(d.importe),
      })),
    })),
  };
}

type ResultadoAgregar =
  | { ok: true }
  | { ok: false; errores: Record<string, string> };

export async function agregarLinea(
  empresaSlug: string,
  periodo: string,
  datos: { concepto: string; detalle: string; importe: string; clasificacion: string }
): Promise<ResultadoAgregar> {
  const { concepto, detalle, clasificacion, importe, errores } = validarCamposLinea(datos);
  if (clasificacion && !VALORES_CLASIFICACION_PRESUPUESTO.has(clasificacion)) {
    errores.clasificacion = ERROR_CLASIFICACION_FUERA_DE_LISTA;
  }
  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const { empresa, presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);
  const autorizacion = await autorizarEdicionLinea(usuario, empresa.id, presupuesto, empresaSlug);
  if (!autorizacion.ok) {
    return { ok: false, errores: { general: autorizacion.error } };
  }

  await prisma.lineaPresupuesto.create({
    data: { presupuestoId: presupuesto.id, concepto, detalle, importe, clasificacion },
  });
  await marcarComoModificadoSiEnRevision(presupuesto);

  revalidarPresupuesto(empresaSlug, periodo);
  return { ok: true };
}

// Nueva (antes solo existían agregarLinea/eliminarLinea): permite al revisor
// ajustar una línea ya cargada sin perder su id/createdAt ni, sobre todo, su
// desglose — borrar y recargar la línea (única alternativa hasta ahora)
// perdería el desglose por el onDelete: Cascade de LineaPresupuestoDesglose.
// Si la línea tiene desglose cargado, se rechaza (no se auto-borra el
// desglose) cuando: (a) el importe nuevo no coincide con la suma del
// desglose existente, o (b) la clasificación nueva ya no admite desglose —
// en los dos casos, quien edita tiene que resolver el desglose primero
// (eliminarDesglose) antes de poder guardar ese cambio puntual.
export async function editarLinea(
  empresaSlug: string,
  periodo: string,
  id: string,
  datos: { concepto: string; detalle: string; importe: string; clasificacion: string }
): Promise<ResultadoAgregar> {
  const { concepto, detalle, clasificacion, importe, errores } = validarCamposLinea(datos);
  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const { empresa, presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);
  const autorizacion = await autorizarEdicionLinea(usuario, empresa.id, presupuesto, empresaSlug);
  if (!autorizacion.ok) {
    return { ok: false, errores: { general: autorizacion.error } };
  }

  const linea = await prisma.lineaPresupuesto.findUnique({
    where: { id },
    include: { desglose: true },
  });
  if (!linea || linea.presupuestoId !== presupuesto.id) {
    return { ok: false, errores: { general: "No encontré esa línea." } };
  }
  // Lista cerrada, salvo que la línea ya tuviera esa categoría vieja.
  if (clasificacion !== linea.clasificacion && !VALORES_CLASIFICACION_PRESUPUESTO.has(clasificacion)) {
    return { ok: false, errores: { clasificacion: ERROR_CLASIFICACION_FUERA_DE_LISTA } };
  }

  if (linea.desglose.length > 0) {
    const sumaDesglose = linea.desglose.reduce((acc, d) => acc + Number(d.importe), 0);
    if (Math.abs(sumaDesglose - importe) >= 0.01) {
      return {
        ok: false,
        errores: {
          importe: `Esta línea tiene un desglose cargado por $${sumaDesglose.toLocaleString("es-AR")} — ajustá el desglose o dejá el importe en $${sumaDesglose.toLocaleString("es-AR")}.`,
        },
      };
    }
    if (!esElegibleParaDesglose(clasificacion)) {
      return {
        ok: false,
        errores: {
          clasificacion:
            "Esta línea tiene un desglose cargado — borralo antes de cambiar a una clasificación que no admite desglose.",
        },
      };
    }
  }

  await prisma.lineaPresupuesto.update({
    where: { id },
    data: { concepto, detalle, importe, clasificacion },
  });
  await marcarComoModificadoSiEnRevision(presupuesto);

  revalidarPresupuesto(empresaSlug, periodo);
  return { ok: true };
}

type ResultadoEliminar = { ok: true } | { ok: false; error: string };

export async function eliminarLinea(
  empresaSlug: string,
  periodo: string,
  id: string
): Promise<ResultadoEliminar> {
  const { empresa, presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);
  const autorizacion = await autorizarEdicionLinea(usuario, empresa.id, presupuesto, empresaSlug);
  if (!autorizacion.ok) {
    return { ok: false, error: autorizacion.error };
  }

  await prisma.lineaPresupuesto.delete({ where: { id } });
  await marcarComoModificadoSiEnRevision(presupuesto);

  revalidarPresupuesto(empresaSlug, periodo);
  return { ok: true };
}

type ResultadoDesglose =
  | { ok: true }
  | { ok: false; errores: Record<string, string> };

// Reemplaza el desglose completo de una línea (simplifica editar: el cliente
// siempre manda el estado final, no hace falta diffear sub-líneas existentes
// contra nuevas). La suma tiene que dar exactamente el importe de la línea
// padre — misma tolerancia (0.01) que ya usan los chequeos de suma-cero de
// Ejecución. Re-valida la elegibilidad server-side: no confiar en que el
// cliente no mande esto para una clasificación no habilitada.
export async function guardarDesglose(
  empresaSlug: string,
  periodo: string,
  lineaId: string,
  sublineas: { detalle: string; importe: string }[]
): Promise<ResultadoDesglose> {
  const { empresa, presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);

  const linea = await prisma.lineaPresupuesto.findUnique({ where: { id: lineaId } });
  if (!linea || linea.presupuestoId !== presupuesto.id) {
    return { ok: false, errores: { general: "No encontré esa línea." } };
  }
  const autorizacion = await autorizarEdicionLinea(usuario, empresa.id, presupuesto, empresaSlug);
  if (!autorizacion.ok) {
    return { ok: false, errores: { general: autorizacion.error } };
  }
  if (!esElegibleParaDesglose(linea.clasificacion)) {
    return {
      ok: false,
      errores: { general: "Esta clasificación no admite desglose." },
    };
  }

  const limpias = sublineas.map((s) => ({
    detalle: s.detalle.trim(),
    importe: parsearImporteArgentino(s.importe),
    importeCrudo: s.importe,
  }));

  const errores: Record<string, string> = {};
  if (limpias.length === 0) {
    errores.general = "Agregá al menos una sub-línea.";
  }
  limpias.forEach((s, i) => {
    if (!s.detalle) errores[`detalle_${i}`] = "Completá el detalle.";
    if (!s.importeCrudo.trim() || s.importe === 0) {
      errores[`importe_${i}`] = "El importe no puede estar vacío ni ser 0.";
    } else if (Number.isNaN(s.importe)) {
      errores[`importe_${i}`] = mensajeDeImporte(s.importeCrudo) ?? "El importe no se entiende.";
    }
  });

  if (Object.keys(errores).length === 0) {
    const suma = limpias.reduce((acc, s) => acc + s.importe, 0);
    const importeLinea = Number(linea.importe);
    if (Math.abs(suma - importeLinea) >= 0.01) {
      errores.general = `La suma del desglose ($${suma.toLocaleString("es-AR")}) tiene que coincidir con el importe de la línea ($${importeLinea.toLocaleString("es-AR")}).`;
    }
  }

  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  await prisma.$transaction([
    prisma.lineaPresupuestoDesglose.deleteMany({ where: { lineaPresupuestoId: lineaId } }),
    prisma.lineaPresupuestoDesglose.createMany({
      data: limpias.map((s) => ({
        lineaPresupuestoId: lineaId,
        detalle: s.detalle,
        importe: s.importe,
      })),
    }),
  ]);
  await marcarComoModificadoSiEnRevision(presupuesto);

  revalidarPresupuesto(empresaSlug, periodo);
  return { ok: true };
}

export async function eliminarDesglose(
  empresaSlug: string,
  periodo: string,
  lineaId: string
): Promise<ResultadoEliminar> {
  const { empresa, presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);
  const autorizacion = await autorizarEdicionLinea(usuario, empresa.id, presupuesto, empresaSlug);
  if (!autorizacion.ok) {
    return { ok: false, error: autorizacion.error };
  }

  await prisma.lineaPresupuestoDesglose.deleteMany({ where: { lineaPresupuestoId: lineaId } });
  await marcarComoModificadoSiEnRevision(presupuesto);

  revalidarPresupuesto(empresaSlug, periodo);
  return { ok: true };
}

type ResultadoTransicionEstado = { ok: true } | { ok: false; error: string };

// Reemplaza a la vieja validarPresupuesto (ABIERTO→VALIDADO directo): ahora
// el gerente manda a revisión primero, y el cierre real queda en
// confirmarVersionFinal más abajo. Misma guardia de "no vacío" que tenía
// validarPresupuesto — un count() simple alcanza: LineaPresupuesto no tiene
// borrado lógico (eliminarLinea hace un delete real) ni puede tener importe
// 0 (ya lo impiden agregarLinea/subirLineasMasivo), así que cualquier fila
// que exista acá es una carga real.
export async function enviarARevision(
  empresaSlug: string,
  periodo: string
): Promise<ResultadoTransicionEstado> {
  const { presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);

  // El gerente solo envía a revisión el mes en curso de carga (ADMIN y FINANZAS, cualquiera).
  if (!puedeEditarPeriodoComoGerente(periodo, esAdminOFinanzas(usuario))) {
    return { ok: false, error: mensajePeriodoSoloLectura() };
  }
  if (presupuesto.estado !== "ABIERTO") {
    return { ok: false, error: "Este presupuesto ya fue enviado a revisión." };
  }

  const cantidadLineas = await prisma.lineaPresupuesto.count({
    where: { presupuestoId: presupuesto.id },
  });
  if (cantidadLineas === 0) {
    return { ok: false, error: "No podés enviar a revisión un presupuesto sin líneas cargadas." };
  }

  await prisma.presupuestoMensual.update({
    where: { id: presupuesto.id },
    data: { estado: "EN_REVISION" },
  });
  revalidarPresupuesto(empresaSlug, periodo);
  return { ok: true };
}

// Solo el revisor puede marcar esto — es la señal que habilita
// confirmarVersionFinal del lado del gerente. Cualquier mutación posterior
// del revisor (ver marcarComoModificadoSiEnRevision) la vuelve a false.
export async function marcarRevisionCompletada(
  empresaSlug: string,
  periodo: string
): Promise<ResultadoTransicionEstado> {
  const { empresa, presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);

  if (presupuesto.estado !== "EN_REVISION") {
    return { ok: false, error: "Este presupuesto no está en revisión." };
  }
  if (!(await puedeRevisarPresupuesto(usuario, empresa.id))) {
    return { ok: false, error: "No tenés permiso para revisar este presupuesto." };
  }

  await prisma.presupuestoMensual.update({
    where: { id: presupuesto.id },
    data: { revisionCompletada: true },
  });
  revalidarPresupuesto(empresaSlug, periodo);
  return { ok: true };
}

// El revisor le devuelve el presupuesto al gerente con un mensaje: EN_REVISION →
// ABIERTO, revisionCompletada=false y queda registrado el pedido (mensaje, quién y
// cuándo) en PedidoCambiosPresupuesto. Se puede repetir (cada pedido es una fila).
// El cambio de estado y el registro van en una sola transacción, y el updateMany con
// estado EN_REVISION en el WHERE es la guardia: si en el medio se confirmó la versión
// final (VALIDADO) o ya se pidieron cambios, no se escribe nada. VALIDADO no se toca.
export async function pedirCambios(
  empresaSlug: string,
  periodo: string,
  mensajeCrudo: string
): Promise<ResultadoTransicionEstado> {
  const validacion = validarMensajePedido(mensajeCrudo);
  if (!validacion.ok) {
    return { ok: false, error: validacion.error };
  }

  const { empresa, presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);

  if (presupuesto.estado !== "EN_REVISION") {
    return { ok: false, error: "Este presupuesto no está en revisión." };
  }
  const esRevisor = await puedeRevisarPresupuesto(usuario, empresa.id);
  if (!puedePedirCambios(presupuesto, esRevisor)) {
    return { ok: false, error: "No tenés permiso para pedir cambios en este presupuesto." };
  }

  const aplicado = await prisma.$transaction(async (tx) => {
    const { count } = await tx.presupuestoMensual.updateMany({
      where: { id: presupuesto.id, estado: "EN_REVISION" },
      data: { estado: "ABIERTO", revisionCompletada: false },
    });
    if (count !== 1) return false;
    await tx.pedidoCambiosPresupuesto.create({
      data: { presupuestoId: presupuesto.id, mensaje: validacion.mensaje, solicitadoPorId: usuario.id },
    });
    return true;
  });
  if (!aplicado) {
    return {
      ok: false,
      error: "El presupuesto cambió de estado mientras pedías los cambios. Recargá la pantalla y revisá su estado.",
    };
  }

  revalidarPresupuesto(empresaSlug, periodo);
  return { ok: true };
}

// Cierre real e irreversible (antes lo hacía validarPresupuesto directo
// desde ABIERTO) — requiere haber pasado por EN_REVISION y que el revisor ya haya
// marcado "Terminé de revisar". Regla de quién (lib/confirmacionFinal.ts): SOLO el rol
// GERENTE confirma por acá; ADMIN y FINANZAS usan confirmarEnNombreDelGerente. La regla
// se repite acá en el servidor: ocultar el botón no alcanza.
export async function confirmarVersionFinal(
  empresaSlug: string,
  periodo: string
): Promise<ResultadoTransicionEstado> {
  const { presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);

  const resultado = await ejecutarConfirmacion(dbConfirmacion, {
    modo: "GERENTE",
    usuario,
    esRevisor: false, // no cuenta en este modo
    presupuesto,
  });
  if (!resultado.ok) return resultado;
  revalidarPresupuesto(empresaSlug, periodo);
  return { ok: true };
}

// Cierre "en nombre del gerente": ADMIN, o FINANZAS con puedeRevisarPresupuesto en la empresa.
// Exige un motivo escrito (mínimo 10 caracteres) y deja constancia en el presupuesto
// (confirmadoEnNombreDeGerente + motivoConfirmacionEnNombre); validadoPorId sigue siendo
// quién apretó. Un GERENTE no puede usarla. Mismas guardas de estado que la normal.
export async function confirmarEnNombreDelGerente(
  empresaSlug: string,
  periodo: string,
  motivo: string
): Promise<ResultadoTransicionEstado> {
  const { empresa, presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);
  const esRevisor = await puedeRevisarPresupuesto(usuario, empresa.id);

  const resultado = await ejecutarConfirmacion(dbConfirmacion, {
    modo: "EN_NOMBRE",
    usuario,
    esRevisor,
    presupuesto,
    motivo,
  });
  if (!resultado.ok) return resultado;
  revalidarPresupuesto(empresaSlug, periodo);
  return { ok: true };
}

type ResultadoImportarLineas =
  | { ok: true; filasImportadas: number }
  | { ok: false; error: string; erroresPorFila?: { fila: number; error: string }[] };

// A diferencia de subirExtracto (que descarta en silencio las filas inválidas), acá se rechaza
// el archivo completo si alguna fila tiene datos incompletos — nada se importa hasta que el
// archivo esté 100% limpio. Es a propósito: el objetivo de esta pantalla es que el total
// coincida con un presupuesto ya aprobado, y una fila descartada en silencio produciría un
// total que parece válido pero está mal, mucho peor que un rechazo claro.
export async function subirLineasMasivo(
  empresaSlug: string,
  periodo: string,
  formData: FormData
): Promise<ResultadoImportarLineas> {
  const archivo = formData.get("archivo");

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false, error: "Elegí un archivo antes de subir." };
  }
  if (!archivo.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "El archivo tiene que ser un .xlsx." };
  }

  const { empresa, presupuesto, usuario } = await resolverEmpresaYPresupuesto(empresaSlug, periodo);
  const autorizacion = await autorizarEdicionLinea(usuario, empresa.id, presupuesto, empresaSlug);
  if (!autorizacion.ok) {
    return { ok: false, error: autorizacion.error };
  }

  const buffer = await archivo.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  // Plantilla propia, no un formato bancario con nombre de hoja fijo — siempre la primera hoja.
  const hoja = workbook.worksheets[0];
  if (!hoja) {
    return { ok: false, error: "El archivo no tiene ninguna hoja." };
  }

  const encabezados: Record<number, string> = {};
  const filaEncabezado = hoja.getRow(FILA_HEADERS);
  filaEncabezado.eachCell((celda, colNumero) => {
    const texto = normalizarEncabezado(String(celda.value ?? ""));
    const campo = COLUMNAS_PRESUPUESTO[texto];
    if (campo) encabezados[colNumero] = campo;
  });

  const columnasEncontradas = new Set(Object.values(encabezados));
  const faltantes = CAMPOS_REQUERIDOS.filter((campo) => !columnasEncontradas.has(campo));
  if (faltantes.length > 0) {
    return {
      ok: false,
      error: `Faltan columnas en el archivo: ${faltantes.join(", ")}. Los encabezados esperados son Concepto, Detalle, Importe y Clasificacion.`,
    };
  }

  const filas: { concepto: string; detalle: string; importe: number; clasificacion: string }[] = [];
  const erroresPorFila: { fila: number; error: string }[] = [];

  hoja.eachRow((fila, numeroFila) => {
    if (numeroFila === FILA_HEADERS) return;

    const valores: Record<string, unknown> = {};
    fila.eachCell((celda, colNumero) => {
      const campo = encabezados[colNumero];
      if (campo) valores[campo] = celda.value;
    });

    const concepto = String(valores.concepto ?? "").trim();
    const detalle = String(valores.detalle ?? "").trim();
    const clasificacionCruda = String(valores.clasificacion ?? "").trim();
    const clasificacion = normalizarClasificacion(clasificacionCruda);
    // Lista cerrada también en la carga masiva (decisión 2026-10-07): se traduce
    // al valor de la lista (valor técnico, texto visible o alias confirmado de
    // lib/rubros.ts); lo que no esté en la lista hace rechazar el archivo entero.
    const clasificacionDeLista = clasificacion ? traducirClasificacionPresupuesto(clasificacion) : null;
    const importeCrudo = valores.importe;

    // Fila completamente vacía (típico al final de una planilla): se saltea sin error.
    if (!concepto && !detalle && !clasificacion && importeCrudo == null) return;

    const { valor: importe, error: errorImporte } = extraerImporteCelda(importeCrudo);
    const problemas: string[] = [];
    if (!concepto) problemas.push("falta el concepto");
    if (!detalle) problemas.push("falta el detalle");
    if (errorImporte) problemas.push(errorImporte);
    else if (importe === null || importe === 0) problemas.push("el importe no es un número válido o es 0");
    if (!clasificacion) problemas.push("falta la clasificación");
    else if (!clasificacionDeLista) problemas.push(`«${clasificacionCruda}» no es una clasificación de la lista`);

    if (problemas.length > 0) {
      erroresPorFila.push({ fila: numeroFila, error: problemas.join("; ") });
      return;
    }

    filas.push({ concepto, detalle, importe: importe as number, clasificacion: clasificacionDeLista! });
  });

  if (erroresPorFila.length > 0) {
    return {
      ok: false,
      error:
        "El archivo tiene filas con datos incompletos o con clasificaciones que no son de la lista — no se importó nada. Corregilas y volvé a subirlo.",
      erroresPorFila,
    };
  }

  if (filas.length === 0) {
    return { ok: false, error: "No encontré ninguna fila con datos para importar." };
  }

  await prisma.lineaPresupuesto.createMany({
    data: filas.map((f) => ({ ...f, presupuestoId: presupuesto.id })),
  });
  await marcarComoModificadoSiEnRevision(presupuesto);

  revalidarPresupuesto(empresaSlug, periodo);
  return { ok: true, filasImportadas: filas.length };
}
