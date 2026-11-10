import { normalizarTexto } from "@/lib/texto";
import { monedaParaClave } from "@/lib/conteoMovimientos";

// Control de continuidad de saldo, en CUALQUIER orden (decisión 2026-10-15, plan
// docs/lector_bancos_plan.md §5.1). Antes asumía que el archivo venía de la fila más
// vieja a la más nueva con el saldo POSTERIOR al movimiento; el madre de julio viene al
// revés y daba ruptura en casi todas las filas. Ahora, por cada cuenta, prueba cuatro
// candidatos —orden del archivo o invertido × saldo posterior o previo al movimiento— y
// se queda con el que menos rupturas da (empate: orden del archivo, saldo posterior).
// Función pura; no bloquea la carga, solo informa.

export type FilaContinuidad = {
  numeroFila: number;
  fecha: Date;
  concepto: string;
  importe: number;
  saldo: number | null;
  bancoYCuenta: string;
  // Sin dato o "ARS": la cuenta se agrupa como siempre. Otra moneda es una cadena de saldo aparte.
  moneda?: string | null;
};

export type Ruptura = {
  fechaAnterior: string;
  saldoAnterior: number;
  fechaSiguiente: string;
  concepto: string;
  saldoEsperado: number;
  saldoReal: number;
  diferencia: number;
};

export type Orientacion = "archivo" | "invertido";

export type AnalisisContinuidad = {
  bancoYCuenta: string;
  // Pares de filas consecutivas con saldo en las dos puntas: lo que se pudo comparar.
  // 0 = "no verificable" (no es lo mismo que "0 rupturas de 659").
  enlaces: number;
  rupturas: Ruptura[];
  orientacion: Orientacion;
  // true si el mejor candidato fue "el saldo es el de ANTES del movimiento".
  saldoPrevio: boolean;
};

// Lo que viaja al cliente: solo las cuentas con rupturas (como antes), más qué se detectó.
export type ResultadoContinuidadSaldo = {
  bancoYCuenta: string;
  cantidad: number;
  enlaces: number;
  orientacion: Orientacion;
  saldoPrevio: boolean;
  rupturas: Ruptura[];
};

const CANDIDATOS: { orientacion: Orientacion; saldoPrevio: boolean }[] = [
  { orientacion: "archivo", saldoPrevio: false },
  { orientacion: "invertido", saldoPrevio: false },
  { orientacion: "archivo", saldoPrevio: true },
  { orientacion: "invertido", saldoPrevio: true },
];

const aCentavos = (pesos: number) => Math.round(pesos * 100);

function evaluar(
  enOrdenDeArchivo: FilaContinuidad[],
  orientacion: Orientacion,
  saldoPrevio: boolean
): { enlaces: number; rupturas: Ruptura[] } {
  // "archivo": las filas ya están en el orden en que se dan; "invertido": se leen al revés.
  const filas = orientacion === "archivo" ? enOrdenDeArchivo : [...enOrdenDeArchivo].reverse();
  const rupturas: Ruptura[] = [];
  let enlaces = 0;

  for (let i = 1; i < filas.length; i++) {
    const anterior = filas[i - 1];
    const actual = filas[i];
    // Saldo null en cualquiera de los dos extremos: no verificable, se salta sin marcar
    // ni como ok ni como ruptura (no es lo mismo "no sé" que "está mal").
    if (anterior.saldo === null || actual.saldo === null) continue;
    enlaces++;

    // Saldo posterior: saldo[i] = saldo[i-1] + importe[i].
    // Saldo previo (el saldo de la fila es el de ANTES del movimiento): saldo[i] = saldo[i-1] + importe[i-1].
    const esperadoCentavos = aCentavos(anterior.saldo) + aCentavos(saldoPrevio ? anterior.importe : actual.importe);
    const difCentavos = aCentavos(actual.saldo) - esperadoCentavos;
    if (difCentavos !== 0) {
      rupturas.push({
        fechaAnterior: anterior.fecha.toISOString().slice(0, 10),
        saldoAnterior: anterior.saldo,
        fechaSiguiente: actual.fecha.toISOString().slice(0, 10),
        concepto: actual.concepto,
        saldoEsperado: esperadoCentavos / 100,
        saldoReal: actual.saldo,
        diferencia: difCentavos / 100,
      });
    }
  }
  return { enlaces, rupturas };
}

// Agrupa por bancoYCuenta normalizado (el hecho físico de la cuenta, agnóstico a
// unidad/empresa) y, dentro de cada cuenta, ordena por numeroFila (el orden real del
// archivo, que solo existe antes de guardar).
export function analizarContinuidad(filas: FilaContinuidad[]): AnalisisContinuidad[] {
  const porCuenta = new Map<string, FilaContinuidad[]>();
  for (const fila of filas) {
    const clave = [normalizarTexto(fila.bancoYCuenta), ...monedaParaClave(fila.moneda)].join("\u0000");
    const grupo = porCuenta.get(clave);
    if (grupo) grupo.push(fila);
    else porCuenta.set(clave, [fila]);
  }

  const resultados: AnalisisContinuidad[] = [];
  for (const grupo of porCuenta.values()) {
    const ordenado = [...grupo].sort((a, b) => a.numeroFila - b.numeroFila);

    let mejor: (AnalisisContinuidad & { cantidad: number }) | null = null;
    for (const c of CANDIDATOS) {
      const { enlaces, rupturas } = evaluar(ordenado, c.orientacion, c.saldoPrevio);
      // Estricto "<": ante un empate gana el candidato anterior (orden del archivo, saldo posterior).
      if (mejor === null || rupturas.length < mejor.cantidad) {
        mejor = {
          bancoYCuenta: grupo[0].bancoYCuenta,
          enlaces,
          rupturas,
          orientacion: c.orientacion,
          saldoPrevio: c.saldoPrevio,
          cantidad: rupturas.length,
        };
      }
    }
    if (mejor) {
      const { cantidad: _cantidad, ...analisis } = mejor;
      void _cantidad;
      resultados.push(analisis);
    }
  }
  return resultados.sort((a, b) => a.bancoYCuenta.localeCompare(b.bancoYCuenta, "es"));
}

export function verificarContinuidadSaldo(filas: FilaContinuidad[]): ResultadoContinuidadSaldo[] {
  return analizarContinuidad(filas)
    .filter((a) => a.rupturas.length > 0)
    .map((a) => ({
      bancoYCuenta: a.bancoYCuenta,
      cantidad: a.rupturas.length,
      enlaces: a.enlaces,
      orientacion: a.orientacion,
      saldoPrevio: a.saldoPrevio,
      rupturas: a.rupturas,
    }));
}

// Avisos informativos (no son rupturas): cuentas que traen el saldo ANTES del movimiento
// y cuentas que no se pudieron verificar (sin saldo, p. ej. BBVA) para que nadie lo lea
// como "todo bien".
export function avisosDeContinuidad(
  analisis: AnalisisContinuidad[],
  { incluirSinSaldo = true }: { incluirSinSaldo?: boolean } = {}
): string[] {
  const avisos: string[] = [];
  for (const a of analisis) {
    if (a.enlaces === 0) {
      if (incluirSinSaldo) avisos.push(`${a.bancoYCuenta}: no trae saldo por fila, no se verificó la continuidad del saldo.`);
    } else if (a.saldoPrevio && a.rupturas.length === 0) {
      avisos.push(`${a.bancoYCuenta}: este archivo trae el saldo antes del movimiento (no es un error).`);
    }
  }
  return avisos;
}
