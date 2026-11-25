/**
 * GET/POST /api/v1/cron/cliente-esperando — o aviso "cliente esperando resposta"
 * (personalização da Mergulho, 25/11/2026; regra em `lib/inbox/cliente-esperando.ts`).
 *
 * A cada minuto: abre um aviso na Central para a conversa em que o cliente espera
 * há 20 minutos sem resposta de uma pessoa (dentro do horário de atendimento) e
 * resolve o aviso de quem já foi respondido. O push dos avisos leva o aviso ao
 * navegador de quem ligou as notificações, mesmo com o CRM minimizado.
 *
 * Agendada no `scheduler` (`docker/scheduler/entrypoint.sh`), de minuto em minuto.
 * Auth: o mesmo contrato dos demais crons (Bearer do segredo interno, fail-closed).
 * Auditoria só quando a rodada fez alguma coisa (abriu ou resolveu aviso).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { rodadaDoClienteEsperando } from "@/lib/inbox/cliente-esperando";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  let resultado: Awaited<ReturnType<typeof rodadaDoClienteEsperando>>;
  try {
    resultado = await rodadaDoClienteEsperando(createAdminClient(), new Date());
  } catch (erro) {
    logger.error("[cliente-esperando] rodada falhou", {
      error: erro instanceof Error ? erro.message : String(erro),
      requestId,
    });
    return fail("internal_error", "Failed to scan waiting conversations.", 500, { requestId });
  }

  // Rodada que não abriu nem resolveu aviso não é mutação: não audita.
  if (resultado.criados > 0 || resultado.resolvidos > 0) {
    void audit({
      action: "conversation.cliente_esperando_run",
      organizationId: null,
      bypassedRls: true,
      metadata: { ...resultado },
      requestId,
    });
  }

  return ok(resultado, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
