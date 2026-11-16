/**
 * GET /api/v1/contact-tags/manuais — as etiquetas que se põem À MÃO no contato
 * (personalização da Mergulho, nov/2026; a regra mora em
 * `lib/contacts/etiquetas-manuais.ts`).
 *
 * `manuais`: o vocabulário da organização menos as automáticas — a lista que o
 * editor do Inbox mostra com o campo vazio. `automaticas`: as que regras ativas
 * põem ou tiram do contato — o editor as esconde também da busca digitada.
 *
 * O vocabulário vem pelo client da SESSÃO (a mesma função e a mesma RLS da busca
 * de `/api/v1/contact-tags`). As REGRAS vêm pelo client admin, filtrado pela
 * organização ativa: a rota de regras exige gerente, e quem atende precisa só do
 * NOME das etiquetas — nada da regra sai daqui além disso.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { etiquetasAutomaticasDoContato, etiquetasManuais, type RegraComEtiquetas } from "@/lib/contacts/etiquetas-manuais";
import { logger } from "@/lib/logger";
import { tagsPageResultSchema } from "@/lib/schemas/tags";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  const supabase = await createClient();
  const { data: pagina, error: erroDoVocabulario } = await supabase.rpc("fn_vocabulario_de_tags_pagina", {
    p_org: org,
    p_busca: "",
    p_offset: 0,
    p_limit: 200,
  });
  const lido = tagsPageResultSchema.safeParse(pagina);
  if (erroDoVocabulario || !lido.success) {
    logger.error("contact-tags/manuais: leitura do vocabulário falhou", {
      requestId,
      orgId: org,
      cause: erroDoVocabulario?.message ?? "formato inesperado",
    });
    return fail("internal_error", "Não foi possível carregar as tags.", 500, { requestId });
  }
  const curadas = lido.data.items.filter((item) => item.no_vocabulario).map((item) => item.tag);

  const { data: regras, error: erroDasRegras } = await createAdminClient()
    .from("automation_rules")
    .select("is_active, actions")
    .eq("organization_id", org)
    .eq("is_active", true);
  if (erroDasRegras) {
    logger.error("contact-tags/manuais: leitura das regras falhou", {
      requestId,
      orgId: org,
      cause: erroDasRegras.message,
    });
    return fail("internal_error", "Não foi possível carregar as tags.", 500, { requestId });
  }

  const automaticas = etiquetasAutomaticasDoContato((regras ?? []) as RegraComEtiquetas[]);
  return ok({ manuais: etiquetasManuais(curadas, automaticas), automaticas }, { requestId });
}
