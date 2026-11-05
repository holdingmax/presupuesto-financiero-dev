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
// Quedan FUERA a propósito: Avianor y Expensas (los carga Enrique Macchi con la pantalla vieja de Presupuesto).
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
  // Tercera tanda: Havanna Perú (Real todo manual; slug con doble «n», ver lib/slug.ts).
  "havanna-peru",
];

// Empresas cuyos importes están en dólares: solo cambia el texto «en pesos» del Reporte por «en dólares»
// (ReportePlantilla). No toca ningún cálculo ni formato de importe.
export const EMPRESAS_EN_DOLARES: readonly string[] = ["bradenton", "plate-silver"];

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
export const EMPRESAS_CON_TIPEO_DIRECTO: readonly string[] = ["brillante", "fredy-publicidad", "hwc", "avianor", "mantenor", "radio", "havanna", "conexion-logistica", "conexion-logistica-spp"];

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
];

// Etiqueta del ciclo fiscal que se muestra en la portada de login (app/login/page.tsx).
//
// PENDIENTE: no está derivada de PERIODO todavía. "3 meses hacia atrás terminando en PERIODO"
// se podría calcular de forma trivial, pero no sé si la regla real es esa (ventana móvil de
// 3 meses) o si en realidad es "el trimestre calendario que contiene a PERIODO" (ene-mar,
// abr-jun, jul-sep, oct-dic) — ambas reglas coinciden para PERIODO="2026-09" (da lo mismo,
// Jul-Sep en los dos casos) pero divergen para cualquier período que no sea fin de trimestre
// calendario. Avisen cuál es la regla correcta y lo calculamos a partir de PERIODO.
export const CICLO_FISCAL_LABEL = "Julio 2026 — Septiembre 2026";
