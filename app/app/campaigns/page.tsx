import type { Metadata } from "next";

import { ListaDeCampanhas } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campanhas" };

export default function CampanhasPage() {
  // Auth e organização já vêm garantidas pelo layout de /app; a lista carrega
  // pela API, que confere o papel por conta própria (Gerente, ou Atendente onde a empresa liberou — `lib/campanhas/quem-usa-campanhas.ts`).
  return <ListaDeCampanhas />;
}
