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
  espejoDe,
  ingreso,
  PRESUPUESTO_MANUAL,
  REAL_IGUAL_PRESUPUESTO,
  REAL_MANUAL,
  SIN_REAL,
  titulo,
  total,
} from "./filas";

// "PF - RADIO - AGOSTO 2026", hoja PRESUPUESTO MES A MES (diagnóstico §2.5).
// Unidad de negocio: RADIO.

// Disponibilidades (principios de mes): componentes tipeados por Macchi.
const disponibilidades = [
  disp("ra.dBancoFci", "BANCO Y FCI", "cuadre"),
  disp("ra.dEfectivo", "EFECTIVO", "cuadre", { pendiente: "K9" }),
  disp("ra.dChequesEnCartera", "CHEQUES EN CARTERA", "cuadre"),
  disp("ra.dChequesNegociados", "CHEQUES NEGOCIADOS PENDIENTES DE INGRESO", "cuadre"),
  disp("ra.dComisionesPendientes", "COMISIONES ESPECIALES PENDIENTES", "cuadre", { pendiente: "K9" }),
  disp("ra.dReservaAguinaldo", "RESERVA AGUINALDO", "cuadre", { pendiente: "K10" }),
  disp("ra.dChequesDespuesDel15", "CHEQUES EN CARTERA DESPUES DEL 15", "ajuste", { pendiente: "K9" }),
];

const ingresos = [
  ingreso("ra.cobranza", "Cobranza clientes", clasif("COBRANZAS"), cat("COBRANZAS")),
  ingreso("ra.otrasOperaciones", "Otras operaciones", SIN_REAL, PRESUPUESTO_MANUAL, { pendiente: "K8" }),
  ingreso("ra.resultadoFci", "Resultado FCI", REAL_MANUAL, cat("Intereses FCI")),
  ingreso("ra.reservaAguinaldo", "Reserva de aguinaldo", REAL_IGUAL_PRESUPUESTO, PRESUPUESTO_MANUAL, {
    pendiente: "K10",
    nota: "Espejo de RESERVA AGUINALDO de Disponibilidades en el mes de pago del SAC; P a mano, R = P.",
  }),
  ingreso("ra.chequesDespuesDel15", "Cheques despues del 15", REAL_IGUAL_PRESUPUESTO, espejoDe("ra.dChequesDespuesDel15"), {
    pendiente: "K9",
    nota: "P = menos CHEQUES EN CARTERA DESPUES DEL 15 de Disponibilidades; R = P.",
  }),
  ingreso("ra.cobroJuicio", "Ingreso - Cobro juicio Municipalidad", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("ra.devolucionEmbargo", "Devolucion embargo", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("ra.otroIngreso", "Otro", SIN_REAL, PRESUPUESTO_MANUAL),
];

const egresos = [
  egreso("ra.chequesDiferidos", "Cheques diferidos", clasif("CHEQUES DIFERIDOS"), cat("CHEQUES DIFERIDOS")),
  egreso("ra.sueldos", "Sueldos", clasif("SUELDOS"), cat("SUELDOS")),
  egreso("ra.sac", "SAC", clasif("SAC"), cat("SAC")),
  egreso("ra.prestamosTarjetas", "Prestamos y tarjetas", clasif("PREST BRIOS Y TC"), cat("Prestamos y tarjetas")),
  egreso("ra.comisionesEspeciales", "Comisiones Especiales", clasif("COMISIONES ESPECIALES"), cat("COMISIONES ESPECIALES")),
  egreso("ra.impuestos", "Impuestos", clasif("IMP Y PREVISIONALES"), cat("IMP Y PREVISIONALES")),
  egreso("ra.expensas", "Expensas", REAL_MANUAL, cat("EXPENSAS"), {
    pendiente: "K2",
    nota: "Planilla: reparto de la unidad EXPENSAS.",
  }),
  egreso("ra.expensasNoSocios", "Expensas - No socios", SIN_REAL, PRESUPUESTO_MANUAL),
  egreso("ra.impuestoAlCheque", "Impuesto al cheque (Gto Brio)", clasif("COM Y GTOS BRIOS"), cat("Gastos bancarios"), {
    nota: "Jul-26: la planilla tipea 1.472.404; COM Y GTOS BRIOS da 1.607.849.",
  }),
  egreso("ra.costoIva", "Costo IVA / Factura C / Efectivo", REAL_MANUAL, cat("IVA"), { pendiente: "K3" }),
  egreso("ra.proveedores", "Proveedores", clasif("PROV Y SERV"), cat("PROV Y SERV"), {
    nota: "Jul-26: la planilla suma además GASTOS TARJETAS (330.409).",
  }),
  egreso("ra.juicios", "Juicios", clasif("JUICIOS"), cat("Juicios")),
];

const deAbajo = [
  abajo("ra.reembolsosPrestamos", "Reembolsos de préstamos", clasifSentido("debitos", "PRESTAMOS MS"), cat("Préstamo MS"), {
    pendiente: "K13",
  }),
  abajo("ra.dividendos", "Dividendos", clasif("DIVIDENDOS"), cat("Dividendos")),
  abajo("ra.ajusteCaja", "Ajuste caja - A conciliar", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("ra.otro", "Otro", SIN_REAL, PRESUPUESTO_MANUAL),
];

export const PLANTILLA_RADIO: Plantilla = {
  empresa: "Radio",
  filas: [
    titulo("ra.tituloDisponibilidades", "DISPONIBILIDADES", "DISPONIBILIDADES (principios de mes)"),
    ...disponibilidades,
    total("ra.totalDisponibilidades", "DISPONIBILIDADES", " TOTAL DISPONIBILIDADES", disponibilidades.map((f) => f.clave), {
      rol: "totalDisponibilidades",
    }),
    titulo("ra.tituloIngresos", "INGRESOS", "INGRESOS"),
    ...ingresos,
    total("ra.totalIngresos", "INGRESOS", "TOTAL INGRESOS", ingresos.map((f) => f.clave), { rol: "totalIngresos" }),
    total("ra.disponibleAntes", "CIERRE", "DISPONIBLE ANTES DE GASTOS", ["ra.totalDisponibilidades", "ra.totalIngresos"], {
      requiere: ["ra.totalDisponibilidades"],
      soloConPresupuesto: true,
    }),
    titulo("ra.tituloEgresos", "EGRESOS", "EGRESOS"),
    ...egresos,
    total("ra.totalEgresosOperativos", "EGRESOS", "TOTAL EGRESOS OPERATIVOS", egresos.map((f) => f.clave), {
      rol: "totalEgresosOperativos",
    }),
    ...deAbajo,
    total("ra.totalEgresos", "ABAJO", "TOTAL EGRESOS", ["ra.totalEgresosOperativos", ...deAbajo.map((f) => f.clave)], {
      rol: "totalEgresos",
    }),
    total("ra.saldo", "CIERRE", "SALDO INICIAL + INGRESOS - TOTAL EGRESOS", ["ra.disponibleAntes"], {
      resta: ["ra.totalEgresos"],
      requiere: ["ra.disponibleAntes"],
      soloConPresupuesto: true,
      rol: "saldo",
    }),
    capital("ra.capital", "CAPITAL DE TRABAJO PROPUESTO (15 DIAS)", {
      terminos: [{ fila: "ra.totalEgresosOperativos", factor: 0.5 }],
    }),
    disponible("ra.disponible", "DISPONIBLE SI - CAPITAL DE TRABAJO", "ra.totalDisponibilidades", "ra.capital"),
  ],
};
