import Link from "next/link";
import { MENSAJE_SIN_ACCESO_A_PANTALLA } from "@/lib/permisosViewer";

// Panel que ve un VIEWER (rol de solo lectura, lib/permisosViewer.ts) en las pantallas que no son para él:
// Presupuesto, carga del Real, subida de extracto, Ejecución global y /admin. Mismo estilo que los demás paneles de "sin acceso".
export default function AvisoSinAccesoPantalla() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">
        {MENSAJE_SIN_ACCESO_A_PANTALLA}{" "}
        <Link href="/" className="underline underline-offset-2">
          Ver mis empresas
        </Link>
      </p>
    </div>
  );
}
