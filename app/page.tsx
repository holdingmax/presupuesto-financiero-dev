import Link from "next/link";
import { requireUsuarioAlDia, esAdminOFinanzas, veTodoEjecucion } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { prisma } from "@/lib/prisma";
import { listarEmpresas, slugDeEmpresa } from "@/lib/slug";
import { PERIODO_POR_DEFECTO } from "@/lib/config";
import { enlaceDeEmpresa } from "@/lib/navegacionEmpresa";
import { ultimoPeriodoCargado } from "@/lib/ultimoPeriodoCargado";
import { iniciales } from "@/lib/iniciales";

// Foco visible: outline marino sobre fondo claro, blanco sobre la banda marino.
const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marino";
const FOCO_OSCURO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const LINK_BANDA = `inline-flex min-h-11 items-center rounded-md px-3 text-sm text-white/80 transition hover:bg-white/10 hover:text-white ${FOCO_OSCURO}`;
const PASTILLA = `inline-flex min-h-11 items-center rounded-full border border-white/25 bg-white/10 px-4 text-sm text-white transition hover:border-white/45 hover:bg-white/20 ${FOCO_OSCURO}`;
const GRUPO = "mb-1 text-xs font-medium tracking-[0.15em] text-marino-tint/80 uppercase";

// Misma línea que .login-backdrop-solido (globals.css): marino con brillo radial arriba a la izquierda
// y reglas finas tipo libro contable. Ahí la textura está acotada a >= lg; acá la banda es marino en
// todos los anchos, así que va como estilo propio con los mismos valores y tokens.
const FONDO_BANDA = {
  backgroundImage: [
    "radial-gradient(120% 100% at 10% 0%, rgba(255, 255, 255, 0.08), transparent 55%)",
    "repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.05) 0px, rgba(255, 255, 255, 0.05) 1px, transparent 1px, transparent 27px)",
    "linear-gradient(135deg, var(--marino-dark) 0%, var(--marino) 70%)",
  ].join(", "),
};

// Landing post-login: qué empresas ve depende del usuario. Un ADMIN ve las
// 13; el resto solo las que tenga asignadas vía UsuarioEmpresa (ver comentario
// en schema.prisma: un ADMIN no necesita filas ahí porque ve todo).
export default async function MisEmpresasPage() {
  const usuario = await requireUsuarioAlDia();

  const empresas =
    usuario.rol === "ADMIN"
      ? await listarEmpresas()
      : await prisma.empresa.findMany({
          where: { activo: true, usuarios: { some: { usuarioId: usuario.id } } },
          orderBy: { nombre: "asc" },
        });

  // Una sola consulta de lectura, solo para ADMIN y FINANZAS: el gerente no la paga y su enlace no cambia.
  const periodoAdmin = esAdminOFinanzas(usuario) ? await ultimoPeriodoCargado() : PERIODO_POR_DEFECTO;

  return (
    <div className="flex flex-1 flex-col">
      <header className="relative overflow-hidden bg-marino text-white" style={FONDO_BANDA}>
        <div className="mx-auto w-full max-w-5xl px-6 py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs tracking-[0.15em] text-white/80 uppercase">
                <span aria-hidden="true" className="h-2 w-2 bg-plata" />
                HoldingMax
              </p>
              <p className="mt-1 font-serif text-2xl font-semibold tracking-tight text-white">
                Presupuesto y Ejecución Financiera
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="px-2 text-sm font-medium text-white">{usuario.nombre}</span>
              <Link href="/cuenta" className={LINK_BANDA}>
                Cambiar contraseña
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  className={`inline-flex min-h-11 items-center rounded-md border border-white/40 px-4 text-sm font-medium text-white transition hover:bg-white/15 ${FOCO_OSCURO}`}
                >
                  Cerrar sesión
                </button>
              </form>
            </div>
          </div>

          {/* Cada grupo se oculta si ninguno de sus links es visible para este usuario. */}
          {(veTodoEjecucion(usuario) || esAdminOFinanzas(usuario) || usuario.rol === "ADMIN") && (
            <nav aria-label="Secciones del sistema" className="mt-6 flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:gap-x-12">
              {(veTodoEjecucion(usuario) || esAdminOFinanzas(usuario)) && (
                <div>
                  <h2 className={GRUPO}>Operación</h2>
                  <ul className="flex flex-wrap gap-2">
                    {/* Ejecución global (plan §3.4): ADMIN, FINANZAS y quien tiene permiso de operar. */}
                    {veTodoEjecucion(usuario) && (
                      <li>
                        <Link href={`/ejecucion/${PERIODO_POR_DEFECTO}`} className={PASTILLA}>
                          Ejecución global
                        </Link>
                      </li>
                    )}
                    {/* FINANZAS ve la administración financiera, no la de usuarios (decisión 2026-10-07). */}
                    {esAdminOFinanzas(usuario) && (
                      <>
                        <li>
                          <Link href="/admin/pago-referencia" className={PASTILLA}>
                            Pagos de referencia
                          </Link>
                        </li>
                        <li>
                          <Link href="/admin/cheque-iva-referencia" className={PASTILLA}>
                            Cheques IVA de referencia
                          </Link>
                        </li>
                        <li>
                          <Link href="/admin/cuentas-bancarias" className={PASTILLA}>
                            Cuentas bancarias
                          </Link>
                        </li>
                        <li>
                          <Link href="/admin/tipo-cambio" className={PASTILLA}>
                            Tipo de cambio
                          </Link>
                        </li>
                      </>
                    )}
                  </ul>
                </div>
              )}
              {(usuario.rol === "ADMIN" || esAdminOFinanzas(usuario)) && (
                <div>
                  <h2 className={GRUPO}>Administración</h2>
                  <ul className="flex flex-wrap gap-2">
                    {usuario.rol === "ADMIN" && (
                      <li>
                        <Link href="/admin/usuarios" className={PASTILLA}>
                          Gestión de usuarios
                        </Link>
                      </li>
                    )}
                    {esAdminOFinanzas(usuario) && (
                      <li>
                        <Link href="/admin/unidades-negocio" className={PASTILLA}>
                          Unidades de negocio
                        </Link>
                      </li>
                    )}
                    {esAdminOFinanzas(usuario) && (
                      <li>
                        <Link href="/admin/reparto-expensas" className={PASTILLA}>
                          Reparto de Expensas
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="mb-6 border-b border-line-strong pb-4">
          <h1 className="font-serif text-3xl font-semibold tracking-tight whitespace-nowrap">Mis empresas</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {empresas.length === 1 ? "1 empresa" : `${empresas.length} empresas`}
          </p>
        </div>

        {empresas.length === 0 ? (
          <p className="text-sm text-ink-secondary">
            Todavía no tenés empresas asignadas. Pedile acceso al administrador.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {empresas.map((empresa) => (
              <li key={empresa.id}>
                <Link
                  href={enlaceDeEmpresa(
                    esAdminOFinanzas(usuario),
                    slugDeEmpresa(empresa.nombre),
                    undefined,
                    undefined,
                    periodoAdmin
                  )}
                  className={`group flex min-h-16 items-center gap-4 rounded-lg border border-line bg-paper-raised px-4 py-3 shadow-sm shadow-ink/5 transition hover:border-marino hover:shadow-md hover:shadow-ink/10 focus-visible:border-marino focus-visible:shadow-md focus-visible:shadow-ink/10 motion-safe:hover:-translate-y-0.5 motion-safe:focus-visible:-translate-y-0.5 ${FOCO}`}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-marino text-sm font-semibold tracking-wide text-white"
                  >
                    {iniciales(empresa.nombre) || "?"}
                  </span>
                  <span className="text-sm font-medium text-ink">{empresa.nombre}</span>
                  <span
                    aria-hidden="true"
                    className="ml-auto text-lg text-marino opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:-translate-x-1 motion-safe:group-hover:translate-x-0 motion-safe:group-focus-visible:translate-x-0"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
