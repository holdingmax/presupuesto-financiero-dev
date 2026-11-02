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

// "PF - BRILLANTE - AGOSTO 2026", hoja PRESUPUESTO MES A MES (diagnóstico §2.3).
// Unidad de negocio: BRILLANTE (incluye la razón social Gold Seguridad).

// Disponibilidades: componentes tipeados por Macchi. "Recupero aporte blanqueo" NO
// suma en el total, como la planilla de agosto (SUM(4:13); E1 del plan 2b §6).
const disponibilidades = [
  disp("br.dBancoFci", "BANCO Y FCI", "cuadre"),
  disp("br.dEfectivo", "EFECTIVO", "cuadre", { pendiente: "K9" }),
  disp("br.dDolares", "DOLARES", "cuadre"),
  disp("br.dReservaIvaAvianor", "RESERVA PAGO IVA AVIANOR", "ajuste"),
  disp("br.dChequesEnCartera", "CHEQUES EN CARTERA", "cuadre"),
  disp("br.dChequesNegociados", "CHEQUES NEGOCIADOS PENDIENTES DE INGRESO", "cuadre"),
  disp("br.dCobranzaMacro", "COBRANZA MACRO LI 03/01", "ajuste"),
  disp("br.dReservaAguinaldo", "RESERVA AGUINALDO", "cuadre", { pendiente: "K10" }),
  disp("br.dAdicionalesComisiones", "ADICIONALES / COMISIONES PENDIENTES", "ajuste", { pendiente: "K9" }),
  disp("br.dReservaAporteMs", "RESERVA APORTE MS - DEVOLUCION LUQUE", "ajuste"),
  disp("br.dRecuperoBlanqueo", "RECUPERO APORTE BLANQUEO", "ajuste", {
    pendiente: "K14",
    excluidaDelTotal: true,
    nota: "La planilla de agosto no la suma en el total (SUM(4:13)); julio sí.",
  }),
];

const ingresos = [
  ingreso("br.cobranzaContado", "Cobranza Contado", clasif("COBRANZAS"), cat("COBRANZAS"), {
    pendiente: "K7",
    parcial: true,
    nota: "Planilla: COBRANZAS de la unidad sin las de Gold Seguridad. Hasta resolver K7 incluye las de Gold.",
  }),
  ingreso("br.cobranzaChequeDiferido", "Cobranza Cheque Diferido", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("br.otrasOperacionesJujuy", "Otras operaciones (MANTENOR JUJUY)", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    pendiente: "K8",
    nota: "Real tipeado a mano.",
  }),
  ingreso("br.goldSalta", "Otros Operaciones (GOLD SALTA)", SIN_REAL, PRESUPUESTO_MANUAL, {
    pendiente: "K7",
    nota: "Cobranzas de la razón social Gold Seguridad.",
  }),
  ingreso("br.cobroIvaInterempresa", "Otro (Cobro IVA interempresa)", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("br.resultadoFci", "Resultado FCI", REAL_MANUAL, cat("Intereses FCI")),
  ingreso("br.prestamoMs", "Préstamo MS", clasifSentido("creditos", "PRESTAMOS MS"), PRESUPUESTO_MANUAL, {
    pendiente: ["K8", "K13"],
    nota: "Entrada de préstamo MS: créditos de PRESTAMOS MS (sin verificar, K13).",
  }),
  ingreso("br.reservaIvaAvianor", "Reserva pago IVA avianor", REAL_IGUAL_PRESUPUESTO, PRESUPUESTO_MANUAL, {
    nota: "Espejo de RESERVA PAGO IVA AVIANOR de Disponibilidades; P a mano, R = P.",
  }),
  ingreso("br.ventaHsAvianor", "Venta HS Vuelos Avianor", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("br.aporteMsLuque", "Aporte MS - Devolucion Luque", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("br.diferenciaExpensas", "Diferencia Expensas a Recuperar", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("br.reservaSac", "Reserva SAC", REAL_IGUAL_PRESUPUESTO, PRESUPUESTO_MANUAL, {
    pendiente: "K10",
    nota: "Espejo de RESERVA AGUINALDO de Disponibilidades en el mes de pago del SAC; P a mano, R = P.",
  }),
  ingreso("br.retroactivoIpsst", "Retroactivo IPSST", SIN_REAL, PRESUPUESTO_MANUAL),
  ingreso("br.otroMsnt", "Otro (MSNT Av Papa F./Av Siria / Av Sarmiento)", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    nota: "Cobro que entró por Mantenor, tipeado a mano.",
  }),
];

const egresos = [
  egreso("br.chequesDiferidos", "Cheques diferidos", clasif("CHEQUES DIFERIDOS"), cat("CHEQUES DIFERIDOS")),
  egreso("br.sueldos", "Sueldos", clasif("SUELDOS"), cat("SUELDOS"), {
    pendiente: "K1",
    parcial: true,
    nota: "Planilla: SUELDOS de la unidad + reparto de la nómina sin unidad.",
  }),
  egreso("br.prestamosTarjetas", "Prestamos y tarjetas", clasif("PREST BRIOS Y TC"), cat("Prestamos y tarjetas"), {
    pendiente: "K1",
    parcial: true,
    nota: "Planilla: PREST BRIOS Y TC + reparto de tarjetas.",
  }),
  egreso("br.sac", "SAC", clasif("SAC"), cat("SAC"), {
    pendiente: "K1",
    parcial: true,
    nota: "Planilla: SAC de la unidad + reparto del SAC sin unidad.",
  }),
  egreso(
    "br.comisionesEspeciales",
    "Adicionales y comisiones especiales",
    clasif("COMISIONES ESPECIALES"),
    cat("COMISIONES ESPECIALES"),
    { parcial: true, nota: "Jul-26: la planilla suma además 6,3M movidos a mano desde Mantenor." }
  ),
  egreso("br.impuestos", "Impuestos", clasif("IMP Y PREVISIONALES"), cat("IMP Y PREVISIONALES"), {
    pendiente: "K1",
    parcial: true,
    nota: "Planilla: IMP Y PREVISIONALES + PRORRATEO IMPUESTOS (F931/SP).",
  }),
  egreso("br.expensas", "Expensas", SIN_REAL, cat("EXPENSAS"), {
    pendiente: "K2",
    nota: "Planilla: reparto de la unidad EXPENSAS.",
  }),
  egreso("br.gastosBancarios", "Gastos Bancarios", clasif("COM Y GTOS BRIOS"), cat("Gastos bancarios")),
  egreso("br.proveedores", "Proveedores", clasif("PROV Y SERV"), cat("PROV Y SERV")),
  egreso("br.compraIva", "Compra IVA", clasif("IVA"), cat("IVA")),
  egreso(
    "br.liquidacionesJuicios",
    "Liquidaciones finales y juicios",
    clasif("LIQ FINAL", "JUICIOS"),
    cat("Liquidación final", "Juicios")
  ),
  egreso("br.gastosGold", "Gastos Gold Seguridad", SIN_REAL, PRESUPUESTO_MANUAL),
];

const deAbajo = [
  abajo("br.reembolsosPrestamos", "Reembolsos de préstamos", clasifSentido("debitos", "PRESTAMOS MS"), cat("Préstamo MS"), {
    pendiente: ["K12", "K13"],
  }),
  abajo("br.dividendos", "Dividendos", clasif("DIVIDENDOS"), cat("Dividendos"), { pendiente: "K12" }),
  abajo("br.devolucionMsCamioneta", "Devolcion MS - Aporte Camioneta", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("br.traspasoPrestamoMs", "Traspaso Saldo Prestamo MS - Brillante a Mantenor", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("br.traspasoSaldoInicial", "Traspaso Saldo Inicial Brillante - Mantenor", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    nota: "Jul-26: 254.780.390 tipeado.",
  }),
  abajo("br.ajusteCaja", "Ajuste Caja -  A conciliar", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("br.devolucionLuque", "Devolucion Luque - Aporte MS", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("br.aporteBlanqueo", "Aporte para blanqueo", SIN_REAL, PRESUPUESTO_MANUAL),
  abajo("br.recuperoGastos", "Recupero Gastos", REAL_MANUAL, PRESUPUESTO_MANUAL, {
    nota: "Real tipeado a mano, con el signo del Excel (negativo = recupero que baja los egresos).",
  }),
  abajo("br.inversiones", "Inversiones", clasif("INVERSIONES"), cat("INVERSIONES")),
];

export const PLANTILLA_BRILLANTE: Plantilla = {
  empresa: "Brillante",
  filas: [
    titulo("br.tituloDisponibilidades", "DISPONIBILIDADES", "Disponibilidades"),
    ...disponibilidades,
    total(
      "br.totalDisponibilidades",
      "DISPONIBILIDADES",
      " TOTAL DISPONIBILIDADES",
      disponibilidades.filter((f) => !f.excluidaDelTotal).map((f) => f.clave),
      { rol: "totalDisponibilidades" }
    ),
    titulo("br.tituloIngresos", "INGRESOS", "INGRESOS"),
    ...ingresos,
    total("br.totalIngresos", "INGRESOS", "TOTAL INGRESOS", ingresos.map((f) => f.clave), { rol: "totalIngresos" }),
    total("br.disponibleAntes", "CIERRE", "DISPONIBLE ANTES DE GASTOS", ["br.totalDisponibilidades", "br.totalIngresos"], {
      requiere: ["br.totalDisponibilidades"],
      soloConPresupuesto: true,
    }),
    titulo("br.tituloEgresos", "EGRESOS", "EGRESOS"),
    ...egresos,
    total("br.totalEgresosOperativos", "EGRESOS", "TOTAL EGRESOS OPERATIVOS", egresos.map((f) => f.clave), {
      rol: "totalEgresosOperativos",
    }),
    ...deAbajo,
    total("br.totalEgresos", "ABAJO", "TOTAL EGRESOS", ["br.totalEgresosOperativos", ...deAbajo.map((f) => f.clave)], {
      rol: "totalEgresos",
    }),
    total("br.saldo", "CIERRE", "SALDO INICIAL + INGRESOS - TOTAL EGRESOS", ["br.disponibleAntes"], {
      resta: ["br.totalEgresos"],
      requiere: ["br.disponibleAntes"],
      soloConPresupuesto: true,
      rol: "saldo",
    }),
    capital(
      "br.capital",
      "CAPITAL DE TRABAJO PROPUESTO (SUELDOS)",
      {
        terminos: [
          { fila: "br.sueldos", factor: 1 },
          { fila: "br.sac", factor: 1 },
        ],
        fijo: 3100000000, // 31.000.000 en centavos (K11: qué son)
        fijoSoloConTerminos: true,
      },
      { pendiente: "K11", nota: "Planilla (agosto): Sueldos + SAC + 31.000.000." }
    ),
    disponible("br.disponible", "DISPONIBLE SI - CAPITAL DE TRABAJO", "br.totalDisponibilidades", "br.capital", {
      pendiente: "K12",
    }),
  ],
};
