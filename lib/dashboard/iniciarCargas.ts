import { exigirAlcance, type Alcance } from "@/lib/dashboard/alcance";
import { exigirAlcanceDelUsuario, type UsuarioParaDashboard } from "@/lib/dashboard/accesoUsuario";
import type { FilaDeAvance } from "@/lib/dashboard/avance";
import type { CalidadDelMes } from "@/lib/dashboard/calidad";
import { cargarAvanceDeEmpresa, leerContextoDeAvance, type ContextoDeAvance } from "@/lib/dashboard/cargarAvance";
import { cargarCalidadDelMes } from "@/lib/dashboard/cargarCalidad";
import { leerControlDepositosDeCheques } from "@/lib/dashboard/consultas";
import { puedeVerControlDepositos, type ControlDepositosDeCheques } from "@/lib/dashboard/controles";
import { fechaDelControl } from "@/lib/dashboard/encabezado";
import { aResultado, crearLimitador, type Resultado } from "@/lib/dashboard/limitador";

// Arranca TODAS las lecturas de la pantalla del dashboard para UN pedido (Entrega 3) y devuelve promesas que la pantalla va
// consumiendo a medida que se pintan (cada empresa en su <Suspense>). No calcula nada: solo llama a los módulos de la Entrega 2.
//
//  - Un único limitador por pedido: como máximo 2 lecturas pesadas a la vez (pool de 5 conexiones), en orden: contexto del
//    mes, empresas (en el orden del alcance, alfabético), calidad y, solo ADMIN, el control de depósitos.
//  - Todo parte del Alcance: una empresa que no es del alcance no tiene promesa. El control de depósitos solo se arranca si
//    puedeVerControlDepositos(alcance) (solo ADMIN): para el resto la propiedad es null y NO se consulta nada.
//  - Las promesas nunca rechazan: un error de una empresa se muestra como «no se pudo cargar», sin detalles.

export type CargasDelDashboard = Readonly<{
  periodo: string;
  contexto: Promise<Resultado<ContextoDeAvance>>;
  // Una por empresa del alcance (clave = id de empresa).
  empresas: ReadonlyMap<string, Promise<Resultado<FilaDeAvance>>>;
  calidad: Promise<Resultado<CalidadDelMes>>;
  // null = este usuario no tiene el control (nunca se consultó).
  control: Promise<Resultado<ControlDepositosDeCheques | null>> | null;
}>;

export function iniciarCargasDelDashboard(alcance: Alcance, usuario: UsuarioParaDashboard, periodo: string): CargasDelDashboard {
  exigirAlcance(alcance);
  exigirAlcanceDelUsuario(alcance, usuario);
  const limitar = crearLimitador();

  const contexto = aResultado(limitar(() => leerContextoDeAvance(alcance, periodo)));

  const empresas = new Map<string, Promise<Resultado<FilaDeAvance>>>();
  for (const empresa of alcance.empresas) {
    empresas.set(
      empresa.id,
      contexto.then((c) =>
        c.estado === "ok"
          ? aResultado(limitar(() => cargarAvanceDeEmpresa(alcance, empresa.id, usuario, c.valor)))
          : ({ estado: "error" } as Resultado<FilaDeAvance>)
      )
    );
  }

  // La calidad y el control se encolan DESPUÉS de las empresas (las filas aparecen primero).
  const despuesDeLasEmpresas = contexto.then(() => undefined);
  const calidad = despuesDeLasEmpresas.then(() => aResultado(limitar(() => cargarCalidadDelMes(alcance, usuario, periodo))));

  const control = puedeVerControlDepositos(alcance)
    ? despuesDeLasEmpresas.then(() =>
        contexto.then((c) =>
          c.estado === "ok"
            ? aResultado(
                limitar(async () => {
                  const fecha = fechaDelControl(periodo, c.valor.semanas);
                  return fecha === null ? null : leerControlDepositosDeCheques(alcance, fecha);
                })
              )
            : ({ estado: "error" } as Resultado<ControlDepositosDeCheques | null>)
        )
      )
    : null;

  return Object.freeze({ periodo, contexto, empresas, calidad, control });
}
