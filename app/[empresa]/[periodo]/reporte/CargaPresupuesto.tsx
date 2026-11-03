"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { guardarPresupuestoDelReporte } from "./actionsCarga";
import { celdaModificada } from "@/lib/reporte/tipeoDirecto";
import { HayCambiosSinGuardarContext } from "../CargaPresupuestoContexto";
import {
  MAX_ACLARACION,
  type CeldaVistaCarga as CeldaVista,
  type EntradaCarga,
} from "@/lib/reporte/cargaGerente";

// Carga del Presupuestado en el Reporte (Etapas 2 y 3). El Reporte es un componente de servidor; acá
// vive lo que necesita estado: los valores tipeados de todas las celdas, el botón "Guardar" (UNA
// sola acción para todo el mes) y el aviso de cambios sin guardar que lee AccionesFlujo.

type Valor = { importe: string; aclaracion: string };

type Contexto = {
  valores: Record<string, Valor>;
  celdas: Map<string, CeldaVista>;
  guardando: boolean;
  cambiar: (id: string, parcial: Partial<Valor>) => void;
  cantidadCambios: number;
  mensaje: { tipo: "ok" | "error"; texto: string } | null;
  guardar: () => Promise<void>;
};

const CargaContext = createContext<Contexto | null>(null);

function valoresIniciales(celdas: CeldaVista[]): Record<string, Valor> {
  return Object.fromEntries(celdas.map((c) => [c.id, { importe: c.importeInicial, aclaracion: c.aclaracionInicial }]));
}

// Cambió si el importe es distinto del valor guardado (centavos exactos: el texto va en pesos enteros); la aclaración solo cuenta si hay
// un importe (con importe vacío la celda se borra y la aclaración no se usa).
function cambio(celda: CeldaVista, valor: Valor): boolean {
  if (celdaModificada(celda, valor.importe)) return true;
  return (
    celda.requiereAclaracion &&
    valor.importe.trim() !== "" &&
    valor.aclaracion.trim() !== celda.aclaracionInicial.trim()
  );
}

export function ProveedorCarga({
  empresaSlug,
  periodo,
  celdas,
  huella,
  children,
}: {
  empresaSlug: string;
  periodo: string;
  celdas: CeldaVista[];
  // Cambia cada vez que el servidor manda valores distintos (después de guardar y refrescar):
  // los valores tipeados se reemplazan por los guardados.
  huella: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [valores, setValores] = useState(() => valoresIniciales(celdas));
  const [huellaVista, setHuellaVista] = useState(huella);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  // Corta un segundo clic ANTES de que React deshabilite el botón; el servidor igual no duplica.
  const guardandoRef = useRef(false);

  if (huella !== huellaVista) {
    setHuellaVista(huella);
    setValores(valoresIniciales(celdas));
  }

  const porId = new Map(celdas.map((c) => [c.id, c]));
  const modificadas = celdas.filter((c) => valores[c.id] && cambio(c, valores[c.id]));
  const hayCambios = modificadas.length > 0;

  function cambiar(id: string, parcial: Partial<Valor>) {
    setMensaje(null);
    setValores((prev) => ({ ...prev, [id]: { ...prev[id], ...parcial } }));
  }

  async function guardar() {
    if (guardandoRef.current || !hayCambios) return;
    guardandoRef.current = true;
    setGuardando(true);
    setMensaje(null);
    const entradas: EntradaCarga[] = modificadas.map((c) => ({
      destino: c.destino,
      clave: c.clave,
      importe: valores[c.id].importe,
      ...(c.requiereAclaracion ? { aclaracion: valores[c.id].aclaracion } : {}),
      // Filas manuales: el valor que la pantalla mostraba (con sus centavos exactos), para que el servidor
      // detecte si otra persona lo cambió mientras tanto.
      ...(c.destino === "manual" ? { base: c.valorExacto ?? c.importeInicial } : {}),
    }));
    try {
      const r = await guardarPresupuestoDelReporte(empresaSlug, periodo, entradas);
      if (!r.ok) {
        setMensaje({ tipo: "error", texto: r.error });
      } else {
        setMensaje({ tipo: "ok", texto: "Guardado." });
        router.refresh();
      }
    } catch {
      setMensaje({ tipo: "error", texto: "No se pudo guardar. Revisá la conexión y probá de nuevo." });
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <HayCambiosSinGuardarContext.Provider value={hayCambios}>
      <CargaContext.Provider
        value={{ valores, celdas: porId, guardando, cambiar, cantidadCambios: modificadas.length, mensaje, guardar }}
      >
        {children}
      </CargaContext.Provider>
    </HayCambiosSinGuardarContext.Provider>
  );
}

// Botón "Guardar presupuesto": UNA acción para todas las celdas que cambiaron.
export function BarraGuardarPresupuesto() {
  const { guardando, cantidadCambios, mensaje, guardar } = useCarga();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={guardar}
        disabled={cantidadCambios === 0 || guardando}
        className="h-9 rounded-md bg-marino px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-marino-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marino disabled:cursor-not-allowed disabled:opacity-40"
      >
        {guardando ? "Guardando..." : "Guardar presupuesto"}
      </button>
      <span className="text-xs text-ink-secondary">
        {cantidadCambios > 0
          ? `${cantidadCambios} ${cantidadCambios === 1 ? "cambio" : "cambios"} sin guardar`
          : "Tipeá tu presupuesto en la columna Presupuestado y guardá."}
      </span>
      {mensaje && (
        <span className={`text-sm ${mensaje.tipo === "error" ? "text-terracota" : "text-verde"}`} role="status">
          {mensaje.texto}
        </span>
      )}
    </div>
  );
}

function useCarga(): Contexto {
  const c = useContext(CargaContext);
  if (!c) throw new Error("La celda editable va dentro de ProveedorCarga.");
  return c;
}

const CLASE_INPUT =
  "h-8 rounded-md border border-line bg-paper px-2 text-right text-sm tabular outline-none focus:border-marino focus:ring-2 focus:ring-marino/15 disabled:opacity-60";
// Dentro de la tabla del Reporte: una fila de la planilla, no un formulario.
const CLASE_INPUT_COMPACTO =
  "h-5 rounded border border-line bg-paper px-1.5 text-right text-[11px] leading-none tabular outline-none focus:border-marino focus:ring-1 focus:ring-marino/30 disabled:opacity-60";

// Input de una celda: va en la columna Presupuestado del último mes. "Otros" lleva además una
// aclaración obligatoria (se guarda como detalle de la línea).
// `compacta`: dentro de la tabla (input bajo, y quién cargó el valor va de tooltip en vez de una línea aparte).
export function CeldaPresupuestoEditable({
  id,
  nombre,
  compacta = false,
}: {
  id: string;
  nombre: string;
  compacta?: boolean;
}) {
  const { valores, celdas, guardando, cambiar } = useCarga();
  const celda = celdas.get(id);
  const valor = valores[id];
  if (!celda || !valor) return null;
  const claseInput = compacta ? CLASE_INPUT_COMPACTO : CLASE_INPUT;
  const titulo =
    [compacta ? celda.leyenda : null, celda.valorExacto !== null ? `Valor exacto: ${celda.valorExacto}` : null]
      .filter((x) => x !== null)
      .join(" · ") || undefined;
  return (
    <div className={`flex flex-col items-end ${compacta ? "gap-0.5" : "gap-1"}`}>
      <input
        value={valor.importe}
        onChange={(e) => cambiar(id, { importe: e.target.value })}
        inputMode="decimal"
        placeholder="0"
        disabled={guardando}
        aria-label={`Presupuestado: ${nombre}`}
        title={titulo}
        className={`${compacta ? "w-28" : "w-32"} ${claseInput}`}
      />
      {!compacta && celda.leyenda && <span className="text-[10px] font-normal text-ink-muted">{celda.leyenda}</span>}
      {celda.requiereAclaracion && valor.importe.trim() !== "" && (
        <input
          value={valor.aclaracion}
          onChange={(e) => cambiar(id, { aclaracion: e.target.value })}
          maxLength={MAX_ACLARACION}
          placeholder="Aclaración (obligatoria)"
          disabled={guardando}
          aria-label={`Aclaración de ${nombre}`}
          className={`w-44 text-left ${claseInput}`}
        />
      )}
    </div>
  );
}
