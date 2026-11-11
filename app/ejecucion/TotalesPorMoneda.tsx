import { lineasDeTotal, type TotalMoneda } from "@/lib/moneda";

// El TOTAL de las pantallas de Ejecución: una línea por moneda, con su símbolo, sin sumar entre monedas.
// Con solo pesos (o sin movimientos) es UNA línea con el mismo texto y las mismas clases de siempre
// ("$1.234,56"), así que las empresas en pesos no ven ningún cambio.
export default function TotalesPorMoneda({ totales }: { totales: readonly TotalMoneda[] }) {
  return (
    <>
      {lineasDeTotal(totales).map((l) => (
        <p
          key={l.moneda}
          className={`tabular text-2xl font-semibold ${
            l.signo === "negativo" ? "text-negative" : l.signo === "positivo" ? "text-positive" : "text-ink"
          }`}
        >
          {l.texto}
        </p>
      ))}
    </>
  );
}
