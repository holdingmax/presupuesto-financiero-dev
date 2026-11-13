import { claveMovimiento } from "@/lib/conteoMovimientos";
import { normalizarEncabezado } from "./encabezados";
import { tipoContenedor } from "./contenedor";
import { avisoDeRangoLejano } from "./fechas";
import type { ControlPieMoneda, FilaHavannaPeru, LecturaHavannaPeru, MonedaHavannaPeru } from "./havannaPeru";
import { verificarCantidadFilasHavannaPeru } from "./limites";
import { ErrorExtracto, type OpcionesLectura } from "./tipos";

// Lector puro del extracto crudo de BBVA Perú de Havanna Perú: el "Histórico de Movimientos" que baja el banco con
// extensión .xls pero que en realidad es HTML (una sola tabla). UN archivo = UNA cuenta y UNA moneda; Perú tiene dos
// (soles y dólares) y se suben por separado o juntos. Se pueden subir VARIOS archivos de la misma cuenta cuyas fechas se
// pisan (por si se bajan por tramos): cada movimiento entra una sola vez.
//
// Forma del archivo: arriba la metadata («Histórico de Movimientos», «Periodo: de dd-mm-aaaa a dd-mm-aaaa», «Cuenta
// Actual: <número> <moneda> <titular>», «Importes en: <moneda>»); después la fila de títulos F. Operación · F. Valor ·
// Código · Nº. Doc. · Concepto · Importe · Oficina; un movimiento por fila (empieza con la fecha dd-mm-aaaa; importe con
// signo, punto decimal, sin separador de miles); y filas «Saldo Inicial: dd-mm-aaaa» (una, al principio) y «Saldo Final:
// dd-mm-aaaa» (una por cada día con movimientos). Las filas de saldo NO son movimientos: solo sirven para el control.
//
// CONTROL: saldo inicial + suma de los movimientos = saldo final de la ÚLTIMA fecha. Si no cuadra, no se carga nada.
// La moneda sale del «Importes en:» del encabezado (PEN o USD), nunca de una constante.
//
// NO es un banco de BANCOS_EXTRACTO ni lo toca detectarFormato: se invoca por su propio camino, como Chase y BROU.
// Sin base de datos. Las celdas se leen como TEXTO (no por SheetJS, que reinterpreta fechas e importes).

const MONEDAS_VALIDAS: readonly MonedaHavannaPeru[] = ["PEN", "USD"];

export type ArchivoHistorico = { nombre: string; bytes: Uint8Array };

// Un archivo ya leído, antes de combinar.
export type HistoricoLeido = {
  nombre: string;
  moneda: MonedaHavannaPeru;
  cuenta: string;
  titular: string;
  // Fechas del encabezado «Periodo: de … a …» (AAAA-MM-DD), informativas.
  periodoDesde: string | null;
  periodoHasta: string | null;
  filas: FilaHavannaPeru[];
  inicialCentavos: number;
  fechaInicial: string; // AAAA-MM-DD
  finalCentavos: number;
  fechaFinal: string; // la ÚLTIMA fecha con «Saldo Final»
  // Si el control del propio archivo falla: el texto de qué pasó (si no, null).
  errorControl: string | null;
  avisos: string[];
};

export type LecturaHistoricoBbvaPeru = LecturaHavannaPeru & {
  // Una línea por archivo, para el resumen («archivo.xls · cuenta … · USD · titular · 38 movimientos · 01-10 a 31-10»).
  detalleArchivos: string[];
};

// ---- HTML → grilla de texto ---------------------------------------------------------------------

const ENTIDADES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
  ordm: "º", ordf: "ª", deg: "°",
};

function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}

function textoDeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// Filas de celdas de TEXTO del HTML, en orden. Parte por <tr> y <td>/<th> (no exige que estén cerrados).
export function celdasDeHtml(html: string): string[][] {
  const limpio = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  const trozosFila = limpio.split(/<tr\b[^>]*>/i).slice(1);
  return trozosFila.map((fila) =>
    fila
      .split(/<t[dh]\b[^>]*>/i)
      .slice(1)
      .map((celda) =>
        decodificarEntidades(celda.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
          .replace(/[\s ]+/g, " ")
          .trim()
      )
  );
}

// ¿Es un «Histórico de Movimientos» de BBVA Perú? Por contenido (HTML con ese título), no por la extensión.
export function esHistoricoBbvaPeru(bytes: Uint8Array): boolean {
  if (tipoContenedor(bytes) !== "html") return false;
  return /HISTORICO DE MOVIMIENTOS/.test(normalizarEncabezado(decodificarEntidades(textoDeBytes(bytes.subarray(0, 8192)))));
}

// ---- Números y fechas ---------------------------------------------------------------------------

const FECHA_DMA = /^(\d{2})-(\d{2})-(\d{4})$/;

function fechaDeDmA(texto: string): Date | null {
  const m = FECHA_DMA.exec(texto.trim());
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d ? f : null;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

// «-1234.56» o «-1,234.56» → centavos. Punto decimal, coma SOLO como separador de miles (grupos de 3), hasta 2
// decimales: cualquier otra forma («1.500,50», «1,5») NO se adivina.
function centavosDeImporte(texto: string): number | null {
  const t = texto.replace(/\s/g, "").replace(/−/g, "-");
  const m = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const centavos = Number(m[2].replace(/,/g, "")) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(centavos)) return null;
  return m[1] === "-" ? -centavos : centavos;
}

const fmt = (centavos: number) =>
  `${centavos < 0 ? "-" : ""}${(Math.abs(centavos) / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---- Lectura de UN archivo ----------------------------------------------------------------------

type SaldoLeido = { fecha: string; centavos: number };

function importeDeFilaDeSaldo(celdas: string[], indiceEtiqueta: number, dmaEnEtiqueta: string): number | null {
  // El importe puede estar en otra celda de la fila (lo normal) o pegado a la etiqueta.
  for (let i = celdas.length - 1; i > indiceEtiqueta; i--) {
    if (celdas[i] === "") continue;
    const c = centavosDeImporte(celdas[i]);
    if (c !== null) return c;
  }
  const resto = celdas[indiceEtiqueta].slice(celdas[indiceEtiqueta].indexOf(dmaEnEtiqueta) + dmaEnEtiqueta.length).trim();
  return resto === "" ? null : centavosDeImporte(resto);
}

export function leerHistoricoBbvaPeru(archivo: ArchivoHistorico): HistoricoLeido {
  const { nombre, bytes } = archivo;
  const falla = (msg: string): never => {
    throw new ErrorExtracto(`${nombre}: ${msg}`);
  };
  if (tipoContenedor(bytes) !== "html") {
    falla("tiene que ser el «Histórico de Movimientos» del BBVA Perú (.xls) tal cual se descargó del banco.");
  }
  const filas = celdasDeHtml(textoDeBytes(bytes));
  const textoFila = (f: string[]) => f.filter((c) => c !== "").join(" ");

  // --- Metadata (se busca por TEXTO, en cualquier fila de arriba de la tabla) ---
  let titulo = false;
  let periodo: RegExpExecArray | null = null;
  let cuentaLinea: string | null = null;
  let monedaTexto: string | null = null;
  let indiceEncabezado = -1;
  const col: Record<string, number> = {};
  for (let i = 0; i < filas.length; i++) {
    const t = normalizarEncabezado(textoFila(filas[i]));
    if (/HISTORICO DE MOVIMIENTOS/.test(t)) titulo = true;
    periodo ??= /PERIODO: ?DE (\d{2}-\d{2}-\d{4}) A (\d{2}-\d{2}-\d{4})/.exec(t);
    const cuenta = /Cuenta Actual:\s*(.+)$/i.exec(textoFila(filas[i]));
    if (cuenta && cuentaLinea === null) cuentaLinea = cuenta[1].trim();
    const mon = /IMPORTES EN: ?(.+)$/.exec(t);
    if (mon && monedaTexto === null) monedaTexto = mon[1].trim();
    if (indiceEncabezado < 0) {
      const textos = filas[i].map((c) => normalizarEncabezado(c));
      const iFecha = textos.findIndex((x) => ["F. OPERACION", "F.OPERACION", "F OPERACION"].includes(x));
      const iImporte = textos.indexOf("IMPORTE");
      const iConcepto = textos.indexOf("CONCEPTO");
      if (iFecha >= 0 && iImporte >= 0 && iConcepto >= 0) {
        indiceEncabezado = i;
        col.fecha = iFecha;
        col.importe = iImporte;
        col.concepto = iConcepto;
        const iDoc = textos.findIndex((x) => /^(N[º°O]?|NRO)\.? ?(DOC|DOCUMENTO)\.?$/.test(x));
        if (iDoc >= 0) col.nroDoc = iDoc;
        const iCod = textos.findIndex((x) => /^COD(IGO)?\.?$/.test(x));
        if (iCod >= 0) col.codigo = iCod;
      }
    }
  }
  if (!titulo) falla("no es un «Histórico de Movimientos» del BBVA Perú.");
  if (indiceEncabezado < 0) falla("no encontré la tabla de movimientos (F. Operación, Concepto, Importe).");

  if (monedaTexto === null) falla("no encontré «Importes en:» en el encabezado. No sé en qué moneda está.");
  const moneda = monedaTexto!.toUpperCase().split(/\s+/)[0] as MonedaHavannaPeru;
  if (!MONEDAS_VALIDAS.includes(moneda)) {
    falla(`no reconozco la moneda «${monedaTexto}» del encabezado «Importes en:» (esperaba PEN o USD).`);
  }
  if (cuentaLinea === null) falla("no encontré «Cuenta Actual:» en el encabezado. No sé de qué cuenta es.");
  const cm = /^(.+?)\s+(PEN|USD)\b\s*(.*)$/i.exec(cuentaLinea!);
  if (!cm) falla(`no pude leer el número de cuenta y la moneda de «Cuenta Actual: ${cuentaLinea}».`);
  const cuenta = cm![1].trim();
  if (cm![2].toUpperCase() !== moneda) {
    falla(`la cuenta dice moneda ${cm![2].toUpperCase()} pero «Importes en:» dice ${moneda}. No sé en qué moneda está.`);
  }
  const titular = cm![3].trim();

  // --- Movimientos y saldos ---
  const avisos = new Set<string>();
  const movimientos: FilaHavannaPeru[] = [];
  const saldosIniciales: SaldoLeido[] = [];
  const saldosFinales: SaldoLeido[] = [];
  let ignoradas = 0;
  for (let i = indiceEncabezado + 1; i < filas.length; i++) {
    const celdas = filas[i];
    if (celdas.every((c) => c === "")) continue;
    const numeroFila = i + 1;
    const primera = celdas[col.fecha] ?? "";

    // Fila de saldo (la etiqueta puede estar en cualquier celda).
    const iEtiqueta = celdas.findIndex((c) => /^SALDO (INICIAL|FINAL): ?\d{2}-\d{2}-\d{4}/.test(normalizarEncabezado(c)));
    if (iEtiqueta >= 0) {
      const m = /^SALDO (INICIAL|FINAL): ?(\d{2}-\d{2}-\d{4})/.exec(normalizarEncabezado(celdas[iEtiqueta]))!;
      const fecha = fechaDeDmA(m[2]);
      if (!fecha) falla(`fila ${numeroFila}: fecha inválida en «${celdas[iEtiqueta]}».`);
      const centavos = importeDeFilaDeSaldo(celdas, iEtiqueta, m[2]);
      if (centavos === null) falla(`fila ${numeroFila}: no pude leer el importe de «${celdas[iEtiqueta]}».`);
      (m[1] === "INICIAL" ? saldosIniciales : saldosFinales).push({ fecha: dia(fecha!), centavos: centavos! });
      continue;
    }

    const fecha = fechaDeDmA(primera);
    if (!fecha) {
      // Fila que no es movimiento ni saldo (títulos repetidos, leyendas). Si parece tener una fecha, NO se descarta.
      if (/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(primera)) falla(`fila ${numeroFila}: fecha inválida («${primera}»). Esperaba dd-mm-aaaa.`);
      ignoradas++;
      continue;
    }
    const importeTexto = celdas[col.importe] ?? "";
    if (importeTexto === "") falla(`fila ${numeroFila}: el movimiento no tiene importe.`);
    const importeCentavos = centavosDeImporte(importeTexto);
    if (importeCentavos === null) {
      falla(`fila ${numeroFila}: no pude leer el importe («${importeTexto}»). Esperaba un número con punto decimal, sin separador de miles.`);
    }
    const nroDoc = col.nroDoc === undefined ? "" : (celdas[col.nroDoc] ?? "");
    const codigo = col.codigo === undefined ? "" : (celdas[col.codigo] ?? "");
    movimientos.push({
      numeroFila,
      fecha: fecha,
      concepto: celdas[col.concepto] || "(sin concepto)",
      importeCentavos: importeCentavos!,
      saldoCentavos: null,
      // Texto: conserva ceros a la izquierda. Sin número = null.
      referencia: nroDoc === "" ? null : nroDoc,
      causal: codigo === "" ? null : codigo,
      detalle: null,
      moneda,
    });
  }
  if (ignoradas > 0) avisos.add(`${nombre}: se ignoraron ${ignoradas} filas que no son movimientos ni saldos (títulos o leyendas).`);

  if (saldosIniciales.length !== 1) {
    falla(
      saldosIniciales.length === 0
        ? "no encontré la fila «Saldo Inicial». Sin ella no se puede controlar el archivo."
        : `hay ${saldosIniciales.length} filas «Saldo Inicial» y tiene que haber una.`
    );
  }
  if (saldosFinales.length === 0) falla("no encontré ninguna fila «Saldo Final». Sin ella no se puede controlar el archivo.");

  const inicial = saldosIniciales[0];
  const ordenFinales = [...saldosFinales].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ultimo = ordenFinales[ordenFinales.length - 1];
  // Dos «Saldo Final» de la misma fecha con importes distintos: no se sabe cuál vale.
  for (const s of ordenFinales) {
    if (s.fecha === ultimo.fecha && s.centavos !== ultimo.centavos) falla(`hay dos «Saldo Final» del ${ultimo.fecha} con importes distintos.`);
  }

  const suma = movimientos.reduce((a, f) => a + f.importeCentavos, 0);
  const diferencia = inicial.centavos + suma - ultimo.centavos;
  let errorControl: string | null = null;
  if (diferencia !== 0) {
    // Dónde se rompe: el primer día cuyo saldo final no es el corrido (solo diagnóstico).
    let corrido = inicial.centavos;
    let dondeSeRompe = "";
    const dias = [...new Set(movimientos.map((f) => dia(f.fecha)))].sort();
    let k = 0;
    for (const s of ordenFinales) {
      while (k < dias.length && dias[k] <= s.fecha) {
        corrido += movimientos.filter((f) => dia(f.fecha) === dias[k]).reduce((a, f) => a + f.importeCentavos, 0);
        k++;
      }
      if (corrido !== s.centavos) {
        dondeSeRompe = ` El primer día que no coincide es el ${s.fecha}: el banco informa saldo final ${fmt(s.centavos)} y con los movimientos leídos da ${fmt(corrido)}.`;
        break;
      }
    }
    errorControl = `${nombre}: el saldo no cuadra. Saldo inicial ${fmt(inicial.centavos)} + movimientos ${fmt(suma)} = ${fmt(inicial.centavos + suma)}, pero el saldo final del ${ultimo.fecha} es ${fmt(ultimo.centavos)} (diferencia ${fmt(diferencia)}).${dondeSeRompe}`;
  }

  return {
    nombre,
    moneda,
    cuenta,
    titular,
    periodoDesde: periodo ? dia(fechaDeDmA(periodo[1])!) : null,
    periodoHasta: periodo ? dia(fechaDeDmA(periodo[2])!) : null,
    filas: movimientos,
    inicialCentavos: inicial.centavos,
    fechaInicial: inicial.fecha,
    finalCentavos: ultimo.centavos,
    fechaFinal: ultimo.fecha,
    errorControl,
    avisos: [...avisos],
  };
}

// ---- Varios archivos de la misma cuenta ---------------------------------------------------------

// Clave de un movimiento ENTRE archivos (sin cuenta: todavía no se resolvió): fecha + importe + concepto + Nº Doc + moneda.
const claveEntreArchivos = (f: FilaHavannaPeru) =>
  claveMovimiento({
    fecha: f.fecha,
    importeCentavos: f.importeCentavos,
    bancoYCuenta: "",
    concepto: f.concepto,
    nroReferencia: f.referencia,
    saldoCentavos: null,
    moneda: f.moneda,
  });

// Lee uno o varios archivos. Los de la misma cuenta se combinan: lo que se pisa entre archivos entra UNA vez (de cada
// clave se toma el MAYOR conteo de un solo archivo, no la suma: dos movimientos realmente idénticos del mismo día siguen
// siendo dos). El control del archivo combinado es el de siempre sobre el rango completo (saldo inicial del primer tramo,
// saldo final del último): si falta un tramo o los archivos no coinciden en lo que se pisa, no cuadra y no se carga nada.
export function leerHistoricosBbvaPeru(archivos: readonly ArchivoHistorico[], opciones: OpcionesLectura = {}): LecturaHistoricoBbvaPeru {
  if (archivos.length === 0) throw new ErrorExtracto("No hay archivos para leer.");
  const leidos = archivos.map(leerHistoricoBbvaPeru);

  const errores: string[] = [];
  const avisos = new Set<string>(leidos.flatMap((l) => l.avisos));
  for (const l of leidos) if (l.errorControl) errores.push(l.errorControl);

  // Una cuenta por moneda: dos archivos de la misma moneda con distinto número de cuenta no se mezclan.
  const porMoneda = new Map<MonedaHavannaPeru, HistoricoLeido[]>();
  for (const l of leidos) porMoneda.set(l.moneda, [...(porMoneda.get(l.moneda) ?? []), l]);
  for (const [moneda, lista] of porMoneda) {
    const cuentas = [...new Set(lista.map((l) => l.cuenta))];
    if (cuentas.length > 1) {
      throw new ErrorExtracto(`Los archivos de ${moneda} son de cuentas distintas (${cuentas.join(" y ")}). Subí juntos solo archivos de la misma cuenta.`);
    }
  }

  const filas: FilaHavannaPeru[] = [];
  const control: ControlPieMoneda[] = [];
  for (const [moneda, lista] of porMoneda) {
    const ordenados = [...lista].sort((a, b) => a.fechaInicial.localeCompare(b.fechaInicial) || a.fechaFinal.localeCompare(b.fechaFinal));
    const yaTomadas = new Map<string, number>();
    const combinadas: FilaHavannaPeru[] = [];
    let repetidas = 0;
    for (const l of ordenados) {
      const vistasEnEste = new Map<string, number>();
      for (const f of l.filas) {
        const k = claveEntreArchivos(f);
        const n = (vistasEnEste.get(k) ?? 0) + 1;
        vistasEnEste.set(k, n);
        if (n > (yaTomadas.get(k) ?? 0)) {
          yaTomadas.set(k, n);
          combinadas.push(f);
        } else {
          repetidas++;
        }
      }
    }
    if (repetidas > 0) avisos.add(`Los archivos de ${moneda} se pisan en fechas: ${repetidas} movimientos aparecían en más de un archivo y se toman una sola vez.`);

    const primero = ordenados[0];
    const ultimo = [...ordenados].sort((a, b) => a.fechaFinal.localeCompare(b.fechaFinal))[ordenados.length - 1];
    // Mismo punto de partida / de llegada en dos archivos: tienen que coincidir.
    for (const l of ordenados) {
      if (l.fechaInicial === primero.fechaInicial && l.inicialCentavos !== primero.inicialCentavos) {
        errores.push(`Los archivos de ${moneda} informan saldos iniciales distintos para el ${primero.fechaInicial} (${fmt(primero.inicialCentavos)} y ${fmt(l.inicialCentavos)}).`);
      }
      if (l.fechaFinal === ultimo.fechaFinal && l.finalCentavos !== ultimo.finalCentavos) {
        errores.push(`Los archivos de ${moneda} informan saldos finales distintos para el ${ultimo.fechaFinal} (${fmt(ultimo.finalCentavos)} y ${fmt(l.finalCentavos)}).`);
      }
    }

    // Cronológico (estable: dentro del día se conserva el orden del archivo).
    const cronologicas = combinadas
      .map((f, i) => ({ f, i }))
      .sort((a, b) => a.f.fecha.getTime() - b.f.fecha.getTime() || a.i - b.i)
      .map((x) => x.f);

    const movimientos = cronologicas.reduce((a, f) => a + f.importeCentavos, 0);
    const diferencia = primero.inicialCentavos + movimientos - ultimo.finalCentavos;
    if (diferencia !== 0 && lista.length > 1 && lista.every((l) => l.errorControl === null)) {
      errores.push(
        `Los archivos de ${moneda} no forman un tramo continuo: saldo inicial ${fmt(primero.inicialCentavos)} (${primero.fechaInicial}) + movimientos ${fmt(movimientos)} no da el saldo final ${fmt(ultimo.finalCentavos)} (${ultimo.fechaFinal}); diferencia ${fmt(diferencia)}. ¿Falta un tramo de fechas?`
      );
    }
    const fechas = cronologicas.map((f) => f.fecha);
    control.push({
      moneda,
      inicialCentavos: primero.inicialCentavos,
      movimientosCentavos: movimientos,
      finalCentavos: ultimo.finalCentavos,
      diferenciaCentavos: diferencia,
      estado: diferencia === 0 ? "cuadra" : "no_cuadra",
      desde: fechas.length > 0 ? dia(new Date(Math.min(...fechas.map((d) => d.getTime())))) : primero.fechaInicial,
      hasta: fechas.length > 0 ? dia(new Date(Math.max(...fechas.map((d) => d.getTime())))) : ultimo.fechaFinal,
    });
    filas.push(...cronologicas);
  }

  if (filas.length === 0) throw new ErrorExtracto("Los archivos no tienen movimientos.");
  const lim = verificarCantidadFilasHavannaPeru(filas.length);
  if (!lim.ok) throw new ErrorExtracto(lim.error);

  const lejano = avisoDeRangoLejano(filas.map((f) => f.fecha), opciones.hoy ?? new Date());
  if (lejano) avisos.add(lejano);

  const cuentas = [...new Set(leidos.map((l) => l.cuenta))];
  return {
    filas,
    cuentaEnArchivo: cuentas.length === 1 ? cuentas[0] : null,
    cuitEnArchivo: null,
    avisos: [...avisos],
    control,
    monedaAsumida: false,
    errores,
    detalleArchivos: leidos.map(
      (l) => `${l.nombre} · cuenta ${l.cuenta} · ${l.moneda}${l.titular ? ` · ${l.titular}` : ""} · ${l.filas.length} movimientos · ${l.fechaInicial} a ${l.fechaFinal}`
    ),
  };
}
