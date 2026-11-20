import { MAXIMA_CONCURRENCIA } from "@/lib/dashboard/avance";

// Limitador de trabajos en paralelo para la pantalla del dashboard (Entrega 3). Módulo PURO.
//
// En la pantalla cada empresa se carga en su propio <Suspense>, y React las renderiza a todas a la vez: sin un tope, doce
// Reportes abrirían doce grupos de consultas y agotarían el pool de 5 conexiones. Este limitador deja correr como máximo
// MAXIMA_CONCURRENCIA trabajos (2) y encola el resto en orden de llegada (FIFO), así las empresas aparecen en orden.
// Se crea UNO POR PEDIDO (no se comparte entre usuarios).

export type Limitador = <T>(tarea: () => Promise<T>) => Promise<T>;

export function crearLimitador(maximo: number = MAXIMA_CONCURRENCIA): Limitador {
  const limite = Math.max(1, Math.min(Math.floor(maximo) || 1, MAXIMA_CONCURRENCIA));
  let activas = 0;
  const cola: (() => void)[] = [];

  const siguiente = () => {
    if (activas >= limite) return;
    const arrancar = cola.shift();
    if (arrancar) arrancar();
  };

  return <T,>(tarea: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolver, rechazar) => {
      cola.push(() => {
        activas += 1;
        // Una tarea que lanza de forma síncrona también libera su lugar.
        Promise.resolve()
          .then(tarea)
          .then(resolver, rechazar)
          .finally(() => {
            activas -= 1;
            siguiente();
          });
      });
      siguiente();
    });
}

// Resultado de un trabajo de la pantalla: nunca rechaza (un error de una empresa no tira la pantalla ni muestra detalles).
export type Resultado<T> = { estado: "ok"; valor: T } | { estado: "error" };

export function aResultado<T>(promesa: Promise<T>): Promise<Resultado<T>> {
  return promesa.then(
    (valor): Resultado<T> => ({ estado: "ok", valor }),
    (): Resultado<T> => ({ estado: "error" })
  );
}
