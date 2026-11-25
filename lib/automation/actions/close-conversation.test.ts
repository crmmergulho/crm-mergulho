import { beforeEach, describe, expect, it, vi } from "vitest";

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn(async (_entrada: unknown) => undefined) }));
vi.mock("@/lib/audit", () => ({ audit: auditMock }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/close-conversation";
import type { ActionCtx } from "@/lib/automation/types";

/**
 * `close_conversation` (Mergulho, 25/11/2026): a regra fecha a conversa do
 * contato pela MESMA função do botão Fechar, com a trava de revisão.
 *
 * O dublê guarda as conversas e responde ao que a ação pergunta: a leitura das
 * conversas em andamento (filtro por organização, status e contato ou id) e o
 * `rpc("fn_service_status")`, que confere a revisão como o banco (PT409).
 */

const ORG = "org-1";

interface Conversa {
  id: string;
  organization_id: string;
  contact_id: string;
  status: string;
  service_revision: number;
}

function banco(conversas: Conversa[], opcoes: { mexerAntesDoFechamento?: string } = {}) {
  const chamadas: Array<Record<string, unknown>> = [];
  let mexeu = false;
  const admin = {
    from(tabela: string) {
      expect(tabela).toBe("conversations");
      const filtros: Array<(c: Conversa) => boolean> = [];
      const q = {
        select: () => q,
        eq: (col: keyof Conversa, valor: unknown) => {
          filtros.push((c) => c[col] === valor);
          return q;
        },
        not: (col: keyof Conversa, op: string, lista: string) => {
          expect(op).toBe("in");
          const valores = lista.slice(1, -1).split(",");
          filtros.push((c) => !valores.includes(String(c[col])));
          return q;
        },
        limit: async (n: number) => ({
          data: conversas
            .filter((c) => filtros.every((f) => f(c)))
            .slice(0, n)
            .map((c) => ({ id: c.id, service_revision: c.service_revision })),
          error: null,
        }),
      };
      return q;
    },
    async rpc(nome: string, args: Record<string, unknown>) {
      expect(nome).toBe("fn_service_status");
      chamadas.push(args);
      const c = conversas.find((x) => x.id === args.p_conversation && x.organization_id === args.p_org);
      if (!c) return { data: null, error: { code: "P0002", message: "conversa não encontrada" } };
      if (opcoes.mexerAntesDoFechamento === c.id && !mexeu) {
        mexeu = true;
        c.service_revision += 1;
      }
      if (c.service_revision !== args.p_expected) {
        return { data: null, error: { code: "PT409", message: "revisão obsoleta" } };
      }
      c.status = String(args.p_status);
      c.service_revision += 1;
      return { data: c, error: null };
    },
  };
  return { admin, chamadas };
}

function ctx(admin: unknown, extra: Partial<ActionCtx> = {}): ActionCtx {
  return {
    admin: admin as ActionCtx["admin"],
    organizationId: ORG,
    ruleId: "regra-1",
    ruleName: "Perdido → fechar a conversa",
    event: { payload: {} } as unknown as ActionCtx["event"],
    context: { contact: { id: "contato-1" } },
    requestId: "req-1",
    ...extra,
  };
}

const conversa = (id: string, extra: Partial<Conversa> = {}): Conversa => ({
  id,
  organization_id: ORG,
  contact_id: "contato-1",
  status: "open",
  service_revision: 3,
  ...extra,
});

const executar = (c: ActionCtx) => getAction("close_conversation")!.execute(c, {});

beforeEach(() => auditMock.mockClear());

describe("ação Fechar a conversa", () => {
  it("está registrada no motor", () => {
    expect(getAction("close_conversation")).toBeDefined();
  });

  it("fecha a conversa aberta do contato, com a revisão lida, e audita", async () => {
    const conversas = [conversa("c1")];
    const { admin, chamadas } = banco(conversas);
    const r = await executar(ctx(admin));
    expect(r.status).toBe("success");
    expect(r.detail?.fechadas).toEqual(["c1"]);
    expect(chamadas).toEqual([{ p_org: ORG, p_conversation: "c1", p_status: "closed", p_expected: 3 }]);
    expect(conversas[0]!.status).toBe("closed");
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "conversation.closed", resourceId: "c1", organizationId: ORG }),
    );
  });

  it("fecha TODAS as conversas em andamento do contato, e só as dele, desta organização", async () => {
    const conversas = [
      conversa("c1"),
      conversa("c2", { status: "claimed" }),
      conversa("c3", { status: "closed" }),
      conversa("c4", { contact_id: "outro" }),
      conversa("c5", { organization_id: "outra-org" }),
    ];
    const { admin } = banco(conversas);
    const r = await executar(ctx(admin));
    expect(r.detail?.fechadas).toEqual(["c1", "c2"]);
    expect(conversas.map((c) => c.status)).toEqual(["closed", "closed", "closed", "open", "open"]);
  });

  it("quando o evento traz a conversa, fecha só ela", async () => {
    const conversas = [conversa("c1"), conversa("c2")];
    const { admin } = banco(conversas);
    const r = await executar(ctx(admin, { event: { payload: { conversation_id: "c2" } } as unknown as ActionCtx["event"] }));
    expect(r.detail?.fechadas).toEqual(["c2"]);
    expect(conversas[0]!.status).toBe("open");
  });

  it("sem conversa aberta, pula com motivo e não audita", async () => {
    const { admin, chamadas } = banco([conversa("c1", { status: "closed" })]);
    const r = await executar(ctx(admin));
    expect(r).toEqual({ type: "close_conversation", status: "skipped", detail: { reason: "nenhuma_conversa_aberta" } });
    expect(chamadas).toHaveLength(0);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("sem contato e sem conversa no evento, pula", async () => {
    const { admin } = banco([conversa("c1")]);
    const r = await executar(ctx(admin, { context: {} }));
    expect(r.status).toBe("skipped");
  });

  it("alguém mexeu na conversa no meio: relê a revisão e fecha na segunda tentativa", async () => {
    const conversas = [conversa("c1")];
    const { admin, chamadas } = banco(conversas, { mexerAntesDoFechamento: "c1" });
    const r = await executar(ctx(admin));
    expect(r.status).toBe("success");
    expect(chamadas.map((c) => c.p_expected)).toEqual([3, 4]);
    expect(conversas[0]!.status).toBe("closed");
  });

  it("erro do banco vira falha nomeada, sem auditar o que não fechou", async () => {
    const { admin } = banco([conversa("c1")]);
    const quebrado = { ...admin, rpc: async () => ({ data: null, error: { code: "XX000", message: "banco fora" } }) };
    const r = await executar(ctx(quebrado));
    expect(r.status).toBe("failed");
    expect(r.error).toBe("banco fora");
    expect(auditMock).not.toHaveBeenCalled();
  });
});
