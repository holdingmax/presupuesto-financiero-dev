"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Indicador «Cargando N de M empresas» del dashboard. Es lo único del dashboard que corre en el navegador, y recibe SOLO la
// cantidad de empresas del propio alcance del usuario (un número que ya conoce: son las suyas) y el id de cada una de ellas a
// medida que su fila termina de pintarse. No recibe ningún dato, nombre ni cantidad de otras empresas.

type Marcar = (id: string) => void;
type Estado = { total: number; listos: ReadonlySet<string>; marcar: Marcar };

const ContextoDeProgreso = createContext<Estado | null>(null);

export function ProgresoProvider({ total, children }: { total: number; children: ReactNode }) {
  const [listos, setListos] = useState<ReadonlySet<string>>(() => new Set());
  const marcar = useCallback<Marcar>((id) => {
    setListos((previos) => (previos.has(id) ? previos : new Set(previos).add(id)));
  }, []);
  const valor = useMemo(() => ({ total, listos, marcar }), [total, listos, marcar]);
  return <ContextoDeProgreso.Provider value={valor}>{children}</ContextoDeProgreso.Provider>;
}

// Se monta cuando la fila de la empresa ya está en pantalla.
export function Listo({ id }: { id: string }) {
  const estado = useContext(ContextoDeProgreso);
  const marcar = estado?.marcar;
  useEffect(() => {
    marcar?.(id);
  }, [marcar, id]);
  return null;
}

// Texto y una barra fina quieta (sin animación): se va llenando a medida que llegan las empresas y desaparece al terminar.
export function IndicadorDeProgreso() {
  const estado = useContext(ContextoDeProgreso);
  if (!estado) return null;
  const { total, listos } = estado;
  if (total === 0 || listos.size >= total) return null;
  return (
    <div role="status" aria-live="polite" className="dash-noprint mt-4 max-w-xs">
      <p className="text-sm text-white/85">
        Cargando {listos.size} de {total} {total === 1 ? "empresa" : "empresas"}…
      </p>
      <div className="mt-1.5 h-1.5 rounded-full bg-white/15">
        <div className="h-1.5 rounded-full bg-[#5b9bff]" style={{ width: `${(listos.size / total) * 100}%` }} />
      </div>
    </div>
  );
}
