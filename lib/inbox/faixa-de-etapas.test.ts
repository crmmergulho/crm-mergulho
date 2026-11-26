import { describe, expect, it } from "vitest";

import {
  corDaEtapa,
  escolhaAtiva,
  etapasDaFaixaParaOPapel,
  etiquetasDasEtapas,
  etiquetasDeContatoNasRegras,
  passosDaEtapa,
  type EtapaDaFaixa,
  type RegraParaAFaixa,
} from "./faixa-de-etapas";

const ETAPA_A = "11111111-1111-4111-8111-111111111111";
const ETAPA_B = "22222222-2222-4222-8222-222222222222";

function regra(parcial: Partial<RegraParaAFaixa>): RegraParaAFaixa {
  return {
    trigger_event: "lead.stage_changed",
    is_active: true,
    conditions: [{ op: "eq", field: "event.to_stage_id", value: ETAPA_A }],
    actions: [
      { type: "remove_tag", config: { tags: ["2 b"], destino: "contato" } },
      { type: "add_tag", config: { tags: ["Em atendimento"], destino: "contato" } },
    ],
    ...parcial,
  };
}

function regraDePasso(etiqueta: string, ativa = true): RegraParaAFaixa {
  return {
    trigger_event: "lead.tag_added",
    is_active: ativa,
    conditions: [{ op: "contains", field: "event.added_tags", value: etiqueta.toLowerCase() }],
    actions: [
      { type: "remove_tag", config: { tags: ["01 - Follow-up"], destino: "contato" } },
      { type: "add_tag", config: { tags: [etiqueta], destino: "contato" } },
      { type: "remove_tag", config: { tags: [etiqueta] } },
    ],
  };
}

describe("etiquetasDasEtapas", () => {
  it("lê a etiqueta adicionada no contato pela regra da etapa, como a regra a escreve", () => {
    expect(etiquetasDasEtapas([regra({})]).get(ETAPA_A)).toBe("Em atendimento");
  });

  it("aceita condições em grupo `all`", () => {
    const r = regra({ conditions: { all: [{ op: "eq", field: "event.to_stage_id", value: ETAPA_B }] } });
    expect(etiquetasDasEtapas([r]).get(ETAPA_B)).toBe("Em atendimento");
  });

  it("ignora regra pausada, de outro gatilho, em grupo `any` ou com etiqueta no card", () => {
    const ignoradas = [
      regra({ is_active: false }),
      regra({ trigger_event: "message.received" }),
      regra({ conditions: { any: [{ op: "eq", field: "event.to_stage_id", value: ETAPA_A }] } }),
      regra({ actions: [{ type: "add_tag", config: { tags: ["1 a"], destino: "card" } }] }),
      regra({ actions: [{ type: "add_tag", config: { tags: ["1 a", "outra"], destino: "contato" } }] }),
    ];
    expect(etiquetasDasEtapas(ignoradas).size).toBe(0);
  });

  it("com duas regras para a mesma etapa, vale a primeira", () => {
    const segunda = regra({ actions: [{ type: "add_tag", config: { tags: ["outra"], destino: "contato" } }] });
    expect(etiquetasDasEtapas([regra({}), segunda]).get(ETAPA_A)).toBe("Em atendimento");
  });

  it("não quebra com formatos inesperados", () => {
    const estranha = { trigger_event: "lead.stage_changed", is_active: true, conditions: null, actions: "x" };
    expect(etiquetasDasEtapas([estranha]).size).toBe(0);
  });
});

describe("etiquetasDeContatoNasRegras", () => {
  it("junta as etiquetas postas no contato por qualquer regra ativa, sem repetir por maiúsculas", () => {
    const regras = [regra({}), regraDePasso("02 - Follow-up"), regraDePasso("02 - follow-up"), regraDePasso("03 - Follow-up", false)];
    expect(etiquetasDeContatoNasRegras(regras)).toEqual(["Em atendimento", "02 - Follow-up"]);
  });
});

describe("passosDaEtapa", () => {
  const todas = ["Em atendimento", "03 - Follow-up", "02 - Follow-up", "02 - Outra coisa", "07 - follow-up"];

  it("transforma em passos as etiquetas numeradas com o mesmo resto, em ordem", () => {
    expect(passosDaEtapa("01 - Follow-up", todas)).toEqual([
      { etiqueta: "01 - Follow-up", rotulo: "01" },
      { etiqueta: "02 - Follow-up", rotulo: "02" },
      { etiqueta: "03 - Follow-up", rotulo: "03" },
      { etiqueta: "07 - follow-up", rotulo: "07" },
    ]);
  });

  it("não cria passos para etiqueta que não começa no 1, que não é numerada ou que está sozinha", () => {
    expect(passosDaEtapa("02 - Follow-up", todas)).toEqual([]);
    expect(passosDaEtapa("Em atendimento", todas)).toEqual([]);
    expect(passosDaEtapa("01 - Sozinha", todas)).toEqual([]);
  });
});

describe("escolhaAtiva", () => {
  const passos = ["01 - Follow-up", "02 - Follow-up"].map((etiqueta, i) => ({
    etiqueta,
    rotulo: `0${i + 1}`,
    contatos: 0,
    novas: 0,
  }));
  const etapas: EtapaDaFaixa[] = [
    { id: ETAPA_A, nome: "A", cor: null, etiqueta: "Em atendimento", etiquetas: ["Em atendimento"], passos: [], cards: 0, novas: 0, ganha: false, perdida: false },
    { id: ETAPA_B, nome: "B", cor: null, etiqueta: "01 - Follow-up", etiquetas: passos.map((p) => p.etiqueta), passos, cards: 0, novas: 0, ganha: false, perdida: false },
  ];

  it("marca a etapa cujo conjunto de etiquetas é o filtro, sem olhar maiúsculas", () => {
    expect(escolhaAtiva(etapas, "em atendimento")).toEqual({ etapaId: ETAPA_A, passo: null });
    expect(escolhaAtiva(etapas, ["02 - follow-up", "01 - Follow-up"])).toEqual({ etapaId: ETAPA_B, passo: null });
  });

  it("marca o passo quando o filtro é só a etiqueta dele", () => {
    expect(escolhaAtiva(etapas, "02 - Follow-up")).toEqual({ etapaId: ETAPA_B, passo: "02 - Follow-up" });
  });

  it("não marca nada sem filtro ou com etiquetas que não são de uma etapa", () => {
    expect(escolhaAtiva(etapas, undefined)).toBeNull();
    expect(escolhaAtiva(etapas, ["Em atendimento", "vip"])).toBeNull();
    expect(escolhaAtiva(etapas, "vip")).toBeNull();
  });
});

describe("corDaEtapa", () => {
  it("aceita só hex de 6 dígitos", () => {
    expect(corDaEtapa("#1A2b3C")).toBe("#1A2b3C");
    expect(corDaEtapa("blue")).toBeNull();
    expect(corDaEtapa(null)).toBeNull();
  });
});

describe("Mergulho 25–26/11 — as etapas de fim (Perdido e Matriculado) fora da faixa da Atendente", () => {
  const etapa = (id: string, nome: string, perdida = false): EtapaDaFaixa => ({
    id,
    nome,
    cor: null,
    etiqueta: nome.toLowerCase(),
    etiquetas: [nome.toLowerCase()],
    passos: [],
    cards: 1,
    novas: 0,
    ganha: nome === "Matriculado",
    perdida,
  });
  const funil = [
    etapa("a", "Novo contato"),
    etapa("b", "Matriculado"),
    etapa("c", "Perdido", true),
    etapa("d", "Reativação"),
  ];

  it("sem permissão de ver as etapas de fim, saem a de perda E a de ganho; a ordem fica", () => {
    expect(etapasDaFaixaParaOPapel(funil, false).map((e) => e.nome)).toEqual(["Novo contato", "Reativação"]);
  });

  it("quem pode ver as etapas de fim recebe a faixa inteira", () => {
    expect(etapasDaFaixaParaOPapel(funil, true).map((e) => e.nome)).toEqual([
      "Novo contato",
      "Matriculado",
      "Perdido",
      "Reativação",
    ]);
  });

  it("decide pela marca de perda, não pelo nome", () => {
    const renomeada = [etapa("x", "Desistiu", true), etapa("y", "Perdido")];
    expect(etapasDaFaixaParaOPapel(renomeada, false).map((e) => e.nome)).toEqual(["Perdido"]);
  });
});
