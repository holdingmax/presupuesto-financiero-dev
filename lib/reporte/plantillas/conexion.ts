import type { Plantilla } from "@/lib/reporte/motor";
import {
  abajo,
  capital,
  cat,
  clasif,
  clasifMasManual,
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

// "PF - CONEXION LOGISTICA - AGOSTO 2026", hoja PRESUPUESTO Y REAL MES A MES
// (diagnóstico §2.1). Unidades de negocio: SPP + LOGISTICA.

// Disponibilidades (principios de mes): componentes tipeados por Macchi. "ajuste" =
// se suma o resta aparte del cierre del mes anterior (plan 2b §1, pregunta K9).
const disponibilidades = [
  disp("cx.dBanco", "BANCO", "cuadre"),
  disp("cx.dEfectivo", "EFECTIVO", "cuadre"),
  disp("cx.dDolares", "DOLARES", "cuadre"),
  disp("cx.dChequesEnCartera", "CHEQUES EN CARTERA ", "cuadre"),
  disp("cx.dChequesNegociados", "CHEQUES NEGOCIADOS PENDIENTES DE INGRESO", "cuadre"),
  disp("cx.dCobranzaTechPack", "COBRANZA TECH PACK 02 Y 09", "ajuste"),
  disp("cx.dReservaAguinaldo", "RESERVA AGUINALDO", "cuadre", { pendiente: "K10" }),
  disp("cx.dChequesDespuesDel10", "CHEQUES EN CARTERA DESPUES DEL 10", "ajuste", { pendiente: "K9" }),
  disp("cx.dAdicionalesPendientes", "ADICIONALES PENDIENTES", "ajuste"),
  disp("cx.dRecuperoBlanqueo", "RECUPERO APORTE BLANQUEO", "ajuste"),
  disp("cx.dGastosJps", "GASTOS JET PARTS SOLUTIONS A RECUPERAR", "ajuste"),
];

const ingresos = [
  ingreso("cx.cobranzaContado", "Cobranza Contado", clasif("COBRANZAS"), cat("COBRANZAS"), {
    nota: "Jul-26: COBRANZAS SPP+LOGISTICA 2.317,2M; la planilla tipea 2.311,3M (dif. 5,8M).",
  }),
  ingreso("cx.cobranzaChequeDiferido", "Cobranza Cheque Diferido", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("cx.otrasOperaciones", "Otras operaciones (VENTA MOTO)", SIN_REAL, PRESUPUESTO_MANUAL, { pendiente: "K8" }),
  ingreso("cx.prestamoMsCiber", "Prestamo MS Ciber", clasifSentido("creditos", "PRESTAMOS MS"), PRESUPUESTO_MANUAL, {
    pendiente: ["K8", "K13"],
    nota: "Entrada de préstamo MS: créditos de PRESTAMOS MS (sin verificar, K13).",
  }),
  ingreso("cx.resultadoFci", "Resultado FCI", REAL_MANUAL, cat("Intereses FCI"), {
    nota: "Rendimientos de FCI tipeados a mano.",
  }),
  ingreso("cx.reservaAguinaldo", "Reserva Aguinaldo", REAL_IGUAL_PRESUPUESTO, PRESUPUESTO_MANUAL, {
    pendiente: "K10",
    nota: "Espejo de RESERVA AGUINALDO de Disponibilidades en el mes de pago del SAC; P a mano, R = P.",
  }),
  ingreso("cx.prestamo", "Préstamo", SIN_REAL, PRESUPUESTO_MANUAL, { pendiente: "K8" }),
  ingreso("cx.gastosMsARecuperar", "Gastos MS a recuperar", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("cx.chequesDespuesDel10", "Cheques en cartera despues del 10", { tipo: "manualDesde", desde: "2026-10" }, espejoDe("cx.dChequesDespuesDel10"), {
    pendiente: "K9",
    nota: "P = menos CHEQUES EN CARTERA DESPUES DEL 10 de Disponibilidades. R: hasta 2026-09 = P en mes cerrado; desde 2026-10 se tipea (vacío hasta que se carga).",
  }),
  ingreso("cx.gastosAvionARecuperar", "Gastos avion a recuperar", SIN_REAL, PRESUPUESTO_MANUAL),
];

const egresos = [
  egreso("cx.chequesDiferidos", "Cheques diferidos", clasif("CHEQUES DIFERIDOS"), cat("CHEQUES DIFERIDOS")),
  egreso("cx.sueldos", "Sueldos", clasif("SUELDOS"), cat("SUELDOS"), {
    pendiente: "K1",
    parcial: true,
    nota: "Planilla: SUELDOS de la unidad + reparto de la nómina sin unidad (hoja DETALLE SUELDOS).",
  }),
  egreso("cx.sac", "SAC", clasifMasManual("2026-10", "SAC"), cat("SAC"), {
    pendiente: "K1",
    parcial: true,
    nota: "Planilla: SAC de la unidad + reparto del SAC sin unidad.",
  }),
  egreso("cx.prestamosTarjetas", "Prestamos y tarjetas", clasif("PREST BRIOS Y TC"), cat("Prestamos y tarjetas"), {
    pendiente: "K1",
    parcial: true,
    nota: "Planilla: PREST BRIOS Y TC + reparto de la hoja TARJETAS Y PRESTAMOS.",
  }),
  egreso(
    "cx.comisionesEspeciales",
    "Adicionales y comisiones especiales",
    clasif("COMISIONES ESPECIALES"),
    cat("COMISIONES ESPECIALES")
  ),
  egreso("cx.impuestos", "Impuestos", clasif("IMP Y PREVISIONALES"), cat("IMP Y PREVISIONALES"), {
    pendiente: "K1",
    parcial: true,
    nota: "Planilla: IMP Y PREVISIONALES + PRORRATEO IMPUESTOS (F931/SP).",
  }),
  egreso("cx.expensas", "Expensas", REAL_MANUAL, cat("EXPENSAS"), {
    pendiente: "K2",
    nota: "Planilla: reparto de la unidad EXPENSAS.",
  }),
  egreso("cx.expensasNoSocios", "Expensas - No socios", SIN_REAL, PRESUPUESTO_MANUAL),
  egreso("cx.impuestoAlCheque", "Impuesto al cheque (Gto Brio)", clasif("COM Y GTOS BRIOS"), cat("Gastos bancarios")),
  egreso("cx.proveedores", "Proveedores", clasif("PROV Y SERV"), cat("PROV Y SERV"), {
    nota: "Jul-26: la hoja DETALLE GASTOS REALES suma 3.973.586,86 menos que PROV Y SERV de la Ejecución.",
  }),
  egreso("cx.peru", "Peru", SIN_REAL, PRESUPUESTO_MANUAL),
  egreso("cx.bolivia", "Bolivia", SIN_REAL, PRESUPUESTO_MANUAL),
  egreso("cx.proveedoresIva", "Proveedores IVA", REAL_MANUAL, cat("IVA"), { pendiente: "K3" }),
  egreso("cx.liquidacionesFinales", "Liquidaciones Finales", clasif("LIQ FINAL"), cat("Liquidación final")),
  egreso("cx.juicios", "Juicios y requerimientos AFIP", clasif("JUICIOS"), cat("Juicios")),
  egreso("cx.prestamoMs", "Préstamo MS", clasifSentido("debitos", "PRESTAMOS MS"), cat("Préstamo MS"), {
    pendiente: "K13",
  }),
];

const deAbajo = [
  abajo("cx.recuperoGastos", "Recupero Gastos", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("cx.gastosCampo", "Gastos Campo", clasif("CAMPO"), PRESUPUESTO_MANUAL, {
    parcial: true,
    nota: "Planilla: CAMPO + Sueldos y SAC de la unidad CAMPO.",
  }),
  abajo("cx.gastosJps", "Gastos Jet Parts Solutions a recuperar", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("cx.gastosMs", "Gastos MS", clasif("MS"), PRESUPUESTO_MANUAL, {
    parcial: true,
    nota: "Jul-26: MS 9.919.918,85 + 13.473.929,75 tipeados sin identificar.",
  }),
  abajo("cx.aporteBlanqueo", "Aporte para blanqueo", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("cx.expensasHavannaPeru", "Expensas Havanna peru a recuperar", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("cx.expensasAmericanas", "Expensas Empresas Americanas a recuperar", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("cx.ajusteCaja", "Ajuste Caja - A conciliar", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("cx.reintegroExpensas", "Reintegro expensas grupo ", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("cx.dividendosExpensas", "Dividendos - Expensas Havanna Peru y Americanas", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    nota: "Jul-26: 28.990.000 tipeado.",
  }),
  abajo("cx.dividendosEfectivo", "Dividendos en efectivo", clasif("DIVIDENDOS"), cat("Dividendos")),
  abajo("cx.dividendosRecuperoExpensas", "Dividendos - Recupero expensas y prestamos grupo", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("cx.dividendosRecuperoGastos", "Dividendos - Recupero de gastos", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("cx.gastosAvion", "Gastos Avion a recuperar", clasif("AVION"), PRESUPUESTO_MANUAL, {
    parcial: true,
    nota: "Planilla: AVION + expensas y tarjetas de Avianor pagadas por Conexión.",
  }),
];

export const PLANTILLA_CONEXION: Plantilla = {
  empresa: "Conexión Logística",
  filas: [
    titulo("cx.tituloDisponibilidades", "DISPONIBILIDADES", "DISPONIBILIDADES "),
    ...disponibilidades,
    total("cx.totalDisponibilidades", "DISPONIBILIDADES", " TOTAL DISPONIBILIDADES", disponibilidades.map((f) => f.clave), {
      rol: "totalDisponibilidades",
    }),
    titulo("cx.tituloIngresos", "INGRESOS", "INGRESOS"),
    ...ingresos,
    total("cx.totalIngresos", "INGRESOS", "TOTAL INGRESOS", ingresos.map((f) => f.clave), { rol: "totalIngresos" }),
    total("cx.disponibleAntes", "CIERRE", "DISPONIBLE ANTES DE GASTOS", ["cx.totalDisponibilidades", "cx.totalIngresos"], {
      requiere: ["cx.totalDisponibilidades"],
      soloConPresupuesto: true,
    }),
    titulo("cx.tituloEgresos", "EGRESOS", "EGRESOS"),
    ...egresos,
    total("cx.totalEgresosOperativos", "EGRESOS", "TOTAL EGRESOS OPERATIVOS", egresos.map((f) => f.clave), {
      rol: "totalEgresosOperativos",
    }),
    ...deAbajo,
    total(
      "cx.totalEgresos",
      "ABAJO",
      "TOTAL DE EGRESOS",
      ["cx.totalEgresosOperativos", ...deAbajo.map((f) => f.clave)],
      { rol: "totalEgresos" }
    ),
    total("cx.saldo", "CIERRE", "SALDO INICIAL + INGRESOS - TOTAL EGRESOS", ["cx.disponibleAntes"], {
      resta: ["cx.totalEgresos"],
      requiere: ["cx.disponibleAntes"],
      soloConPresupuesto: true,
      rol: "saldo",
    }),
    capital(
      "cx.capital",
      "CAPITAL DE TRABAJO PROPUESTO (15 DIAS)",
      {
        terminos: [
          { fila: "cx.totalEgresosOperativos", factor: 0.5 },
          { fila: "cx.reservaAguinaldo", factor: -0.5 },
        ],
      },
      { nota: "Planilla: (TOTAL EGRESOS OPERATIVOS − Reserva Aguinaldo de Ingresos) / 2." }
    ),
    disponible("cx.disponible", "DISPONIBLE SI - CAPITAL DE TRABAJO", "cx.totalDisponibilidades", "cx.capital"),
  ],
};
