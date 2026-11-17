import Link from "next/link";
import { notFound } from "next/navigation";
import { almacenPrisma } from "@/lib/recuperacionDb";
import { recuperacionActiva, tokenEsValido } from "@/lib/recuperacion";
import MarcoAcceso from "../olvide/MarcoAcceso";
import RestablecerForm from "./RestablecerForm";

// El token va en la URL: no-referrer evita que se filtre en el encabezado Referer hacia otro sitio.
export const metadata = { title: "Nueva contraseña", referrer: "no-referrer", robots: { index: false } };

export default async function RestablecerPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  if (!recuperacionActiva()) notFound();

  const { token: crudo } = await searchParams;
  const token = typeof crudo === "string" ? crudo : "";
  const valido = await tokenEsValido(token, { almacen: almacenPrisma });

  return (
    <MarcoAcceso titulo="Nueva contraseña">
      {valido ? (
        <RestablecerForm token={token} />
      ) : (
        <>
          <p className="text-sm text-terracota bg-terracota-tint rounded-md px-3 py-2">El enlace no es válido o ya venció.</p>
          <p className="mt-4 text-sm">
            <Link href="/olvide" className="text-marino underline underline-offset-2">
              Pedir un enlace nuevo
            </Link>
          </p>
        </>
      )}
    </MarcoAcceso>
  );
}
