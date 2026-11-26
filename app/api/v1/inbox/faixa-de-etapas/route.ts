/**
 * GET /api/v1/inbox/faixa-de-etapas — as etapas do funil para a faixa do topo do
 * Inbox, com a etiqueta-espelho de cada uma, quantos cards há nela, quantas
 * conversas não lidas os contatos dela têm e, na etapa com passos (o follow-up
 * de 7 mensagens), os mesmos números por passo (personalização da Mergulho,
 * nov/2026; a regra mora em `lib/inbox/faixa-de-etapas.ts`).
 *
 * Contagens de CONVERSA e de contato pelo client da SESSÃO: herdam a RLS de
 * `contacts` e `conversations`, então um atendente em modo "só os meus" vê os
 * números do SEU escopo — a mesma garantia de `/api/v1/conversations/counts`,
 * cuja montagem esta rota repete (canal desativado e contato pessoal fora).
 *
 * O número de CARDS da etapa é a exceção (Mergulho, 25/11/2026): ele conta TODOS
 * os cards da etapa na organização, pelo client admin filtrado pela organização
 * ativa. Pela sessão ele contava só os cards que o perfil enxerga (a SDR via 0
 * em Novo contato porque o card era da administradora), e por isso tinha saído
 * da faixa em 23/11. Sai daqui só o NÚMERO por etapa — nenhum card, nome ou dono.
 *
 * As REGRAS de automação são lidas pelo client admin, filtrado pela organização
 * ativa: a rota de regras exige gerente, e o atendente precisa só do nome das
 * etiquetas — nada da regra sai daqui além disso.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { idsDosCanaisDesativados } from "@/lib/channels/desativado";
import { loadAuthUser } from "@/lib/auth/server";
import { orgAtivaDaApi } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { CONVERSATION_TERMINAL_STATUSES } from "@/lib/schemas";
import { aplicarMarcadores } from "@/lib/inbox/marcador-da-conversa";
import {
  corDaEtapa,
  etapasDaFaixaParaOPapel,
  etiquetasDasEtapas,
  etiquetasDeContatoNasRegras,
  passosDaEtapa,
  type EtapaDaFaixa,
  type FaixaDeEtapas,
  type PassoDaFaixa,
  type RegraParaAFaixa,
} from "@/lib/inbox/faixa-de-etapas";
import { ETAPAS_DE_FIM_NA_FAIXA_DA_ATENDENTE } from "@/lib/inbox/abas-da-mergulho";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { idsDeContatosPessoais } from "../../conversations/_handler";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  const authUser = await loadAuthUser();
  const t = (texto: string) => traduzir(texto, authUser?.idioma ?? "pt-BR");
  const ativa = await orgAtivaDaApi(authUser, requestId);
  if (!ativa.ok) return ativa.response;
  const activeOrg = ativa.org;
  if (!activeOrg) {
    return fail("no_active_org", t("No active organization."), 403, { requestId });
  }
  const org = activeOrg.orgId;

  // O funil pedido, ou o padrão da organização (o primeiro por posição na falta dele).
  const pedido = req.nextUrl.searchParams.get("pipeline_id");
  let consultaDoFunil = supabase
    .from("crm_pipelines")
    .select("id, name, is_default, position")
    .eq("organization_id", org)
    .eq("is_archived", false);
  if (pedido && UUID.test(pedido)) consultaDoFunil = consultaDoFunil.eq("id", pedido);
  const { data: funis, error: erroDoFunil } = await consultaDoFunil
    .order("is_default", { ascending: false })
    .order("position", { ascending: true })
    .limit(1);
  if (erroDoFunil) {
    return fail("internal_error", t("Não foi possível ler o funil."), 500, { requestId });
  }
  const funil = (funis ?? [])[0] as { id: string; name: string } | undefined;
  if (!funil) {
    const vazia: FaixaDeEtapas = { funil: null, etapas: [] };
    return ok(vazia, { requestId });
  }

  const { data: etapas, error: erroDasEtapas } = await supabase
    .from("crm_stages")
    .select("id, name, color, position, is_won, is_lost")
    .eq("organization_id", org)
    .eq("pipeline_id", funil.id)
    .eq("is_archived", false)
    .order("position", { ascending: true });
  if (erroDasEtapas) {
    return fail("internal_error", t("Não foi possível ler as etapas."), 500, { requestId });
  }

  // Todas as regras ativas: as de etapa dizem a etiqueta-espelho; as demais
  // (as de passo, `lead.tag_added`) dizem quais passos existem.
  const admin = createAdminClient();
  const { data: regras } = await admin
    .from("automation_rules")
    .select("trigger_event, is_active, conditions, actions")
    .eq("organization_id", org)
    .eq("is_active", true);
  const lidas = (regras ?? []) as RegraParaAFaixa[];
  const etiquetas = etiquetasDasEtapas(lidas);
  const todasAsEtiquetas = etiquetasDeContatoNasRegras(lidas);

  const pessoais = await idsDeContatosPessoais(supabase, org);
  const desativados = await idsDosCanaisDesativados(supabase, org);

  /** Conversas abertas com mensagem não lida de contatos com QUALQUER uma das etiquetas. */
  async function naoLidas(marcadores: readonly string[]): Promise<number> {
    if (marcadores.length === 0) return 0;
    let consulta = supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .not("status", "in", `(${CONVERSATION_TERMINAL_STATUSES.join(",")})`)
      .gt("unread_count_for_assignee", 0);
    if (desativados.length > 0) {
      consulta = consulta.not("channel_session_id", "in", `(${desativados.join(",")})`);
    }
    if (pessoais.length > 0) {
      consulta = consulta.not("contact_id", "in", `(${pessoais.join(",")})`);
    }
    // O MESMO marcador que a lista aplica quando o botão é clicado.
    consulta = aplicarMarcadores(consulta, marcadores, "ou");
    const { count } = await consulta;
    return count ?? 0;
  }

  type LinhaDaEtapa = {
    id: string;
    name: string;
    color: string | null;
    is_won: boolean | null;
    is_lost: boolean | null;
  };

  const linhas: EtapaDaFaixa[] = await Promise.all(
    ((etapas ?? []) as LinhaDaEtapa[]).map(async (etapa) => {
      const etiqueta = etiquetas.get(etapa.id) ?? null;
      const doPasso = etiqueta ? passosDaEtapa(etiqueta, todasAsEtiquetas) : [];

      // Todos os cards da etapa, de qualquer dono (ver o cabeçalho): admin +
      // organização ativa, e a etapa já veio da leitura pela sessão.
      const { count: cards } = await admin
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org)
        .eq("stage_id", etapa.id);

      const passos: PassoDaFaixa[] = await Promise.all(
        doPasso.map(async (passo) => {
          const { count: contatos } = await supabase
            .from("contacts")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org)
            .contains("tags", [passo.etiqueta]);
          return { ...passo, contatos: contatos ?? 0, novas: await naoLidas([passo.etiqueta]) };
        }),
      );

      const doBotao = passos.length > 0 ? passos.map((p) => p.etiqueta) : etiqueta ? [etiqueta] : [];

      return {
        id: etapa.id,
        nome: etapa.name,
        cor: corDaEtapa(etapa.color),
        etiqueta,
        etiquetas: doBotao,
        passos,
        cards: cards ?? 0,
        novas: await naoLidas(doBotao),
        ganha: etapa.is_won === true,
        perdida: etapa.is_lost === true,
      };
    }),
  );

  // Mergulho: as etapas de fim (Perdido, Matriculado) não aparecem para a
  // Atendente (`lib/inbox/abas-da-mergulho.ts`). Só esconde o botão: não é permissão.
  const verFim = ETAPAS_DE_FIM_NA_FAIXA_DA_ATENDENTE || roleAtLeast(activeOrg.role, "manager");
  const resposta: FaixaDeEtapas = {
    funil: { id: funil.id, nome: funil.name },
    etapas: etapasDaFaixaParaOPapel(linhas, verFim),
  };
  return ok(resposta, { requestId });
}
