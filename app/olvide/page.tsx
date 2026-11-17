import { notFound } from "next/navigation";
import { recuperacionActiva } from "@/lib/recuperacion";
import MarcoAcceso from "./MarcoAcceso";
import OlvideForm from "./OlvideForm";

export const metadata = { title: "Recuperar contraseña", robots: { index: false } };

export default function OlvidePage() {
  if (!recuperacionActiva()) notFound();
  return (
    <MarcoAcceso titulo="¿Olvidaste tu contraseña?">
      <OlvideForm />
    </MarcoAcceso>
  );
}
