"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { guardarDesgloseMovimiento, eliminarDesgloseMovimiento } from "./actions";
import CampoImporte from "@/components/CampoImporte";
import { mensajeDeImporte } from "@/lib/importes";
import { prefijoMoneda } from "@/lib/moneda";
import { opcionesUnidad } from "@/lib/unidadesNegocio";
import {
  CIEN_POR_CIENTO,
  aCentavos,
  parsearMontoACentavos,
  parsearPorcentaje,
  repartirPorPorcentajes,
  porcentajeDeCentavos,
  partesIguales,
  formatearCentavos,
  formatearPorcentaje,
} from "@/lib/prorrateo";

type Modo = "porcentaje" | "monto";
// Texto tal cual lo tipeó el usuario en cada columna — solo la del modo activo
// es editable; la otra se deriva (ver `calculo` abajo) y se muestra al lado.
type Linea = { unidadNegocio: string; porcentaje: string; monto: string };

type Props = {
  numeroSemana: number;
  movimientoId: string;
  importeMovimiento: number;
  // Moneda del movimiento (código ISO); sin dato es pesos.
  moneda?: string;
  desgloseInicial: { id: string; unidadNegocio: string; importe: number }[];
  onCerrar: () => void;
};

const LINEA_VACIA: Linea = { unidadNegocio: "", porcentaje: "", monto: "" };

// Prorrateo de un movimiento entre varias unidades de negocio (pedido de Kike,
// 2026-10-06): se carga por PORCENTAJE o por MONTO (selector general) y siempre
// se ven las dos columnas. Toda la cuenta va en centavos/centésimas enteros
// (lib/prorrateo.ts) para que la suma dé EXACTO el importe del movimiento; al
// server viaja solo el importe de cada línea, en centavos. No toca
// MovimientoBancario.unidadNegocio propio de la fila (eso se edita aparte, en el
// <select> de TablaMovimientos) — ver guardarDesgloseMovimiento.
export default function PanelDesgloseMovimiento({
  numeroSemana,
  movimientoId,
  importeMovimiento,
  moneda,
  desgloseInicial,
  onCerrar,
}: Props) {
  const simbolo = prefijoMoneda(moneda);
  const router = useRouter();
  const { periodo: periodoUrl } = useParams<{ periodo: string }>();

  const total = aCentavos(importeMovimiento);
  const unidadesDisponibles = opcionesUnidad(desgloseInicial.map((d) => d.unidadNegocio));

  // Un desglose ya guardado se reabre en modo monto: es el dato exacto que está
  // en la base (el % derivado puede estar redondeado). Uno nuevo arranca en %.
  const [modo, setModo] = useState<Modo>(desgloseInicial.length > 0 ? "monto" : "porcentaje");
  const [lineas, setLineas] = useState<Linea[]>(
    desgloseInicial.length > 0
      ? desgloseInicial.map((d) => {
          const centavos = aCentavos(d.importe);
          return {
            unidadNegocio: d.unidadNegocio,
            monto: formatearCentavos(centavos),
            porcentaje: formatearPorcentaje(porcentajeDeCentavos(centavos, total)),
          };
        })
      : [{ ...LINEA_VACIA }, { ...LINEA_VACIA }]
  );
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [quitando, setQuitando] = useState(false);

  // En modo %: los montos salen de repartirPorPorcentajes (mayor resto → suman
  // exacto si los % suman 100). En modo $: los % se derivan solo para mostrar.
  // `valido[i]`: la columna activa de esa línea tiene un número > 0.
  const calculo = (() => {
    if (modo === "porcentaje") {
      const leidos = lineas.map((l) => parsearPorcentaje(l.porcentaje));
      const porcentajes = leidos.map((p) => p ?? 0);
      const montos = repartirPorPorcentajes(total, porcentajes);
      const sumaPorcentajes = porcentajes.reduce((a, p) => a + p, 0);
      return {
        porcentajes,
        montos,
        valido: leidos.map((p) => p !== null && p > 0),
        cierra: sumaPorcentajes === CIEN_POR_CIENTO,
        diferencia: CIEN_POR_CIENTO - sumaPorcentajes,
      };
    }
    const leidos = lineas.map((l) => parsearMontoACentavos(l.monto));
    const montos = leidos.map((m) => m ?? 0);
    const sumaMontos = montos.reduce((a, m) => a + m, 0);
    return {
      porcentajes: montos.map((m) => porcentajeDeCentavos(m, total)),
      montos,
      valido: leidos.map((m) => m !== null && m > 0),
      cierra: sumaMontos === total,
      diferencia: total - sumaMontos,
    };
  })();

  const sumaMontos = calculo.montos.reduce((a, m) => a + m, 0);
  const unidadesElegidas = lineas.map((l) => l.unidadNegocio);
  const repetida = (i: number) =>
    lineas[i].unidadNegocio !== "" && unidadesElegidas.indexOf(lineas[i].unidadNegocio) !== i;
  const puedeGuardar =
    total > 0 &&
    lineas.length >= 2 &&
    calculo.cierra &&
    calculo.valido.every(Boolean) &&
    lineas.every((l, i) => l.unidadNegocio !== "" && !repetida(i));

  function actualizarLinea(i: number, campo: keyof Linea, valor: string) {
    setLineas((prev) => prev.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));
    setErrores((prev) => {
      const clave = campo === "unidadNegocio" ? `unidadNegocio_${i}` : `importe_${i}`;
      const { [clave]: _omitido, general: _g, ...resto } = prev;
      return resto;
    });
  }

  // Al cambiar de modo, la columna que pasa a ser editable arranca con lo que se
  // venía viendo derivado — así no se pierde lo cargado.
  function cambiarModo(nuevo: Modo) {
    if (nuevo === modo) return;
    setLineas((prev) =>
      prev.map((l, i) =>
        nuevo === "monto"
          ? { ...l, monto: calculo.valido[i] ? formatearCentavos(calculo.montos[i]) : "" }
          : {
              ...l,
              porcentaje: calculo.valido[i] ? formatearPorcentaje(calculo.porcentajes[i]) : "",
            }
      )
    );
    setModo(nuevo);
    setErrores({});
  }

  function repartirEnPartesIguales() {
    const partes = partesIguales(modo === "porcentaje" ? CIEN_POR_CIENTO : total, lineas.length);
    setLineas((prev) =>
      prev.map((l, i) =>
        modo === "porcentaje"
          ? { ...l, porcentaje: formatearPorcentaje(partes[i]) }
          : { ...l, monto: formatearCentavos(partes[i]) }
      )
    );
    setErrores({});
  }

  // Lo que falta para cerrar, cargado en esta línea (en la columna activa).
  function completarResto(i: number) {
    const otras = (modo === "porcentaje" ? calculo.porcentajes : calculo.montos).reduce(
      (a, v, idx) => (idx === i ? a : a + v),
      0
    );
    const resto = (modo === "porcentaje" ? CIEN_POR_CIENTO : total) - otras;
    if (resto <= 0) return;
    actualizarLinea(
      i,
      modo === "porcentaje" ? "porcentaje" : "monto",
      modo === "porcentaje" ? formatearPorcentaje(resto) : formatearCentavos(resto)
    );
  }

  function agregarLinea() {
    setLineas((prev) => [...prev, { ...LINEA_VACIA }]);
  }

  function quitarLinea(i: number) {
    setLineas((prev) => prev.filter((_, idx) => idx !== i));
    setErrores({});
  }

  async function guardar() {
    setGuardando(true);
    setErrores({});

    const resultado = await guardarDesgloseMovimiento(
      periodoUrl,
      numeroSemana,
      movimientoId,
      lineas.map((l, i) => ({ unidadNegocio: l.unidadNegocio, importeCentavos: calculo.montos[i] }))
    );

    if (!resultado.ok) {
      setErrores(resultado.errores);
      setGuardando(false);
      return;
    }

    setGuardando(false);
    router.refresh();
    onCerrar();
  }

  async function quitarProrrateo() {
    setQuitando(true);
    await eliminarDesgloseMovimiento(periodoUrl, numeroSemana, movimientoId);
    setQuitando(false);
    router.refresh();
    onCerrar();
  }

  const textoDiferencia =
    modo === "porcentaje"
      ? `${calculo.diferencia > 0 ? "Falta" : "Sobra"} ${formatearPorcentaje(Math.abs(calculo.diferencia))}%`
      : `${calculo.diferencia > 0 ? "Falta" : "Sobra"} ${simbolo}${formatearCentavos(Math.abs(calculo.diferencia))}`;

  return (
    <div className="rounded-md border border-line-strong border-l-4 border-l-marino bg-paper-cool px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink">
          Prorrateo por unidad de negocio{" "}
          <span className="font-normal text-ink-muted">· {simbolo}{formatearCentavos(total)}</span>
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-muted">Cargar por</span>
          <div className="inline-flex rounded-md border border-line p-0.5">
            {(["porcentaje", "monto"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => cambiarModo(m)}
                className={`px-2.5 py-1 rounded font-medium transition ${
                  modo === m ? "bg-marino-tint text-marino" : "text-ink-secondary hover:text-ink"
                }`}
              >
                {m === "porcentaje" ? "%" : "$"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {total === 0 && (
        <p className="mb-3 text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          Un movimiento de $0 no se puede prorratear.
        </p>
      )}

      {errores.general && (
        <p className="mb-3 text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
          {errores.general}
        </p>
      )}

      <div className="space-y-2.5">
        {lineas.map((l, i) => {
          const errorUnidad = errores[`unidadNegocio_${i}`] ?? (repetida(i) ? "Esta unidad ya está en otra línea." : "");
          const errorImporte = errores[`importe_${i}`];
          return (
            <div key={i} className="flex items-start gap-2.5">
              <div className="flex-1">
                <select
                  value={l.unidadNegocio}
                  onChange={(e) => actualizarLinea(i, "unidadNegocio", e.target.value)}
                  className={`w-full h-10 rounded-md border bg-paper px-3 text-sm outline-none focus:ring-2 focus:ring-marino/15 ${
                    errorUnidad ? "border-terracota" : "border-line focus:border-marino"
                  }`}
                >
                  <option value="">Unidad de negocio…</option>
                  {unidadesDisponibles.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                {errorUnidad && <p className="mt-1 text-xs text-terracota">{errorUnidad}</p>}
              </div>

              <div className="w-28">
                {modo === "porcentaje" ? (
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={l.porcentaje}
                      onChange={(e) => actualizarLinea(i, "porcentaje", e.target.value)}
                      placeholder="0"
                      className={`w-full h-10 rounded-md border bg-paper pl-3 pr-7 text-sm tabular outline-none focus:ring-2 focus:ring-marino/15 ${
                        errorImporte || (l.porcentaje && !calculo.valido[i])
                          ? "border-terracota"
                          : "border-line focus:border-marino"
                      }`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">
                      %
                    </span>
                  </div>
                ) : (
                  <p className="flex h-10 items-center justify-end pr-1 text-sm tabular text-ink-muted">
                    {calculo.valido[i] ? `${formatearPorcentaje(calculo.porcentajes[i])}%` : "—"}
                  </p>
                )}
              </div>

              <div className="w-40">
                {modo === "monto" ? (
                  <CampoImporte
                    value={l.monto}
                    onChange={(valor) => actualizarLinea(i, "monto", valor)}
                    hasError={Boolean(errorImporte) || (l.monto !== "" && !calculo.valido[i])}
                  />
                ) : (
                  <p className="flex h-10 items-center justify-end pr-1 text-sm tabular text-ink-muted">
                    {calculo.valido[i] ? `${simbolo}${formatearCentavos(calculo.montos[i])}` : "—"}
                  </p>
                )}
                {errorImporte && <p className="mt-1 text-xs text-terracota">{errorImporte}</p>}
                {!errorImporte && modo === "monto" && mensajeDeImporte(l.monto) && (
                  <p className="mt-1 text-xs text-terracota">{mensajeDeImporte(l.monto)}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => completarResto(i)}
                disabled={calculo.cierra}
                title="Cargar en esta línea lo que falta para cerrar"
                className="h-10 px-1 text-xs text-marino hover:text-marino-dark transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Resto
              </button>
              <button
                type="button"
                onClick={() => quitarLinea(i)}
                disabled={lineas.length <= 2}
                className="h-10 px-1 text-xs text-ink-muted hover:text-terracota transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Quitar
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-4 text-sm">
        <button
          type="button"
          onClick={agregarLinea}
          className="text-marino hover:text-marino-dark underline underline-offset-2"
        >
          + Agregar unidad de negocio
        </button>
        <button
          type="button"
          onClick={repartirEnPartesIguales}
          className="text-marino hover:text-marino-dark underline underline-offset-2"
        >
          Partes iguales
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-xs">
          <span className="text-ink-muted">Repartido: </span>
          <span className="tabular font-medium text-ink">
            {simbolo}{formatearCentavos(sumaMontos)} ({formatearPorcentaje(porcentajeDeCentavos(sumaMontos, total))}%)
          </span>
          <span className="text-ink-muted"> de {simbolo}{formatearCentavos(total)}</span>
          {calculo.cierra ? (
            <span className="ml-2 font-medium text-verde">✓ Cierra exacto</span>
          ) : (
            <span className="ml-2 text-terracota">{textoDiferencia}</span>
          )}
        </span>

        <div className="flex items-center gap-3">
          {desgloseInicial.length > 0 && (
            <button
              type="button"
              onClick={quitarProrrateo}
              disabled={quitando || guardando}
              className="text-xs text-ink-muted hover:text-terracota transition disabled:opacity-50"
            >
              {quitando ? "Quitando..." : "Quitar prorrateo"}
            </button>
          )}
          <button
            type="button"
            onClick={onCerrar}
            className="h-9 px-3 rounded-md text-sm text-ink-secondary hover:text-ink transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={!puedeGuardar || guardando}
            className="h-9 px-4 rounded-md bg-marino text-white text-sm font-medium hover:bg-marino-dark transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {guardando ? "Guardando..." : "Guardar prorrateo"}
          </button>
        </div>
      </div>
    </div>
  );
}
