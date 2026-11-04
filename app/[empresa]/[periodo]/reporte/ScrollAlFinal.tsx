"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { corresponderScrollAlFinal } from "@/lib/reporte/scrollInicial";

// useLayoutEffect solo en el navegador (en el servidor no existe layout); así en navegación interna el scroll se
// aplica antes del primer pintado. En una carga completa el HTML llega a la izquierda y salta al hidratar.
const useEfectoDeLayout = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Contenedor con scroll de «Columnas juntas»: al montar y cada vez que cambia `clave` (mes o vista) deja el scroll
// horizontal al final, para que se vea el último mes. Un router.refresh no cambia `clave`, así que no lo vuelve a
// mover. La columna Concepto es `sticky left-0` y sigue fija: el scroll no la afecta.
export default function ScrollAlFinal({
  clave,
  cantidadMeses,
  className,
  children,
}: {
  clave: string;
  cantidadMeses: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const claveAplicada = useRef<string | null>(null);

  useEfectoDeLayout(() => {
    const el = ref.current;
    if (!el || !corresponderScrollAlFinal(cantidadMeses, clave, claveAplicada.current)) return;
    el.scrollLeft = el.scrollWidth;
    claveAplicada.current = clave;
  }, [clave, cantidadMeses]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
