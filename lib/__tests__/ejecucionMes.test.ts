import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { construirExcelMovimientos } from "@/lib/ejecucionExcel";
import { mapearMovimiento } from "@/lib/ejecucionVista";
import { avisoSemanasAbiertas, sumarTotalesSemanales, whereMovimientosDelMes } from "@/lib/ejecucionMes";

// "Todo el mes" de la pestaña Ejecución de la empresa. Lo puro se prueba con datos en memoria (un
// intérprete mínimo del `where`, como en filtroClasificacionEmpresa.test.ts); lo que habla con la base
// (permiso, consultas) se verifica leyendo la fuente: acá no se toca la base ni se levanta el server.

const leerFuente = (...partes: string[]) => readFileSync(join(process.cwd(), ...partes), "utf8");
const DIR = ["app", "[empresa]", "[periodo]", "ejecucion"];
const FUENTE_DATOS = leerFuente(...DIR, "datos.ts");
const FUENTE_PAGINA = leerFuente(...DIR, "mes", "page.tsx");
const FUENTE_EXCEL = leerFuente(...DIR, "mes", "excel", "route.ts");
const FUENTE_NAV = leerFuente(...DIR, "NavSemanas.tsx");

type Fila = {
  id: string;
  ejecucionId: string;
  clasificacion: string;
  unidadNegocio: string;
  desglose: { unidadNegocio: string; importe: number }[];
  importe: number;
  ignorado: boolean;
};

const MIS_UNIDADES = ["SPP", "RADIO"];
const f = (id: string, ejecucionId: string, unidadNegocio: string, importe: number, extra: Partial<Fila> = {}): Fila => ({
  id,
  ejecucionId,
  clasificacion: "PROV Y SERV",
  unidadNegocio,
  desglose: [],
  importe,
  ignorado: false,
  ...extra,
});

const SEMANAS = [
  { id: "s1", numeroSemana: 1, estado: "CERRADA" },
  { id: "s2", numeroSemana: 2, estado: "CERRADA" },
  { id: "s3", numeroSemana: 3, estado: "ABIERTA" },
];

const FILAS: Fila[] = [
  f("a1", "s1", "SPP", -100.1),
  f("a2", "s1", "RADIO", -50.2),
  f("a3", "s2", "SPP", 300.05),
  f("a4", "s3", "RADIO", -20.15, { clasificacion: "SUELDOS" }),
  // Ignorado: no entra ni a la lista ni al total.
  f("i1", "s2", "SPP", -999, { ignorado: true }),
  // De otra empresa.
  f("b1", "s1", "JPS", -7777),
  f("b2", "s3", "AVIANOR", -8888),
  // Prorrateado: solo cuenta la porción propia (SPP -40), la otra es de otra empresa.
  f("p1", "s2", "JPS", -100, { desglose: [{ unidadNegocio: "SPP", importe: -40 }, { unidadNegocio: "JPS", importe: -60 }] }),
  // De una semana que no es del período.
  f("x1", "otro-periodo", "SPP", -1),
  // Clasificación oculta para el usuario.
  f("o1", "s1", "SPP", -5, { clasificacion: "RESERVADA" }),
];

function evaluar(where: Record<string, unknown>, fila: Fila): boolean {
  return Object.entries(where).every(([clave, valor]) => {
    switch (clave) {
      case "ejecucionId":
        return (valor as { in: string[] }).in.includes(fila.ejecucionId);
      case "ignorado":
        return fila.ignorado === valor;
      case "clasificacion":
        return typeof valor === "string" ? fila.clasificacion === valor : (valor as { in: string[] }).in.includes(fila.clasificacion);
      case "NOT":
        return !evaluar(valor as Record<string, unknown>, fila);
      case "unidadNegocio":
        return (valor as { in: string[] }).in.includes(fila.unidadNegocio);
      case "desglose": {
        const d = valor as { none?: object; some?: { unidadNegocio: { in: string[] } } };
        if (d.none) return fila.desglose.length === 0;
        if (d.some) return fila.desglose.some((x) => d.some!.unidadNegocio.in.includes(x.unidadNegocio));
        throw new Error("desglose desconocido");
      }
      case "OR":
        return (valor as Record<string, unknown>[]).some((w) => evaluar(w, fila));
      default:
        throw new Error(`clave de where no soportada en el test: ${clave}`);
    }
  });
}

const IDS = SEMANAS.map((s) => s.id);
const consultar = (unidades: string[], clasificacion?: string, ocultas: string[] = [], ids = IDS) =>
  FILAS.filter((fila) => evaluar(whereMovimientosDelMes(ids, unidades, clasificacion, ocultas) as Record<string, unknown>, fila)).map(
    (fila) => fila.id
  );

// Total de UNA semana como lo hace sumarImporteDeUnidades: sin ignorados, no prorrateados de sus
// unidades + porciones propias de los prorrateados.
function totalSemana(ejecucionId: string, unidades: string[], clasificacion?: string, ocultas: string[] = []) {
  let centavos = 0;
  for (const fila of FILAS) {
    if (fila.ejecucionId !== ejecucionId || fila.ignorado) continue;
    if (clasificacion && fila.clasificacion !== clasificacion) continue;
    if (ocultas.includes(fila.clasificacion)) continue;
    if (fila.desglose.length === 0) {
      if (unidades.includes(fila.unidadNegocio)) centavos += Math.round(fila.importe * 100);
    } else {
      for (const d of fila.desglose) if (unidades.includes(d.unidadNegocio)) centavos += Math.round(d.importe * 100);
    }
  }
  return centavos / 100;
}

// ---------- Total ----------

test("TOTAL: el total del mes es la suma de los totales de cada semana", () => {
  const porSemana = SEMANAS.map((s) => totalSemana(s.id, MIS_UNIDADES));
  assert.deepEqual(porSemana, [-155.3, 260.05, -20.15]);
  assert.equal(sumarTotalesSemanales(porSemana), 84.6);
});

test("TOTAL: la suma en centavos no arrastra deriva de coma flotante", () => {
  assert.equal(sumarTotalesSemanales([0.1, 0.2]), 0.3); // 0.1 + 0.2 en flotante da 0.30000000000000004
  assert.equal(sumarTotalesSemanales([]), 0);
  assert.equal(sumarTotalesSemanales([-1234.56, 1234.56]), 0);
});

test("TOTAL: con filtro de clasificación también cierra semana por semana", () => {
  const porSemana = SEMANAS.map((s) => totalSemana(s.id, MIS_UNIDADES, "SUELDOS"));
  assert.equal(sumarTotalesSemanales(porSemana), -20.15);
});

// ---------- Unidades de la empresa ----------

test("UNIDADES: solo salen movimientos de las unidades de la empresa (y porciones propias de prorrateo), de todas las semanas", () => {
  assert.deepEqual(consultar(MIS_UNIDADES, undefined, ["RESERVADA"]), ["a1", "a2", "a3", "a4", "p1"]);
});

test("UNIDADES: movimientos de otras empresas y de otro período no aparecen", () => {
  const ids = consultar(MIS_UNIDADES);
  for (const ajeno of ["b1", "b2", "x1"]) assert.equal(ids.includes(ajeno), false, ajeno);
  // Con las unidades de la otra empresa salen los suyos, no los de la primera.
  assert.deepEqual(consultar(["JPS", "AVIANOR"]), ["b1", "b2", "p1"]);
});

test("UNIDADES: una empresa sin unidades no ve nada", () => {
  assert.deepEqual(consultar([]), []);
});

// ---------- Ignorados ----------

test("IGNORADOS: no aparecen movimientos ignorados", () => {
  assert.equal(consultar(MIS_UNIDADES).includes("i1"), false);
  assert.equal(whereMovimientosDelMes(IDS, MIS_UNIDADES, undefined).ignorado, false);
});

// ---------- Filtro y ocultas ----------

test("FILTRO: la clasificación elegida se combina por AND con todo lo demás", () => {
  assert.deepEqual(consultar(MIS_UNIDADES, "SUELDOS"), ["a4"]);
  assert.deepEqual(consultar(MIS_UNIDADES, "PROV Y SERV"), ["a1", "a2", "a3", "p1"]);
  // Una clasificación de otra empresa da cero filas.
  assert.deepEqual(consultar(MIS_UNIDADES, "NO EXISTE"), []);
});

test("OCULTAS: las clasificaciones reservadas se excluyen de la lista, también si la URL las pide", () => {
  assert.equal(consultar(MIS_UNIDADES, undefined, ["RESERVADA"]).includes("o1"), false);
  assert.equal(consultar(MIS_UNIDADES).includes("o1"), true);
  assert.deepEqual(consultar(MIS_UNIDADES, "RESERVADA", ["RESERVADA"]), []);
  assert.equal(sumarTotalesSemanales(SEMANAS.map((s) => totalSemana(s.id, MIS_UNIDADES, undefined, ["RESERVADA"]))), 89.6);
});

// ---------- Aviso de semanas abiertas ----------

test("AVISO: con semanas abiertas muestra la cantidad", () => {
  assert.equal(
    avisoSemanasAbiertas(SEMANAS),
    "Incluye semanas abiertas (1): los valores pueden cambiar hasta que se cierren."
  );
  assert.equal(
    avisoSemanasAbiertas([{ estado: "ABIERTA" }, { estado: "ABIERTA" }, { estado: "CERRADA" }]),
    "Incluye semanas abiertas (2): los valores pueden cambiar hasta que se cierren."
  );
});

test("AVISO: con todas cerradas (o sin semanas) no hay aviso", () => {
  assert.equal(avisoSemanasAbiertas([{ estado: "CERRADA" }, { estado: "CERRADA" }]), null);
  assert.equal(avisoSemanasAbiertas([]), null);
});

// ---------- Permiso (fuente) ----------

test("PERMISO: la pantalla y el Excel del mes exigen acceso a la empresa, igual que por semana", () => {
  // datos.ts: la función del mes pasa por resolverEmpresaParaLeer (requireAccesoEmpresa) antes de consultar nada.
  const cuerpoMes = FUENTE_DATOS.slice(FUENTE_DATOS.indexOf("export async function obtenerDatosMesDeEmpresa"));
  assert.ok(cuerpoMes.indexOf("resolverEmpresaParaLeer(") >= 0);
  assert.ok(cuerpoMes.indexOf("resolverEmpresaParaLeer(") < cuerpoMes.indexOf("prisma."));
  assert.match(FUENTE_DATOS, /const usuario = await requireAccesoEmpresa\(empresa\.id\)/);
  // Excel: requireAccesoEmpresa antes de consultar, y 403 si no hay acceso.
  assert.ok(FUENTE_EXCEL.indexOf("requireAccesoEmpresa(empresa.id)") < FUENTE_EXCEL.indexOf("prisma.ejecucionSemanal"));
  assert.match(FUENTE_EXCEL, /status: 403/);
});

test("PERMISO/OCULTAS: pantalla y Excel usan las mismas clasificaciones ocultas y las unidades de la empresa", () => {
  for (const fuente of [FUENTE_DATOS.slice(FUENTE_DATOS.indexOf("obtenerDatosMesDeEmpresa")), FUENTE_EXCEL]) {
    assert.match(fuente, /obtenerValoresOcultos\(/);
    assert.match(fuente, /whereMovimientosDelMes\(/);
    assert.match(fuente, /empresa\.unidadesNegocio|unidades/);
  }
  assert.match(FUENTE_DATOS, /sumarImporteDeUnidades\(s\.id/);
  // Sin saldo: ni la pantalla ni el Excel piden verSaldo.
  assert.equal(/verSaldo/.test(FUENTE_DATOS.slice(FUENTE_DATOS.indexOf("obtenerDatosMesDeEmpresa"))), false);
  assert.match(FUENTE_EXCEL, /,\s*false,\s*true\s*\)/);
});

test("PANTALLA: pestaña Todo el mes al lado de las semanas, aviso y columna Semana", () => {
  assert.match(FUENTE_NAV, /Todo el mes/);
  assert.match(FUENTE_NAV, /ejecucion\/mes/);
  assert.match(FUENTE_PAGINA, /datos\.avisoAbiertas/);
  assert.match(FUENTE_PAGINA, /mostrarSemana/);
  assert.match(FUENTE_PAGINA, /soloLectura/);
});

// ---------- Excel ----------

function mov(id: string, importe: number) {
  return {
    id,
    fecha: new Date("2026-10-05T00:00:00Z"),
    concepto: "Pago",
    importe,
    bancoYCuenta: "SANT CC",
    clasificacion: "PROV Y SERV",
    unidadNegocio: "SPP",
    detalle: "",
    ignorado: false,
    sugeridaPorSistema: false,
    chequeIvaAmbiguo: false,
    unidadSugeridaPorSistema: false,
    desglose: [],
  };
}

async function leer(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets[0];
}

test("EXCEL: con conSemana agrega la columna Semana y el resto queda igual", async () => {
  const filas = [
    { ...mapearMovimiento(mov("m1", -10), MIS_UNIDADES), semana: 1 },
    { ...mapearMovimiento(mov("m2", 20), MIS_UNIDADES), semana: 3 },
  ];
  const conSemana = await leer(await construirExcelMovimientos(filas, false, true));
  const sinSemana = await leer(await construirExcelMovimientos(filas, false));
  const enc = (h: ExcelJS.Worksheet) => (h.getRow(1).values as unknown[]).slice(1);
  assert.deepEqual(enc(conSemana), ["Fecha", "Semana", "Banco y cuenta", "Concepto", "Importe", "Clasificación", "Unidad de negocio", "Prorrateo", "Detalle"]);
  assert.deepEqual(enc(sinSemana), ["Fecha", "Banco y cuenta", "Concepto", "Importe", "Clasificación", "Unidad de negocio", "Prorrateo", "Detalle"]);
  assert.equal(conSemana.getRow(2).getCell(2).value, 1);
  assert.equal(conSemana.getRow(3).getCell(2).value, 3);
  assert.equal(conSemana.getRow(2).getCell(5).value, -10);
});
