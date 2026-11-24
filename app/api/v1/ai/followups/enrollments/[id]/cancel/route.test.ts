/**
 * Encerrar pela fila um roteiro de atendimento em andamento ('coletando', 0394).
 * Antes a rota devolvia 409 "já está encerrado" — o roteiro não estava na lista
 * de vivos (revisão do PR 1 do port do #1130).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const deps = vi.hoisted(() => ({
  role: vi.fn(),
  support: vi.fn(),
  audit: vi.fn(),
  client: vi.fn(),
  admin: vi.fn(),
  posse: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: deps.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: deps.support }));
vi.mock("@/lib/audit", () => ({ audit: deps.audit }));
vi.mock("@/lib/supabase/server", () => ({ createClient: deps.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: deps.admin }));
vi.mock("@/lib/carteira/posse", async (original) => ({
  ...(await original<object>()),
  conferirPosse: deps.posse,
}));

import { POST } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";

function client(status: string) {
  const atualizados: Array<Record<string, unknown>> = [];
  const cadeia = {
    select: () => cadeia,
    eq: () => cadeia,
    maybeSingle: async () => ({
      data: { id: ID, status, current_node_id: "t", contact_id: "contato" },
      error: null,
    }),
    update: (patch: Record<string, unknown>) => (atualizados.push(patch), cadeia),
    single: async () => ({ data: { id: ID, status: "cancelled" }, error: null }),
    insert: async () => ({ error: null }),
  };
  return { atualizados, c: { from: () => cadeia } };
}

/** A leitura vai pela sessão; a escrita, pelo admin filtrado pela organização. */
function usar(c: unknown) {
  deps.client.mockResolvedValue(c);
  deps.admin.mockReturnValue(c);
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.support.mockResolvedValue(null);
  deps.role.mockResolvedValue({ ok: true, user: { id: "eu", idioma: "pt-BR" }, org: { orgId: "org", role: "manager" } });
  deps.posse.mockResolvedValue({ pode: true, motivo: "papel" });
});

function comoAtendente() {
  deps.role.mockResolvedValue({ ok: true, user: { id: "eu", idioma: "pt-BR" }, org: { orgId: "org", role: "agent" } });
}

async function cancelar() {
  return POST(new NextRequest(`http://localhost/x/${ID}/cancel`, { method: "POST" }), {
    params: Promise.resolve({ id: ID }),
  } as never);
}

describe("POST /api/v1/ai/followups/enrollments/:id/cancel", () => {
  it("roteiro 'coletando' é encerrado, não recusado com 409", async () => {
    const { atualizados, c } = client("coletando");
    usar(c);
    const res = await POST(new NextRequest(`http://localhost/x/${ID}/cancel`, { method: "POST" }), {
      params: Promise.resolve({ id: ID }),
    } as never);
    expect(res.status).toBe(200);
    expect(atualizados[0]).toMatchObject({ status: "cancelled", cancel_reason: "manual" });
  });

  it("espera longa ('dormente') é encerrada de verdade, não recusada com 409", async () => {
    const { atualizados, c } = client("dormente");
    usar(c);
    const res = await POST(new NextRequest(`http://localhost/x/${ID}/cancel`, { method: "POST" }), {
      params: Promise.resolve({ id: ID }),
    } as never);
    expect(res.status).toBe(200);
    expect(atualizados[0]).toMatchObject({
      status: "cancelled",
      cancel_reason: "manual",
      next_eval_at: null,
    });
  });

  it("o que já acabou continua 409", async () => {
    const { c } = client("completed");
    usar(c);
    const res = await POST(new NextRequest(`http://localhost/x/${ID}/cancel`, { method: "POST" }), {
      params: Promise.resolve({ id: ID }),
    } as never);
    expect(res.status).toBe(409);
  });

  it("o piso da rota é Atendente (agent), não mais gerente", async () => {
    const { c } = client("active");
    usar(c);
    await cancelar();
    expect(deps.role).toHaveBeenCalledWith("agent", expect.anything());
  });

  it("Mergulho — o Atendente DONO do cliente para o follow-up", async () => {
    comoAtendente();
    deps.posse.mockResolvedValue({ pode: true, motivo: "conversa" });
    const { atualizados, c } = client("active");
    usar(c);
    const res = await cancelar();
    expect(res.status).toBe(200);
    expect(atualizados[0]).toMatchObject({ status: "cancelled", cancel_reason: "manual" });
    // A mesma régua de quem inscreve: ação follow_up, contato da inscrição, papel da sessão.
    expect(deps.posse).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: "follow_up",
        organizationId: "org",
        atorId: "eu",
        papel: "agent",
        contactId: "contato",
      }),
    );
  });

  it("Mergulho — o Atendente de FORA do cliente recebe 403 e nada é gravado", async () => {
    comoAtendente();
    deps.posse.mockResolvedValue({ pode: false, motivo: "fora_da_posse" });
    const { atualizados, c } = client("active");
    usar(c);
    const res = await cancelar();
    expect(res.status).toBe(403);
    expect(atualizados).toHaveLength(0);
    expect(deps.audit).not.toHaveBeenCalled();
  });
});
