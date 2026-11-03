import type { Plantilla } from "@/lib/reporte/motor";
import {
  abajo,
  capital,
  cat,
  clasif,
  clasifSentido,
  disp,
  disponible,
  egreso,
  ingreso,
  PRESUPUESTO_MANUAL,
  REAL_IGUAL_PRESUPUESTO,
  REAL_MANUAL,
  SIN_REAL,
  titulo,
  total,
} from "./filas";

// "PF - FREDY - AGOSTO 2026", hoja PRESUPUESTO MES A MES (diagnóstico §2.2).
// Unidad de negocio: FREDY. Ojo: la planilla toma el Real del extracto propio de
// Fredy; en la app, cobranza y sueldos dependen de K5.

// Disponibilidades: componentes tipeados por Macchi.
const disponibilidades = [
  disp("fr.dBancosFci", "BANCOS + FCI", "cuadre"),
  disp("fr.dEfectivo", "EFECTIVO", "cuadre", { pendiente: "K9" }),
  disp("fr.dDolar", "DÓLAR", "cuadre"),
  disp("fr.dChequesNegociados", "CHEQUES NEGOCIADOS PENDIENTES DE INGRESO", "cuadre"),
  disp("fr.dReservaCapitalTrabajo", "RESERVA CAPITAL DE TRABAJO", "ajuste"),
  disp("fr.dReservaAguinaldo", "RESERVA AGUINALDO", "cuadre", { pendiente: "K10" }),
  disp("fr.dComisionesPendientes", "COMISIONES ESPECIALES PENDIENTES DE PAGO", "cuadre", { pendiente: "K9" }),
  disp("fr.dDividendosPendientes", "DIVIDENDOS PENDIENTES", "cuadre"),
  disp("fr.dRecuperoBlanqueo", "RECUPERO APORTE BLANQUEO", "ajuste"),
];

const ingresos = [
  ingreso("fr.cobranza", "Cobranza clientes", clasif("COBRANZAS"), cat("COBRANZAS"), {
    pendiente: "K5",
    parcial: true,
    nota: "Jul-26: 209,8M en la planilla contra 43,2M de COBRANZAS de la unidad FREDY en la Ejecución consolidada.",
  }),
  ingreso("fr.otrasOperaciones", "Otras operaciones (APORTES)", SIN_REAL, PRESUPUESTO_MANUAL, { pendiente: "K8" }),
  ingreso("fr.resultadoFci", "Resultado FCI", REAL_MANUAL, cat("Intereses FCI")),
  ingreso("fr.reservaAguinaldo", "Reserva Aguinaldo", REAL_IGUAL_PRESUPUESTO, PRESUPUESTO_MANUAL, {
    pendiente: "K10",
    nota: "Espejo de RESERVA AGUINALDO de Disponibilidades en el mes de pago del SAC; P a mano, R = P.",
  }),
  ingreso("fr.reservaCapitalTrabajo", "Reserva Capital de Trabajo", REAL_IGUAL_PRESUPUESTO, PRESUPUESTO_MANUAL, {
    nota: "Espejo de RESERVA CAPITAL DE TRABAJO de Disponibilidades; P a mano, R = P.",
  }),
  ingreso("fr.aporteBlanqueo", "Aporte para blaqueo otras empresas", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("fr.prestamoMs", "Prestamo MS", clasifSentido("creditos", "PRESTAMOS MS"), PRESUPUESTO_MANUAL, {
    pendiente: ["K8", "K13"],
    nota: "Entrada de préstamo MS: créditos de PRESTAMOS MS (sin verificar, K13).",
  }),
  ingreso("fr.chequesNegociadosIva", "Cheques negociados no ingresados IVA", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("fr.otroIngreso", "Otro", SIN_REAL, PRESUPUESTO_MANUAL),
];

const egresos = [
  egreso("fr.chequesDiferidos", "Cheques diferidos", clasif("CHEQUES DIFERIDOS"), cat("CHEQUES DIFERIDOS")),
  egreso("fr.sueldos", "Sueldos", clasif("SUELDOS"), cat("SUELDOS"), {
    pendiente: "K5",
    parcial: true,
    nota: "Jul-26: 15,8M en la planilla contra 10,2M de SUELDOS de la unidad FREDY en la Ejecución consolidada.",
  }),
  egreso("fr.sac", "SAC", clasif("SAC"), cat("SAC"), { pendiente: "K5", parcial: true }),
  egreso("fr.comisionEspecial", "Comision Especial", clasif("COMISIONES ESPECIALES"), cat("COMISIONES ESPECIALES")),
  egreso("fr.compraIva", "Compra de IVA", REAL_MANUAL, cat("IVA"), { pendiente: "K3" }),
  egreso("fr.pagosEspeciales", "Pagos especiales", clasif("PAGOS ESPECIALES"), cat("PAGOS ESPECIALES")),
  egreso("fr.impuestos", "Impuestos", clasif("IMP Y PREVISIONALES"), cat("IMP Y PREVISIONALES")),
  egreso("fr.expensas", "Expensas", REAL_MANUAL, cat("EXPENSAS"), {
    pendiente: "K2",
    nota: "Planilla: reparto de la unidad EXPENSAS.",
  }),
  egreso("fr.expensasNoSocios", "Expensas - No socios", SIN_REAL, PRESUPUESTO_MANUAL),
  egreso("fr.impuestoAlCheque", "Impuesto al cheque", clasif("COM Y GTOS BRIOS"), cat("Gastos bancarios")),
  egreso("fr.proveedores", "Proveedores", clasif("PROV Y SERV"), cat("PROV Y SERV")),
  egreso("fr.liqFinal", "Liq final", clasif("LIQ FINAL"), cat("Liquidación final")),
  egreso("fr.otro", "Otro", clasif("OTROS"), cat("OTROS")),
];

const deAbajo = [
  abajo("fr.reembolsosPrestamos", "Reembolsos de préstamos", clasifSentido("debitos", "PRESTAMOS MS"), cat("Préstamo MS"), {
    pendiente: "K13",
  }),
  abajo("fr.blanqueoPropios", "Aporte para blanqueo con fondos propios", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("fr.blanqueoTerceros", "Aporte para blanqueo con fondos de terceros", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("fr.ajusteCaja", "Ajuste Caja - A conciliar", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("fr.dividendos", "Dividendos", clasif("DIVIDENDOS"), cat("Dividendos")),
  abajo("fr.inversiones", "Inversiones", clasif("INVERSIONES"), cat("INVERSIONES")),
  abajo("fr.pagosMs", "Pagos solicitados por MS", clasif("MS"), PRESUPUESTO_MANUAL),
];

export const PLANTILLA_FREDY: Plantilla = {
  empresa: "Fredy Publicidad",
  filas: [
    titulo("fr.tituloDisponibilidades", "DISPONIBILIDADES", "Disponibilidades"),
    ...disponibilidades,
    total("fr.totalDisponibilidades", "DISPONIBILIDADES", "DISPONIBILIDADES INICIALES", disponibilidades.map((f) => f.clave), {
      rol: "totalDisponibilidades",
    }),
    titulo("fr.tituloIngresos", "INGRESOS", "INGRESOS"),
    ...ingresos,
    total("fr.totalIngresos", "INGRESOS", "TOTAL INGRESOS", ingresos.map((f) => f.clave), { rol: "totalIngresos" }),
    total("fr.disponibleAntes", "CIERRE", "DISPONIBLE ANTES DE GASTOS", ["fr.totalDisponibilidades", "fr.totalIngresos"], {
      requiere: ["fr.totalDisponibilidades"],
      soloConPresupuesto: true,
    }),
    titulo("fr.tituloEgresos", "EGRESOS", "EGRESOS"),
    ...egresos,
    total("fr.totalEgresosOperativos", "EGRESOS", "TOTAL EGRESOS OPERATIVOS", egresos.map((f) => f.clave), {
      rol: "totalEgresosOperativos",
    }),
    ...deAbajo,
    total("fr.totalEgresos", "ABAJO", "TOTAL EGRESOS", ["fr.totalEgresosOperativos", ...deAbajo.map((f) => f.clave)], {
      rol: "totalEgresos",
    }),
    total("fr.saldo", "CIERRE", "SALDO INICIAL + INGRESOS - TOTAL EGRESOS", ["fr.disponibleAntes"], {
      resta: ["fr.totalEgresos"],
      requiere: ["fr.disponibleAntes"],
      soloConPresupuesto: true,
      rol: "saldo",
    }),
    capital("fr.capital", "CAPITAL DE TRABAJO PROPUESTO", {
      terminos: [{ fila: "fr.totalEgresosOperativos", factor: 0.5 }],
    }),
    disponible("fr.disponible", "DISPONIBLE SI - CAPITAL DE TRABAJO", "fr.totalDisponibilidades", "fr.capital"),
  ],
};
