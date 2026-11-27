/**
 * GET /api/v1/inbox/faixa-de-etapas/leads?etapa=<uuid> — os LEADS de uma etapa
 * para a lista da esquerda do Inbox (personalização da Mergulho, 27/11/2026).
 *
 * Uma linha por card da etapa, com a conversa mais recente do contato (de
 * qualquer aba, dono ou situação) ou nenhuma, quando ainda não houve conversa.
 * A montagem mora em `lib/inbox/lista-da-etapa.ts`.
 *
 * Tudo pelo client da SESSÃO: herda a RLS de `crm_leads`, `contacts` e
 * `conversations`, então ninguém vê aqui o que não veria no quadro e no Inbox.
 * Na Mergulho a visibilidade é "Todos veem tudo", e a lista bate com o número do
 * botão; numa empresa com visibilidade restrita ela mostraria só o que a pessoa
 * enxerga. Sempre com a organização ativa (cookie validado), nunca do pedido.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { orgAtivaDaApi } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  montarLinhasDaEtapa,
  type CardDaEtapa,
  type ContatoDaEtapa,
  type ConversaDaEtapa,
  type ListaDaEtapa,
} from "@/lib/inbox/lista-da-etapa";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Teto de cards lidos: uma etapa com mais que isto é para o quadro, não para a lista. */
const TETO = 500;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) return fail("unauthenticated", "Auth required.", 401, { requestId });

  const authUser = await loadAuthUser();
  const t = (texto: string) => traduzir(texto, authUser?.idioma ?? "pt-BR");
  const ativa = await orgAtivaDaApi(authUser, requestId);
  if (!ativa.ok) return ativa.response;
  if (!ativa.org) return fail("no_active_org", t("No active organization."), 403, { requestId });
  const org = ativa.org.orgId;

  const etapaId = z.string().uuid().safeParse(req.nextUrl.searchParams.get("etapa"));
  if (!etapaId.success) {
    return fail("validation_failed", t("Parâmetros inválidos."), 422, { requestId, details: { etapa: ["uuid"] } });
  }

  const { data: etapa, error: erroEtapa } = await supabase
    .from("crm_stages")
    .select("id, name")
    .eq("organization_id", org)
    .eq("id", etapaId.data)
    .maybeSingle();
  if (erroEtapa) return fail("internal_error", t("Não foi possível ler a etapa."), 500, { requestId });
  if (!etapa) return fail("resource_not_found", t("Etapa não encontrada."), 404, { requestId });

  const { data: cards, error: erroCards } = await supabase
    .from("crm_leads")
    .select("id, contact_id, updated_at")
    .eq("organization_id", org)
    .eq("stage_id", etapaId.data)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(TETO);
  if (erroCards) return fail("internal_error", t("Não foi possível ler os cards da etapa."), 500, { requestId });
  const lidos = (cards ?? []) as CardDaEtapa[];
  const idsDeContato = [...new Set(lidos.map((c) => c.contact_id).filter((id): id is string => !!id))];

  const contatos = await buscaEmLotes<ContatoDaEtapa>(idsDeContato, async (lote) => {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, name, display_name, phone_number")
      .eq("organization_id", org)
      .in("id", lote);
    return { data: (data ?? null) as ContatoDaEtapa[] | null, error };
  });
  if (contatos.error) return fail("internal_error", t("Não foi possível ler os contatos da etapa."), 500, { requestId });

  const conversas = await buscaEmLotes<ConversaDaEtapa>(idsDeContato, async (lote) => {
    const { data, error } = await supabase
      .from("conversations")
      .select(
        "id, contact_id, status, last_message_at, last_message_preview, unread_count_for_assignee, assigned_to_user_id, assigned_to_user_name",
      )
      .eq("organization_id", org)
      .eq("is_group", false)
      .in("contact_id", lote);
    return { data: (data ?? null) as ConversaDaEtapa[] | null, error };
  });
  if (conversas.error) return fail("internal_error", t("Não foi possível ler as conversas da etapa."), 500, { requestId });

  const resposta: ListaDaEtapa = {
    etapa: { id: (etapa as { id: string }).id, nome: (etapa as { name: string }).name },
    linhas: montarLinhasDaEtapa(lidos, contatos.data, conversas.data),
  };
  return ok(resposta, { requestId });
}
