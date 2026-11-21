"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AVISO_UNA_VEZ, formatearCentavos, parsearCuenta } from "@/lib/reporte/bloqueo";
import { guardarValoresManuales } from "./actions";

export type CampoVista = {
  clave: string;
  columna: "PRESUPUESTADO" | "REAL";
  texto: string;
  bloque: string;
  valor: string;
  // Hay un valor guardado a mano (ValorManualReporte). En las filas con calculado `valor` es el total, así que no alcanza para saberlo.
  cargado: boolean;
  // Solo en las filas con parte calculada + tipeo: el calculado (centavos) que se muestra; `valor` es el TOTAL y se guarda solo la diferencia.
  calculado?: number;
  // Fila cuyo Real calculado lo reemplaza un valor manual (motor: pisableConManual).
  pisaCalculado?: boolean;
  nota: string | null;
  cargadoPor: string | null;
  bloqueo: string | null;
  // Componente de Disponibilidades: un solo campo (P = R).
  componente: { arrastre: "cuadre" | "ajuste"; enTotal: boolean } | null;
  sugerenciaDesde: string | null;
  // Solo Capital: resultado de la regla de la plantilla (texto) o null si no se puede calcular.
  reglaCapital?: string | null;
};

const TITULOS: Record<string, string> = {
  DISPONIBILIDADES: "Disponibilidades (principios de mes)",
  INGRESOS: "Ingresos",
  EGRESOS: "Egresos",
  ABAJO: "Egresos de abajo",
  CIERRE: "Cierre",
};
const ORDEN = ["DISPONIBILIDADES", "INGRESOS", "EGRESOS", "ABAJO", "CIERRE"];

const clave = (c: CampoVista) => `${c.clave}|${c.columna}`;

// Período bloqueado: un campo vacío admite la primera carga; uno con valor es solo lectura.
const soloLectura = (c: CampoVista) => !!c.bloqueo && c.cargado;

export default function CargaValoresManuales({
  empresaSlug,
  periodo,
  campos,
  cierreRealAnterior,
}: {
  empresaSlug: string;
  periodo: string;
  campos: CampoVista[];
  cierreRealAnterior: number | null;
}) {
  const router = useRouter();
  const [textos, setTextos] = useState<Record<string, string>>(
    Object.fromEntries(campos.map((c) => [clave(c), c.valor]))
  );
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  const valorDe = (c: CampoVista): number | null => {
    const t = textos[clave(c)] ?? "";
    return t.trim() === "" ? null : (parsearCuenta(t)?.centavos ?? null);
  };

  // Ayuda de arrastre: suma de lo que entra en el total contra cierre anterior + ajustes.
  const resumen = useMemo(() => {
    const componentes = campos.filter((c) => c.componente);
    if (componentes.length === 0) return null;
    let suma = 0;
    let ajustes = 0;
    for (const c of componentes) {
      const t = textos[`${c.clave}|${c.columna}`] ?? "";
      const v = t.trim() === "" ? 0 : (parsearCuenta(t)?.centavos ?? 0);
      if (!c.componente!.enTotal) continue;
      suma += v;
      if (c.componente!.arrastre === "ajuste") ajustes += v;
    }
    const deberiaDar = cierreRealAnterior === null ? null : cierreRealAnterior + ajustes;
    return { suma, ajustes, deberiaDar, diferencia: deberiaDar === null ? null : suma - deberiaDar };
  }, [campos, textos, cierreRealAnterior]);

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    const cambiados = campos.filter((c) => !soloLectura(c) && (textos[clave(c)] ?? "") !== c.valor);
    const r = await guardarValoresManuales(
      empresaSlug,
      periodo,
      cambiados.map((c) => ({
        filaClave: c.clave,
        columna: c.columna,
        texto: textos[clave(c)] ?? "",
        ...(c.calculado === undefined ? {} : { calculadoMostrado: c.calculado }),
      }))
    );
    setGuardando(false);
    if (r.ok) {
      setMensaje({ ok: true, texto: `Guardado: ${r.guardados} valores, ${r.borrados} borrados.` });
      router.refresh();
    } else {
      setMensaje({ ok: false, texto: r.error });
    }
  }

  return (
    <div className="mt-6">
      {resumen && (
        <div className="mb-6 rounded-md border border-line-strong bg-paper-raised px-4 py-3 text-sm">
          <p className="font-medium">Arrastre de Disponibilidades</p>
          <p className="mt-1 text-ink-secondary">
            Cierre real del mes anterior: {cierreRealAnterior === null ? "—" : formatearCentavos(cierreRealAnterior)} ·
            Ajustes: {formatearCentavos(resumen.ajustes)} · Total que debería dar:{" "}
            {resumen.deberiaDar === null ? "—" : formatearCentavos(resumen.deberiaDar)}
          </p>
          <p className="mt-1">
            Suma de los componentes: {formatearCentavos(resumen.suma)}
            {resumen.diferencia !== null && (
              <span className={Math.abs(resumen.diferencia) < 100 ? "text-ink-secondary" : "text-terracota"}>
                {" "}
                · {Math.abs(resumen.diferencia) < 100 ? "cuadra" : "no cuadra"} (dif.{" "}
                {formatearCentavos(resumen.diferencia)})
              </span>
            )}
          </p>
        </div>
      )}

      {ORDEN.map((bloque) => {
        const delBloque = campos.filter((c) => c.bloque === bloque);
        if (delBloque.length === 0) return null;
        return (
          <section key={bloque} className="mb-8">
            <h2 className="text-xs font-semibold tracking-[0.15em] uppercase">{TITULOS[bloque]}</h2>
            <ul className="mt-2 divide-y divide-line-hairline border-t border-line-strong">
              {delBloque.map((c) => {
                const t = textos[clave(c)] ?? "";
                const invalido = t.trim() !== "" && parsearCuenta(t) === null;
                const desde = c.sugerenciaDesde ? campos.find((x) => x.clave === c.sugerenciaDesde) : null;
                const sugerido = desde ? valorDe(desde) : null;
                return (
                  <li key={clave(c)} className="grid grid-cols-[1fr_14rem] items-center gap-3 py-2 text-sm">
                    <div>
                      <label htmlFor={clave(c)}>{c.texto}</label>
                      {c.columna === "PRESUPUESTADO" && c.bloque !== "CIERRE" && (
                        <span className="ml-2 text-[11px] text-ink-muted">(presupuestado)</span>
                      )}
                      {c.componente && <span className="ml-2 text-[11px] text-ink-muted">{c.componente.arrastre}</span>}
                      {c.calculado !== undefined && (
                        <p className="text-[11px] text-ink-muted">
                          Total del Real (incluye {formatearCentavos(c.calculado)} calculado). Se guarda solo la diferencia.
                        </p>
                      )}
                      {c.pisaCalculado && (
                        <p className="text-[11px] text-ink-muted">
                          {c.cargado ? "Valor manual: reemplaza al calculado." : "Lo que cargues reemplaza al calculado; vacío = rige el cálculo."}
                        </p>
                      )}
                      {c.cargadoPor && (
                        <p className="text-[11px] text-ink-muted">
                          {c.cargadoPor}
                          {c.nota ? ` · cuenta: ${c.nota}` : ""}
                        </p>
                      )}
                      {c.bloqueo && (
                        <p className="text-[11px] text-terracota">
                          {soloLectura(c) ? `Bloqueado: ${c.bloqueo}` : AVISO_UNA_VEZ}
                        </p>
                      )}
                      {c.reglaCapital !== undefined && (
                        <p className="text-[11px] text-ink-muted">
                          Regla de la plantilla: {c.reglaCapital ?? "—"}. Vacío = usar la regla.
                        </p>
                      )}
                      {sugerido !== null && !soloLectura(c) && (
                        <button
                          type="button"
                          className="text-[11px] underline"
                          onClick={() => setTextos((p) => ({ ...p, [clave(c)]: formatearCentavos(-sugerido) }))}
                        >
                          usar −reserva de Disponibilidades ({formatearCentavos(-sugerido)})
                        </button>
                      )}
                    </div>
                    <input
                      id={clave(c)}
                      type="text"
                      inputMode="decimal"
                      value={t}
                      readOnly={soloLectura(c)}
                      disabled={soloLectura(c)}
                      onChange={(e) => setTextos((p) => ({ ...p, [clave(c)]: e.target.value }))}
                      className={`rounded-md border px-2 py-1 text-right tabular ${invalido ? "border-terracota" : "border-line-strong"} disabled:bg-paper-cool`}
                      aria-invalid={invalido}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="rounded-md bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        {mensaje && <p className={`text-sm ${mensaje.ok ? "text-ink-secondary" : "text-terracota"}`}>{mensaje.texto}</p>}
      </div>
    </div>
  );
}
