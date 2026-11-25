import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { FILTRO_VAZIO, filtroDeAudienciaSchema, type FiltroDeAudiencia } from "./audiencia";
import { buscarCandidatos } from "./consulta-de-audiencia";

/**
 * LOTES DA CAMPANHA (Mergulho, 25/11/2026) — `sem_campanha_ha_dias`.
 *
 * O defeito que motivou o filtro: o teto ("Máximo de contatos") corta o recorte
 * ANTES do veto "já em campanha". Com uma lista de 500 e "Máximo 200", a segunda
 * campanha com o mesmo filtro pegava de novo os MESMOS 200 primeiros — todos
 * vetados se a primeira ainda rodava (campanha quase vazia), ou todos
 * reabordados se ela já tinha terminado. Com o filtro, quem recebeu outra
 * campanha no período, ou está numa não concluída, sai ANTES do teto, e a
 * campanha seguinte pega os 200 SEGUINTES.
 *
 * O dublê é um PostgREST mínimo: aplica os filtros, o `order`, o keyset e o
 * corte de `max_rows` que estas consultas usam — e falha alto em parâmetro que
 * não conhece, para um filtro novo não virar "passa tudo" em silêncio.
 */

const ORG = "99999999-9999-4999-8999-999999999999";
const MAX_ROWS = 1_000;
const AGORA = new Date(Date.UTC(2026, 10, 25, 12));
const id = (i: number, p = "1111") => `${String(i).padStart(8, "0")}-${p}-4111-8111-111111111111`;
const contato = (i: number) => id(i, "c0c0");
const dias = (n: number) => new Date(AGORA.getTime() - n * 86_400_000).toISOString();

interface Campanha {
  id: string;
  status: string;
}
interface Destinatario {
  id: string;
  campaign_id: string;
  contact_id: string;
  sent_at: string | null;
}

const ord = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const listaDoIn = (v: string) => v.slice(4, -1).split(",").map((s) => s.replace(/^"|"$/g, ""));

function json(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
}

function bancoFalso(totalDeContatos: number, campanhas: Campanha[], destinatarios: Destinatario[]) {
  const urls: string[] = [];
  const contatos = Array.from({ length: totalDeContatos }, (_, i) => ({
    id: contato(i),
    created_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
  }));

  const sb = createClient("http://127.0.0.1:54321", "x".repeat(200), {
    global: {
      fetch: async (entrada: RequestInfo | URL) => {
        const bruta = String(entrada);
        urls.push(bruta);
        const url = new URL(bruta);
        const p = url.searchParams;
        expect(p.get("organization_id")).toBe(`eq.${ORG}`);
        const limite = Math.min(Number(p.get("limit") ?? MAX_ROWS), MAX_ROWS);

        if (url.pathname.endsWith("/campaigns")) {
          const status = p.get("status");
          const neq = p.get("id");
          return json(
            campanhas
              .filter((c) => !status || listaDoIn(status).includes(c.status))
              .filter((c) => !neq || c.id !== neq.slice(4))
              .map((c) => ({ id: c.id })),
          );
        }

        if (url.pathname.endsWith("/campaign_recipients")) {
          let linhas = [...destinatarios];
          for (const v of p.getAll("campaign_id")) {
            if (v.startsWith("in.")) linhas = linhas.filter((d) => listaDoIn(v).includes(d.campaign_id));
            else if (v.startsWith("neq.")) linhas = linhas.filter((d) => d.campaign_id !== v.slice(4));
            else throw new Error(`dublê: campaign_id=${v}`);
          }
          const sent = p.get("sent_at");
          if (sent) {
            if (!sent.startsWith("gte.")) throw new Error(`dublê: sent_at=${sent}`);
            linhas = linhas.filter((d) => d.sent_at !== null && ord(d.sent_at, sent.slice(4)) >= 0);
          }
          const depois = p.get("id");
          if (depois) {
            if (!depois.startsWith("gt.")) throw new Error(`dublê: id=${depois}`);
            linhas = linhas.filter((d) => ord(d.id, depois.slice(3)) > 0);
          }
          if (p.get("order") !== "id.asc") throw new Error(`dublê: order=${p.get("order")}`);
          linhas.sort((a, b) => ord(a.id, b.id));
          return json(linhas.slice(0, limite).map((d) => ({ id: d.id, contact_id: d.contact_id })));
        }

        if (url.pathname.endsWith("/contacts")) {
          let linhas = [...contatos];
          // Os incluídos à mão vêm por `id=in.(…)`.
          const porId = p.getAll("id").find((v) => v.startsWith("in."));
          if (porId) linhas = linhas.filter((c) => listaDoIn(porId).includes(c.id));
          // Keyset `created_at.gt.X,and(created_at.eq.X,id.gt.Y)`.
          const or = p.get("or");
          if (or) {
            const m = /created_at\.gt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.gt\.([^)]+)\)/.exec(or);
            if (!m) throw new Error(`dublê: or=${or}`);
            const [, x, , y] = m;
            linhas = linhas.filter((c) => ord(c.created_at, x!) > 0 || (c.created_at === x && ord(c.id, y!) > 0));
          }
          linhas.sort((a, b) => ord(a.created_at, b.created_at) || ord(a.id, b.id));
          return json(
            linhas.slice(0, limite).map((c) => ({
              ...c,
              name: "Contato",
              display_name: null,
              phone_number: "+5534999990000",
              email: null,
              is_blocked: false,
              is_personal: false,
              is_anonymized: false,
              consent: null,
            })),
          );
        }
        throw new Error(`dublê: tabela inesperada ${url.pathname}`);
      },
    },
  });
  return { sb, urls };
}

async function ids(
  banco: ReturnType<typeof bancoFalso>,
  filtro: Partial<FiltroDeAudiencia>,
  campanhaId?: string,
): Promise<string[]> {
  const { candidatos } = await buscarCandidatos(banco.sb, {
    organizationId: ORG,
    filtro: { ...FILTRO_VAZIO, com_alguma_tag: ["visitante"], ...filtro },
    agora: AGORA,
    corpo: "Oi",
    ...(campanhaId ? { campanhaId } : {}),
  });
  return candidatos.map((c) => c.contactId);
}

const faixa = (de: number, ate: number) => Array.from({ length: ate - de }, (_, i) => contato(de + i));

describe("lotes da campanha — `sem_campanha_ha_dias`", () => {
  const A = id(1, "aaaa");
  const B = id(2, "bbbb");

  it("controle: SEM o filtro, a 2ª campanha pega de novo os mesmos primeiros (o defeito)", async () => {
    const banco = bancoFalso(10, [{ id: A, status: "running" }], faixa(0, 4).map((c, i) => ({
      id: id(i, "d0d0"),
      campaign_id: A,
      contact_id: c,
      sent_at: null,
    })));
    expect(await ids(banco, { limite: 4 })).toEqual(faixa(0, 4));
    // E nem pergunta pelas campanhas: o caminho antigo fica intacto.
    expect(banco.urls.some((u) => u.includes("/campaign_recipients"))).toBe(false);
  });

  it("com o filtro, a 2ª campanha pega os SEGUINTES enquanto a 1ª ainda roda", async () => {
    const banco = bancoFalso(10, [{ id: A, status: "running" }], faixa(0, 4).map((c, i) => ({
      id: id(i, "d0d0"),
      campaign_id: A,
      contact_id: c,
      sent_at: i < 2 ? dias(1) : null,
    })));
    expect(await ids(banco, { limite: 4, sem_campanha_ha_dias: 30 })).toEqual(faixa(4, 8));
  });

  it("campanha CONCLUÍDA tira só quem recebeu dentro do período", async () => {
    const enviados = faixa(0, 4).map((c, i) => ({
      id: id(i, "d0d0"),
      campaign_id: A,
      contact_id: c,
      sent_at: i < 2 ? dias(2) : dias(10),
    }));
    const banco = bancoFalso(10, [{ id: A, status: "completed" }], enviados);
    // Em 30 dias, os 4 receberam: o lote seguinte começa no 5º.
    expect(await ids(banco, { limite: 4, sem_campanha_ha_dias: 30 })).toEqual(faixa(4, 8));
    // Em 5 dias, só os 2 primeiros receberam; os outros 2 voltam a entrar.
    expect(await ids(banco, { limite: 4, sem_campanha_ha_dias: 5 })).toEqual([...faixa(2, 4), ...faixa(4, 6)]);
  });

  it("os destinatários da PRÓPRIA campanha não a esvaziam ao preparar de novo", async () => {
    const banco = bancoFalso(10, [{ id: A, status: "ready" }, { id: B, status: "running" }], [
      ...faixa(0, 4).map((c, i) => ({ id: id(i, "d0d0"), campaign_id: A, contact_id: c, sent_at: null })),
      { id: id(9, "d1d1"), campaign_id: B, contact_id: contato(0), sent_at: dias(1) },
    ]);
    // Preparando A: os dela continuam; só o contato 0, que está em B, sai.
    expect(await ids(banco, { limite: 4, sem_campanha_ha_dias: 30 }, A)).toEqual(faixa(1, 5));
  });

  it("lista maior que o max_rows: pagina até a página vazia e não deixa ninguém para trás", async () => {
    const banco = bancoFalso(2_600, [{ id: A, status: "running" }], faixa(0, 2_500).map((c, i) => ({
      id: id(i, "d0d0"),
      campaign_id: A,
      contact_id: c,
      sent_at: null,
    })));
    expect(await ids(banco, { limite: 200, sem_campanha_ha_dias: 30 })).toEqual(faixa(2_500, 2_600));
  });

  it("o incluído à mão continua entrando, mesmo tendo recebido", async () => {
    const banco = bancoFalso(6, [{ id: A, status: "running" }], [
      { id: id(0, "d0d0"), campaign_id: A, contact_id: contato(0), sent_at: dias(1) },
    ]);
    const lista = await ids(banco, { limite: 10, sem_campanha_ha_dias: 30, incluir_contatos: [contato(0)] });
    expect([...lista].sort()).toEqual(faixa(0, 6));
  });

  it("o campo é opcional, inteiro e não conta sozinho como critério", () => {
    expect(filtroDeAudienciaSchema.parse({ com_alguma_tag: ["x"] }).sem_campanha_ha_dias).toBeNull();
    expect(filtroDeAudienciaSchema.parse({ com_alguma_tag: ["x"], sem_campanha_ha_dias: 30 }).sem_campanha_ha_dias).toBe(30);
    expect(filtroDeAudienciaSchema.safeParse({ com_alguma_tag: ["x"], sem_campanha_ha_dias: 0 }).success).toBe(false);
    expect(filtroDeAudienciaSchema.safeParse({ sem_campanha_ha_dias: 30 }).success).toBe(false);
  });
});
