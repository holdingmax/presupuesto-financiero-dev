import type { Plantilla } from "@/lib/reporte/motor";
import {
  abajo,
  cat,
  clasif,
  disp,
  egreso,
  ingreso,
  PRESUPUESTO_MANUAL,
  REAL_MANUAL,
  titulo,
  total,
} from "./filas";

// "PF - AVIANOR - AGOSTO 2026", hoja PRESUPUESTO MES A MES (diagnóstico §2.8).
// Unidad de negocio: AVIANOR.
//
// Solo tienen fuente de Real las filas cuyo texto coincide con una clasificación de
// Ejecución sin ambigüedad. El resto (Tarjetas, Comisiones, Adicionales, Préstamo y
// Reembolsos, Expensas - No socios, los tres "Otro", Cuenta Particular…) se tipea a
// mano en /reporte/carga hasta que Finanzas confirme de dónde salen (decisión
// 2026-10-28): no se asigna COMISIONES ESPECIALES, Prestamos y tarjetas, OTROS ni
// PRESTAMOS MS a ninguna de ellas.
//
// Sin control de arrastre en esta versión: Avianor tiene una sola fila de efectivo y
// ningún total con rol "totalDisponibilidades" (el motor deja el arrastre en null).
// Sin Capital de trabajo ni Disponible, como la planilla.
//
// Los tres totales de flujo llevan rol para admitir filas extra del Reporte (lib/reporte/filasExtra.ts). El Saldo lleva
// rol "saldo" (desde que el gerente ve el Cierre, config EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE): es lo único de Cierre
// que tiene Avianor.

const ingresos = [
  ingreso("av.cobranzaClientes", "Cobranza clientes", clasif("COBRANZAS"), cat("COBRANZAS")),
  ingreso("av.otrasOperaciones", "Otras operaciones", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("av.ventaPropiedades", "Venta de Propiedades y Equipos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("av.cobroCapitalPrestamos", "Cobro de Capital de Préstamos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("av.prestamo", "Préstamo", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("av.aporteMs", "Aporte MS", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("av.otroIngreso", "Otro", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

const egresos = [
  egreso("av.chequesDiferidos", "Cheques diferidos", clasif("CHEQUES DIFERIDOS"), cat("CHEQUES DIFERIDOS")),
  egreso("av.sueldos", "Sueldos", clasif("SUELDOS"), cat("SUELDOS")),
  egreso("av.sac", "SAC", clasif("SAC"), cat("SAC")),
  egreso("av.comisiones", "Comisiones", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("av.tarjetas", "Tarjetas", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("av.adicionales", "Adicionales", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("av.impuestos", "Impuestos", clasif("IMP Y PREVISIONALES"), cat("IMP Y PREVISIONALES")),
  egreso("av.expensas", "Expensas", clasif("EXPENSAS"), cat("EXPENSAS")),
  egreso("av.expensasNoSocios", "Expensas - No socios", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("av.gastosBancarios", "Gastos Bancarios", clasif("COM Y GTOS BRIOS"), cat("Gastos bancarios")),
  egreso("av.proveedores", "Proveedores", clasif("PROV Y SERV"), cat("PROV Y SERV")),
  egreso("av.liquidacionFinal", "Liquidacion Final", clasif("LIQ FINAL"), cat("Liquidación final")),
  egreso("av.otroEgreso", "Otro", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

const deAbajo = [
  abajo("av.reembolsosPrestamos", "Reembolsos de préstamos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  abajo("av.dividendos", "Dividendos", clasif("DIVIDENDOS"), cat("Dividendos")),
  abajo("av.cuentaParticular", "Cuenta Particular", REAL_MANUAL, PRESUPUESTO_MANUAL),
  abajo("av.otroAbajo", "Otro", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

export const PLANTILLA_AVIANOR: Plantilla = {
  empresa: "Avianor",
  filas: [
    // Una sola fila (no el bloque de componentes de las otras empresas): un número tipeado, igual en P y R.
    disp("av.dEfectivo", "EFECTIVO DISPONIBLE (principios de mes)", "cuadre", {
      nota: "Planilla: cierre del mes anterior. Se tipea; sin control de arrastre en esta versión.",
    }),
    titulo("av.tituloIngresos", "INGRESOS", "INGRESOS"),
    ...ingresos,
    total("av.totalIngresos", "INGRESOS", "TOTAL INGRESOS", ingresos.map((f) => f.clave), { rol: "totalIngresos" }),
    total("av.disponibleAntes", "CIERRE", "DISPONIBLE ANTES DE GASTOS", ["av.dEfectivo", "av.totalIngresos"], {
      requiere: ["av.dEfectivo"],
      soloConPresupuesto: true,
    }),
    titulo("av.tituloEgresos", "EGRESOS", "EGRESOS"),
    ...egresos,
    total("av.totalEgresosOperativos", "EGRESOS", "TOTAL EGRESOS OPERATIVOS", egresos.map((f) => f.clave), {
      rol: "totalEgresosOperativos",
    }),
    ...deAbajo,
    total("av.totalEgresos", "ABAJO", "TOTAL EGRESOS", ["av.totalEgresosOperativos", ...deAbajo.map((f) => f.clave)], {
      rol: "totalEgresos",
    }),
    total("av.saldo", "CIERRE", "SALDO INICIAL + INGRESOS - TOTAL EGRESOS", ["av.disponibleAntes"], {
      resta: ["av.totalEgresos"],
      requiere: ["av.disponibleAntes"],
      soloConPresupuesto: true,
      rol: "saldo",
    }),
  ],
};
