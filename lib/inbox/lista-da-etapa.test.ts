import { describe, expect, it } from "vitest";

import { montarLinhasDaEtapa, type ConversaDaEtapa } from "./lista-da-etapa";

/**
 * A lista da etapa no Inbox (Mergulho, 27/11/2026): uma linha por CARD, com a
 * conversa mais recente do contato — de qualquer aba, dono ou situação — e
 * também quem ainda não tem conversa. O número do botão da faixa conta cards;
 * a lista tem de ter a mesma quantidade.
 */

const card = (id: string, contato: string | null, mexido = "2026-11-27T10:00:00Z") => ({
  id,
  contact_id: contato,
  updated_at: mexido,
});
const contato = (id: string, nome: string | null, telefone: string | null = "+553499990000") => ({
  id,
  name: nome,
  display_name: null,
  phone_number: telefone,
});
const conversa = (id: string, contatoId: string, em: string | null, extra: Partial<ConversaDaEtapa> = {}): ConversaDaEtapa => ({
  id,
  contact_id: contatoId,
  status: "open",
  last_message_at: em,
  last_message_preview: "oi",
  unread_count_for_assignee: 0,
  assigned_to_user_id: null,
  assigned_to_user_name: null,
  ...extra,
});

describe("lista da etapa", () => {
  it("uma linha por card — inclusive conversa fechada, de outra pessoa e quem não tem conversa", () => {
    const linhas = montarLinhasDaEtapa(
      [card("l1", "c1"), card("l2", "c2"), card("l3", "c3"), card("l4", "c4")],
      [contato("c1", "Ana"), contato("c2", "Bia"), contato("c3", "Caio"), contato("c4", "Duda")],
      [
        conversa("v1", "c1", "2026-11-27T09:00:00Z", { status: "closed" }),
        conversa("v2", "c2", "2026-11-27T11:00:00Z", { status: "claimed", assigned_to_user_name: "Paullyne" }),
        conversa("v3", "c3", "2026-11-27T10:00:00Z"),
      ],
    );
    expect(linhas).toHaveLength(4);
    // Com conversa, da mais recente para a mais antiga; sem conversa, no fim.
    expect(linhas.map((l) => l.contato.nome)).toEqual(["Bia", "Caio", "Ana", "Duda"]);
    expect(linhas[0]!.conversa).toMatchObject({ id: "v2", status: "claimed", dono_nome: "Paullyne" });
    expect(linhas[2]!.conversa?.status).toBe("closed");
    expect(linhas[3]!.conversa).toBeNull();
  });

  it("contato com duas conversas mostra a mais recente", () => {
    const [linha] = montarLinhasDaEtapa(
      [card("l1", "c1")],
      [contato("c1", "Ana")],
      [conversa("velha", "c1", "2026-11-20T09:00:00Z"), conversa("nova", "c1", "2026-11-27T09:00:00Z")],
    );
    expect(linha!.conversa?.id).toBe("nova");
  });

  it("sem conversa, ordena pelo card mexido por último", () => {
    const linhas = montarLinhasDaEtapa(
      [card("l1", "c1", "2026-11-20T10:00:00Z"), card("l2", "c2", "2026-11-26T10:00:00Z")],
      [contato("c1", "Ana"), contato("c2", "Bia")],
      [],
    );
    expect(linhas.map((l) => l.lead_id)).toEqual(["l2", "l1"]);
  });

  it("nome: apelido, nome, telefone — nunca linha em branco; card sem contato fica de fora", () => {
    const linhas = montarLinhasDaEtapa(
      [card("l1", "c1"), card("l2", null)],
      [{ id: "c1", name: null, display_name: null, phone_number: "+5534911112222" }],
      [],
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.contato.nome).toBe("+5534911112222");
  });
});
