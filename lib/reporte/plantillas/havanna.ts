import type { Plantilla } from "@/lib/reporte/motor";
import {
  abajo,
  capital,
  cat,
  clasif,
  clasifNeteando,
  clasifSentido,
  disp,
  disponible,
  egreso,
  ingreso,
  PRESUPUESTO_DISPONIBLE,
  PRESUPUESTO_MANUAL,
  REAL_IGUAL_PRESUPUESTO,
  REAL_MANUAL,
  SIN_REAL,
  titulo,
  total,
} from "./filas";

// "PF - HAVANNA - AGOSTO 2026", hoja PRESUPUESTO MES A MES (diagnóstico §2.4).
// Unidad de negocio: HAVANNA (razones sociales PANINI + TUCSON).

// Disponibilidades (principios de mes): componentes tipeados por Macchi.
const disponibilidades = [
  disp("hv.dBancoFci", "BANCO Y FCI", "cuadre"),
  disp("hv.dEfectivo", "EFECTIVO", "cuadre", { pendiente: "K9" }),
  disp("hv.dDolares", "DOLARES", "cuadre"),
  // Agregada a pedido (nov-2026), no está en la planilla de agosto: se tipea cada mes (P = R) y entra en el total.
  disp("hv.dChequesEnCartera", "CHEQUES EN CARTERA", "cuadre"),
  disp("hv.dReservaAguinaldo", "RESERVA AGUINALDO", "cuadre", { pendiente: "K10" }),
  disp("hv.dChequesNegociados", "CHEQUES NEGOCIADOS PENDIENTES DE INGRESO", "cuadre"),
  disp("hv.dIngresoBancoMacro", "INGRESO BANCO MACRO", "ajuste"),
];

const ingresos = [
  ingreso(
    "hv.cobranzaBancos",
    "Cobranza Bancos Ingreso Neto",
    clasifNeteando("2026-10", ["hv.cobranzasLocales", "hv.acreditacionTarjetas"], "COBRANZAS"),
    cat("COBRANZAS"),
    {
      pendiente: "K4",
      parcial: true,
      nota: "COBRANZAS de la unidad. Desde 2026-10 se les resta el Real manual de «Cobranzas locales» y de «Acreditacion Tarjetas pendientes», que ya están adentro y se tipean aparte; antes de esa fecha lleva toda la cobranza (K4). Planilla: cobranza bancaria + comisiones y tarjetas a cobrar.",
    }
  ),
  ingreso("hv.cobranzasLocales", "Cobranzas locales", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    pendiente: "K4",
    nota: "Planilla: efectivo de los locales + sueldos y gastos pagados en los locales. Real tipeado a mano; desde 2026-10 se resta de Cobranza Bancos.",
  }),
  ingreso(
    "hv.acreditacionTarjetas",
    "Acreditacion Tarjetas pendientes",
    { tipo: "manualDesde", desde: "2026-10" },
    { tipo: "espejo", fila: "hv.tarjetaNoIngresada", columna: "real", mes: "anterior", factor: -1, pisableConManual: true },
    {
      pendiente: "K9",
      nota: "P = menos el Real de Otro tarjeta no ingresada del mes anterior (un valor tipeado en la carga lo pisa). R: hasta 2026-09 = P en mes cerrado; desde 2026-10 se tipea y se resta de Cobranza Bancos.",
    }
  ),
  ingreso("hv.resultadoFci", "Resultado FCI", REAL_MANUAL, cat("Intereses FCI")),
  ingreso("hv.reservaAguinaldo", "Reserva Aguinaldo", REAL_IGUAL_PRESUPUESTO, PRESUPUESTO_MANUAL, {
    pendiente: "K10",
    nota: "Espejo de RESERVA AGUINALDO de Disponibilidades en el mes de pago del SAC; P a mano, R = P.",
  }),
  ingreso("hv.prestamo", "Préstamo", SIN_REAL, PRESUPUESTO_MANUAL, { pendiente: "K8" }),
  ingreso("hv.prestamoMs", "Préstamo MS ", clasifSentido("creditos", "PRESTAMOS MS"), PRESUPUESTO_MANUAL, {
    pendiente: ["K8", "K13"],
    nota: "Entrada de préstamo MS: créditos de PRESTAMOS MS (sin verificar, K13).",
  }),
  ingreso("hv.tarjetaNoIngresada", "Otro tarjeta no ingresada", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    nota: "P: 20 % de la cobranza bancaria proyectada (negativo). R: tarjetas no ingresadas (DATOS ADICIONALES).",
  }),
  ingreso("hv.otrosIngresos", "Otros Ingresos", clasif("IVA"), PRESUPUESTO_MANUAL, {
    nota: "Jul-26: la planilla pone acá el IVA neto (+29.885).",
  }),
  ingreso("hv.recuperoGastosMs", "Recupero Gastos MS ", SIN_REAL, PRESUPUESTO_MANUAL),
];

const egresos = [
  egreso("hv.chequesDiferidos", "Cheques diferidos", clasif("CHEQUES DIFERIDOS"), cat("CHEQUES DIFERIDOS")),
  egreso("hv.sueldos", "Sueldos", clasif("SUELDOS"), cat("SUELDOS"), {
    parcial: true,
    nota: "Planilla: SUELDOS de la unidad + sueldos pagados en efectivo en los locales (DATOS ADICIONALES).",
  }),
  egreso("hv.sacVacaciones", "SAC Y VACACIONES", clasif("SAC"), cat("SAC")),
  egreso("hv.prestamos", "Prestamos", clasif("PREST BRIOS Y TC"), cat("Prestamos y tarjetas"), {
    nota: "Jul-26: la planilla suma PREST BRIOS Y TC dentro de Proveedores (GASTOS TARJETAS).",
  }),
  egreso("hv.tarjetasComisiones", "Tarjetas y Comisiones", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    nota: "Liquidación de tarjetas PANINI + TUCSON (DATOS ADICIONALES).",
  }),
  egreso("hv.inversiones", "Inversiones", clasif("INVERSIONES"), cat("INVERSIONES")),
  egreso("hv.impuestos", "Impuestos", clasif("IMP Y PREVISIONALES"), cat("IMP Y PREVISIONALES")),
  egreso("hv.expensas", "Expensas", REAL_MANUAL, cat("EXPENSAS"), {
    pendiente: "K2",
    nota: "Planilla: reparto de la unidad EXPENSAS.",
  }),
  egreso("hv.impuestoAlCheque", "Impuesto al cheque", clasif("COM Y GTOS BRIOS"), cat("Gastos bancarios")),
  egreso("hv.compraIva", "Compra IVA", SIN_REAL, cat("IVA")),
  egreso("hv.proveedores", "Proveedores", clasif("PROV Y SERV"), cat("PROV Y SERV"), {
    parcial: true,
    nota: "Planilla: PROV Y SERV + GASTOS TARJETAS + GASTOS VS BARES (tipeado).",
  }),
  egreso("hv.juicios", "Juicios", clasif("JUICIOS"), cat("Juicios"), {
    nota: "Jul-26: la planilla pone JUICIOS en la fila Liq Final; acá va en su fila.",
  }),
  egreso("hv.liqFinal", "Liq Final", clasif("LIQ FINAL"), cat("Liquidación final")),
];

const deAbajo = [
  abajo("hv.devolucionExpensas", "Devolucion prestamo - Deuda expensas", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo(
    "hv.devolucionPrestamoMs",
    "Devolucion prestamo - Prestamo MS",
    clasifSentido("debitos", "PRESTAMOS MS"),
    PRESUPUESTO_DISPONIBLE,
    { pendiente: "K13", nota: "P = DISPONIBLE SI - CAPITAL DE TRABAJO del mes (agosto)." }
  ),
  abajo("hv.dividendos", "Dividendos", clasif("DIVIDENDOS"), cat("Dividendos")),
  abajo("hv.cuentaParticularMs", "Cuenta Particular MS -  Aporte liquidacion Mundo Cell", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("hv.ajusteCaja", "Ajuste Caja - A conciliar", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("hv.pagosMs", "Pagos solicitados MS", clasif("MS"), PRESUPUESTO_MANUAL),
  abajo("hv.retirosMs", "Retiros MS", SIN_REAL, PRESUPUESTO_MANUAL),
];

export const PLANTILLA_HAVANNA: Plantilla = {
  empresa: "Havanna",
  filas: [
    titulo("hv.tituloDisponibilidades", "DISPONIBILIDADES", "DISPONIBILIDADES (principios de mes)"),
    ...disponibilidades,
    total("hv.totalDisponibilidades", "DISPONIBILIDADES", " TOTAL DISPONIBILIDADES", disponibilidades.map((f) => f.clave), {
      rol: "totalDisponibilidades",
    }),
    titulo("hv.tituloIngresos", "INGRESOS", "INGRESOS"),
    ...ingresos,
    total("hv.totalIngresos", "INGRESOS", "TOTAL INGRESOS", ingresos.map((f) => f.clave), { rol: "totalIngresos" }),
    total("hv.disponibleAntes", "CIERRE", "DISPONIBLE ANTES DE GASTOS", ["hv.totalDisponibilidades", "hv.totalIngresos"], {
      requiere: ["hv.totalDisponibilidades"],
      soloConPresupuesto: true,
    }),
    titulo("hv.tituloEgresos", "EGRESOS", "EGRESOS"),
    ...egresos,
    total("hv.totalEgresosOperativos", "EGRESOS", "TOTAL EGRESOS OPERATIVOS", egresos.map((f) => f.clave), {
      rol: "totalEgresosOperativos",
    }),
    ...deAbajo,
    total("hv.totalEgresos", "ABAJO", "TOTAL EGRESOS", ["hv.totalEgresosOperativos", ...deAbajo.map((f) => f.clave)], {
      rol: "totalEgresos",
    }),
    total("hv.saldo", "CIERRE", "SALDO INICIAL + INGRESOS - TOTAL EGRESOS", ["hv.disponibleAntes"], {
      resta: ["hv.totalEgresos"],
      requiere: ["hv.disponibleAntes"],
      soloConPresupuesto: true,
      rol: "saldo",
    }),
    capital(
      "hv.capital",
      "CAPITAL DE TRABAJO PROPUESTO",
      {
        terminos: [
          { fila: "hv.sueldos", factor: 1 },
          { fila: "hv.expensas", factor: 1 },
          { fila: "hv.proveedores", factor: 1 / 4 },
          { fila: "hv.inversiones", factor: 1 / 3 },
        ],
      },
      { pendiente: "K11", nota: "Planilla (agosto): Sueldos + Expensas + Proveedores/4 + Inversiones/3." }
    ),
    disponible("hv.disponible", "DISPONIBLE SI - CAPITAL DE TRABAJO", "hv.totalDisponibilidades", "hv.capital", {
      suma: ["hv.prestamo"],
    }),
  ],
};
