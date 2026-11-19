"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { crearUsuario, type ResultadoCrear } from "../actions";
import EmpresasYPermisos from "../EmpresasYPermisos";
import BotonCopiar from "@/components/BotonCopiar";

type Empresa = { id: string; nombre: string };

const ESTADO_INICIAL: ResultadoCrear | null = null;

export default function NuevoUsuarioForm({ empresas }: { empresas: Empresa[] }) {
  const [estado, formAction, pendiente] = useActionState(crearUsuario, ESTADO_INICIAL);
  const [rol, setRol] = useState("GERENTE");

  const erroresCampo = estado && !estado.ok ? estado.errores : {};

  if (estado?.ok) {
    return (
      <div className="mx-auto w-full max-w-lg px-6 py-14">
        <h1 className="text-3xl font-serif font-semibold tracking-tight mb-4">Usuario creado</h1>
        <p className="text-sm bg-marino-tint text-marino rounded-md px-3 py-2 mb-2">
          Contraseña temporal: <span className="font-mono font-semibold">{estado.passwordTemporal}</span>
          <BotonCopiar texto={estado.passwordTemporal} />
        </p>
        <p className="text-xs text-ink-muted mb-6">
          Copiala y compartísela por fuera del sistema — no se va a volver a mostrar. El usuario va
          a tener que definir su propia contraseña la primera vez que entre.
        </p>
        {estado.advertencia && (
          <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2 mb-6">
            {estado.advertencia}
          </p>
        )}
        <Link href="/admin/usuarios" className="text-sm text-marino underline underline-offset-2">
          Volver al listado
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-14">
      <h1 className="text-3xl font-serif font-semibold tracking-tight mb-8">Nuevo usuario</h1>

      <form action={formAction} className="space-y-5">
        <div>
          <label htmlFor="nombre" className="block text-sm text-ink-secondary mb-1.5">
            Nombre
          </label>
          <input
            id="nombre"
            name="nombre"
            className={`w-full h-11 rounded-md border bg-paper px-3.5 text-sm outline-none focus:ring-2 focus:ring-marino/15 ${
              erroresCampo.nombre ? "border-terracota" : "border-line focus:border-marino"
            }`}
          />
          {erroresCampo.nombre && <p className="mt-1 text-xs text-terracota">{erroresCampo.nombre}</p>}
        </div>

        <div>
          <label htmlFor="email" className="block text-sm text-ink-secondary mb-1.5">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={`w-full h-11 rounded-md border bg-paper px-3.5 text-sm outline-none focus:ring-2 focus:ring-marino/15 ${
              erroresCampo.email ? "border-terracota" : "border-line focus:border-marino"
            }`}
          />
          {erroresCampo.email && <p className="mt-1 text-xs text-terracota">{erroresCampo.email}</p>}
        </div>

        <div>
          <label htmlFor="rol" className="block text-sm text-ink-secondary mb-1.5">
            Rol
          </label>
          <select
            id="rol"
            name="rol"
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            className="w-full h-11 rounded-md border border-line bg-paper px-3.5 text-sm outline-none focus:border-marino focus:ring-2 focus:ring-marino/15"
          >
            <option value="GERENTE">GERENTE</option>
            <option value="FINANZAS">FINANZAS</option>
            <option value="ADMIN">ADMIN</option>
            <option value="VIEWER">VIEWER (solo lectura)</option>
          </select>
          {erroresCampo.rol && <p className="mt-1 text-xs text-terracota">{erroresCampo.rol}</p>}
        </div>

        {rol !== "ADMIN" && <EmpresasYPermisos empresas={empresas} soloLectura={rol === "VIEWER"} />}

        {rol === "VIEWER" && (
          <div>
            <input type="hidden" name="veBloquesReservadosIncluida" value="1" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="veBloquesReservados" />
              Ve los bloques reservados del Reporte (Disponibilidades y Cierre)
            </label>
            <p className="mt-1 text-xs text-ink-muted">
              En pantalla y en el Excel, solo de las empresas que tiene asignadas. Sigue siendo solo lectura. Sin esta casilla no los ve.
            </p>
          </div>
        )}

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={pendiente}
            className="h-11 px-5 rounded-md bg-marino text-white text-sm font-medium hover:bg-marino-dark transition disabled:opacity-60"
          >
            {pendiente ? "Creando..." : "Crear usuario"}
          </button>
          <Link href="/admin/usuarios" className="text-sm text-ink-secondary underline underline-offset-2">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
