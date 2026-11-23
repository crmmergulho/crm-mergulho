import { describe, expect, it } from "vitest";

import { etiquetasDoEnvio, isDeskcommPayload, mapDeskcommPayload, ORIGEM_DESKCOMM } from "./deskcomm";

/** O envelope que `call_webhook` monta (`lib/automation/actions/call-webhook.ts`). */
function envelope(sobrescrever: Record<string, unknown> = {}) {
  return {
    event: "lead.stage_changed",
    occurred_at: "2026-11-23T12:00:00.000Z",
    happened_at: "2026-11-23T12:00:00.000Z",
    delivery_id: "a6b1f4d0-0000-5000-8000-000000000001",
    data: {
      from_stage_id: "s-1",
      to_stage_id: "s-2",
      lead: {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Suelen Silva",
        status: "open",
        tags: ["fez experimental", "nat. bebês"],
        custom_fields: { observacoes: "Prefere a turma das 9h", idade: 2, pago: false, vazio: "  " },
      },
      contact: {
        id: "22222222-2222-4222-8222-222222222222",
        name: null,
        display_name: "Suelen Silva",
        email: "suelen@example.com",
        phone_number: "+5534991297672",
        tags: ["Nat. Bebês", "aula experimental", "unidade i", "nat. bebês"],
      },
      ...sobrescrever,
    },
  };
}

describe("isDeskcommPayload", () => {
  it("reconhece o envelope de saída de um DeskcommCRM", () => {
    expect(isDeskcommPayload(envelope())).toBe(true);
  });

  it("não confunde formulário comum, RD Station nem envelope sem contato", () => {
    expect(isDeskcommPayload({ nome: "Ana", telefone: "34999999999" })).toBe(false);
    expect(isDeskcommPayload({ leads: [{ id: "x", name: "Ana" }] })).toBe(false);
    expect(isDeskcommPayload({ event: "lead.created", delivery_id: "d", data: { lead: { id: "x" } } })).toBe(false);
    expect(isDeskcommPayload({ event: "lead.created", data: { contact: { phone_number: "+55" } } })).toBe(false);
    expect(isDeskcommPayload(null)).toBe(false);
  });
});

describe("mapDeskcommPayload", () => {
  it("leva nome, telefone, e-mail e os campos do card", () => {
    const m = mapDeskcommPayload(envelope());
    expect(m.name).toBe("Suelen Silva");
    expect(m.phone).toBe("+5534991297672");
    expect(m.email).toBe("suelen@example.com");
    expect(m.custom_fields).toEqual({ observacoes: "Prefere a turma das 9h", idade: "2", pago: "false" });
  });

  it("o id do card de origem vira o external_id (reenvio não duplica)", () => {
    const m = mapDeskcommPayload(envelope());
    expect(m.externalId).toBe("deskcomm:11111111-1111-4111-8111-111111111111");
    expect(m.source_metadata).toEqual({
      origem: ORIGEM_DESKCOMM,
      deskcomm_evento: "lead.stage_changed",
      deskcomm_card_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("separa as etiquetas do contato e as do card, normalizadas e sem repetição", () => {
    const m = mapDeskcommPayload(envelope());
    expect(m.etiquetasDoContato).toEqual(["nat. bebês", "aula experimental", "unidade i"]);
    expect(m.etiquetasDoCard).toEqual(["fez experimental", "nat. bebês"]);
  });

  it("sem nome no contato, usa o título do card", () => {
    const m = mapDeskcommPayload(
      envelope({ contact: { phone_number: "+5534991297672", name: null, display_name: null } }),
    );
    expect(m.name).toBe("Suelen Silva");
  });
});

describe("etiquetasDoEnvio", () => {
  it("ignora o que não é texto, o vazio e o grande demais, e respeita o teto de 20", () => {
    const muitas = Array.from({ length: 30 }, (_, i) => `etiqueta ${i}`);
    expect(etiquetasDoEnvio(muitas)).toHaveLength(20);
    expect(etiquetasDoEnvio([1, "", "  ", "x".repeat(41), " Ok "])).toEqual(["ok"]);
    expect(etiquetasDoEnvio("nat. bebês")).toEqual([]);
  });
});
