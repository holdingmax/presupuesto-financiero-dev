"use client";

import { useState } from "react";

type Empresa = { id: string; nombre: string };
export type PermisosPorEmpresa = Record<string, { opera: boolean; revisa: boolean }>;

// Casilleros "Empresas que puede ver" + permisos por empresa tildada ("Puede cargar
// Real de esta empresa" / "Revisa presupuesto"), compartidos por el alta y la edición de
// usuario. Manda empresaIds, opera_<id>, revisa_<id> y la marca permisosIncluidos
// (ver crearUsuario / actualizarUsuario: sin esa marca no se tocan los permisos).
export default function EmpresasYPermisos({
  empresas,
  empresaIdsIniciales = [],
  permisosIniciales = {},
}: {
  empresas: Empresa[];
  empresaIdsIniciales?: string[];
  permisosIniciales?: PermisosPorEmpresa;
}) {
  // Controlados, para mostrar los dos casilleros de permisos solo debajo de las
  // empresas tildadas.
  const [tildadas, setTildadas] = useState<Set<string>>(new Set(empresaIdsIniciales));
  const [permisos, setPermisos] = useState(permisosIniciales);

  function alternarEmpresa(empresaId: string) {
    setTildadas((prev) => {
      const next = new Set(prev);
      if (next.has(empresaId)) next.delete(empresaId);
      else next.add(empresaId);
      return next;
    });
  }

  function alternarPermiso(empresaId: string, permiso: "opera" | "revisa") {
    setPermisos((prev) => {
      const actual = prev[empresaId] ?? { opera: false, revisa: false };
      return { ...prev, [empresaId]: { ...actual, [permiso]: !actual[permiso] } };
    });
  }

  return (
    <div>
      <p className="block text-sm text-ink-secondary mb-1.5">Empresas que puede ver</p>
      <input type="hidden" name="permisosIncluidos" value="1" />
      <div className="space-y-2 rounded-md border border-line bg-paper px-3.5 py-3">
        {empresas.map((empresa) => {
          const tildada = tildadas.has(empresa.id);
          const permiso = permisos[empresa.id] ?? { opera: false, revisa: false };
          return (
            <div key={empresa.id}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="empresaIds"
                  value={empresa.id}
                  checked={tildada}
                  onChange={() => alternarEmpresa(empresa.id)}
                />
                {empresa.nombre}
              </label>
              {tildada && (
                <div className="ml-6 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name={`opera_${empresa.id}`}
                      checked={permiso.opera}
                      onChange={() => alternarPermiso(empresa.id, "opera")}
                    />
                    Puede cargar Real de esta empresa
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name={`revisa_${empresa.id}`}
                      checked={permiso.revisa}
                      onChange={() => alternarPermiso(empresa.id, "revisa")}
                    />
                    Revisa presupuesto
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
