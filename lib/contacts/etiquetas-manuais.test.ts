import { describe, expect, it } from "vitest";

import { etiquetasAutomaticasDoContato, etiquetasManuais, etiquetasQueAcionamRegras } from "./etiquetas-manuais";

describe("etiquetasAutomaticasDoContato", () => {
  it("junta o que regras ativas põem ou tiram do contato, normalizado", () => {
    const regras = [
      {
        is_active: true,
        actions: [
          { type: "remove_tag", config: { destino: "contato", tags: ["Novo contato", "Geladeira"] } },
          { type: "add_tag", config: { destino: "contato", tags: ["Em atendimento"] } },
        ],
      },
      { is_active: true, actions: [{ type: "add_tag", config: { destino: "contato", tags: ["02 - Follow-up"] } }] },
    ];
    expect(etiquetasAutomaticasDoContato(regras).sort()).toEqual(
      ["02 - follow-up", "em atendimento", "geladeira", "novo contato"].sort(),
    );
  });

  it("ignora regra pausada, etiqueta posta no card e formatos inesperados", () => {
    const regras = [
      { is_active: false, actions: [{ type: "add_tag", config: { destino: "contato", tags: ["pausada"] } }] },
      { is_active: true, actions: [{ type: "add_tag", config: { tags: ["nat. bebês"] } }] },
      { is_active: true, actions: [{ type: "create_task", config: { destino: "contato", tags: ["tarefa"] } }] },
      { is_active: true, actions: "x" },
      { is_active: true, actions: [null, { type: "add_tag" }, { type: "add_tag", config: { destino: "contato", tags: [1] } }] },
    ];
    expect(etiquetasAutomaticasDoContato(regras)).toEqual([]);
  });
});

describe("etiquetasManuais", () => {
  it("tira as automáticas, normaliza, não repete e ordena", () => {
    const vocabulario = ["Unidade II", "nat. bebês", "Geladeira", "unidade i", "Unidade I", "hidro", "02 - Follow-up"];
    const automaticas = ["geladeira", "02 - follow-up"];
    expect(etiquetasManuais(vocabulario, automaticas)).toEqual(["hidro", "nat. bebês", "unidade i", "unidade ii"]);
  });
});

describe("etiqueta que aciona regra é manual", () => {
  const espelho = {
    is_active: true,
    trigger_event: "lead.stage_changed",
    actions: [{ type: "add_tag", config: { destino: "contato", tags: ["aula experimental"] } }],
  };
  const mover = {
    is_active: true,
    trigger_event: "contact.tag_added",
    conditions: [{ field: "event.added_tags", op: "contains", value: "Aula Experimental" }],
    actions: [{ type: "create_or_move_lead", config: { pipeline_id: "p", stage_id: "s" } }],
  };

  it("acha as etiquetas que disparam regras de contato ganhou etiqueta", () => {
    expect(etiquetasQueAcionamRegras([espelho, mover])).toEqual(["aula experimental"]);
    expect(etiquetasQueAcionamRegras([{ ...mover, is_active: false }])).toEqual([]);
    expect(etiquetasQueAcionamRegras([{ ...mover, trigger_event: "lead.tag_added" }])).toEqual([]);
    expect(etiquetasQueAcionamRegras([{ ...mover, conditions: { any: mover.conditions } }])).toEqual(["aula experimental"]);
  });

  it("a etiqueta que aciona regra deixa de ser automática, mesmo que o espelho a ponha", () => {
    expect(etiquetasAutomaticasDoContato([espelho])).toEqual(["aula experimental"]);
    expect(etiquetasAutomaticasDoContato([espelho, mover])).toEqual([]);
  });
});
