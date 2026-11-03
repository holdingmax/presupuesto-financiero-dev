import type { Plantilla } from "@/lib/reporte/motor";
import {
  abajo,
  capital,
  cat,
  clasif,
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

// "PF - HANDY - AGOSTO 2026" (= HWC), hoja PRESUPUESTO MES A MES (diagnóstico
// §2.7). Unidad de negocio: HWC. La planilla dice ESPERADO y % EJECUCION en vez
// de PRESUPUESTADO y % AVANCE (pregunta 4, queda abierta).

// Disponibilidades: componentes tipeados por Macchi. Todos suman en el total
// (agosto: SUM(4:11); julio dejaba afuera Previsión SAC y Pago LATAM, E2 del plan 2b).
const disponibilidades = [
  disp("hw.dBancosFci", "BANCOS Y FCI", "cuadre"),
  disp("hw.dCaja", "CAJA", "cuadre", { pendiente: "K9" }),
  disp("hw.dTransferenciaSaife", "TRANSFERENCIA SAIFE PENDIENTE RETIRO", "ajuste"),
  disp("hw.dChequesEnCartera", "CHEQUES EN CARTERA", "cuadre"),
  disp("hw.dChequesPendientes", "CHEQUES PENDIENTES DE INGRESO", "cuadre"),
  disp("hw.dDolaresEnCaja", "DOLARES EN CAJA", "cuadre"),
  disp("hw.dPrevisionSac", "PREVISION SAC", "ajuste", { pendiente: ["K10", "K14"] }),
  disp("hw.dPagoLatamPendiente", "PAGO LATAM PENDIENTE", "ajuste", { pendiente: "K14" }),
];

const ingresos = [
  ingreso("hw.clientesPropios", "CLIENTES PROPIOS", clasif("COBRANZAS"), cat("COBRANZAS"), {
    pendiente: "K6",
    parcial: true,
    nota: "Hasta resolver K6 lleva toda la cobranza de la unidad HWC.",
  }),
  ingreso("hw.facturacionLatam", "FACTURACION HANDY A LATAM", REAL_MANUAL, PRESUPUESTO_MANUAL, { pendiente: "K6" }),
  ingreso("hw.recaudacionLatamAvianca", "RECAUDACION LATAM Y AVIANCA", REAL_MANUAL, PRESUPUESTO_MANUAL, { pendiente: "K6" }),
  ingreso("hw.recaudacionJetsmart", "RECAUDACION JETSMART", REAL_MANUAL, PRESUPUESTO_MANUAL, { pendiente: "K6" }),
  ingreso("hw.reservaSac", "RESERVA SAC", REAL_IGUAL_PRESUPUESTO, PRESUPUESTO_MANUAL, {
    pendiente: "K10",
    nota: "Espejo de PREVISION SAC de Disponibilidades; P a mano, R = P.",
  }),
  ingreso("hw.recuperoExpensas", "RECUPERO EXPENSAS", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("hw.recuperoBlanqueo", "RECUPERO APORTE BLANQUEO", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("hw.resultadoFci", "RESULTADO FCI", REAL_MANUAL, cat("Intereses FCI")),
];

const egresos = [
  egreso("hw.impuestoAlCheque", "IMPUESTO AL CHEQUE", clasif("COM Y GTOS BRIOS"), cat("Gastos bancarios")),
  egreso("hw.chequesDiferidos", "CHEQUES DIFERIDOS", clasif("CHEQUES DIFERIDOS"), cat("CHEQUES DIFERIDOS")),
  egreso("hw.impuestos", "IMPUESTOS", clasif("IMP Y PREVISIONALES"), cat("IMP Y PREVISIONALES")),
  egreso("hw.prestamosTc", "PRESTAMOS BANCARIOS Y TC", clasif("PREST BRIOS Y TC"), cat("Prestamos y tarjetas")),
  egreso("hw.proveedores", "PROVEEDORES Y SERVICIOS", clasif("PROV Y SERV"), cat("PROV Y SERV")),
  egreso("hw.sueldos", "SUELDOS", clasif("SUELDOS"), cat("SUELDOS"), {
    pendiente: "K6",
    parcial: true,
    nota: "Jul-26: 243,3M en la planilla contra 39,3M de SUELDOS de la unidad HWC en la Ejecución consolidada.",
  }),
  egreso("hw.sac", "SAC", clasif("SAC"), cat("SAC")),
  egreso("hw.expensas", "EXPENSAS", REAL_MANUAL, cat("EXPENSAS"), {
    pendiente: "K2",
    nota: "Planilla: reparto de la unidad EXPENSAS.",
  }),
  egreso("hw.costoIva", "COSTO OPERACIONES IVA", REAL_MANUAL, cat("IVA"), { pendiente: "K3" }),
  egreso("hw.liquidacionesFinales", "LIQUIDACIONES FINALES", clasif("LIQ FINAL"), cat("Liquidación final")),
  egreso("hw.comisionesEspeciales", "COMISIONES ESPECIALES", clasif("COMISIONES ESPECIALES"), cat("COMISIONES ESPECIALES")),
];

const deAbajo = [
  abajo("hw.pagoGlobe", "PAGO GLOBE AIR CARGO", REAL_MANUAL, PRESUPUESTO_MANUAL, { pendiente: "K6" }),
  abajo("hw.pagoLatam", "PAGO LATAM Y LAN ECUADOR", REAL_MANUAL, PRESUPUESTO_MANUAL, { pendiente: "K6" }),
  abajo("hw.pagoAvianca", "PAGO AVIANCA", REAL_MANUAL, PRESUPUESTO_MANUAL, { pendiente: "K6" }),
  abajo("hw.pagoFlybondi", "PAGO FLYBONDI", REAL_MANUAL, PRESUPUESTO_MANUAL, { pendiente: "K6" }),
  abajo("hw.pagoGol", "PAGO GOL LINEAS AEREAS", REAL_MANUAL, PRESUPUESTO_MANUAL, { pendiente: "K6" }),
  abajo("hw.dividendos", "Dividendos Entregados", clasif("DIVIDENDOS"), cat("Dividendos")),
  abajo("hw.gastosAvion", "Gastos Avion", clasif("AVION"), PRESUPUESTO_MANUAL),
  abajo("hw.ms", "MS", clasif("MS"), PRESUPUESTO_MANUAL),
  abajo("hw.ajusteCaja", "Ajuste Caja - A conciliar", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("hw.aporteBlanqueo", "Aporte Blanqueo", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("hw.dividendosPendientes", "Dividendos Pendientes", SIN_REAL, PRESUPUESTO_MANUAL),
];

export const PLANTILLA_HWC: Plantilla = {
  empresa: "HWC",
  filas: [
    titulo("hw.tituloDisponibilidades", "DISPONIBILIDADES", "Disponibilidades"),
    ...disponibilidades,
    total("hw.totalDisponibilidades", "DISPONIBILIDADES", "DISPONIBILIDAD INICIAL", disponibilidades.map((f) => f.clave), {
      rol: "totalDisponibilidades",
    }),
    titulo("hw.tituloIngresos", "INGRESOS", "INGRESOS"),
    ...ingresos,
    total("hw.totalIngresos", "INGRESOS", "TOTAL DE INGRESOS", ingresos.map((f) => f.clave), { rol: "totalIngresos" }),
    total("hw.disponibleAntes", "CIERRE", "DISPONIBLE ANTES DE GASTOS", ["hw.totalDisponibilidades", "hw.totalIngresos"], {
      requiere: ["hw.totalDisponibilidades"],
      soloConPresupuesto: true,
    }),
    titulo("hw.tituloGastos", "EGRESOS", "GASTOS"),
    ...egresos,
    total("hw.subtotalEstructura", "EGRESOS", "SUBTOTAL ESTRUCTURA DE GASTOS", egresos.map((f) => f.clave), {
      rol: "totalEgresosOperativos",
    }),
    ...deAbajo,
    total("hw.totalPagado", "ABAJO", "TOTAL EN EFECTIVO PAGADO", ["hw.subtotalEstructura", ...deAbajo.map((f) => f.clave)], {
      rol: "totalEgresos",
    }),
    total("hw.saldo", "CIERRE", "POSICIÓN DE EFECTIVO (fin de mes)", ["hw.disponibleAntes"], {
      resta: ["hw.totalPagado"],
      requiere: ["hw.disponibleAntes"],
      soloConPresupuesto: true,
      rol: "saldo",
    }),
    capital("hw.capital", "Capital de trabajo propuesto", {
      terminos: [{ fila: "hw.subtotalEstructura", factor: 1 }],
    }),
    disponible("hw.disponible", "Excedente (+) / Faltante (-)", "hw.totalDisponibilidades", "hw.capital"),
  ],
};
