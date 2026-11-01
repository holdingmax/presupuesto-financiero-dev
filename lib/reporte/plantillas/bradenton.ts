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

// "PF - BRADENTON - AGOSTO 2026", hoja PRESUPUESTO MES A MES (diagnóstico §2.10; en el Excel la empresa
// figura como "BRADENTON GAS STATION", en la app es "Bradenton", slug `bradenton`). Bradenton lleva su
// planilla en DÓLARES y su banco (Chase) no pasa por la Ejecución argentina. Sin cartel ni formato de
// moneda por ahora: queda pendiente de Kike.
//
// Textos literales de la planilla, con sus tipeos y espacios: " TOTAL DISPONIBILIDADES" (espacio adelante),
// "Prestamos y tarjetas", "Adicionales: " (dos puntos y espacio al final), "Proveedoresv(Mercs + Servicios+Mant+
// Honorarios)" e "Inversion Food Truck". El test de textos los compara con el Excel.
//
// REAL: ninguna fila lee de la Ejecución. En la planilla el Real sale de la hoja CHASE (extracto propio);
// acá todo se tipea a mano en /reporte/carga. PRESUPUESTADO: por categoría de Presupuesto donde el nombre
// coincide exacto, y a mano el resto. Dos decisiones propias, confirmadas: "Proveedoresv(…)" va por PROV Y
// SERV (su fórmula suma mercadería, servicios, mantenimiento y honorarios, todos proveedores) e "Inversion
// Food Truck" queda manual (la categoría INVERSIONES no coincide por nombre).
//
// Categorías de Presupuesto SIN fila en esta plantilla (el motor las ignora sin avisar; las fija
// bradenton.test.ts): Intereses FCI, Préstamo Cocos, Préstamo MS, COMISIONES ESPECIALES, INVERSIONES, IVA,
// OTROS, PAGOS ESPECIALES y SAC.
//
// SIN control de arrastre (sin rol totalDisponibilidades ni saldo), como Avianor: el Banco sale del extracto
// Chase, no de la Posición del mes anterior, y el Excel tampoco cuadra (solo agosto, porque su hoja Presup
// 08-2026 se arma con el cierre de julio). Las diferencias de febrero a julio quedan fijadas en
// bradenton.test.ts como documentación. Banco y Efectivo se tipean cada mes (P = R).
//
// Capital de trabajo propuesto es un valor TIPEADO (30.000), no una fórmula: P en los 12 meses; R `=+P` en
// enero y febrero, 30.000 tipeado de marzo a julio y 30.001 de agosto a diciembre. Va como fila manual con P y
// R tipeables porque la planilla también usa el R (los tipos `capital` / `disponible` del motor solo calculan
// P). Excedente / Faltante = TOTAL DISPONIBILIDADES − Capital de trabajo (celda =+B7-B41), en P y en R: NO es
// Posición − Capital.

const disponibilidades = [
  disp("bd.dBanco", "BANCO", "cuadre"),
  disp("bd.dEfectivo", "EFECTIVO", "cuadre"),
];

const ingresos = [
  ingreso("bd.cobranzaClientes", "Cobranza clientes", REAL_MANUAL, cat("COBRANZAS")),
  ingreso("bd.otrasOperaciones", "Otras operaciones", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("bd.ventaPropiedades", "Venta de Propiedades y Equipos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("bd.cobroCapitalPrestamos", "Cobro de Capital de Préstamos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("bd.prestamo", "Préstamo", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("bd.otroTc", "Otro (TC mes anterior)", REAL_MANUAL, PRESUPUESTO_MANUAL),
  ingreso("bd.otroIngreso", "Otro", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

const egresos = [
  egreso("bd.chequesDiferidos", "Cheques diferidos", REAL_MANUAL, cat("CHEQUES DIFERIDOS")),
  egreso("bd.sueldos", "Sueldos", REAL_MANUAL, cat("SUELDOS")),
  egreso("bd.prestamosTarjetas", "Prestamos y tarjetas", REAL_MANUAL, cat("Prestamos y tarjetas")),
  egreso("bd.adicionales", "Adicionales: ", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("bd.impuestos", "Impuestos", REAL_MANUAL, cat("IMP Y PREVISIONALES")),
  egreso("bd.impuestoInmobiliario", "Impuesto inmobiliario (Manatee)", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("bd.expensas", "Expensas", REAL_MANUAL, cat("EXPENSAS")),
  egreso("bd.gastosBancarios", "Gastos Bancarios", REAL_MANUAL, cat("Gastos bancarios")),
  egreso("bd.proveedores", "Proveedoresv(Mercs + Servicios+Mant+ Honorarios)", REAL_MANUAL, cat("PROV Y SERV")),
  egreso("bd.proveedoresIva", "Proveedores IVA", REAL_MANUAL, PRESUPUESTO_MANUAL),
  egreso("bd.liquidacionesFinales", "Liquidaciones Finales", REAL_MANUAL, cat("Liquidación final")),
  egreso("bd.juicios", "Juicios", REAL_MANUAL, cat("Juicios")),
  egreso("bd.otroLottery", "Otro: Lottery", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

const deAbajo = [
  abajo("bd.reembolsosPrestamos", "Reembolsos de préstamos", REAL_MANUAL, PRESUPUESTO_MANUAL),
  abajo("bd.dividendos", "Dividendos", REAL_MANUAL, cat("Dividendos")),
  abajo("bd.inversionFoodTruck", "Inversion Food Truck", REAL_MANUAL, PRESUPUESTO_MANUAL),
  abajo("bd.otroAbajo", "Otro", REAL_MANUAL, PRESUPUESTO_MANUAL),
];

// Valor tipeado en P y en R (no es una fórmula de la planilla). Va en Cierre, como las demás de ese bloque.
const capital: FilaLinea = {
  clave: "bd.capital",
  bloque: "CIERRE",
  tipo: "linea",
  texto: "Capital de trabajo propuesto",
  signo: 1,
  real: REAL_MANUAL,
  presupuesto: PRESUPUESTO_MANUAL,
  nota: "Planilla: 30.000 tipeado en P; en R, =+P en enero y febrero, tipeado después.",
};

export const PLANTILLA_BRADENTON: Plantilla = {
  empresa: "Bradenton",
  filas: [
    titulo("bd.tituloDisponibilidades", "DISPONIBILIDADES", "DISPONIBILIDADES (principios de mes)"),
    ...disponibilidades,
    total("bd.totalDisponibilidades", "DISPONIBILIDADES", " TOTAL DISPONIBILIDADES", disponibilidades.map((f) => f.clave)),
    titulo("bd.tituloIngresos", "INGRESOS", "INGRESOS"),
    ...ingresos,
    total("bd.totalIngresos", "INGRESOS", "TOTAL INGRESOS", ingresos.map((f) => f.clave)),
    total("bd.disponibleAntes", "CIERRE", "DISPONIBLE ANTES DE GASTOS", ["bd.totalDisponibilidades", "bd.totalIngresos"], {
      requiere: ["bd.totalDisponibilidades"],
      soloConPresupuesto: true,
    }),
    titulo("bd.tituloGastos", "EGRESOS", "GASTOS"),
    ...egresos,
    total("bd.totalGastosOperativos", "EGRESOS", "TOTAL GASTOS OPERATIVOS", egresos.map((f) => f.clave)),
    ...deAbajo,
    total("bd.totalGastos", "ABAJO", "TOTAL GASTOS", ["bd.totalGastosOperativos", ...deAbajo.map((f) => f.clave)]),
    total("bd.saldo", "CIERRE", "POSICIÓN DE EFECTIVO (fin de mes)", ["bd.disponibleAntes"], {
      resta: ["bd.totalGastos"],
      requiere: ["bd.disponibleAntes"],
      soloConPresupuesto: true,
      visibleGerente: true,
    }),
    capital,
    total("bd.excedente", "CIERRE", "Excedente / Faltante", ["bd.totalDisponibilidades"], {
      resta: ["bd.capital"],
      requiere: ["bd.totalDisponibilidades"],
      soloConPresupuesto: true,
      visibleGerente: true,
    }),
  ],
};
