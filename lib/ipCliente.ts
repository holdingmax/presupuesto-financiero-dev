// IP del cliente para el límite de pedidos de recuperación.
//
// Situación en Render (informada, NO verificada acá): el tráfico pasa por Cloudflare antes de llegar a
// Render, y Render no limpia un x-forwarded-for que ya traiga el cliente. Entonces:
//   - la ÚLTIMA entrada de x-forwarded-for puede ser la IP de Cloudflare (compartida por muchos usuarios);
//   - las entradas de la IZQUIERDA las puede inventar cualquiera.
// Por eso el orden por defecto prefiere los encabezados de Cloudflare y deja x-forwarded-for como último
// recurso. cf-connecting-ip va PRIMERO porque Cloudflare lo pone (y pisa el que mande el cliente) en
// todos los pedidos; true-client-ip solo lo agrega si está habilitado: si no lo está, un cliente puede
// mandar el suyo y esquivar el límite por IP.
//
// El orden se puede cambiar con la variable IP_CLIENTE_ENCABEZADOS (lista separada por comas con
// nombres de esta lista blanca; los desconocidos se ignoran). Ejemplo por defecto:
//   IP_CLIENTE_ENCABEZADOS="cf-connecting-ip,true-client-ip,x-forwarded-for"

export const ENCABEZADOS_IP_CONOCIDOS = ["cf-connecting-ip", "true-client-ip", "x-forwarded-for", "x-real-ip"] as const;
export type EncabezadoIp = (typeof ENCABEZADOS_IP_CONOCIDOS)[number];

export const ORDEN_IP_POR_DEFECTO: readonly EncabezadoIp[] = ["cf-connecting-ip", "true-client-ip", "x-forwarded-for"];

// Con x-forwarded-for se toma la entrada contando desde la DERECHA (1 = la última, la que agregó el
// proxy más cercano a la app).
export const SALTOS_PROXY_CONFIABLES = 1;

// Una IPv4/IPv6 "razonable": solo dígitos hex, puntos y dos puntos. Descarta basura antes de hashearla.
const FORMATO_IP = /^[0-9a-fA-F:.]{2,45}$/;

export function ordenDesdeEntorno(valor: string | undefined): readonly EncabezadoIp[] {
  if (!valor) return ORDEN_IP_POR_DEFECTO;
  const conocidos = new Set<string>(ENCABEZADOS_IP_CONOCIDOS);
  const orden: EncabezadoIp[] = [];
  for (const crudo of valor.split(",")) {
    const nombre = crudo.trim().toLowerCase();
    if (conocidos.has(nombre) && !orden.includes(nombre as EncabezadoIp)) orden.push(nombre as EncabezadoIp);
  }
  return orden.length > 0 ? orden : ORDEN_IP_POR_DEFECTO;
}

export function ipDelCliente(
  cabeceras: { get(nombre: string): string | null },
  orden: readonly EncabezadoIp[] = ordenDesdeEntorno(process.env.IP_CLIENTE_ENCABEZADOS),
  saltos = SALTOS_PROXY_CONFIABLES
): string {
  for (const nombre of orden) {
    const valor = cabeceras.get(nombre);
    if (!valor) continue;
    const candidata = nombre === "x-forwarded-for" ? entradaDeLaDerecha(valor, saltos) : valor.trim();
    if (candidata && FORMATO_IP.test(candidata)) return candidata;
  }
  return "desconocida";
}

function entradaDeLaDerecha(xff: string, saltos: number): string | undefined {
  const lista = xff.split(",").map((s) => s.trim()).filter(Boolean);
  return lista[lista.length - saltos];
}
