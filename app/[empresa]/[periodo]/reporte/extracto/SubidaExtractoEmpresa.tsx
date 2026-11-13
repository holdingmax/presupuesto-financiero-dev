"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { subirExtractoEmpresa, type PestanaCandidataVista, type ResultadoExtractoEmpresa } from "@/app/ejecucion/actionsExtractoEmpresa";
import type { ControlPieMoneda } from "@/lib/extractos/havannaPeru";
import { NOMBRE_ESTADO_PIE, puedeConfirmarVistaPrevia } from "@/lib/extractos/pantallaExtractoEmpresa";
import { formatearImporteConCentavos } from "@/app/ejecucion/formato";

type Vista = Extract<ResultadoExtractoEmpresa, { requiereVistaPrevia: true }>["vista"];

type Props = {
  empresaId: string;
  periodo: string;
  semanasAbiertas: number[];
  semanaPorDefecto: number | null;
  // Extensiones que acepta el selector de archivo (".xlsx"; Bradenton también ".csv"; Plate Silver ".xls").
  acepta?: string;
  // Se pueden elegir varios archivos (Perú: tramos del histórico del BBVA).
  varios?: boolean;
};

const BOTON =
  "inline-flex h-9 items-center rounded-md bg-marino px-4 text-sm font-medium text-white transition hover:bg-marino-dark disabled:cursor-not-allowed disabled:opacity-50";
const CAMPO = "h-9 px-2 rounded-md border border-line bg-paper text-sm text-ink focus:outline-none focus:border-marino";

const plata = (centavos: number | null) => (centavos === null ? "—" : formatearImporteConCentavos(centavos / 100));

const NOMBRE_MONEDA: Record<string, string> = { PEN: "Soles", USD: "Dólares", UYU: "Pesos uruguayos" };

// Extracto SIN saldo (BROU): no hay saldo inicial ni final contra qué cuadrar. Se muestran la cantidad de filas y los
// totales de débito y crédito del archivo para compararlos a ojo con los del banco.
function TablaControlSinSaldo({ control }: { control: ControlPieMoneda[] }) {
  return (
    <>
      <p className="mt-1 text-xs">El archivo no trae saldo: comparalo con los totales de débito y crédito que muestra el banco.</p>
      <table className="mt-2 w-full text-xs tabular">
        <thead>
          <tr className="text-left text-ink-secondary">
            <th className="py-1 pr-3 font-medium">Moneda</th>
            <th className="py-1 pr-3 text-right font-medium">Movimientos</th>
            <th className="py-1 pr-3 text-right font-medium">Débitos</th>
            <th className="py-1 pr-3 text-right font-medium">Créditos</th>
            <th className="py-1 pr-3 text-right font-medium">Neto</th>
            <th className="py-1 font-medium">Fechas</th>
          </tr>
        </thead>
        <tbody>
          {control.map((c) => (
            <tr key={c.moneda} className="border-t border-line">
              <td className="py-1 pr-3">{NOMBRE_MONEDA[c.moneda] ?? c.moneda}</td>
              <td className="py-1 pr-3 text-right">{c.cantidad}</td>
              <td className="py-1 pr-3 text-right">{plata(c.debitoCentavos ?? 0)}</td>
              <td className="py-1 pr-3 text-right">{plata(c.creditoCentavos ?? 0)}</td>
              <td className="py-1 pr-3 text-right">{plata(c.movimientosCentavos)}</td>
              <td className="py-1">
                {c.desde} a {c.hasta}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function TablaControl({ control }: { control: ControlPieMoneda[] }) {
  if (control.length > 0 && control.every((c) => c.cantidad !== undefined)) return <TablaControlSinSaldo control={control} />;
  return (
    <table className="mt-2 w-full text-xs tabular">
      <thead>
        <tr className="text-left text-ink-secondary">
          <th className="py-1 pr-3 font-medium">Moneda</th>
          <th className="py-1 pr-3 text-right font-medium">Saldo inicial</th>
          <th className="py-1 pr-3 text-right font-medium">Movimientos</th>
          <th className="py-1 pr-3 text-right font-medium">Saldo final del archivo</th>
          <th className="py-1 font-medium">Control</th>
        </tr>
      </thead>
      <tbody>
        {control.map((c) => (
          <tr key={c.moneda} className="border-t border-line">
            <td className="py-1 pr-3">{NOMBRE_MONEDA[c.moneda] ?? c.moneda}</td>
            <td className="py-1 pr-3 text-right">{plata(c.inicialCentavos)}</td>
            <td className="py-1 pr-3 text-right">{plata(c.movimientosCentavos)}</td>
            <td className="py-1 pr-3 text-right">{plata(c.finalCentavos)}</td>
            <td className={`py-1 font-medium ${c.estado === "no_cuadra" ? "text-terracota" : ""}`}>
              {NOMBRE_ESTADO_PIE[c.estado]}
              {c.estado === "no_cuadra" && c.diferenciaCentavos !== null ? ` (diferencia ${plata(c.diferenciaCentavos)})` : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Elegir archivo → (selector de pestaña si hace falta) → resumen → Confirmar. Nada se carga hasta Confirmar, y con
// errores (pie que no cuadra incluido) no hay botón. Lo que decide es el servidor (subirExtractoEmpresa).
export default function SubidaExtractoEmpresa({ empresaId, periodo, semanasAbiertas, semanaPorDefecto, acepta = ".xlsx", varios = false }: Props) {
  const router = useRouter();
  const [archivos, setArchivos] = useState<File[]>([]);
  const [semana, setSemana] = useState<number | null>(semanaPorDefecto);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<{ texto: string; control?: ControlPieMoneda[] } | null>(null);
  const [candidatas, setCandidatas] = useState<{ motivo: string; lista: PestanaCandidataVista[] } | null>(null);
  const [pestana, setPestana] = useState<string | undefined>(undefined);
  const [vista, setVista] = useState<Vista | null>(null);
  const [exito, setExito] = useState<{ texto: string; avisos: string[]; control: ControlPieMoneda[] } | null>(null);

  function limpiar() {
    setError(null);
    setCandidatas(null);
    setVista(null);
    setExito(null);
  }

  async function enviar(pestanaElegida: string | undefined, confirmar: boolean) {
    if (archivos.length === 0 || semana === null) return;
    setOcupado(true);
    setError(null);
    if (!confirmar) {
      setCandidatas(null);
      setVista(null);
    }
    try {
      const fd = new FormData();
      for (const a of archivos) fd.append("archivo", a);
      const r = await subirExtractoEmpresa(empresaId, periodo, semana, fd, {
        pestana: pestanaElegida,
        confirmarVistaPrevia: confirmar,
      });
      if (r.ok) {
        setVista(null);
        setCandidatas(null);
        setExito({
          texto:
            r.filasNuevas === 0
              ? `No se cargó nada nuevo: las ${r.filasYaCargadas} filas de la pestaña "${r.pestana}" ya estaban cargadas.`
              : `Listo: se cargaron ${r.filasNuevas} movimientos nuevos de la pestaña "${r.pestana}" (${r.filasYaCargadas} ya estaban cargados).`,
          avisos: r.avisos,
          control: r.control,
        });
        router.refresh();
      } else if ("requierePestana" in r) {
        setCandidatas({ motivo: r.motivo, lista: r.candidatas });
      } else if ("requiereVistaPrevia" in r) {
        setVista(r.vista);
      } else {
        setError({ texto: r.error, control: r.control });
      }
    } catch {
      setError({ texto: "No pude subir el archivo. Probá de nuevo; si sigue igual, avisale a Finanzas." });
    } finally {
      setOcupado(false);
    }
  }

  if (semanaPorDefecto === null) {
    return (
      <p className="mt-6 rounded-md bg-terracota-tint px-3 py-2 text-sm text-terracota">
        Este período no tiene una semana abierta, así que no hay dónde cargar el extracto. La semana la abre Finanzas desde
        Ejecución.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-secondary">Archivo ({acepta.replace(/,/g, " o ")})</span>
          <input
            type="file"
            accept={acepta}
            multiple={varios}
            disabled={ocupado}
            onChange={(e) => {
              setArchivos(Array.from(e.target.files ?? []));
              setPestana(undefined);
              limpiar();
            }}
            className="text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-secondary">Semana del período {periodo}</span>
          <select
            value={semana ?? ""}
            disabled={ocupado}
            onChange={(e) => {
              setSemana(Number(e.target.value));
              limpiar();
            }}
            className={CAMPO}
          >
            {semanasAbiertas.map((n) => (
              <option key={n} value={n}>
                Semana {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={BOTON} disabled={archivos.length === 0 || ocupado} onClick={() => enviar(pestana, false)}>
          {ocupado ? "Leyendo…" : "Ver resumen"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-terracota bg-terracota-tint px-3 py-3 text-sm text-terracota" role="alert">
          <p className="font-medium">No se cargó nada.</p>
          <p className="mt-1">{error.texto}</p>
          {error.control && error.control.length > 0 && <TablaControl control={error.control} />}
        </div>
      )}

      {candidatas && (
        <div className="rounded-md bg-marino-tint px-3 py-3 text-sm text-marino">
          <p className="font-medium">
            {candidatas.lista.length === 0
              ? "No encontré ninguna pestaña de movimientos en el archivo."
              : candidatas.motivo === "varias_en_periodo"
                ? "Hay más de una pestaña con fechas de este mes. Elegí cuál cargar:"
                : `Ninguna pestaña tiene todas sus fechas dentro de ${periodo}. Si es la que corresponde, elegila:`}
          </p>
          <ul className="mt-2 space-y-1">
            {candidatas.lista.map((c) => (
              <li key={c.nombre}>
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input type="radio" name="pestana" checked={pestana === c.nombre} onChange={() => setPestana(c.nombre)} />
                  <span className="font-medium">{c.nombre}</span>
                  <span>
                    · {c.desde} a {c.hasta} · {c.filas} filas
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {candidatas.lista.length > 0 && (
            <button type="button" className={`${BOTON} mt-3`} disabled={!pestana || ocupado} onClick={() => enviar(pestana, false)}>
              Ver resumen de esa pestaña
            </button>
          )}
        </div>
      )}

      {vista && (
        <div className="rounded-md bg-marino-tint px-3 py-3 text-sm text-marino">
          <p className="font-medium">Todavía no se cargó nada: revisá el resumen y recién ahí confirmá.</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs tabular">
            <dt>Pestaña</dt>
            <dd>{vista.pestana}</dd>
            {vista.detalleArchivos?.map((d) => (
              <div key={d} className="contents">
                <dt>Archivo</dt>
                <dd>{d}</dd>
              </div>
            ))}
            <dt>Fechas del archivo</dt>
            <dd>
              {vista.desde} a {vista.hasta}
            </dd>
            <dt>Movimientos</dt>
            <dd>
              {vista.filas} ({vista.nuevas} nuevos, {vista.yaCargadas} ya cargados)
            </dd>
            {vista.porCuenta.map((c) => (
              <div key={c.cuenta} className="contents">
                <dt>{c.cuenta}</dt>
                <dd>
                  {c.filas} filas · {c.nuevas} nuevas
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs font-medium">
            {vista.control.every((c) => c.cantidad !== undefined) ? "Control del archivo" : "Control contra el pie del archivo"}
          </p>
          <TablaControl control={vista.control} />
          {vista.avisos.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {vista.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className={`${BOTON} mt-3`}
            disabled={ocupado || !puedeConfirmarVistaPrevia(vista)}
            onClick={() => enviar(vista.pestana, true)}
          >
            {ocupado ? "Cargando…" : `Confirmar y cargar ${vista.nuevas} movimientos`}
          </button>
        </div>
      )}

      {exito && (
        <div className="rounded-md bg-marino-tint px-3 py-3 text-sm text-marino" role="status">
          <p className="font-medium">{exito.texto}</p>
          {exito.avisos.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {exito.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <TablaControl control={exito.control} />
        </div>
      )}
    </div>
  );
}
