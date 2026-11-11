import type { Plantilla } from "@/lib/reporte/motor";
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

// "PF - PLATE SILVER - AGOSTO 2026", hoja PRESUPUESTO Y REAL MES A MES (diagnóstico §2.11).
// Plate Silver (Uruguay) lleva su planilla en DÓLARES y sus bancos (UY / USD) no pasan por la
// Ejecución argentina. Sin cartel ni formato de moneda por ahora: queda pendiente de Kike. La
// planilla cierra con la nota "Las cifras están expresadas en dólares americanos" (A43); la
// Plantilla no tiene campo para una nota al pie, así que solo queda acá.
//
// Textos literales de la planilla, incluidos " TOTAL DISPONIBILIDADES" (con un espacio adelante) y
// "Otro (retencio UI + Collet)" (con el error de tipeo): el test de textos los compara con Excel.
//
// REAL: ninguna fila lee de la Ejecución. Todo el Real se tipea a mano en /reporte/carga (o es
// una fórmula de la planilla). La empresa tampoco tiene unidades de negocio asignadas.
// PRESUPUESTADO: por categoría de Presupuesto donde la planilla tiene una equivalente exacta; el
// resto, a mano. "Proveedores IVA" queda manual a propósito: la categoría IVA es otra operación
// (cheques a la financiera a cambio de efectivo), no el IVA de proveedores.
//
// Categorías de Presupuesto SIN fila en esta plantilla (el motor las ignora sin avisar; las fija
// plateSilver.test.ts): Intereses FCI, Préstamo Cocos, Préstamo MS, COMISIONES ESPECIALES,
// INVERSIONES, IVA, Juicios, OTROS, PAGOS ESPECIALES y SAC.
//
// Arrastre: igual que HWC. Banco, Efectivo y Cheques en cartera se tipean cada mes (P = R) y el
// control de arrastre compara el Total Disponibilidades con la POSICIÓN DE EFECTIVO real del mes
// anterior (en la planilla, Banco(P) = Posición(R) del mes anterior). No hay arrastre automático.
//
// Capital de trabajo y Excedente son filas de total (no `capital` / `disponible`) porque la
// planilla los calcula también en la columna REAL. Excedente = TOTAL DISPONIBILIDADES − Capital de
// trabajo (celda =+B8-B40): NO es Posición − Capital.

const disponibilidades = [
  disp("ps.dBanco", "BANCO", "cuadre"),
  disp("ps.dEfectivo", "EFECTIVO", "cuadre"),
  disp("ps.dChequesEnCartera", "CHEQUES EN CARTERA", "cuadre"),
];

const ingresos = [
  ingreso("ps.cobranzaClientes", "Cobranza clientes", REAL_MANUAL, cat("COBRANZAS")),
  ingreso("ps.otrasOperaciones", "Otras operaciones", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("ps.ventaPropiedades", "Venta de Propiedades y Equipos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("ps.cobroCapitalPrestamos", "Cobro de Capital de Préstamos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("ps.prestamo", "Préstamo", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("ps.otroRetencion", "Otro (retencio UI + Collet)", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("ps.otroIngreso", "Otro", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

const egresos = [
  egreso("ps.chequesDiferidos", "Cheques diferidos", REAL_MANUAL, cat("CHEQUES DIFERIDOS")),
  egreso("ps.sueldos", "Sueldos", REAL_MANUAL, cat("SUELDOS")),
  egreso("ps.impuestos", "Impuestos", REAL_MANUAL, cat("IMP Y PREVISIONALES")),
  egreso("ps.prestamosTarjetas", "Prestamos y tarjetas", REAL_MANUAL, cat("Prestamos y tarjetas")),
  egreso("ps.adicionales", "Adicionales", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("ps.expensas", "Expensas", REAL_MANUAL, cat("EXPENSAS")),
  egreso("ps.gastosBancarios", "Gastos Bancarios", REAL_MANUAL, cat("Gastos bancarios")),
  egreso("ps.proveedores", "Proveedores", REAL_MANUAL, cat("PROV Y SERV")),
  egreso("ps.proveedoresIva", "Proveedores IVA", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("ps.liquidacionesFinales", "Liquidaciones Finales", REAL_MANUAL, cat("Liquidación final")),
  egreso("ps.diferenciaCambio", "Diferencia de cambio - Otros gastos banco", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("ps.otroFondoFijo", "Otro (reposición de fondo fijo)", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

const deAbajo = [
  abajo("ps.reembolsosPrestamos", "Reembolsos de préstamos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  abajo("ps.dividendos", "Dividendos", REAL_MANUAL, cat("Dividendos")),
  abajo("ps.otroAbajo", "Otro", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

export const PLANTILLA_PLATE_SILVER: Plantilla = {
  empresa: "Plate Silver",
  filas: [
    titulo("ps.tituloDisponibilidades", "DISPONIBILIDADES", "DISPONIBILIDADES (principios de mes)"),
    ...disponibilidades,
    total("ps.totalDisponibilidades", "DISPONIBILIDADES", " TOTAL DISPONIBILIDADES", disponibilidades.map((f) => f.clave), {
      rol: "totalDisponibilidades",
    }),
    titulo("ps.tituloIngresos", "INGRESOS", "INGRESOS"),
    ...ingresos,
    total("ps.totalIngresos", "INGRESOS", "TOTAL INGRESOS", ingresos.map((f) => f.clave), { rol: "totalIngresos" }),
    total("ps.disponibleAntes", "CIERRE", "DISPONIBLE ANTES DE GASTOS", ["ps.totalDisponibilidades", "ps.totalIngresos"], {
      requiere: ["ps.totalDisponibilidades"],
      soloConPresupuesto: true,
    }),
    titulo("ps.tituloGastos", "EGRESOS", "GASTOS"),
    ...egresos,
    total("ps.totalGastosOperativos", "EGRESOS", "TOTAL GASTOS OPERATIVOS", egresos.map((f) => f.clave), { rol: "totalEgresosOperativos" }),
    ...deAbajo,
    total("ps.totalGastos", "ABAJO", "TOTAL GASTOS", ["ps.totalGastosOperativos", ...deAbajo.map((f) => f.clave)], { rol: "totalEgresos" }),
    total("ps.saldo", "CIERRE", "POSICIÓN DE EFECTIVO (fin de mes)", ["ps.disponibleAntes"], {
      resta: ["ps.totalGastos"],
      requiere: ["ps.disponibleAntes"],
      soloConPresupuesto: true,
      rol: "saldo",
      visibleGerente: true,
    }),
    // OJO (filas extra, a confirmar con Romina): el Capital sale del 100% de TOTAL GASTOS OPERATIVOS, así que una fila extra de
    // Egresos lo sube y baja el Excedente (igual que en HWC, Fredy, Radio y Conexión). Una fila de Ingresos o «de abajo» no lo mueve.
    total("ps.capital", "CIERRE", "Capital de trabajo propuesto", ["ps.totalGastosOperativos"], {
      soloConPresupuesto: true,
      visibleGerente: true,
    }),
    total("ps.excedente", "CIERRE", "Excedente(+) / Faltante (-)", ["ps.totalDisponibilidades"], {
      resta: ["ps.capital"],
      requiere: ["ps.totalDisponibilidades"],
      soloConPresupuesto: true,
      visibleGerente: true,
    }),
  ],
};
