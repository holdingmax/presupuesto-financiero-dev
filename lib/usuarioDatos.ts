import { casillaReservadosSegunRol, esViewer } from "@/lib/permisosViewer";
import { normalizarEmail } from "@/lib/email";

export type DatosUsuario = {
  nombre: string;
  email: string;
  rol: string;
  empresaIds: string[];
};

// Lectura del formulario de alta/edición de usuario. Vive acá (y no en
// app/admin/usuarios/actions.ts, que es "use server" y solo exporta async) para
// poder testear que el email siempre queda normalizado.
export function leerDatosUsuario(formData: FormData): DatosUsuario {
  return {
    nombre: String(formData.get("nombre") ?? "").trim(),
    email: normalizarEmail(String(formData.get("email") ?? "")),
    rol: String(formData.get("rol") ?? ""),
    empresaIds: formData.getAll("empresaIds").map(String),
  };
}

// Casilla "ve bloques reservados" del alta y la edición (Usuario.veBloquesReservados). Vive acá, y no en
// app/admin/usuarios/actions.ts ("use server": solo exporta async), para poder testearla.
//  - Solo el VIEWER puede tenerla: con cualquier otro rol devuelve `false` (se guarda en false aunque el formulario la
//    mande tildada, y también al pasar un VIEWER a otro rol, para no dejarla escondida).
//  - Para un VIEWER solo se toma lo que manda el formulario si trae la marca `veBloquesReservadosIncluida`: un envío sin
//    esa marca devuelve `undefined` (no se toca lo guardado), así nunca se apaga de rebote.
export function leerCasillaReservados(formData: FormData, rol: string): boolean | undefined {
  if (!esViewer({ rol })) return false;
  if (formData.get("veBloquesReservadosIncluida") !== "1") return undefined;
  return casillaReservadosSegunRol(rol, formData.get("veBloquesReservados") === "on");
}
