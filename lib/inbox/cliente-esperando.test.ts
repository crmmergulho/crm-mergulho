import { describe, expect, it } from "vitest";

import {
  AVISO_DE_ESPERA,
  dentroDaJanela,
  horaNoFuso,
  rodadaDoClienteEsperando,
  textoDoAviso,
  type ConversaEsperando,
} from "./cliente-esperando";

/**
 * O aviso "cliente esperando resposta" (Mergulho, 25/11/2026).
 *
 * O dublê responde só ao que a rodada pergunta: o `rpc` de quem espera, a
 * leitura dos avisos abertos, o update de resolver, o insert de criar (com o
 * índice único de um aberto por conversa) e a leitura das organizações paradas.
 */

interface Aviso {
  id: string;
  organization_id: string;
  kind: string;
  ref_id: string;
  status: string;
  para_user_id?: string | null;
  title?: string;
}

function banco(esperando: ConversaEsperando[], avisos: Aviso[], paradas: string[] = []) {
  let seq = 0;
  const admin = {
    async rpc(nome: string, args: Record<string, unknown>) {
      expect(nome).toBe("fn_conversas_com_cliente_esperando");
      expect(args).toEqual({ p_minutos: 20, p_horas_max: 24 });
      return { data: esperando, error: null };
    },
    from(tabela: string) {
      if (tabela === "organizations") {
        return {
          select: () => ({
            neq: async () => ({ data: paradas.map((id) => ({ id })), error: null }),
          }),
        };
      }
      expect(tabela).toBe("agent_inbox_items");
      const filtros: Array<(a: Aviso) => boolean> = [];
      let mudanca: Partial<Aviso> | null = null;
      const q = {
        select: () => q,
        update: (m: Partial<Aviso>) => {
          mudanca = m;
          return q;
        },
        eq: (col: keyof Aviso, v: unknown) => {
          filtros.push((a) => a[col] === v);
          return mudanca ? q : q;
        },
        neq: (col: keyof Aviso, v: unknown) => {
          filtros.push((a) => a[col] !== v);
          if (mudanca) {
            const alvo = avisos.filter((a) => filtros.every((f) => f(a)));
            for (const a of alvo) Object.assign(a, mudanca);
            return Promise.resolve({ data: null, error: null });
          }
          return q;
        },
        limit: async () => ({ data: avisos.filter((a) => filtros.every((f) => f(a))), error: null }),
        insert: async (linha: Aviso & Record<string, unknown>) => {
          const dup = avisos.some(
            (a) => a.kind === linha.kind && a.organization_id === linha.organization_id && a.ref_id === linha.ref_id && a.status !== "resolved",
          );
          if (dup) return { data: null, error: { code: "23505", message: "duplicate" } };
          avisos.push({ ...linha, id: `novo-${++seq}`, status: "open" });
          return { data: null, error: null };
        },
      };
      return q;
    },
  };
  return admin as unknown as Parameters<typeof rodadaDoClienteEsperando>[0];
}

/** 25/11/2026 em Brasília (UTC-3). */
const as = (hora: number, min = 0) => new Date(Date.UTC(2026, 10, 25, hora + 3, min));
const espera = (conversa: string, extra: Partial<ConversaEsperando> = {}): ConversaEsperando => ({
  organization_id: "org-1",
  conversation_id: conversa,
  assigned_to_user_id: null,
  esperando_desde: as(9, 0).toISOString(),
  ...extra,
});

describe("janela de horário", () => {
  it("conta a hora no fuso de Brasília, não em UTC", () => {
    expect(horaNoFuso(as(8, 0), "America/Sao_Paulo")).toBe(8);
    expect(horaNoFuso(as(23, 30), "America/Sao_Paulo")).toBe(23);
  });

  it("das 8h às 18h: 8h00 entra, 17h59 entra, 18h00 e 7h59 não", () => {
    expect(dentroDaJanela(as(8, 0), AVISO_DE_ESPERA)).toBe(true);
    expect(dentroDaJanela(as(17, 59), AVISO_DE_ESPERA)).toBe(true);
    expect(dentroDaJanela(as(18, 0), AVISO_DE_ESPERA)).toBe(false);
    expect(dentroDaJanela(as(7, 59), AVISO_DE_ESPERA)).toBe(false);
  });
});

describe("texto do aviso", () => {
  it("diz o prazo e o horário em que o cliente escreveu, sem dado do cliente", () => {
    const t = textoDoAviso({ esperando_desde: as(9, 5).toISOString() }, AVISO_DE_ESPERA);
    expect(t.title).toBe("Cliente esperando resposta há mais de 20 minutos");
    expect(t.body).toContain("às 09:05");
  });
});

describe("rodada do aviso de cliente esperando", () => {
  it("abre um aviso por conversa esperando, para o responsável quando há um", async () => {
    const avisos: Aviso[] = [];
    const r = await rodadaDoClienteEsperando(
      banco([espera("c1"), espera("c2", { assigned_to_user_id: "sdr" })], avisos),
      as(10, 0),
    );
    expect(r).toEqual({ esperando: 2, criados: 2, resolvidos: 0, foraDaJanela: false });
    expect(avisos.map((a) => [a.ref_id, a.para_user_id, a.kind, a.status])).toEqual([
      ["c1", null, "cliente_esperando", "open"],
      ["c2", "sdr", "cliente_esperando", "open"],
    ]);
  });

  it("não duplica: a conversa que já tem aviso aberto não ganha outro", async () => {
    const avisos: Aviso[] = [{ id: "a1", organization_id: "org-1", kind: "cliente_esperando", ref_id: "c1", status: "open" }];
    const r = await rodadaDoClienteEsperando(banco([espera("c1")], avisos), as(10, 0));
    expect(r.criados).toBe(0);
    expect(avisos).toHaveLength(1);
  });

  it("resolve sozinho o aviso de quem foi respondido (saiu da lista de espera)", async () => {
    const avisos: Aviso[] = [
      { id: "a1", organization_id: "org-1", kind: "cliente_esperando", ref_id: "respondida", status: "open" },
      { id: "a2", organization_id: "org-1", kind: "cliente_esperando", ref_id: "c1", status: "ack" },
    ];
    const r = await rodadaDoClienteEsperando(banco([espera("c1")], avisos), as(10, 0));
    expect(r.resolvidos).toBe(1);
    expect(avisos.find((a) => a.id === "a1")?.status).toBe("resolved");
    expect(avisos.find((a) => a.id === "a2")?.status).toBe("ack");
  });

  it("fora do horário não abre aviso — mas resolve o de quem foi respondido", async () => {
    const avisos: Aviso[] = [{ id: "a1", organization_id: "org-1", kind: "cliente_esperando", ref_id: "respondida", status: "open" }];
    const r = await rodadaDoClienteEsperando(banco([espera("c1")], avisos), as(20, 0));
    expect(r).toEqual({ esperando: 1, criados: 0, resolvidos: 1, foraDaJanela: true });
    expect(avisos.filter((a) => a.status !== "resolved")).toHaveLength(0);
  });

  it("organização parada não ganha aviso", async () => {
    const avisos: Aviso[] = [];
    const r = await rodadaDoClienteEsperando(
      banco([espera("c1", { organization_id: "parada" }), espera("c2")], avisos, ["parada"]),
      as(10, 0),
    );
    expect(r.criados).toBe(1);
    expect(avisos.map((a) => a.ref_id)).toEqual(["c2"]);
  });

  it("a mesma conversa em outra organização não é confundida", async () => {
    const avisos: Aviso[] = [{ id: "a1", organization_id: "org-2", kind: "cliente_esperando", ref_id: "c1", status: "open" }];
    const r = await rodadaDoClienteEsperando(banco([espera("c1")], avisos), as(10, 0));
    // o aviso da org-2 não espera mais (a lista só tem a org-1): resolve; a org-1 ganha o seu
    expect(r).toMatchObject({ criados: 1, resolvidos: 1 });
  });

  it("corrida: o 23505 do índice não conta como aviso criado nem derruba a rodada", async () => {
    const avisos: Aviso[] = [];
    const admin = banco([espera("c1"), espera("c1")], avisos);
    const r = await rodadaDoClienteEsperando(admin, as(10, 0));
    expect(r.criados).toBe(1);
    expect(avisos).toHaveLength(1);
  });
});
