// Orden de VISUALIZACIÓN de los movimientos de un mismo día según la cadena de saldo
// (pedido de Flavia: controla el arrastre de saldos con la columna Saldo). No toca datos
// guardados: se aplica solo al armar la vista. Función pura, en centavos enteros.
//
// Para cada (fecha, bancoYCuenta) se busca el orden en que cada fila cumple
// saldo = saldo de la anterior + su importe. Solo se reordena si ese orden EXISTE y es ÚNICO
// con todas las filas del grupo; si falta algún saldo (BBVA), si los saldos no encadenan o si
// hay más de un orden posible (empate), el grupo queda como venía. El orden entre fechas y entre
// cuentas distintas no cambia: cada grupo reutiliza las posiciones que ya ocupaba.

import { monedaParaClave } from "@/lib/conteoMovimientos";

export type FilaOrdenable = {
  fecha: string; // AAAA-MM-DD
  bancoYCuenta: string;
  importeCentavos: number;
  saldoCentavos: number | null;
  // Sin dato o "ARS": se agrupa como siempre. Otra moneda es una cadena de saldo aparte.
  moneda?: string | null;
};

// Tope de pasos de la búsqueda por grupo: con saldos repetidos puede haber muchas ramas; si se
// excede, el grupo se considera "sin orden único" y no se reordena.
const LIMITE_PASOS = 200_000;

// Devuelve el orden (índices del grupo) o null si no hay exactamente una cadena completa.
function cadenaUnica(importes: number[], saldos: number[]): number[] | null {
  const n = importes.length;
  const previos = saldos.map((s, i) => s - importes[i]);
  const porPrevio = new Map<number, number[]>();
  previos.forEach((p, i) => {
    const lista = porPrevio.get(p);
    if (lista) lista.push(i);
    else porPrevio.set(p, [i]);
  });

  const usada = new Array<boolean>(n).fill(false);
  const camino: number[] = [];
  let soluciones = 0;
  let primera = null as number[] | null;
  let pasos = 0;
  let abortar = false;

  const buscar = () => {
    if (camino.length === n) {
      soluciones++;
      if (soluciones === 1) primera = [...camino];
      if (soluciones >= 2) abortar = true;
      return;
    }
    const ultima = camino[camino.length - 1];
    for (const candidata of porPrevio.get(saldos[ultima]) ?? []) {
      if (usada[candidata]) continue;
      if (++pasos > LIMITE_PASOS) {
        abortar = true;
        pasos = Infinity;
        return;
      }
      usada[candidata] = true;
      camino.push(candidata);
      buscar();
      camino.pop();
      usada[candidata] = false;
      if (abortar) return;
    }
  };

  // Inicio posible: la fila cuyo saldo previo no es el saldo de NINGUNA otra fila (nadie puede
  // precederla). En una cadena normal es una sola, y la búsqueda queda lineal. Si no hay ninguna
  // (todas se enganchan entre sí), se prueban todas.
  const cuentaSaldos = new Map<number, number>();
  for (const s of saldos) cuentaSaldos.set(s, (cuentaSaldos.get(s) ?? 0) + 1);
  const sinPredecesora = previos
    .map((p, i) => i)
    .filter((i) => (cuentaSaldos.get(previos[i]) ?? 0) - (saldos[i] === previos[i] ? 1 : 0) === 0);
  const inicios = sinPredecesora.length > 0 ? sinPredecesora : previos.map((_, i) => i);

  for (const inicio of inicios) {
    if (abortar) break;
    usada[inicio] = true;
    camino.push(inicio);
    buscar();
    camino.pop();
    usada[inicio] = false;
  }
  return soluciones === 1 && pasos !== Infinity ? primera : null;
}

export function ordenarPorCadenaDeSaldo<T extends FilaOrdenable>(filas: T[]): T[] {
  const grupos = new Map<string, number[]>();
  filas.forEach((f, i) => {
    const clave = [f.fecha, f.bancoYCuenta, ...monedaParaClave(f.moneda)].join("\u0000");
    const g = grupos.get(clave);
    if (g) g.push(i);
    else grupos.set(clave, [i]);
  });

  const resultado = [...filas];
  for (const posiciones of grupos.values()) {
    if (posiciones.length < 2) continue;
    const miembros = posiciones.map((p) => filas[p]);
    if (miembros.some((m) => m.saldoCentavos === null)) continue;
    // Es solo cosmética: ante cualquier excepción (p. ej. desborde de pila por recursión profunda
    // en un día enorme) ese grupo queda como venía y la función sigue con los demás.
    let orden: number[] | null;
    try {
      orden = cadenaUnica(
        miembros.map((m) => m.importeCentavos),
        miembros.map((m) => m.saldoCentavos as number)
      );
    } catch {
      continue;
    }
    if (!orden) continue;
    orden.forEach((indiceEnGrupo, k) => {
      resultado[posiciones[k]] = miembros[indiceEnGrupo];
    });
  }
  return resultado;
}
