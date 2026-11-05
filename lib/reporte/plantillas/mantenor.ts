import type { Plantilla } from "@/lib/reporte/motor";
import {
  abajo,
  capital,
  cat,
  clasif,
  clasifMasManual,
  clasifNeteando,
  clasifSentido,
  disp,
  disponible,
  egreso,
  ingreso,
  PRESUPUESTO_DISPONIBLE_PISABLE,
  PRESUPUESTO_MANUAL,
  REAL_MANUAL,
  SIN_REAL,
  titulo,
  total,
} from "./filas";

// "PF - MANTENOR - AGOSTO 2026", hoja PRESUPUESTO MES A MES (diagnóstico §2.6).
// Unidad de negocio: MANTENOR.

// Disponibilidades (sin título, como la planilla): componentes tipeados por Macchi.
const disponibilidades = [
  disp("mn.dBancoFci", "BANCO Y FCI", "cuadre"),
  disp("mn.dEfectivo", "EFECTIVO", "cuadre", { pendiente: "K9" }),
  disp("mn.dDolares", "DOLARES", "cuadre"),
  disp("mn.dChequesNegociados", "CHEQUES NEGOCIADOS PENDIENTES DE INGRESO", "cuadre"),
  disp("mn.dReservaSac", "RESERVA SAC", "ajuste", {
    nota: "Se tipea en negativo. Sin espejo en Ingresos; viene de la hoja VALORES A MANO del PF de octubre.",
  }),
];

const ingresos = [
  ingreso(
    "mn.cobranzaJujuy",
    "Cobranza Mantenor Jujuy",
    clasifNeteando("2026-10", ["mn.otrosClientesJujuy", "mn.otrosClientesTucuman", "mn.msmColumnas", "mn.msmPinturaVial"], "COBRANZAS"),
    cat("COBRANZAS"),
    {
      pendiente: "K4",
      parcial: true,
      nota: "COBRANZAS de la unidad. Desde 2026-10 se les resta el Real manual de «Otros Clientes Jujuy», «Otros Clientes Tucuman», «MSM COLUMNAS» y «MSM PINTURA VIAL», que ya están adentro y se tipean aparte; antes de esa fecha lleva toda la cobranza de la unidad (Jujuy + MSNT, K4).",
    }
  ),
  ingreso("mn.otrosClientesJujuy", "Otros Clientes Jujuy", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    nota: "Real tipeado a mano; desde 2026-10 se resta de Cobranza Mantenor Jujuy.",
  }),
  ingreso("mn.otrosClientesTucuman", "Otros Clientes Tucuman", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    nota: "Real tipeado a mano; desde 2026-10 se resta de Cobranza Mantenor Jujuy.",
  }),
  ingreso("mn.msmColumnas", "MSM COLUMNAS", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    nota: "Real tipeado a mano; desde 2026-10 se resta de Cobranza Mantenor Jujuy.",
  }),
  ingreso("mn.msmPinturaVial", "MSM PINTURA VIAL", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    nota: "Real tipeado a mano; desde 2026-10 se resta de Cobranza Mantenor Jujuy.",
  }),
  ingreso("mn.cobranzaMsnt", "Cobranza MSNT Av Papa F./Av Siria / Av Sarmiento", SIN_REAL, PRESUPUESTO_MANUAL, {
    pendiente: "K4",
  }),
  ingreso("mn.traspasoSaldoInicial", "Traspaso Saldo Inicial Brillante - Mantenor", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("mn.traspasoPrestamoMs", "Traspaso Saldo Prestamo MS - Brillante a Mantenor", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("mn.resultadoFci", "Resultado FCI", REAL_MANUAL, cat("Intereses FCI")),
  ingreso("mn.prestamoMs", "Préstamo MS", clasifSentido("creditos", "PRESTAMOS MS"), PRESUPUESTO_MANUAL, {
    pendiente: ["K8", "K13"],
    nota: "Entrada de préstamo MS: créditos de PRESTAMOS MS (sin verificar, K13).",
  }),
];

const egresos = [
  egreso("mn.chequesDiferidos", "Cheques diferidos", clasif("CHEQUES DIFERIDOS"), cat("CHEQUES DIFERIDOS")),
  egreso("mn.sueldos", "Sueldos", clasif("SUELDOS"), cat("SUELDOS"), {
    pendiente: "K1",
    parcial: true,
    nota: "Planilla: SUELDOS de la unidad + reparto de la nómina sin unidad.",
  }),
  egreso("mn.sac", "SAC", clasifMasManual("2026-10", "SAC"), cat("SAC"), {
    pendiente: "K1",
    parcial: true,
    nota: "Planilla: SAC de la unidad + reparto del SAC sin unidad.",
  }),
  egreso("mn.tarjetas", "Tarjetas", clasif("PREST BRIOS Y TC"), cat("Prestamos y tarjetas"), {
    pendiente: "K1",
    parcial: true,
  }),
  egreso(
    "mn.comisionesEspeciales",
    "Adicionales y comisiones especiales",
    clasif("COMISIONES ESPECIALES"),
    cat("COMISIONES ESPECIALES"),
    { nota: "Jul-26: la planilla movió 6,3M de comisiones a Brillante." }
  ),
  egreso("mn.impuestos", "Impuestos", clasif("IMP Y PREVISIONALES"), cat("IMP Y PREVISIONALES"), {
    pendiente: "K1",
    parcial: true,
    nota: "Planilla: IMP Y PREVISIONALES + PRORRATEO IMPUESTOS (F931/SP).",
  }),
  egreso("mn.expensas", "Expensas", REAL_MANUAL, cat("EXPENSAS"), {
    pendiente: "K2",
    nota: "Planilla: reparto de la unidad EXPENSAS.",
  }),
  egreso("mn.gastosBancarios", "Gastos Bancarios", clasif("COM Y GTOS BRIOS"), cat("Gastos bancarios")),
  egreso("mn.compraIva", "Compra IVA", clasif("IVA"), cat("IVA")),
  egreso("mn.proveedores", "Proveedores", clasif("PROV Y SERV"), cat("PROV Y SERV")),
  egreso(
    "mn.liquidacionesJuicios",
    "Liquidaciones Finales y Juicios",
    clasif("LIQ FINAL", "JUICIOS"),
    cat("Liquidación final", "Juicios")
  ),
];

const deAbajo = [
  abajo("mn.prestamos", "Prestamos", clasifSentido("debitos", "PRESTAMOS MS"), PRESUPUESTO_DISPONIBLE_PISABLE, {
    pendiente: "K13",
    nota: "P = DISPONIBLE SI - CAPITAL DE TRABAJO del mes (agosto); un valor tipeado en /reporte/carga lo pisa.",
  }),
  abajo("mn.dividendos", "Dividendos", clasif("DIVIDENDOS"), cat("Dividendos")),
  abajo("mn.inversiones", "Inversiones", clasif("INVERSIONES"), cat("INVERSIONES")),
];

export const PLANTILLA_MANTENOR: Plantilla = {
  empresa: "Mantenor",
  filas: [
    ...disponibilidades,
    total("mn.totalDisponibilidades", "DISPONIBILIDADES", "EFECTIVO DISPONIBLE (principios de mes)", disponibilidades.map((f) => f.clave), {
      rol: "totalDisponibilidades",
    }),
    titulo("mn.tituloIngresos", "INGRESOS", "INGRESOS"),
    ...ingresos,
    total("mn.totalIngresos", "INGRESOS", "TOTAL INGRESOS", ingresos.map((f) => f.clave), { rol: "totalIngresos" }),
    total("mn.disponibleAntes", "CIERRE", "DISPONIBLE ANTES DE GASTOS", ["mn.totalDisponibilidades", "mn.totalIngresos"], {
      requiere: ["mn.totalDisponibilidades"],
      soloConPresupuesto: true,
    }),
    titulo("mn.tituloGastos", "EGRESOS", "GASTOS"),
    ...egresos,
    total("mn.totalGastosOperativos", "EGRESOS", "TOTAL GASTOS OPERATIVOS", egresos.map((f) => f.clave), {
      rol: "totalEgresosOperativos",
    }),
    ...deAbajo,
    total("mn.totalGastos", "ABAJO", "TOTAL GASTOS", ["mn.totalGastosOperativos", ...deAbajo.map((f) => f.clave)], {
      rol: "totalEgresos",
    }),
    total("mn.saldo", "CIERRE", "POSICIÓN DE EFECTIVO (fin de mes)", ["mn.disponibleAntes"], {
      resta: ["mn.totalGastos"],
      requiere: ["mn.disponibleAntes"],
      soloConPresupuesto: true,
      rol: "saldo",
    }),
    capital("mn.capital", "CAPITAL DE TRABAJO PROPUESTO (SUELDOS)", "manual", {
      pendiente: "K11",
      nota: "Planilla (agosto): 231.200.000 tipeado.",
    }),
    disponible("mn.disponible", "DISPONIBLE SI - CAPITAL DE TRABAJO", "mn.totalDisponibilidades", "mn.capital"),
  ],
};
