import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/followups/enrollments/:id/cancel — encerra um
 *   enrollment VIVO (active|waiting_reply|paused_handoff|paused_manual|
 *   coletando|dormente) manualmente pela fila. 409 `already_terminal` se já
 *   tiver encerrado (completed/cancelled/dead) — cancelar 2x não é erro
 *   operacional, mas também não deve reescrever o desfecho de um enrollment que
 *   já fechou por conta própria.
 *
 * Quem pode (Mergulho, nov/2026): gerência, sempre; o Atendente, quando o
 *   cliente é DELE — a MESMA régua de posse do POST de inscrição
 *   (`lib/carteira/posse.ts`, `acao: "follow_up"`): conversa do contato atribuída
 *   a ele, ou o contato na carteira dele. Quem ativa o follow-up do cliente pode
 *   desistir dele; antes, o botão só existia para manager+ e a SDR ficava sem
 *   saída. A escrita vai pelo cliente admin, filtrada pela organização da sessão,
 *   porque a RLS de UPDATE de `followup_enrollments` (0489) é manager+.
 *
 * Promessas (`cron_jobs`) NÃO são canceláveis por aqui — fora de escopo desta
 *   task; só enrollments do motor.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { conferirPosse, respostaDaPosse } from "@/lib/carteira/posse";
import { statusCancelavel } from "@/lib/followup/vocabulario";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// `paused_manual` (0145) é cancelável: quem pausou tem o direito de desistir sem
// ter de retomar antes só para poder encerrar — retomar reagendaria o próximo
// passo, e entre o retomar e o cancelar o motor poderia mandar a mensagem.
// `coletando` (0394) é o roteiro de atendimento em andamento: quem opera pode
// encerrá-lo pela fila — antes, a rota devolvia 409 como se já tivesse acabado.
// `dormente` (0308) é a espera longa pela vaga do contato: a fila o mostra como
// vivo e oferece o botão de cancelar, então quem opera precisa poder desistir de
// uma espera de dias. O cancelamento grava `status = 'cancelled'` com
// `next_eval_at = null`, e o claim do despertar só busca `dormente` — a espera
// cancelada não volta a acordar.
//
// A lista mora em `STATUS_CANCELAVEIS` (#3434) porque era escrita à mão em três
// lugares e o dossiê ficou para trás justamente nesta mudança do #3263: rota,
// fila e dossiê agora leem a MESMA constante.

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) {
    return fail("invalid_request", "id inválido.", 400, { requestId });
  }

  const authz = await requireRole("agent", { requestId, resource: "followup_enrollments" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("followup_enrollments")
    .select("id, status, current_node_id, contact_id")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (fetchErr) return fail("internal_error", fetchErr.message, 500, { requestId });
  if (!existing) return fail("not_found", t("Enrollment não encontrado."), 404, { requestId });

  if (!statusCancelavel(existing.status)) {
    return fail("already_terminal", t("Enrollment já está encerrado."), 409, { requestId });
  }

  // A posse, no servidor: a mesma régua de quem inscreve. Sem `conversaId`, vale
  // qualquer conversa do contato atribuída ao ator (é o que o GET responde à tela
  // em `meta.pode_inscrever`, que mostra o botão).
  const admin = createAdminClient();
  const posse = await conferirPosse({
    acao: "follow_up",
    db: admin,
    organizationId: activeOrg.orgId,
    atorId: user.id,
    papel: activeOrg.role,
    contactId: existing.contact_id,
  });
  if (!posse.pode) return respostaDaPosse(posse, { traduzir: t, requestId });

  const { data: updated, error: updErr } = await admin
    .from("followup_enrollments")
    .update({
      status: "cancelled",
      cancel_reason: "manual",
      next_eval_at: null,
      outcome: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .select("id, status, cancel_reason, updated_at")
    .single();
  if (updErr || !updated) {
    return fail("internal_error", updErr?.message ?? "followup_enrollment_cancel_failed", 500, {
      requestId,
    });
  }

  const { error: eventErr } = await admin.from("followup_enrollment_events").insert({
    organization_id: activeOrg.orgId,
    enrollment_id: id,
    node_id: existing.current_node_id,
    event_type: "cancelled_manual",
    payload: { actor_user_id: user.id },
  });
  if (eventErr) {
    logger.error("[followup.enrollment.cancel] event insert failed", { error: eventErr.message, requestId });
  }

  void audit({
    action: "followup_enrollment.cancelled",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "followup_enrollment",
    resourceId: id,
    requestId,
    metadata: { previous_status: existing.status, posse: posse.motivo },
  });

  return ok(updated, { requestId });
}
