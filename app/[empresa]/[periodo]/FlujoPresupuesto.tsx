"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  enviarARevision,
  marcarRevisionCompletada,
  confirmarVersionFinal,
  confirmarEnNombreDelGerente,
  pedirCambios,
} from "./presupuesto/actions";
import { formatearDiaMes, textoTrazabilidad } from "@/lib/fecha";
import { MAX_MOTIVO_EN_NOMBRE, MIN_MOTIVO_EN_NOMBRE } from "@/lib/confirmacionFinal";
import { MAX_MENSAJE_PEDIDO_CAMBIOS } from "@/lib/pedidoCambiosPresupuesto";
import { useHayCambiosSinGuardar } from "./CargaPresupuestoContexto";

// Estado del presupuesto y botones del flujo (ABIERTO → EN_REVISION → ABIERTO con mensaje →
// VALIDADO), compartidos por Presupuesto (PresupuestoForm) y el Reporte. Se separan en tres
// piezas porque en las dos pantallas van en lugares distintos: la etiqueta junto al título, los
// avisos arriba y los botones abajo. Las reglas de quién puede qué las repite el servidor (ver
// las acciones de presupuesto/actions.ts); acá solo se muestra u oculta.

// variante "reporte": chip más grande para el encabezado del Reporte, con el "Validado" en un terracota
// más oscuro (AA sobre terracota-tint). Sin la variante se ve exactamente como siempre.
export function EstadoBadge({ estado, variante }: { estado: string; variante?: "reporte" }) {
  const validado = estado === "VALIDADO";
  const enRevision = estado === "EN_REVISION";
  const reporte = variante === "reporte";
  return (
    <span
      className={`${reporte ? "text-sm font-medium px-3 py-1 rounded-full" : "text-xs px-2.5 py-1 rounded-md"} ${
        validado
          ? reporte
            ? "bg-terracota-tint text-[#a63f1c]"
            : "bg-terracota-tint text-terracota"
          : enRevision
            ? "bg-plata/20 text-ink-secondary"
            : "bg-marino-tint text-marino"
      }`}
    >
      {validado ? "Validado" : enRevision ? "En revisión" : "Abierto"}
    </span>
  );
}

type PropsAvisos = {
  estado: string;
  esRevisor: boolean;
  revisionCompletada: boolean;
  fueModificadoPorRevisor: boolean;
  // Trazabilidad: quién confirmó la versión final y cuándo (null si no está validado).
  // enNombreDeGerente/motivo: la versión final la confirmó un ADMIN/FINANZAS en nombre del gerente.
  validacion: { fecha: string; por: string | null; enNombreDeGerente: boolean; motivo: string | null } | null;
  // Último pedido de cambios del revisor (null si nunca hubo). Solo se muestra en ABIERTO.
  pedidoCambios: { mensaje: string; fecha: string; por: string | null } | null;
  // Qué confirmación final le corresponde a este usuario, por rol (lib/confirmacionFinal.ts).
  puedeConfirmarFinal: boolean;
  puedeConfirmarEnNombre: boolean;
};

export function AvisosFlujo({
  estado,
  esRevisor,
  revisionCompletada,
  fueModificadoPorRevisor,
  validacion,
  pedidoCambios,
  puedeConfirmarFinal,
  puedeConfirmarEnNombre,
}: PropsAvisos) {
  const validado = estado === "VALIDADO";
  const enRevision = estado === "EN_REVISION";
  // Revisión terminada: el aviso depende de quién mira (le toca al gerente / espera al gerente / otro).
  const terminadaParaGerente = enRevision && revisionCompletada && puedeConfirmarFinal;
  const terminadaEsperando = enRevision && revisionCompletada && !puedeConfirmarFinal && puedeConfirmarEnNombre;
  const terminadaOtro = enRevision && revisionCompletada && !puedeConfirmarFinal && !puedeConfirmarEnNombre;
  return (
    <>
      {estado === "ABIERTO" && pedidoCambios && (
        <div className="mb-6 text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          <p className="font-medium">
            {pedidoCambios.por
              ? `Pedido de cambios de ${pedidoCambios.por} el ${formatearDiaMes(pedidoCambios.fecha)}`
              : `Pedido de cambios del ${formatearDiaMes(pedidoCambios.fecha)}`}
          </p>
          <p className="mt-1 whitespace-pre-line">{pedidoCambios.mensaje}</p>
        </div>
      )}

      {validado && (
        <p className="mb-6 text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          Este presupuesto ya fue validado. Cualquier corrección se carga en el período
          siguiente.
          {validacion && !validacion.enNombreDeGerente && (
            <span className="mt-1 block text-xs">
              {textoTrazabilidad("Validado", validacion.fecha, validacion.por)}.
            </span>
          )}
          {validacion?.enNombreDeGerente && (
            <span className="mt-1 block text-xs">
              {validacion.por ? `Validado por ${validacion.por}` : "Validado"} en nombre del gerente el{" "}
              {formatearDiaMes(validacion.fecha)}. Motivo: {validacion.motivo}
            </span>
          )}
        </p>
      )}

      {terminadaParaGerente && (
        <div className="mb-6 space-y-2">
          <p className="text-sm text-ink-secondary bg-plata/20 rounded-md px-3 py-2">
            La revisión de este presupuesto terminó. Te toca confirmar la versión final.
          </p>
          {fueModificadoPorRevisor && (
            <p className="text-xs text-ink-muted">Se hicieron cambios en este presupuesto durante la revisión.</p>
          )}
        </div>
      )}

      {terminadaEsperando && (
        <p className="mb-6 text-sm text-ink-secondary bg-plata/20 rounded-md px-3 py-2">
          Esperando la confirmación final del gerente.
        </p>
      )}

      {terminadaOtro && (
        <p className="mb-6 text-sm text-ink-secondary bg-plata/20 rounded-md px-3 py-2">
          La revisión de este presupuesto terminó. La confirmación final la hace el gerente de la empresa.
        </p>
      )}

      {enRevision && !revisionCompletada && !esRevisor && (
        <div className="mb-6 space-y-2">
          <p className="text-sm text-ink-secondary bg-plata/20 rounded-md px-3 py-2">
            Este presupuesto está en revisión — no podés editarlo mientras dure.
          </p>
          {fueModificadoPorRevisor && (
            <p className="text-xs text-ink-muted">Se hicieron cambios en este presupuesto durante la revisión.</p>
          )}
        </div>
      )}

      {enRevision && !revisionCompletada && esRevisor && (
        <p className="mb-6 text-sm text-ink-secondary bg-plata/20 rounded-md px-3 py-2">
          Este presupuesto está en revisión — estás editando como revisor.
        </p>
      )}
    </>
  );
}

type PropsAcciones = {
  estado: string;
  esRevisor: boolean;
  revisionCompletada: boolean;
  // Cantidad de líneas guardadas: sin ninguna no se puede enviar a revisión.
  cantidadLineas: number;
  // Mes en solo lectura para el gerente: no se muestra "Enviar a revisión". Las acciones del revisor y
  // las de confirmación final (cada una según el rol) no cambian.
  ocultarEnviarARevision?: boolean;
  // Qué confirmación final le corresponde a este usuario, por rol (lib/confirmacionFinal.ts):
  // "Confirmar versión final" solo el GERENTE; "Confirmar en nombre del gerente" ADMIN y FINANZAS revisor.
  puedeConfirmarFinal: boolean;
  puedeConfirmarEnNombre: boolean;
};

export function AccionesFlujo({
  estado,
  esRevisor,
  revisionCompletada,
  cantidadLineas,
  ocultarEnviarARevision = false,
  puedeConfirmarFinal,
  puedeConfirmarEnNombre,
}: PropsAcciones) {
  const router = useRouter();
  const { empresa: empresaSlug, periodo: periodoUrl } = useParams<{
    empresa: string;
    periodo: string;
  }>();

  const [errorValidar, setErrorValidar] = useState("");
  // Panel "Pedir cambios" (solo revisor, solo EN_REVISION). El error se muestra
  // adentro del panel y no lo cierra, para no perder el texto escrito.
  const [panelPedidoAbierto, setPanelPedidoAbierto] = useState(false);
  const [mensajePedido, setMensajePedido] = useState("");
  const [errorPedido, setErrorPedido] = useState("");
  const [enviandoPedido, setEnviandoPedido] = useState(false);
  // Panel "Confirmar en nombre del gerente": el motivo se escribe (mínimo 10 caracteres), no alcanza un confirm().
  const [panelEnNombreAbierto, setPanelEnNombreAbierto] = useState(false);
  const [motivoEnNombre, setMotivoEnNombre] = useState("");
  const [errorEnNombre, setErrorEnNombre] = useState("");
  const [confirmandoEnNombre, setConfirmandoEnNombre] = useState(false);

  // En el Reporte con carga activa: valores tipeados que todavía no se guardaron.
  const hayCambiosSinGuardar = useHayCambiosSinGuardar();

  const validado = estado === "VALIDADO";
  const enRevision = estado === "EN_REVISION";

  async function handleEnviarARevision() {
    if (!confirm("¿Enviar este presupuesto a revisión? Vos ya no vas a poder seguir editándolo mientras dure.")) {
      return;
    }
    setErrorValidar("");
    const resultado = await enviarARevision(empresaSlug, periodoUrl);
    if (!resultado.ok) {
      setErrorValidar(resultado.error);
      return;
    }
    router.refresh();
  }

  async function handleTerminarRevision() {
    setErrorValidar("");
    const resultado = await marcarRevisionCompletada(empresaSlug, periodoUrl);
    if (!resultado.ok) {
      setErrorValidar(resultado.error);
      return;
    }
    router.refresh();
  }

  function cerrarPanelPedido() {
    setPanelPedidoAbierto(false);
    setMensajePedido("");
    setErrorPedido("");
  }

  async function handleEnviarPedido() {
    setEnviandoPedido(true);
    setErrorPedido("");
    const resultado = await pedirCambios(empresaSlug, periodoUrl, mensajePedido);
    setEnviandoPedido(false);
    if (!resultado.ok) {
      setErrorPedido(resultado.error);
      return;
    }
    cerrarPanelPedido();
    router.refresh();
  }

  async function handleConfirmarVersionFinal() {
    if (!confirm("¿Confirmar la versión final? Después de esto no se puede editar para atrás.")) {
      return;
    }
    setErrorValidar("");
    const resultado = await confirmarVersionFinal(empresaSlug, periodoUrl);
    if (!resultado.ok) {
      setErrorValidar(resultado.error);
      return;
    }
    router.refresh();
  }

  function cerrarPanelEnNombre() {
    setPanelEnNombreAbierto(false);
    setMotivoEnNombre("");
    setErrorEnNombre("");
  }

  async function handleConfirmarEnNombre() {
    setConfirmandoEnNombre(true);
    setErrorEnNombre("");
    const resultado = await confirmarEnNombreDelGerente(empresaSlug, periodoUrl, motivoEnNombre);
    setConfirmandoEnNombre(false);
    if (!resultado.ok) {
      setErrorEnNombre(resultado.error);
      return;
    }
    cerrarPanelEnNombre();
    router.refresh();
  }

  // Se muestra al lado de "Terminé de revisar" (y también cuando la revisión ya está
  // completada: el revisor puede arrepentirse, ver puedePedirCambios).
  const botonPedirCambios =
    enRevision && esRevisor ? (
      <button
        onClick={() => setPanelPedidoAbierto(true)}
        disabled={enviandoPedido || panelPedidoAbierto}
        className="h-14 px-6 rounded-md border border-line-strong text-base font-semibold tracking-wide text-ink transition hover:bg-paper-raised disabled:cursor-not-allowed disabled:opacity-50"
      >
        Pedir cambios
      </button>
    ) : null;

  if (validado) return null;
  // ABIERTO solo tiene ese botón: sin él no queda nada que mostrar.
  if (estado === "ABIERTO" && ocultarEnviarARevision) return null;
  // Revisión terminada y este usuario no puede confirmar ni revisar (FINANZAS sin permiso de revisor): no hay
  // ningún botón para mostrar, así que no se dibuja el contenedor vacío (solo quedaría la línea de borde).
  if (enRevision && revisionCompletada && !puedeConfirmarFinal && !puedeConfirmarEnNombre && !esRevisor && !errorValidar) {
    return null;
  }

  return (
    <div className="mt-10 border-t border-line pt-6">
      {errorValidar && (
        <p className="mb-4 text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          {errorValidar}
        </p>
      )}

      {estado === "ABIERTO" && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-muted max-w-xs">
            Una vez que la envíes a revisión, vos ya no vas a poder editarla más. Cualquier
            corrección la carga quien revisa.
          </p>
          {hayCambiosSinGuardar && (
            <p className="text-xs text-terracota mr-4">Guardá los cambios antes de enviar a revisión.</p>
          )}
          <button
            onClick={handleEnviarARevision}
            disabled={cantidadLineas === 0 || hayCambiosSinGuardar}
            className="h-14 px-6 rounded-md bg-ink text-base font-semibold tracking-wide text-paper shadow-sm transition hover:bg-ink/90 hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
          >
            Enviar a revisión
          </button>
        </div>
      )}

      {enRevision && esRevisor && !revisionCompletada && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-muted max-w-xs">
            Cuando termines de revisar, marcalo acá — recién ahí se puede confirmar la versión
            final.
          </p>
          <div className="flex items-center gap-3">
            {botonPedirCambios}
            <button
              onClick={handleTerminarRevision}
              disabled={enviandoPedido}
              className="h-14 px-6 rounded-md bg-ink text-base font-semibold tracking-wide text-paper shadow-sm transition hover:bg-ink/90 hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Terminé de revisar
            </button>
          </div>
        </div>
      )}

      {enRevision && esRevisor && panelPedidoAbierto && (
        <div className="mt-6 rounded-md border border-line-strong bg-paper-raised px-4 py-4">
          <label htmlFor="mensajePedido" className="block text-sm text-ink-secondary mb-1.5">
            Qué cambios necesitás
          </label>
          <textarea
            id="mensajePedido"
            value={mensajePedido}
            onChange={(e) => {
              setMensajePedido(e.target.value);
              setErrorPedido("");
            }}
            maxLength={MAX_MENSAJE_PEDIDO_CAMBIOS}
            rows={5}
            disabled={enviandoPedido}
            className={`w-full rounded-md border bg-paper px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-marino/15 disabled:opacity-60 ${
              errorPedido ? "border-terracota" : "border-line focus:border-marino"
            }`}
          />
          <div className="mt-1 flex items-start justify-between gap-4">
            <p className="text-xs text-ink-muted">
              El presupuesto vuelve al gerente para que lo corrija. Vas a tener que revisarlo de
              nuevo cuando lo reenvíe.
            </p>
            <span className="tabular shrink-0 text-xs text-ink-muted">
              {mensajePedido.length}/{MAX_MENSAJE_PEDIDO_CAMBIOS}
            </span>
          </div>
          {errorPedido && (
            <p className="mt-3 text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
              {errorPedido}
            </p>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleEnviarPedido}
              disabled={enviandoPedido}
              className="h-11 px-5 rounded-md bg-ink text-sm font-semibold text-paper transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviandoPedido ? "Enviando..." : "Enviar pedido"}
            </button>
            <button
              onClick={cerrarPanelPedido}
              disabled={enviandoPedido}
              className="h-11 px-4 rounded-md border border-line-strong text-sm text-ink-secondary transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Confirmación final (revisión terminada). Quién ve cada botón sale del ROL, no de esRevisor:
          "Confirmar versión final" solo el GERENTE; "Confirmar en nombre del gerente" ADMIN y FINANZAS
          revisor (lib/confirmacionFinal.ts). Quien no tiene ninguno de los dos (FINANZAS sin permiso de
          revisión) no ve botón de confirmar. El servidor repite la regla en cada acción. */}
      {enRevision && revisionCompletada && (puedeConfirmarFinal || puedeConfirmarEnNombre || esRevisor) && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-muted max-w-xs">
            {puedeConfirmarFinal
              ? "Una vez que confirmes, el presupuesto de este mes queda cerrado. Cualquier corrección se carga en el período siguiente."
              : puedeConfirmarEnNombre
                ? "La confirmación final es del gerente. Solo si no puede hacerla, confirmá en su nombre dejando el motivo."
                : ""}
          </p>
          <div className="flex items-center gap-3">
            {esRevisor && botonPedirCambios}
            {puedeConfirmarFinal && (
              <button
                onClick={handleConfirmarVersionFinal}
                disabled={enviandoPedido}
                className="h-14 px-6 rounded-md bg-ink text-base font-semibold tracking-wide text-paper shadow-sm transition hover:bg-ink/90 hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirmar versión final
              </button>
            )}
            {!puedeConfirmarFinal && puedeConfirmarEnNombre && (
              <button
                onClick={() => setPanelEnNombreAbierto(true)}
                disabled={enviandoPedido || confirmandoEnNombre || panelEnNombreAbierto}
                className="h-14 px-6 rounded-md bg-ink text-base font-semibold tracking-wide text-paper shadow-sm transition hover:bg-ink/90 hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirmar en nombre del gerente
              </button>
            )}
          </div>
        </div>
      )}

      {enRevision && revisionCompletada && !puedeConfirmarFinal && puedeConfirmarEnNombre && panelEnNombreAbierto && (
        <div className="mt-6 rounded-md border border-line-strong bg-paper-raised px-4 py-4">
          <label htmlFor="motivoEnNombre" className="block text-sm text-ink-secondary mb-1.5">
            Motivo por el que confirmás en nombre del gerente (obligatorio, mínimo {MIN_MOTIVO_EN_NOMBRE} caracteres)
          </label>
          <textarea
            id="motivoEnNombre"
            value={motivoEnNombre}
            onChange={(e) => {
              setMotivoEnNombre(e.target.value);
              setErrorEnNombre("");
            }}
            maxLength={MAX_MOTIVO_EN_NOMBRE}
            rows={3}
            disabled={confirmandoEnNombre}
            className={`w-full rounded-md border bg-paper px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-marino/15 disabled:opacity-60 ${
              errorEnNombre ? "border-terracota" : "border-line focus:border-marino"
            }`}
          />
          <div className="mt-1 flex items-start justify-between gap-4">
            <p className="text-xs text-ink-muted">
              Queda registrado quién confirmó y el motivo. El presupuesto se cierra y no se puede editar para atrás.
            </p>
            <span className="tabular shrink-0 text-xs text-ink-muted">
              {motivoEnNombre.length}/{MAX_MOTIVO_EN_NOMBRE}
            </span>
          </div>
          {errorEnNombre && (
            <p className="mt-3 text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">{errorEnNombre}</p>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleConfirmarEnNombre}
              disabled={confirmandoEnNombre || motivoEnNombre.trim().length < MIN_MOTIVO_EN_NOMBRE}
              className="h-11 px-5 rounded-md bg-ink text-sm font-semibold text-paper transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmandoEnNombre ? "Confirmando..." : "Confirmar en nombre del gerente"}
            </button>
            <button
              onClick={cerrarPanelEnNombre}
              disabled={confirmandoEnNombre}
              className="h-11 px-4 rounded-md border border-line-strong text-sm text-ink-secondary transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
