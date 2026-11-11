"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { crearFilaExtra, borrarFilaExtra } from "./actionsFilasExtra";
import type { BloqueExtra } from "@/lib/reporte/filasExtra";

// Agregar y borrar filas extra del Reporte (ADMIN y FINANZAS, y el gerente con la casilla de su empresa en las empresas de
// EMPRESAS_CON_FILAS_EXTRA_GERENTE: el servidor no manda nada de esto a nadie más). Compacto, como el resto de la tabla. Las reglas las aplican las acciones del servidor
// (reporte/actionsFilasExtra.ts): acá no se decide nada.

const CLASE_INPUT =
  "h-5 w-56 rounded border border-line bg-paper px-1.5 text-[11px] leading-none outline-none focus:border-marino focus:ring-1 focus:ring-marino/30 disabled:opacity-60";
const CLASE_BOTON =
  "h-5 rounded border border-line-strong px-2 text-[11px] leading-none hover:bg-paper-raised disabled:cursor-not-allowed disabled:opacity-50";

// «Agregar una fila» al final de un bloque: un botón que abre un formulario de nombre; una fila por vez.
export function AgregarFila({
  empresaSlug,
  periodo,
  bloque,
  nombreBloque,
}: {
  empresaSlug: string;
  periodo: string;
  bloque: BloqueExtra;
  nombreBloque: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Corta un segundo envío antes de que React deshabilite el botón.
  const enviandoRef = useRef(false);

  function cerrar() {
    setAbierto(false);
    setNombre("");
    setError(null);
  }

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      const r = await crearFilaExtra(empresaSlug, periodo, bloque, nombre);
      if (!r.ok) {
        setError(r.error);
      } else {
        cerrar();
        router.refresh();
      }
    } catch {
      setError("No se pudo agregar. Revisá la conexión y probá de nuevo.");
    } finally {
      enviandoRef.current = false;
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={CLASE_BOTON}
        aria-label={`Agregar una fila a ${nombreBloque}`}
      >
        + Agregar una fila
      </button>
    );
  }
  return (
    <form onSubmit={agregar} className="flex flex-wrap items-center gap-1.5">
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        autoFocus
        maxLength={120}
        placeholder="Nombre de la fila"
        disabled={guardando}
        aria-label={`Nombre de la fila nueva (${nombreBloque})`}
        className={CLASE_INPUT}
      />
      <button type="submit" disabled={guardando || nombre.trim() === ""} className={CLASE_BOTON}>
        {guardando ? "Agregando..." : "Agregar"}
      </button>
      <button type="button" onClick={cerrar} disabled={guardando} className={CLASE_BOTON}>
        Cancelar
      </button>
      {error && (
        <span className="text-[11px] font-normal text-terracota" role="status">
          {error}
        </span>
      )}
    </form>
  );
}

// «×» al lado del nombre de una fila extra SIN valores. El servidor vuelve a comprobar que no tenga ninguno.
export function BorrarFila({
  empresaSlug,
  periodo,
  id,
  nombre,
}: {
  empresaSlug: string;
  periodo: string;
  id: string;
  nombre: string;
}) {
  const router = useRouter();
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enviandoRef = useRef(false);

  async function borrar() {
    if (enviandoRef.current) return;
    if (!window.confirm(`¿Borrar la fila «${nombre}»? No tiene valores cargados.`)) return;
    enviandoRef.current = true;
    setBorrando(true);
    setError(null);
    try {
      const r = await borrarFilaExtra(empresaSlug, periodo, id);
      if (!r.ok) setError(r.error);
      else router.refresh();
    } catch {
      setError("No se pudo borrar. Probá de nuevo.");
    } finally {
      enviandoRef.current = false;
      setBorrando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={borrar}
        disabled={borrando}
        title="Borrar la fila (solo si no tiene valores)"
        aria-label={`Borrar la fila ${nombre}`}
        className="ml-2 text-[11px] leading-none text-ink-muted hover:text-terracota disabled:opacity-50"
      >
        ×
      </button>
      {error && (
        <span className="ml-2 text-[11px] font-normal text-terracota" role="status">
          {error}
        </span>
      )}
    </>
  );
}
