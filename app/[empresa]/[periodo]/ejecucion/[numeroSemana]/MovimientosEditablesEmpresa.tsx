"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import TablaMovimientos, { type MovimientoTabla } from "@/app/ejecucion/TablaMovimientos";
import { clasificarMovimientoEmpresa, confirmarSugerenciasEmpresa } from "../actionsClasificar";

// Tabla de movimientos EDITABLE de la pestaña de una empresa, solo para un gerente con la casilla «Puede cargar Real de esta
// empresa» y con la semana ABIERTA (la página decide cuándo mostrarla; el servidor vuelve a decidir en cada acción). Permite
// clasificar, cambiar la unidad entre las de la empresa, ignorar y confirmar sugerencias. No cierra la semana, no elimina y no
// prorratea: esas opciones ni existen acá, y las acciones tampoco.

type Edicion = {
  unidades: string[];
  clasificaciones: string[];
  sugeridasClasificacion: number;
  sugeridasUnidad: number;
};

type Props = {
  empresaId: string;
  periodo: string;
  numeroSemana: number;
  movimientos: MovimientoTabla[];
  edicion: Edicion;
};

export default function MovimientosEditablesEmpresa({ empresaId, periodo, numeroSemana, movimientos, edicion }: Props) {
  const router = useRouter();
  const [filas, setFilas] = useState(movimientos);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Después de router.refresh() llegan las filas del servidor: son la verdad (se ajusta el estado al renderizar, sin efecto).
  const [recibidas, setRecibidas] = useState(movimientos);
  if (recibidas !== movimientos) {
    setRecibidas(movimientos);
    setFilas(movimientos);
  }

  async function guardar(
    id: string,
    datos: { clasificacion?: string; unidadNegocio?: string; ignorado?: boolean },
    cambio: (m: MovimientoTabla) => MovimientoTabla
  ) {
    const antes = filas;
    setError(null);
    setAviso(null);
    setFilas((f) => f.map((m) => (m.id === id ? cambio(m) : m)));
    const r = await clasificarMovimientoEmpresa(empresaId, periodo, numeroSemana, id, datos);
    if (!r.ok) {
      setFilas(antes); // se deshace: no queda en pantalla algo que el servidor no guardó
      setError(r.error);
      return;
    }
    router.refresh();
  }

  async function confirmar(tipo: "clasificacion" | "unidad") {
    setOcupado(true);
    setError(null);
    setAviso(null);
    const r = await confirmarSugerenciasEmpresa(empresaId, periodo, numeroSemana, tipo);
    setOcupado(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setAviso(`Se confirmaron ${r.cantidad} sugerencias.`);
    router.refresh();
  }

  const hayClasificacion = edicion.sugeridasClasificacion > 0;
  const hayUnidad = edicion.sugeridasUnidad > 0;

  return (
    <div>
      {(hayClasificacion || hayUnidad) && (
        <div className="mb-3 rounded-md bg-marino-tint px-3 py-3 text-sm text-marino">
          <p className="font-medium">Sugerencias sin confirmar (solo de tu empresa)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {hayClasificacion && (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => confirmar("clasificacion")}
                className="rounded-md border border-marino px-3 py-1 text-xs font-medium transition hover:bg-paper disabled:opacity-50"
              >
                Confirmar {edicion.sugeridasClasificacion} clasificaciones sugeridas
              </button>
            )}
            {hayUnidad && (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => confirmar("unidad")}
                className="rounded-md border border-marino px-3 py-1 text-xs font-medium transition hover:bg-paper disabled:opacity-50"
              >
                Confirmar {edicion.sugeridasUnidad} unidades sugeridas
              </button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="mb-3 rounded-md border border-terracota bg-terracota-tint px-3 py-2 text-sm text-terracota" role="alert">
          {error}
        </p>
      )}
      {aviso && (
        <p className="mb-3 rounded-md bg-marino-tint px-3 py-2 text-sm text-marino" role="status">
          {aviso}
        </p>
      )}
      <TablaMovimientos
        movimientos={filas}
        numeroSemana={numeroSemana}
        clasificacionesDisponibles={edicion.clasificaciones}
        unidadesPermitidas={edicion.unidades}
        sinProrrateo
        onCambiarClasificacion={(id, valor) =>
          guardar(id, { clasificacion: valor }, (m) => ({ ...m, clasificacion: valor }))
        }
        onCambiarUnidadNegocio={(id, valor) =>
          guardar(id, { unidadNegocio: valor }, (m) => ({ ...m, unidadNegocio: valor, unidadSugeridaPorSistema: false }))
        }
        onToggleIgnorado={(id, valor) => guardar(id, { ignorado: valor }, (m) => ({ ...m, ignorado: valor }))}
      />
    </div>
  );
}
