/**
 * "Ativar follow-up" leva o card para a etapa do fluxo (personalização da
 * Mergulho, nov/2026).
 *
 * O fluxo com gatilho de etapa (`trigger_config.kind = 'stage_change'`) começa
 * quando o card ENTRA na etapa. Inscrito à mão pelo botão do painel do contato,
 * o cliente passava a receber as mensagens com o card parado onde estava: o
 * quadro e a faixa do Inbox diziam "Em atendimento" para quem estava no meio do
 * follow-up, e as regras da etapa (etiqueta-espelho, modalidade copiada para o
 * card) não rodavam.
 *
 * Aqui a inscrição manual faz o movimento que a pessoa faria arrastando o card,
 * com a MESMA função do quadro (`moveLeadHandler`) e em nome de quem clicou. O
 * gatilho de etapa recebe o `lead.stage_changed` e não inscreve de novo: a
 * inscrição já existe, e o índice "1 follow-up vivo por contato" o devolve como
 * `skipped_existing` (`lib/followup/gatilho-etapa.ts`).
 *
 * Melhor esforço: quem chama já gravou a inscrição, e ela não volta atrás se o
 * movimento falhar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import type { Actor } from "@/lib/api/handlers/types";
import { etapaQueOPointerArma } from "@/lib/followup/gatilho-etapa";

export type MotivoSemMovimento = "fluxo_sem_etapa" | "sem_card_aberto" | "ja_na_etapa";

export type ResultadoDoMovimento =
  | { movido: true; leadId: string; etapaId: string }
  | { movido: false; motivo: MotivoSemMovimento };

/** O card aberto do contato no funil da etapa do fluxo, ou `null`. */
export interface CardDoContato {
  id: string;
  stage_id: string;
}

/** A decisão, PURA: mover, ou por que não. */
export function decidirMovimento(
  etapaDoFluxo: string | null,
  card: CardDoContato | null,
): { mover: true; leadId: string; etapaId: string } | { mover: false; motivo: MotivoSemMovimento } {
  if (!etapaDoFluxo) return { mover: false, motivo: "fluxo_sem_etapa" };
  if (!card) return { mover: false, motivo: "sem_card_aberto" };
  if (card.stage_id === etapaDoFluxo) return { mover: false, motivo: "ja_na_etapa" };
  return { mover: true, leadId: card.id, etapaId: etapaDoFluxo };
}

export interface EntradaDoMovimento {
  organizationId: string;
  pointerId: string;
  contactId: string;
  actor: Actor;
  requestId: string;
}

export interface DependenciasDoMovimento {
  mover: typeof moveLeadHandler;
}

export async function levarCardParaEtapaDoFluxo(
  admin: SupabaseClient,
  entrada: EntradaDoMovimento,
  deps: DependenciasDoMovimento = { mover: moveLeadHandler },
): Promise<ResultadoDoMovimento> {
  const { organizationId, pointerId, contactId } = entrada;

  const { data: pointer, error: pointerErr } = await admin
    .from("followup_flow_pointers")
    .select("active_version_id, trigger_config, surface")
    .eq("organization_id", organizationId)
    .eq("id", pointerId)
    .maybeSingle();
  if (pointerErr) throw new Error(pointerErr.message);
  const etapaDoFluxo = pointer ? etapaQueOPointerArma(pointer) : null;
  if (!etapaDoFluxo) return { movido: false, motivo: "fluxo_sem_etapa" };

  // A etapa diz o funil; o card que se move é o ABERTO do contato nesse funil.
  const { data: etapa, error: etapaErr } = await admin
    .from("crm_stages")
    .select("pipeline_id")
    .eq("organization_id", organizationId)
    .eq("id", etapaDoFluxo)
    .maybeSingle();
  if (etapaErr) throw new Error(etapaErr.message);
  if (!etapa) return { movido: false, motivo: "fluxo_sem_etapa" };

  const { data: card, error: cardErr } = await admin
    .from("crm_leads")
    .select("id, stage_id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("pipeline_id", etapa.pipeline_id)
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cardErr) throw new Error(cardErr.message);

  const decisao = decidirMovimento(etapaDoFluxo, (card as CardDoContato | null) ?? null);
  if (!decisao.mover) return { movido: false, motivo: decisao.motivo };

  await deps.mover(
    admin,
    { organization_id: organizationId, actor: entrada.actor, requestId: entrada.requestId },
    decisao.leadId,
    { to_stage_id: decisao.etapaId },
  );
  return { movido: true, leadId: decisao.leadId, etapaId: decisao.etapaId };
}
