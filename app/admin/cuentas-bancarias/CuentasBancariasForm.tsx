"use client";

import { useState } from "react";
import Link from "next/link";
import { BANCOS_CUENTA, NOMBRE_BANCO_CUENTA } from "@/lib/extractos/bancosCuenta";
import {
  cambiarEstadoCuentaBancaria,
  crearCuentaBancaria,
  editarCuentaBancaria,
  type CuentaDto,
} from "./actions";

type Empresa = { id: string; nombre: string };

type Props = { cuentasIniciales: CuentaDto[]; empresas: Empresa[] };

// titular: id de la empresa titular, "" = sin titular.
type Borrador = { nombre: string; banco: string; terminacion: string; titular: string };
const BORRADOR_VACIO: Borrador = { nombre: "", banco: "MACRO", terminacion: "", titular: "" };

const campo =
  "h-9 px-2 rounded-md border border-line bg-paper text-sm text-ink focus:outline-none focus:border-marino";

// Ejecución global (plan §3.2): las cuentas son del holding, un solo listado sin agrupar por
// empresa. La empresa es solo la TITULAR (opcional): se usa para avisar si el CUIT del archivo no
// coincide. El nombre es único en todo el holding. Las reglas las vuelve a validar el servidor
// (lib/cuentasBancarias.ts); acá solo se ayuda a tipear.
export default function CuentasBancariasForm({ cuentasIniciales, empresas }: Props) {
  const [cuentas, setCuentas] = useState(cuentasIniciales);
  const [nueva, setNueva] = useState<Borrador>(BORRADOR_VACIO);
  const [editando, setEditando] = useState<{ id: string; borrador: Borrador } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string; reactivarId?: string } | null>(null);

  const nombreEmpresa = (id: string | null) => empresas.find((e) => e.id === id)?.nombre ?? null;

  function reemplazar(cuenta: CuentaDto) {
    setCuentas((prev) =>
      prev.some((c) => c.id === cuenta.id) ? prev.map((c) => (c.id === cuenta.id ? cuenta : c)) : [...prev, cuenta]
    );
  }

  function avisar(ok: boolean, texto: string, reactivarId?: string) {
    setMensaje({ ok, texto, reactivarId });
  }

  async function agregar() {
    setOcupado(true);
    const r = await crearCuentaBancaria(nueva.titular || null, nueva);
    setOcupado(false);
    if (!r.ok) return avisar(false, r.error, r.reactivarId);
    reemplazar(r.cuenta);
    setNueva(BORRADOR_VACIO);
    avisar(true, ["Cuenta agregada.", ...r.avisos].join(" "));
  }

  async function guardarEdicion(cuenta: CuentaDto) {
    if (!editando) return;
    const cambioNombre = editando.borrador.nombre.trim().toUpperCase() !== cuenta.nombre;
    if (
      cambioNombre &&
      !window.confirm(
        "Cambiar el nombre NO modifica los movimientos ya cargados: siguen guardados con el nombre anterior. ¿Continuar?"
      )
    ) {
      return;
    }
    setOcupado(true);
    const r = await editarCuentaBancaria(cuenta.id, editando.borrador, editando.borrador.titular || null);
    setOcupado(false);
    if (!r.ok) return avisar(false, r.error);
    reemplazar(r.cuenta);
    setEditando(null);
    avisar(true, ["Cuenta guardada.", ...r.avisos].join(" "));
  }

  async function cambiarEstado(cuenta: CuentaDto, activa: boolean) {
    setOcupado(true);
    const r = await cambiarEstadoCuentaBancaria(cuenta.id, activa);
    setOcupado(false);
    if (!r.ok) return avisar(false, r.error);
    reemplazar(r.cuenta);
    avisar(true, activa ? "Cuenta reactivada." : "Cuenta desactivada (no se borra).");
  }

  const ordenadas = [...cuentas].sort(
    (a, b) => Number(b.activa) - Number(a.activa) || a.nombre.localeCompare(b.nombre, "es")
  );

  const selectorTitular = (valor: string, onChange: (v: string) => void) => (
    <select value={valor} onChange={(e) => onChange(e.target.value)} className={campo} aria-label="Titular">
      <option value="">Sin titular</option>
      {empresas.map((e) => (
        <option key={e.id} value={e.id}>
          {e.nombre}
        </option>
      ))}
    </select>
  );

  const selectorBanco = (valor: string, onChange: (v: string) => void) => (
    <select value={valor} onChange={(e) => onChange(e.target.value)} className={campo} aria-label="Banco">
      {BANCOS_CUENTA.map((b) => (
        <option key={b} value={b}>
          {b} · {NOMBRE_BANCO_CUENTA[b]}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-14">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs tracking-[0.15em] text-ink-secondary uppercase mb-1">
            <span className="w-2 h-2 bg-plata" />
            Administración
          </p>
          <h1 className="text-4xl font-serif font-semibold tracking-tight">Cuentas bancarias</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            Las cuentas del holding para elegir al subir un extracto crudo del banco. El nombre es el mismo que usa el
            archivo madre (MACRO 599, GALICIA 731, FRANCES 891, BSE 560, BNA 241, SANT 099) y no se puede repetir. La
            titular es opcional: solo sirve para avisar si el CUIT del archivo no coincide; la unidad de cada
            movimiento sale de la cuenta, no de la titular. Las cuentas no se borran: se desactivan.
          </p>
        </div>
        <Link href="/" className="text-sm text-ink-secondary underline underline-offset-2 hover:text-ink">
          Volver
        </Link>
      </div>

      <div className="rounded-md border border-line-strong bg-paper-raised px-5 py-4">
        {ordenadas.length === 0 ? (
          <p className="text-xs text-ink-muted">Todavía no hay cuentas cargadas.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="pb-2 font-medium">Cuenta</th>
                <th className="pb-2 font-medium">Banco</th>
                <th className="pb-2 font-medium">Termina en</th>
                <th className="pb-2 font-medium">Titular</th>
                <th className="pb-2 font-medium">Estado</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-hairline">
              {ordenadas.map((c) => {
                const enEdicion = editando?.id === c.id;
                return enEdicion ? (
                  <tr key={c.id}>
                    <td colSpan={6} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={editando.borrador.nombre}
                          onChange={(e) =>
                            setEditando({ id: c.id, borrador: { ...editando.borrador, nombre: e.target.value } })
                          }
                          className={`${campo} w-36`}
                          aria-label="Nombre"
                        />
                        {selectorBanco(editando.borrador.banco, (v) =>
                          setEditando({ id: c.id, borrador: { ...editando.borrador, banco: v } })
                        )}
                        <input
                          value={editando.borrador.terminacion}
                          onChange={(e) =>
                            setEditando({
                              id: c.id,
                              borrador: { ...editando.borrador, terminacion: e.target.value.replace(/\D/g, "") },
                            })
                          }
                          inputMode="numeric"
                          className={`${campo} w-24`}
                          aria-label="Terminación"
                        />
                        {selectorTitular(editando.borrador.titular, (v) =>
                          setEditando({ id: c.id, borrador: { ...editando.borrador, titular: v } })
                        )}
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => guardarEdicion(c)}
                          className="h-8 px-3 rounded-md bg-marino text-white text-xs font-medium hover:bg-marino-dark disabled:opacity-40"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditando(null)}
                          className="h-8 px-3 rounded-md border border-line text-xs text-ink-secondary hover:border-line-strong"
                        >
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} className={c.activa ? "" : "opacity-50"}>
                    <td className="py-2 font-medium">{c.nombre}</td>
                    <td className="py-2 text-xs text-ink-muted">
                      {NOMBRE_BANCO_CUENTA[c.banco as keyof typeof NOMBRE_BANCO_CUENTA] ?? c.banco}
                    </td>
                    <td className="py-2 text-xs text-ink-muted">{c.terminacion}</td>
                    <td className="py-2 text-xs text-ink-secondary">{nombreEmpresa(c.empresaId) ?? "—"}</td>
                    <td className="py-2 text-xs text-ink-muted">{c.activa ? "activa" : "inactiva"}</td>
                    <td className="py-2">
                      <div className="flex justify-end gap-3 text-xs">
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() =>
                            setEditando({
                              id: c.id,
                              borrador: {
                                nombre: c.nombre,
                                banco: c.banco,
                                terminacion: c.terminacion,
                                titular: c.empresaId ?? "",
                              },
                            })
                          }
                          className="text-ink-secondary underline underline-offset-2 hover:text-ink"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => cambiarEstado(c, !c.activa)}
                          className="text-ink-secondary underline underline-offset-2 hover:text-ink"
                        >
                          {c.activa ? "Desactivar" : "Reactivar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-hairline pt-3">
          <input
            value={nueva.nombre}
            onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })}
            placeholder="MACRO 599"
            className={`${campo} w-36`}
            aria-label="Nombre de la cuenta"
          />
          {selectorBanco(nueva.banco, (v) => setNueva({ ...nueva, banco: v }))}
          <input
            value={nueva.terminacion}
            onChange={(e) => setNueva({ ...nueva, terminacion: e.target.value.replace(/\D/g, "") })}
            placeholder="Terminación"
            inputMode="numeric"
            className={`${campo} w-28`}
            aria-label="Terminación"
          />
          {selectorTitular(nueva.titular, (v) => setNueva({ ...nueva, titular: v }))}
          <button
            type="button"
            disabled={ocupado}
            onClick={agregar}
            className="h-8 px-3 rounded-md bg-marino text-white text-xs font-medium hover:bg-marino-dark active:scale-[0.99] transition disabled:opacity-40"
          >
            Agregar cuenta
          </button>
        </div>

        {mensaje && (
          <p
            className={`mt-3 text-xs rounded-md px-3 py-2 ${
              mensaje.ok ? "text-marino bg-marino-tint" : "text-terracota bg-terracota-tint"
            }`}
          >
            {mensaje.texto}
            {mensaje.reactivarId && (
              <button
                type="button"
                className="ml-2 underline underline-offset-2"
                onClick={() => {
                  const c = cuentas.find((x) => x.id === mensaje.reactivarId);
                  if (c) void cambiarEstado(c, true);
                }}
              >
                Reactivar
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
