"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { guardarTipeoDelReporte } from "./actionsTipeo";
import { placeholderDeCelda, type CeldaTipeo } from "@/lib/reporte/tipeoDirecto";

// Tipeo directo en el Reporte (solo ADMIN y FINANZAS: el servidor no manda estas celdas a nadie más): el Real
// manual de las filas de la plantilla y el Presupuestado y el Real de las filas extra. Estado propio, separado
// de la carga del Presupuestado del gerente (CargaPresupuesto.tsx): una sola acción, "Guardar valores", para
// todas las celdas que cambiaron. Cada celda se identifica por «clave|columna».

type Contexto = {
  valores: Record<string, string>;
  celdas: Map<string, CeldaTipeo>;
  guardando: boolean;
  cambiar: (id: string, texto: string) => void;
  cantidadCambios: number;
  mensaje: { tipo: "ok" | "error"; texto: string } | null;
  guardar: () => Promise<void>;
};

const TipeoContext = createContext<Contexto | null>(null);

function valoresIniciales(celdas: CeldaTipeo[]): Record<string, string> {
  return Object.fromEntries(celdas.map((c) => [c.id, c.importeInicial]));
}

export function ProveedorTipeo({
  empresaSlug,
  periodo,
  celdas,
  huella,
  children,
}: {
  empresaSlug: string;
  periodo: string;
  celdas: CeldaTipeo[];
  // Cambia cuando el servidor manda valores guardados distintos: lo tipeado se reemplaza por lo guardado.
  huella: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [valores, setValores] = useState(() => valoresIniciales(celdas));
  const [huellaVista, setHuellaVista] = useState(huella);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<Contexto["mensaje"]>(null);
  // Corta un segundo clic antes de que React deshabilite el botón.
  const guardandoRef = useRef(false);

  if (huella !== huellaVista) {
    setHuellaVista(huella);
    setValores(valoresIniciales(celdas));
  }

  const porId = new Map(celdas.map((c) => [c.id, c]));
  const modificadas = celdas.filter((c) => (valores[c.id] ?? "").trim() !== c.importeInicial.trim());

  function cambiar(id: string, texto: string) {
    setMensaje(null);
    setValores((prev) => ({ ...prev, [id]: texto }));
  }

  async function guardar() {
    if (guardandoRef.current || modificadas.length === 0) return;
    guardandoRef.current = true;
    setGuardando(true);
    setMensaje(null);
    try {
      const r = await guardarTipeoDelReporte(
        empresaSlug,
        periodo,
        modificadas.map((c) => ({ filaClave: c.clave, columna: c.columna, texto: valores[c.id] ?? "" }))
      );
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
    <TipeoContext.Provider
      value={{ valores, celdas: porId, guardando, cambiar, cantidadCambios: modificadas.length, mensaje, guardar }}
    >
      {children}
    </TipeoContext.Provider>
  );
}

function useTipeo(): Contexto {
  const c = useContext(TipeoContext);
  if (!c) throw new Error("La celda de tipeo va dentro de ProveedorTipeo.");
  return c;
}

export function BarraGuardarTipeo() {
  const { guardando, cantidadCambios, mensaje, guardar } = useTipeo();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={guardar}
        disabled={cantidadCambios === 0 || guardando}
        className="h-9 rounded-md bg-marino px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-marino-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marino disabled:cursor-not-allowed disabled:opacity-40"
      >
        {guardando ? "Guardando..." : "Guardar valores"}
      </button>
      <span className="text-xs text-ink-secondary">
        {cantidadCambios > 0
          ? `${cantidadCambios} ${cantidadCambios === 1 ? "cambio" : "cambios"} sin guardar`
          : "Tipeá los valores en las celdas con borde (Real, y Presupuestado en las filas agregadas). Se aceptan cuentas como 321.235,44+17.755,22."}
      </span>
      {mensaje && (
        <span className={`text-sm ${mensaje.tipo === "error" ? "text-terracota" : "text-verde"}`} role="status">
          {mensaje.texto}
        </span>
      )}
    </div>
  );
}

// Input dentro de la columna Real o Presupuestado del último mes. `derivado` (centavos): el Presupuestado que calcula la
// regla de la plantilla; sin valor guardado se muestra en gris en lugar del «0» y lo tipeado lo reemplaza.
export function CeldaTipeoEditable({
  clave,
  columna,
  nombre,
  derivado,
}: {
  clave: string;
  columna: "PRESUPUESTADO" | "REAL";
  nombre: string;
  derivado?: number | null;
}) {
  const { valores, celdas, guardando, cambiar } = useTipeo();
  const id = `${clave}|${columna}`;
  const celda = celdas.get(id);
  if (!celda) return null;
  const placeholder = placeholderDeCelda(celda.importeInicial, derivado);
  return (
    <input
      value={valores[id] ?? ""}
      onChange={(e) => cambiar(id, e.target.value)}
      inputMode="decimal"
      placeholder={placeholder}
      disabled={guardando}
      aria-label={`${columna === "REAL" ? "Real" : "Presupuestado"}: ${nombre}`}
      title={celda.aviso ?? (placeholder !== "0" ? "Calculado por la regla; tipeá para reemplazarlo" : undefined)}
      className="h-5 w-28 rounded border border-line bg-paper px-1.5 text-right text-[11px] leading-none tabular outline-none focus:border-marino focus:ring-1 focus:ring-marino/30 disabled:opacity-60"
    />
  );
}

// Con tipeo envuelve el Reporte; sin él no agrega nada.
export function ConTipeo({
  tipeo,
  empresaSlug,
  periodo,
  children,
}: {
  tipeo: { celdas: CeldaTipeo[]; huella: string } | null;
  empresaSlug: string;
  periodo: string;
  children: ReactNode;
}) {
  if (!tipeo) return <>{children}</>;
  return (
    <ProveedorTipeo empresaSlug={empresaSlug} periodo={periodo} celdas={tipeo.celdas} huella={tipeo.huella}>
      {children}
    </ProveedorTipeo>
  );
}
