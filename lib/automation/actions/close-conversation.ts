/**
 * Ação `close_conversation` (personalização da Mergulho, 25/11/2026) — a regra
 * FECHA a conversa do contato.
 *
 * ─── Por que ela existe ────────────────────────────────────────────────────
 *
 * Nenhuma ação de automação fechava conversa: quando o card ia para "Perdido"
 * (ou "Matriculado"), a conversa seguia aberta na Fila ou em Minhas até alguém
 * clicar em Fechar. A regra "Card entrou em Perdido → Fechar a conversa" é o
 * primeiro uso.
 *
 * ─── O MESMO fechamento do botão ───────────────────────────────────────────
 *
 * Fecha por `fn_service_status(..., 'closed', revisão)`, a função que o botão
 * Fechar (`POST /api/v1/conversations/[id]/close`) usa, com a mesma trava de
 * revisão (PT409): se alguém mexeu na conversa entre a leitura e o fechamento, a
 * ação relê e tenta UMA vez mais; não fecha por cima de estado alheio. Como o
 * botão sem "devolver ao automático", não toca em trava de humano.
 *
 * Fechar não envia NADA ao cliente. Se ele escrever depois, a conversa reabre
 * sozinha (`fn_service_inbound`) e volta para a Fila.
 *
 * ─── Qual conversa? ───────────────────────────────────────────────────────
 *
 * O motor hidrata o contato, nunca a conversa. A conversa do EVENTO vale quando
 * ele a traz (`payload.conversation_id`); senão, TODAS as conversas em
 * andamento do contato nesta organização (uma por número conectado, no máximo
 * `TETO`). "O contato saiu do atendimento" vale para todas.
 *
 * ─── Sem laço ─────────────────────────────────────────────────────────────
 *
 * Fechar grava o status da conversa e não chama `emit_event`; nenhum gatilho de
 * automação escuta conversa fechada. Repetir é inofensivo: conversa já fechada
 * não é lida de novo.
 */
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { CONVERSATION_TERMINAL_STATUSES } from "@/lib/schemas/messaging";

const TIPO = "close_conversation";

/** Conversas em andamento de um contato: uma por número, com folga. */
const TETO = 10;

interface ConversaAberta {
  id: string;
  service_revision: number;
}

function conversaDoEvento(ctx: ActionCtx): string | null {
  const doPayload = ctx.event.payload?.conversation_id;
  return typeof doPayload === "string" ? doPayload : null;
}

async function conversasAbertas(
  ctx: ActionCtx,
  filtro: { conversaId: string } | { contactId: string },
): Promise<ConversaAberta[] | { erro: string }> {
  let consulta = ctx.admin
    .from("conversations")
    .select("id, service_revision")
    .eq("organization_id", ctx.organizationId)
    .not("status", "in", `(${CONVERSATION_TERMINAL_STATUSES.join(",")})`);
  consulta =
    "conversaId" in filtro ? consulta.eq("id", filtro.conversaId) : consulta.eq("contact_id", filtro.contactId);
  const { data, error } = await consulta.limit(TETO);
  if (error) return { erro: error.message };
  return (data ?? []) as ConversaAberta[];
}

/** Fecha UMA conversa pela função do botão. `true` = fechou; `false` = já não estava aberta. */
async function fechar(ctx: ActionCtx, conversa: ConversaAberta): Promise<boolean> {
  let revisao = conversa.service_revision;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const { error } = await ctx.admin.rpc("fn_service_status", {
      p_org: ctx.organizationId,
      p_conversation: conversa.id,
      p_status: "closed",
      p_expected: revisao,
    });
    if (!error) return true;
    const conflito = error.code === "PT409" || error.code === "40001";
    if (!conflito || tentativa > 0) throw new Error(error.message);
    // Alguém mexeu na conversa: relê. Se ela já fechou por outro caminho, nada a fazer.
    const relida = await conversasAbertas(ctx, { conversaId: conversa.id });
    if ("erro" in relida) throw new Error(relida.erro);
    const atual = relida[0];
    if (!atual) return false;
    revisao = atual.service_revision;
  }
  return false;
}

async function execute(ctx: ActionCtx): Promise<ActionResultDetail> {
  const doEvento = conversaDoEvento(ctx);
  const contactId = (ctx.context.contact as { id?: string } | undefined)?.id ?? null;
  if (!doEvento && !contactId) {
    return { type: TIPO, status: "skipped", detail: { reason: "nenhuma_conversa_aberta" } };
  }

  const lidas = await conversasAbertas(
    ctx,
    doEvento ? { conversaId: doEvento } : { contactId: contactId as string },
  );
  if ("erro" in lidas) return { type: TIPO, status: "failed", error: lidas.erro };
  if (lidas.length === 0) {
    return { type: TIPO, status: "skipped", detail: { reason: "nenhuma_conversa_aberta" } };
  }

  const fechadas: string[] = [];
  for (const conversa of lidas) {
    try {
      if (!(await fechar(ctx, conversa))) continue;
    } catch (erro) {
      logger.warn("[automation.close_conversation] não foi possível fechar a conversa", {
        organization_id: ctx.organizationId,
        conversation_id: conversa.id,
        rule_id: ctx.ruleId,
        error: erro instanceof Error ? erro.message : String(erro),
      });
      // As que já fecharam continuam fechadas; a falha diz qual não fechou.
      return {
        type: TIPO,
        status: "failed",
        error: erro instanceof Error ? erro.message : String(erro),
        detail: { fechadas, falhou: conversa.id },
      };
    }
    fechadas.push(conversa.id);
    await audit({
      action: "conversation.closed",
      organizationId: ctx.organizationId,
      resourceType: "conversation",
      resourceId: conversa.id,
      requestId: ctx.requestId,
      metadata: { origem: "automacao", regra_id: ctx.ruleId, regra: ctx.ruleName },
    });
  }

  if (fechadas.length === 0) {
    return { type: TIPO, status: "skipped", detail: { reason: "nenhuma_conversa_aberta" } };
  }
  return {
    type: TIPO,
    status: "success",
    detail: {
      fechadas,
      conversa_de: doEvento ? "evento" : "contato",
      explicacao:
        fechadas.length === 1
          ? "A conversa foi fechada pela regra. Se o cliente escrever, ela reabre na Fila."
          : "As conversas do contato foram fechadas pela regra. Se o cliente escrever, elas reabrem na Fila.",
    },
  };
}

registerAction({ type: TIPO, execute });
