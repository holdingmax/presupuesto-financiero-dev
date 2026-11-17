import LoginForm from "./LoginForm";
import { recuperacionActiva } from "@/lib/recuperacion";

export default function LoginPage() {
  return (
    <div
      className="group relative min-h-screen w-full"
      data-backdrop="solido"
      // ↑ debe coincidir con la clase del fondo de abajo: "solido" cuando se usa
      // login-backdrop-solido (marino sólido), o quitarse/cambiarse si se vuelve
      // a login-backdrop (degradé marino → marino-mist) — controla si el texto
      // de ayuda del panel derecho usa color claro u oscuro en desktop.
    >
      {/* Fondo continuo, variante marino sólido (ver .login-backdrop-solido en globals.css) — a pantalla completa */}
      <div aria-hidden className="login-backdrop-solido absolute inset-0 -z-10" />

      {/* Contenido contenido y centrado dentro de un ancho máximo; el fondo de arriba sigue ocupando todo el viewport */}
      <div className="mx-auto flex min-h-screen w-full max-w-[1400px]">
        {/* Panel izquierdo: identidad de marca + las etapas reales del proceso */}
        <div className="hidden lg:flex lg:w-[40%] flex-col justify-between text-paper px-12 py-14">
          <div>
            <div className="flex items-center gap-2 mb-5">
              <span className="w-2 h-2 bg-plata" />
              <p className="text-xs tracking-[0.15em] text-paper/55 uppercase">HoldingMax</p>
            </div>
            <h1 className="text-4xl font-serif font-semibold leading-[1.1] tracking-tight">
              Presupuesto y<br />Ejecución Financiera
            </h1>
          </div>
        </div>

        {/* Panel derecho: login */}
        <div className="flex flex-1 items-center justify-center px-6 py-16">
          <div className="w-full max-w-sm">
            <div className="mb-10 lg:hidden">
              <p className="text-xs tracking-wide text-ink-secondary uppercase">HoldingMax</p>
              <h1 className="mt-1 text-xl font-serif font-semibold">
                Presupuesto y Ejecución Financiera
              </h1>
            </div>

            <div className="relative">
              {/* Resplandor ambiental: simula que la tarjeta emite luz propia sobre el fondo marino */}
              {/* TEMPORAL — intensidad subida a propósito para probar visibilidad, bajar después */}
              <div
                aria-hidden
                className="absolute -inset-24 -z-10 rounded-[2rem] bg-plata/45 blur-[100px]"
              />

              <div className="relative rounded-lg border border-line-strong border-l-4 border-l-marino bg-paper-cool px-6 py-8 login-card-shadow sm:px-8 sm:py-10">
                <p className="mb-3 flex items-center gap-2 text-xs tracking-[0.15em] text-marino uppercase">
                  <span className="w-2 h-2 bg-plata" />
                  Acceso
                </p>
                <h2 className="mb-2 text-4xl font-serif font-semibold tracking-tight">Ingresar</h2>
                <p className="text-sm text-ink-secondary mb-8">
                  Entrá con el email que te dio tu administrador.
                </p>

                <LoginForm mostrarOlvide={recuperacionActiva()} />
              </div>
            </div>

            <p className="mt-4 text-xs text-ink-muted lg:group-data-[backdrop=solido]:text-paper/60">
              ¿Problemas para entrar? Escribile al administrador del sistema.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
