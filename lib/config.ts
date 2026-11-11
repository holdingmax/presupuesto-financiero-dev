// Empresa y período ya no son fijos: ahora vienen de la URL (/[empresa]/[periodo]/...),
// resueltos vía lib/slug.ts y lib/presupuesto.ts. EMPRESA_NOMBRE se eliminó porque ya no
// tiene ningún uso — ninguna pantalla depende de "una sola empresa" en el código.
//
// Períodos de Presupuesto y Reporte que puede abrir CUALQUIER usuario, ADMIN y FINANZAS incluidos (ver
// lib/periodosHabilitados.ts): un período fuera de la lista no se abre por URL ni crea su cabecera. Es el
// selector de mes de las pantallas de Presupuesto y Reporte: para habilitar un mes nuevo, agregarlo acá
// (en orden). Ejecución financiera no usa esta lista. Agosto y septiembre 2026 quedan ocultos a propósito
// (sus datos siguen en la base, sin tocar).
export const PERIODOS_HABILITADOS: readonly string[] = ["2026-10", "2026-11"];

// Único período que el gerente (quien no es ADMIN ni FINANZAS) puede EDITAR: el mes en curso de
// carga. Los demás de PERIODOS_HABILITADOS los puede abrir, pero en solo lectura. Se aplica en el
// servidor (carga desde el Reporte y edición de líneas de Presupuesto). Hay que rotarlo a mano
// cada mes; tiene que estar en PERIODOS_HABILITADOS (lo controla un test). Ver
// puedeEditarPeriodoComoGerente en lib/periodosHabilitados.ts.
export const PERIODO_EN_CARGA_GERENTE = "2026-11";

// Primer mes del historial del Reporte (interruptor «Mes en curso | Todos los meses»): los botones de
// «Todos los meses» van desde acá hasta el mes previo a PERIODO_EN_CARGA_GERENTE. Solo ordena la navegación:
// no habilita nada (los permisos salen de PERIODOS_HABILITADOS). Ver lib/reporte/vistaReporte.ts.
export const PERIODO_INICIO_HISTORIAL = "2026-10";

// Período de respaldo de los links de "Mis empresas" (y del aviso de período no habilitado). ADMIN y FINANZAS entran
// al Reporte del último mes con alguna semana cerrada (lib/ultimoPeriodoCargado.ts) y caen acá si no hay ninguno;
// las empresas sin Reporte por plantilla (Expensas, Gold, Cielos, Tucson) van siempre a este período.
// Tiene que estar en PERIODOS_HABILITADOS (lo controla un test).
export const PERIODO_POR_DEFECTO = "2026-10";

// Reporte por plantilla: muestra las etiquetas K (K1, K7...), sus tooltips y el panel
// "Pendiente de confirmar con Kike" a ADMIN y FINANZAS. En false se ocultan para todos
// (la lista sigue en lib/reporte/pendientes.ts); volver a true para reactivarlos. No
// afecta al control de arrastre ni a las marcas de la planilla (eso es verControl).
export const MOSTRAR_PENDIENTES_EN_REPORTE = false;

// Interruptor por empresa de la carga del gerente directo en el Reporte (plan: el gerente
// tipea su Presupuestado en /reporte). Lista de SLUGS de empresa (lib/slug.ts). Una empresa fuera
// de la lista sigue cargando en Presupuesto. Para volver atrás con una empresa, sacar su slug de
// la lista. Ver cargaEnReporteActiva en lib/estadoPresupuesto.ts.
//
// Con la carga activa, el gerente además deja de ver la pestaña Presupuesto (ocultaPestanaPresupuesto
// en lib/navegacionEmpresa.ts); ADMIN y FINANZAS la conservan. Cada slug tiene que tener plantilla
// de Reporte (lib/reporte/plantillas): un test lo controla.
//
// Primera tanda (Etapa 4): Brillante, Havanna, Radio, Fredy Publicidad, HWC, Mantenor y Conexión
// (los dos alias de slug: uno es el de testing; el que no exista en una base no hace nada).
// Segunda tanda: Bradenton y Plate Silver (en dólares: el texto del Reporte lo dice, ver EMPRESAS_EN_DOLARES).
// Tercera tanda: Havanna Perú y Avianor. Avianor ya no queda afuera: carga desde el Reporte como las demás. OJO: 10
// categorías de Presupuesto no tienen fila en su plantilla (Intereses FCI, Préstamo Cocos, Préstamo MS, COMISIONES
// ESPECIALES, INVERSIONES, IVA, Juicios, OTROS, PAGOS ESPECIALES, Prestamos y tarjetas): un monto cargado ahí no llega a la
// columna Presupuestado ni a los totales (la pantalla de carga lo muestra aparte como «sin fila»).
// Quedan FUERA a propósito: Expensas y Gold Seguridad (siguen con la pantalla vieja de Presupuesto).
// Sumar una empresa es agregar su slug acá. Expensas, Gold Seguridad, Cielos y Tucson no
// tienen Reporte por plantilla: no se pueden activar.
export const EMPRESAS_CON_CARGA_EN_REPORTE: readonly string[] = [
  "brillante",
  "havanna",
  "radio",
  "fredy-publicidad",
  "hwc",
  "mantenor",
  "conexion-logistica",
  "conexion-logistica-spp",
  "bradenton",
  "plate-silver",
  // Havanna Perú (Real todo manual; slug con doble «n», ver lib/slug.ts).
  "havanna-peru",
  "avianor",
];

// Empresas que cargan su Real por EXTRACTO propio (acción subirExtractoEmpresa, Etapa 2): el archivo no es el de un
// banco sino un libro de la propia empresa y las cuentas, la unidad y el lector están fijados en
// lib/extractos/cargaEmpresa.ts (CONFIG_EXTRACTO_EMPRESA, una entrada por slug). Hoy Havanna Perú, Bradenton (Chase, USD) y Plate Silver (BROU, UYU y USD). Sumar una
// empresa es agregar su slug acá Y su entrada allá (un test controla que coincidan).
export const EMPRESAS_CON_EXTRACTO_POR_EMPRESA: readonly string[] = ["havanna-peru", "bradenton", "plate-silver"];

// Empresas cuyos importes están en dólares: solo cambia el texto «en pesos» del Reporte por «en dólares»
// (ReportePlantilla). No toca ningún cálculo ni formato de importe.
export const EMPRESAS_EN_DOLARES: readonly string[] = ["bradenton", "plate-silver"];

// Empresas en cuyo Reporte NO se muestra el botón «Cargar valores del mes» (para ningún rol): el Presupuestado y el Real se
// tipean directo en las celdas del Reporte (EMPRESAS_CON_TIPEO_DIRECTO y «Guardar presupuesto»). Solo oculta el botón: la
// ruta /reporte/carga sigue abierta por URL (con sus permisos de siempre) porque en Bradenton y Havanna Perú es el único lugar
// donde ADMIN y FINANZAS cargan el Capital de trabajo. No toca «Guardar presupuesto», «Guardar valores» ni «Subir extracto».
export const EMPRESAS_SIN_LINK_CARGA_EN_REPORTE: readonly string[] = ["bradenton", "plate-silver", "havanna-peru"];

// Pestaña Presupuesto también oculta para ADMIN y FINANZAS (Kike: la reemplazó la carga del gerente sobre el Reporte),
// pero solo en las empresas de EMPRESAS_CON_CARGA_EN_REPORTE que tienen plantilla de Reporte; las demás conservan la
// pestaña. Con la pestaña oculta, /presupuesto redirige al Reporte del mismo período y "Mis empresas" lleva al Reporte.
// En false vuelve el comportamiento anterior: ADMIN y FINANZAS siempre ven la pestaña (el gerente sigue sin verla donde
// carga en el Reporte). No borra ni cambia ningún dato ni ninguna pantalla. Ver ocultaPestanaPresupuesto en lib/navegacionEmpresa.ts.
export const OCULTAR_PRESUPUESTO_TAMBIEN_PARA_ADMIN_Y_FINANZAS = true;

// Interruptores del gerente en el Reporte (Etapa 5 B): qué bloques reservados ve, en SOLO LECTURA. Listas
// de SLUGS de empresa (lib/slug.ts), una por bloque; vacía = nadie los ve (como hasta ahora). ADMIN y
// FINANZAS los ven siempre y no dependen de esto. Ver accesoReservadosDelReporte en lib/reporte/visibilidad.ts.
//
// Disponibilidades: los componentes (Banco y FCI, Efectivo, Cheques…) y su total. OJO: ahí el «Presupuestado» es
// el saldo real del banco.
//
// Primera tanda: Brillante. Segunda: Fredy Publicidad, HWC y Avianor (ninguna tiene filas de Ingresos que
// espejen Disponibilidades). Mantenor. Tercera: Havanna, Radio, Conexión Logística, Bradenton y Plate Silver. En Radio
// y Conexión las filas espejo de Ingresos («Cheques despues del 15», «Cheques en cartera despues del 10») son espejos
// de Disponibilidades: al prender el interruptor su Presupuestado y los totales que las suman (TOTAL INGRESOS,
// DISPONIBLE ANTES DE GASTOS que no se muestra, Saldo) pasan a mostrarse al gerente; es el efecto buscado y no cambia
// lo que el gerente tipea. En Havanna pasa lo mismo con «Devolucion prestamo - Prestamo MS» (su P es el Disponible),
// TOTAL EGRESOS y Saldo. Sumar una empresa es agregar su slug acá.
export const EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE: readonly string[] = [
  "brillante",
  "fredy-publicidad",
  "hwc",
  "avianor",
  "mantenor",
  "havanna",
  "radio",
  "conexion-logistica",
  "bradenton",
  "plate-silver",
  // Havanna Perú (decisión de Kike, 2026-11): su gerente carga el «EFECTIVO DISPONIBLE (principios de mes)», la única fila
  // de su bloque (sin BANCO ni CHEQUES, sin total). No está en la lista de Cierre: no ve Posición, Capital ni Excedente.
  "havanna-peru",
];
// Cierre: Saldo, Capital de trabajo y Disponible (NO «Disponible antes de gastos»), al pie de la tabla como en la hoja
// «PRESUPUESTO MES A MES». Se calculan con el total de Disponibilidades: una empresa solo puede estar acá si también está
// en la lista de arriba (lo controla un test, y el motor lo aplica igual: sin Disponibilidades, no hay Cierre).
// El gerente las ve en solo lectura: el Capital de trabajo de las empresas que lo tipean lo carga ADMIN en /reporte/carga.
// En Plate Silver y Bradenton además se ven Posición, Capital y Excedente (marcadas con visibleGerente en su plantilla).
export const EMPRESAS_QUE_VEN_CIERRE_EN_REPORTE: readonly string[] = [
  "brillante",
  "fredy-publicidad",
  "hwc",
  "avianor",
  "mantenor",
  "havanna",
  "radio",
  "conexion-logistica",
  "bradenton",
  "plate-silver",
];

// Tipeo directo en el Reporte de los valores que en la planilla se tipean a mano (Real manual de
// Ingresos / Egresos / de abajo y componentes de Disponibilidades), solo para ADMIN y FINANZAS. Lista de
// SLUGS de empresa; vacía = ninguna celda editable (el Reporte se ve como siempre). Las celdas de
// Disponibilidades además exigen que la empresa esté en EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE (lo
// controla un test de subconjunto). El gerente nunca recibe estas celdas. /reporte/carga no depende de esto.
// Ver lib/reporte/tipeoDirecto.ts.
//
// Tanda 1: solo flujo (Real manual de Ingresos/Egresos/de abajo). Sin filas extra y sin Disponibilidades.
//
// Bradenton, Plate Silver y Havanna Perú: todo su Real es manual (ninguna fila lee de la Ejecución). Se tipean las filas de
// Ingresos, Egresos y de abajo; las Disponibilidades solo en Bradenton y Plate Silver (Havanna Perú no las ve: no está en
// EMPRESAS_QUE_VEN_DISPONIBILIDADES_EN_REPORTE y su «EFECTIVO DISPONIBLE» sigue cargándose en /reporte/carga). El Capital de
// trabajo de las tres es una línea o un total, no una fila `capital`: no abre celda. Sin filas extra.
export const EMPRESAS_CON_TIPEO_DIRECTO: readonly string[] = ["brillante", "fredy-publicidad", "hwc", "avianor", "mantenor", "radio", "havanna", "conexion-logistica", "conexion-logistica-spp", "bradenton", "plate-silver", "havanna-peru"];

// Filas extra del Reporte (las que agrega ADMIN/FINANZAS mientras revisa, lib/reporte/filasExtra.ts). Lista de
// SLUGS de empresa; vacía = el Reporte no consulta ni muestra ninguna (ni siquiera lee la tabla) y no hay botón
// «Agregar una fila». Una empresa solo puede estar acá si también tiene el tipeo directo
// (EMPRESAS_CON_TIPEO_DIRECTO) y los roles de totales en su plantilla; un test lo controla. Solo ADMIN y FINANZAS
// agregan y borran filas; el gerente las ve en solo lectura.
//
// Tanda 2: Fredy Publicidad y HWC. Ojo: en ellas el Capital de trabajo sale de un total de Egresos (Fredy 50% de
// TOTAL EGRESOS OPERATIVOS, HWC 100% del SUBTOTAL ESTRUCTURA), así que una fila extra de Egresos lo mueve (decisión
// confirmada). Un Capital tipeado a mano lo reemplaza.
// Avianor: no tiene Capital de trabajo ni Disponible; una fila extra solo mueve los totales, Disponible antes de
// gastos y Saldo.
// Mantenor: el Capital de trabajo es manual (se tipea en /reporte/carga) y no depende de ningún total: las filas extra no
// lo tocan. Sí mueven los totales, Disponible antes de gastos y Posición de efectivo.
// Radio: el Capital de trabajo sale del 50% de TOTAL EGRESOS OPERATIVOS, así que una fila extra de Egresos lo mueve (igual
// que en Fredy y HWC); un Capital tipeado a mano lo reemplaza.
// Bradenton y Havanna Perú: el Capital de trabajo es una línea manual que no sale de ningún total: una fila extra mueve los totales,
// Disponible antes de gastos y Saldo, pero no el Capital ni el Excedente. Disponibilidades no se mueve nunca.
// Plate Silver: el Capital sale del 100% de TOTAL GASTOS OPERATIVOS, así que una fila extra de Egresos lo sube y baja el Excedente (como
// HWC, Fredy, Radio y Conexión). PENDIENTE DE CONFIRMAR CON ROMINA.
// Havanna: el Capital de trabajo suma Sueldos, Expensas, Proveedores/4 e Inversiones/3 (no un total de Egresos), así que una fila
// extra no lo mueve; sí mueve los totales, Disponible antes de gastos y Saldo.
// Conexión Logística (y su alias de testing): el Capital de trabajo sale del 50% de TOTAL EGRESOS OPERATIVOS, así que una fila extra
// de Egresos lo mueve (igual que en Radio); un Capital tipeado a mano lo reemplaza.
export const EMPRESAS_CON_FILAS_EXTRA: readonly string[] = [
  "brillante",
  "fredy-publicidad",
  "hwc",
  "avianor",
  "mantenor",
  "radio",
  "havanna",
  "conexion-logistica",
  "conexion-logistica-spp",
  "bradenton",
  "plate-silver",
  "havanna-peru",
];

// Filas extra que además puede agregar y borrar un GERENTE: solo con la casilla «Puede cargar Real de esta empresa» de ESA empresa
// (UsuarioEmpresa.puedeOperarEjecucion) y solo en las empresas de esta lista (subconjunto de EMPRESAS_CON_FILAS_EXTRA; un test lo
// controla). ADMIN y FINANZAS siguen pudiendo en todas las de la lista de arriba. El gerente de cualquier otra empresa, tenga o no la
// casilla, no puede. A diferencia de ADMIN y FINANZAS, el gerente puede aunque el Presupuesto esté En revisión (decisión de Leticia);
// la regla del mes bloqueado vale para todos. Del Presupuestado de esas filas se encarga ADMIN/FINANZAS: el gerente solo tipea Real.
export const EMPRESAS_CON_FILAS_EXTRA_GERENTE: readonly string[] = ["bradenton", "plate-silver", "havanna-peru"];

// Etiqueta del ciclo fiscal que se muestra en la portada de login (app/login/page.tsx).
//
// PENDIENTE: no está derivada de PERIODO todavía. "3 meses hacia atrás terminando en PERIODO"
// se podría calcular de forma trivial, pero no sé si la regla real es esa (ventana móvil de
// 3 meses) o si en realidad es "el trimestre calendario que contiene a PERIODO" (ene-mar,
// abr-jun, jul-sep, oct-dic) — ambas reglas coinciden para PERIODO="2026-09" (da lo mismo,
// Jul-Sep en los dos casos) pero divergen para cualquier período que no sea fin de trimestre
// calendario. Avisen cuál es la regla correcta y lo calculamos a partir de PERIODO.
export const CICLO_FISCAL_LABEL = "Julio 2026 — Septiembre 2026";

// Clasificaciones cuyo DETALLE no ve el gerente en la pestaña «Ejecución financiera» de su empresa (lista, cantidad,
// Total de la pantalla, desplegable de Clasificación, ?clasificacion= en la URL y Excel). Mapa por SLUG de empresa
// (lib/slug.ts); una empresa fuera del mapa no cambia. Se compara sin distinguir mayúsculas ni espacios y se aplica en
// el SERVIDOR. ADMIN, FINANZAS y quien opera Ejecución (operaEjecucion) ven todo. Solo oculta la visualización del
// detalle: el Reporte (montos por fila), el saldo, los chequeos y el cierre siguen sumando todos los movimientos.
// Ver clasificacionesOcultasParaUsuario en lib/clasificacionesOcultas.ts.
//
// Conexión Logística (pedido de Kike): AVION, MS y PRESTAMO MS. Los dos slugs son los alias de la empresa (uno es el de testing).
export const CLASIFICACIONES_OCULTAS_PARA_GERENTE: Readonly<Record<string, readonly string[]>> = {
  "conexion-logistica": ["AVION", "MS", "PRESTAMO MS"],
  "conexion-logistica-spp": ["AVION", "MS", "PRESTAMO MS"],
};

// Lista PROPIA de clasificaciones de una empresa (Bradenton, Plate Silver y Havanna Perú), solo para la pantalla "Ejecución financiera" de esa empresa cuando el gerente
// con la casilla clasifica sus movimientos (lib/clasificarPorEmpresaDb.ts: clasificacionesParaEditar). Por slug. Una empresa
// que no está acá sigue con la lista general de siempre. NO cambia Ejecución global (que sigue ofreciendo lo suyo), ni el Reporte,
// ni las demás empresas. «SIN CLASIFICAR» no se escribe acá: se agrega siempre, primero.
//
// Bradenton: los 17 conceptos de las pestañas "Presup 11-2026" y "Ejecutado 10-2026" del libro PF, con sus nombres exactos y en el
// orden del libro (ingresos y después egresos), más "OTROS" al final (18 en total). Confirmado por Romina: formato fijo de la
// pestaña Presup; lo único que se sumó es OTROS. Los depósitos (DEP EFECTIVO) los clasifica ella a mano.
export const CLASIFICACIONES_POR_EMPRESA: Readonly<Record<string, readonly string[]>> = {
  bradenton: [
    "COBRANZAS",
    "DEP EFECTIVO",
    "COBRO FOOD TRUCK",
    "VENTA ICE MACHINE-TC",
    "REBATE",
    "DIVIDENDOS",
    "CHEQ EMITIDOS (DEBITADOS)",
    "COM Y GTOS BRIOS",
    "HONORARIOS + ABONOS MENSUALES",
    "TAX",
    "LOTTERY",
    "COMPRA MERCS C-STORE",
    "COMPRA C-STORE-CASH",
    "SERVICIOS",
    "MANTENIMIENTO Y REPARACIONES",
    "SUELDOS",
    "EXPENSAS",
    // Agregada después, a pedido de Romina (confirmado): va al final, sin tocar el orden del libro.
    "OTROS",
  ],
  // Plate Silver: los 29 conceptos que confirmó Romina, en su orden, y OTROS al final (30 en total; con SIN CLASIFICAR, que
  // el sistema agrega siempre primero, 31). OTROS está escrito acá a propósito: el sistema NO lo agrega solo.
  "plate-silver": [
    "COBRANZA DE CLIENTE",
    "IMPUESTO PERCEPCION IVA (UI)",
    "COMISION BANCARIA",
    "DIVIDENDOS",
    "INVERSION PROYECTO USA",
    "REPOSICION FONDO FIJO",
    "DEVOLUCION DE INGRESO POR ERROR",
    "TRANSFERENCIA ENTRE CUENTAS",
    "IMPUESTO IVA",
    "IMPUESTOS ANTICIPOS IRAE",
    "IMPUESTO ANTICIPOS PERSONA JURIDICA",
    "IMPUESTO A LAS SOCIEDADES - ICOSA",
    "AG. DE RETENCION IRNR",
    "ARRIENDO DE EQUIPO MULTIFUNCION/IMPRESOR",
    "HONORARIOS MILTON GONZALEZ",
    "HONORARIOS PROFESIONALES - ESTUDIO CONTABLE",
    "SERVICIOS DE ALQUILER DE OFICINAS Y GASTOS",
    "ALQUILER DE VEHICULO MVD UY",
    "LIMPIEZA",
    "WI-FI / TELEFONO",
    "SERVICIOS DE SOFTWARE CARGAS",
    "BPS",
    "LIBRERIA Y OTROS",
    "COSTO POR CUENTA Y ORDEN",
    "POLIZA DE SEGUROS ARIEL",
    "POLIZA SEGURO ACCIDENTES DE TRABAJO",
    "PASAJE AEP - MVD - AEP",
    "SUELDO",
    "AGUINALDO",
    "OTROS",
  ],
  // Havanna Perú: los 10 valores de la columna DETALLE de la hoja «MOVIMIENTOS OCTUBRE 26» del libro de Perú, en su orden, y OTROS
  // al final (11 en total; con SIN CLASIFICAR, que el sistema agrega siempre primero, 12). OTROS está escrito acá a propósito: el
  // sistema NO lo agrega solo. PENDIENTE DE CONFIRMAR CON NADINA: OTROS no sale del libro, se sumó por analogía con Bradenton y
  // Plate Silver; si ella no lo quiere, se borra esa línea (y el test que lo fija).
  "havanna-peru": [
    "COBRANZAS CLIENTES",
    "PROVEEDORES Y SERVICIOS",
    "SUELDOS",
    "COMISIONES BANCARIAS",
    "IMPUESTOS",
    "PRESTAMOS",
    "SOLES A DOLARES",
    "TARJETA",
    "EXPENSAS",
    "IMPORTACION",
    "OTROS",
  ],
};
