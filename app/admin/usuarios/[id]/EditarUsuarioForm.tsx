"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import { actualizarUsuario, restablecerPassword, type ResultadoActualizar } from "../actions";
import EmpresasYPermisos, { type PermisosPorEmpresa } from "../EmpresasYPermisos";
import BotonCopiar from "@/components/BotonCopiar";

type Empresa = { id: string; nombre: string };
type UsuarioInicial = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  // Permiso global de operar Ejecución (subir, clasificar, asignar). ADMIN opera siempre.
  operaEjecucion: boolean;
  // Solo VIEWER: ve los bloques reservados del Reporte (Disponibilidades y Cierre). En otro rol no se muestra y se guarda en false.
  veBloquesReservados: boolean;
  empresaIds: string[];
  // Permisos por empresa (UsuarioEmpresa) de las empresas que ya tiene.
  permisos: PermisosPorEmpresa;
};

const ESTADO_INICIAL: ResultadoActualizar | null = null;

export default function EditarUsuarioForm({
  usuario,
  empresas,
  esPropioUsuario,
}: {
  usuario: UsuarioInicial;
  empresas: Empresa[];
  esPropioUsuario: boolean;
}) {
  const actualizarUsuarioConId = actualizarUsuario.bind(null, usuario.id);
  const [estado, formAction, pendiente] = useActionState(actualizarUsuarioConId, ESTADO_INICIAL);
  const [rol, setRol] = useState(usuario.rol);

  const [passwordTemporal, setPasswordTemporal] = useState<string | null>(null);
  const [errorReset, setErrorReset] = useState("");
  const [reseteando, setReseteando] = useState(false);

  async function handleRestablecer() {
    if (!confirm(`¿Restablecer la contraseña de ${usuario.nombre}? Se van a cerrar todas sus sesiones activas.`)) {
      return;
    }
    setReseteando(true);
    setErrorReset("");
    const resultado = await restablecerPassword(usuario.id);
    setReseteando(false);
    if (!resultado.ok) {
      setErrorReset(resultado.error);
      return;
    }
    setPasswordTemporal(resultado.passwordTemporal);
  }

  // Con action={formAction} React 19 resetea el formulario al terminar la action: los
  // campos vuelven a su valor inicial (select de rol, checkboxes, y nombre/email tras
  // un error de validación). Con onSubmit se arma el mismo FormData pero sin reset.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    startTransition(() => formAction(datos));
  }

  const erroresCampo = estado && !estado.ok ? estado.errores : {};

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-14">
      <h1 className="text-3xl font-serif font-semibold tracking-tight mb-8">Editar usuario</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="nombre" className="block text-sm text-ink-secondary mb-1.5">
            Nombre
          </label>
          <input
            id="nombre"
            name="nombre"
            defaultValue={usuario.nombre}
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
            defaultValue={usuario.email}
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
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            disabled={esPropioUsuario}
            className="w-full h-11 rounded-md border border-line bg-paper px-3.5 text-sm outline-none focus:border-marino focus:ring-2 focus:ring-marino/15 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="GERENTE">GERENTE</option>
            <option value="FINANZAS">FINANZAS</option>
            <option value="ADMIN">ADMIN</option>
            <option value="VIEWER">VIEWER (solo lectura)</option>
          </select>
          <input type="hidden" name="rol" value={rol} />
          {esPropioUsuario && (
            <p className="mt-1 text-xs text-ink-muted">No podés cambiar tu propio rol.</p>
          )}
          {erroresCampo.rol && <p className="mt-1 text-xs text-terracota">{erroresCampo.rol}</p>}
        </div>

        {rol !== "ADMIN" && (
          <EmpresasYPermisos
            empresas={empresas}
            empresaIdsIniciales={usuario.empresaIds}
            permisosIniciales={usuario.permisos}
            soloLectura={rol === "VIEWER"}
          />
        )}

        {rol !== "ADMIN" && rol !== "VIEWER" && (
          <div>
            <input type="hidden" name="operaEjecucionIncluida" value="1" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="operaEjecucion" defaultChecked={usuario.operaEjecucion} />
              Opera Ejecución (todas las empresas)
            </label>
            <p className="mt-1 text-xs text-ink-muted">
              Puede subir extractos, clasificar y asignar unidades. Cerrar la semana es solo de FINANZAS y ADMIN.
            </p>
          </div>
        )}

        {rol === "VIEWER" && (
          <div>
            <input type="hidden" name="veBloquesReservadosIncluida" value="1" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="veBloquesReservados" defaultChecked={usuario.veBloquesReservados} />
              Ve los bloques reservados del Reporte (Disponibilidades y Cierre)
            </label>
            <p className="mt-1 text-xs text-ink-muted">
              En pantalla y en el Excel, solo de las empresas que tiene asignadas. Sigue siendo solo lectura. Sin esta casilla no los ve.
            </p>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="activo" defaultChecked={usuario.activo} />
          Usuario activo
        </label>

        {estado?.ok && estado.advertencia && (
          <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
            {estado.advertencia}
          </p>
        )}
        {estado?.ok && (
          <p className="text-sm text-marino bg-marino-tint rounded-md px-3 py-2">Guardado.</p>
        )}

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={pendiente}
            className="h-11 px-5 rounded-md bg-marino text-white text-sm font-medium hover:bg-marino-dark transition disabled:opacity-60"
          >
            {pendiente ? "Guardando..." : "Guardar cambios"}
          </button>
          <Link href="/admin/usuarios" className="text-sm text-ink-secondary underline underline-offset-2">
            Volver al listado
          </Link>
        </div>
      </form>

      <div className="mt-10 border-t border-line-strong pt-6">
        <p className="text-sm font-medium mb-1">Restablecer contraseña</p>
        <p className="text-xs text-ink-muted mb-3">
          Genera una contraseña temporal nueva y cierra todas las sesiones activas de este usuario.
        </p>
        <button
          onClick={handleRestablecer}
          disabled={reseteando}
          className="h-10 px-4 rounded-md border border-line-strong text-sm hover:bg-paper-raised transition disabled:opacity-60"
        >
          {reseteando ? "Restableciendo..." : "Restablecer contraseña"}
        </button>
        {errorReset && <p className="mt-3 text-sm text-terracota">{errorReset}</p>}
        {passwordTemporal && (
          <p className="mt-3 text-sm bg-marino-tint text-marino rounded-md px-3 py-2">
            Contraseña temporal: <span className="font-mono font-semibold">{passwordTemporal}</span>
            <BotonCopiar texto={passwordTemporal} />
            <br />
            <span className="text-xs">Copiala ahora — no se va a volver a mostrar.</span>
          </p>
        )}
      </div>
    </div>
  );
}
