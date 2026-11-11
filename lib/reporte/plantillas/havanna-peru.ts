import type { FilaLinea, Plantilla } from "@/lib/reporte/motor";
import {
  abajo,
  cat,
  disp,
  egreso,
  ingreso,
  PRESUPUESTO_MANUAL,
  REAL_MANUAL,
  titulo,
  total,
} from "./filas";

// "PF - HAVANNA PERU - AGOSTO 2026", hoja PRESUPUESTO MES A MES (diagnóstico §2.9; en la app es "Havanna Perú",
// slug `havanna-peru`). Familia "simple" (una sola fila de efectivo, como Avianor). La planilla está en SOLES
// (cabecera "PRESUPUESTADO SOLES" / "REAL SOLES"); el Reporte no rotula la moneda, igual que Bradenton y Plate
// Silver: queda pendiente de Kike.
//
// REAL: ninguna fila lee de la Ejecución. En la planilla el Real sale de los extractos propios en soles
// (hojas MOVIMIENTOS <mes> → RESUMEN GASTOS REALES), fuera de la Ejecución en pesos y sin unidad de negocio;
// acá todo el Real se tipea a mano en /reporte/carga. PRESUPUESTADO: por categoría de Presupuesto donde el
// nombre coincide exacto, y a mano el resto.
//
// Sin control de arrastre en esta versión: una sola fila de efectivo y ningún total con rol
// "totalDisponibilidades" (el motor deja el arrastre en null). Sin roles de totales: la empresa no tiene
// filas extra ni interruptores en config.ts.
//
// Capital de trabajo propuesto: en la planilla es una fórmula de USD 80.000 × tipo de cambio (3,757 en enero);
// va tipeado en P y en R. Excedente (+) / Faltante (-) = EFECTIVO DISPONIBLE − Capital de trabajo (=+B4-B36),
// en P y en R: NO es Posición − Capital. La fila 40 de la planilla (CONTROL SF) queda fuera.

const ingresos = [
  ingreso("hp.cobranzaClientes", "Cobranza clientes", REAL_MANUAL, cat("COBRANZAS")),
  ingreso("hp.otrasOperaciones", "Otras operaciones (APORTES)", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("hp.ventaPropiedades", "Venta de Propiedades y Equipos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("hp.cobroCapitalPrestamos", "Cobro de Capital de Préstamos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("hp.prestamo", "Préstamo", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("hp.devolucionPercepcionIgv", "DEVOLUCION PERCEPCION IGV", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("hp.otroIngreso", "Otro", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

const egresos = [
  egreso("hp.gratificaciones", "Gratificaciones", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("hp.sueldos", "Sueldos", REAL_MANUAL, cat("SUELDOS")),
  egreso("hp.prestamos", "Prestamos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("hp.tarjetas", "Tarjetas", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("hp.adicionales", "Adicionales", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("hp.impuestos", "Impuestos", REAL_MANUAL, cat("IMP Y PREVISIONALES")),
  egreso("hp.expensas", "Expensas", REAL_MANUAL, cat("EXPENSAS")),
  egreso("hp.gastosBancarios", "Gastos Bancarios", REAL_MANUAL, cat("Gastos bancarios")),
  egreso("hp.proveedores", "Proveedores", REAL_MANUAL, cat("PROV Y SERV")),
  egreso("hp.regalias", "Regalias", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("hp.otroEgreso", "Otro", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

const deAbajo = [
  abajo("hp.importacionHavanna", "Importacion Havanna", REAL_MANUAL, PRESUPUESTO_MANUAL),
  abajo("hp.solesADolares", "Soles a Dolares", REAL_MANUAL, PRESUPUESTO_MANUAL),
  abajo("hp.dividendos", "Dividendos", REAL_MANUAL, cat("Dividendos")),
  abajo("hp.implementacionLocales", "Implementacion nuevos locales", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

// Valor tipeado en P y en R (en la planilla es 80000*TC, no un número de la hoja). Va en Cierre.
const capital: FilaLinea = {
  clave: "hp.capital",
  bloque: "CIERRE",
  tipo: "linea",
  texto: "Capital de trabajo propuesto",
  signo: 1,
  real: REAL_MANUAL,
  presupuesto: PRESUPUESTO_MANUAL,
  nota: "Planilla: USD 80.000 × tipo de cambio (3,757 en enero), en P y en R. Se tipea.",
};

export const PLANTILLA_HAVANNA_PERU: Plantilla = {
  empresa: "Havanna Perú",
  filas: [
    // Una sola fila (no el bloque de componentes de las otras empresas): un número tipeado, igual en P y R.
    disp("hp.dEfectivo", "EFECTIVO DISPONIBLE (principios de mes)", "cuadre", {
      nota: "Planilla: cierre del mes anterior. Se tipea; sin control de arrastre en esta versión.",
    }),
    titulo("hp.tituloIngresos", "INGRESOS", "INGRESOS"),
    ...ingresos,
    total("hp.totalIngresos", "INGRESOS", "TOTAL INGRESOS", ingresos.map((f) => f.clave), { rol: "totalIngresos" }),
    total("hp.disponibleAntes", "CIERRE", "DISPONIBLE ANTES DE GASTOS", ["hp.dEfectivo", "hp.totalIngresos"], {
      requiere: ["hp.dEfectivo"],
      soloConPresupuesto: true,
    }),
    titulo("hp.tituloGastos", "EGRESOS", "GASTOS"),
    ...egresos,
    total("hp.totalGastosOperativos", "EGRESOS", "TOTAL GASTOS OPERATIVOS", egresos.map((f) => f.clave), { rol: "totalEgresosOperativos" }),
    ...deAbajo,
    total("hp.totalGastos", "ABAJO", "TOTAL GASTOS", ["hp.totalGastosOperativos", ...deAbajo.map((f) => f.clave)], { rol: "totalEgresos" }),
    total("hp.saldo", "CIERRE", "POSICIÓN DE EFECTIVO (fin de mes)", ["hp.disponibleAntes"], {
      resta: ["hp.totalGastos"],
      requiere: ["hp.disponibleAntes"],
      soloConPresupuesto: true,
    }),
    capital,
    total("hp.excedente", "CIERRE", "Excedente (+) / Faltante (-)", ["hp.dEfectivo"], {
      resta: ["hp.capital"],
      requiere: ["hp.dEfectivo"],
      soloConPresupuesto: true,
    }),
  ],
};
