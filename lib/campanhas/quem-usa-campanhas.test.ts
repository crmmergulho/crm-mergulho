import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Quem pode usar Campanhas (Mergulho, 26/11/2026): o papel mínimo vira chave
 * por empresa (`settings.campanhas_papel_minimo`), com Gerente como padrão.
 *
 * O `requireRole` é dublado: devolve OK quando o papel da sessão alcança o
 * pedido e recusa (403) quando não alcança — que é o contrato dele. O que se
 * mede aqui é QUAL papel o portão pede e QUANDO lê a empresa.
 */

const h = vi.hoisted(() => ({
  papelDaSessao: "agent" as string,
  settings: null as unknown,
  erroDeLeitura: null as { message: string } | null,
  pedidos: [] as string[],
  leiturasDaOrg: 0,
}));

const RANK: Record<string, number> = { viewer: 1, agent: 2, manager: 3, admin: 4 };

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async (min: string) => {
    h.pedidos.push(min);
    if ((RANK[h.papelDaSessao] ?? 0) >= (RANK[min] ?? 99)) {
      return { ok: true, user: { id: "u1" }, org: { orgId: "org-1", role: h.papelDaSessao } };
    }
    return { ok: false, response: new Response(null, { status: 403 }) };
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      expect(tabela).toBe("organizations");
      return {
        select: () => ({
          eq: (col: string, valor: string) => {
            expect([col, valor]).toEqual(["id", "org-1"]);
            return {
              maybeSingle: async () => {
                h.leiturasDaOrg++;
                return { data: h.erroDeLeitura ? null : { settings: h.settings }, error: h.erroDeLeitura };
              },
            };
          },
        }),
      };
    },
  }),
}));

import { exigirPapelDeCampanhas, papelMinimoDasCampanhas } from "./quem-usa-campanhas";

beforeEach(() => {
  h.papelDaSessao = "agent";
  h.settings = null;
  h.erroDeLeitura = null;
  h.pedidos = [];
  h.leiturasDaOrg = 0;
});

describe("papel mínimo gravado na empresa", () => {
  it("ausente, vazio ou inválido vale Gerente (o produto)", () => {
    expect(papelMinimoDasCampanhas(null)).toBe("manager");
    expect(papelMinimoDasCampanhas({})).toBe("manager");
    expect(papelMinimoDasCampanhas({ campanhas_papel_minimo: "viewer" })).toBe("manager");
    expect(papelMinimoDasCampanhas({ campanhas_papel_minimo: 3 })).toBe("manager");
  });

  it("aceita agent e manager; admin não endurece nada e vale o padrão", () => {
    expect(papelMinimoDasCampanhas({ campanhas_papel_minimo: "agent" })).toBe("agent");
    expect(papelMinimoDasCampanhas({ campanhas_papel_minimo: "manager" })).toBe("manager");
    expect(papelMinimoDasCampanhas({ campanhas_papel_minimo: "admin" })).toBe("manager");
  });

  it("não lê de dentro de settings.campanhas (aquele objeto é regravado pela tela de padrões)", () => {
    expect(papelMinimoDasCampanhas({ campanhas: { campanhas_papel_minimo: "agent" } })).toBe("manager");
  });
});

describe("o portão das rotas de campanha", () => {
  it("Atendente numa empresa SEM a chave: recusado, pelo requireRole de Gerente (403 + auditoria de sempre)", async () => {
    const r = await exigirPapelDeCampanhas({ requestId: "r" });
    expect(r.ok).toBe(false);
    expect(h.pedidos).toEqual(["agent", "manager"]);
  });

  it("Atendente numa empresa com a chave em 'agent': entra", async () => {
    h.settings = { campanhas_papel_minimo: "agent" };
    const r = await exigirPapelDeCampanhas({ requestId: "r" });
    expect(r.ok).toBe(true);
    expect(h.pedidos).toEqual(["agent"]);
  });

  it("Gerente entra sem consultar a empresa — o comportamento de sempre", async () => {
    h.papelDaSessao = "manager";
    const r = await exigirPapelDeCampanhas({ requestId: "r" });
    expect(r.ok).toBe(true);
    expect(h.leiturasDaOrg).toBe(0);
  });

  it("Visualizador nunca entra, nem com a chave em 'agent'", async () => {
    h.papelDaSessao = "viewer";
    h.settings = { campanhas_papel_minimo: "agent" };
    const r = await exigirPapelDeCampanhas({ requestId: "r" });
    expect(r.ok).toBe(false);
    expect(h.leiturasDaOrg).toBe(0);
  });

  it("falha ao ler a empresa fecha a porta (vale Gerente)", async () => {
    h.settings = { campanhas_papel_minimo: "agent" };
    h.erroDeLeitura = { message: "fora do ar" };
    const r = await exigirPapelDeCampanhas({ requestId: "r" });
    expect(r.ok).toBe(false);
    expect(h.pedidos).toEqual(["agent", "manager"]);
  });

  it("a chave só abre para baixo: Gerente segue entrando mesmo com valor estranho gravado", async () => {
    h.papelDaSessao = "manager";
    h.settings = { campanhas_papel_minimo: "admin" };
    const r = await exigirPapelDeCampanhas({ requestId: "r" });
    expect(r.ok).toBe(true);
  });
});
