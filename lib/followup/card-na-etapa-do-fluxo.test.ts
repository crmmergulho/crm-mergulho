import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { decidirMovimento, levarCardParaEtapaDoFluxo } from "./card-na-etapa-do-fluxo";

const ORG = "00000000-0000-4000-8000-000000000001";
const FLUXO = "00000000-0000-4000-8000-000000000002";
const CONTATO = "00000000-0000-4000-8000-000000000003";
const FOLLOW_UP = "00000000-0000-4000-8000-0000000000f0";
const EM_ATENDIMENTO = "00000000-0000-4000-8000-0000000000a0";
const FUNIL = "00000000-0000-4000-8000-0000000000c0";
const CARD = "00000000-0000-4000-8000-0000000000d0";

describe("decidirMovimento", () => {
  it("move o card que está em outra etapa", () => {
    expect(decidirMovimento(FOLLOW_UP, { id: CARD, stage_id: EM_ATENDIMENTO })).toEqual({
      mover: true,
      leadId: CARD,
      etapaId: FOLLOW_UP,
    });
  });
  it("não move quem já está na etapa do fluxo", () => {
    expect(decidirMovimento(FOLLOW_UP, { id: CARD, stage_id: FOLLOW_UP })).toEqual({
      mover: false,
      motivo: "ja_na_etapa",
    });
  });
  it("não move quando o fluxo não começa por etapa", () => {
    expect(decidirMovimento(null, { id: CARD, stage_id: EM_ATENDIMENTO })).toEqual({
      mover: false,
      motivo: "fluxo_sem_etapa",
    });
  });
  it("não move quando o contato não tem card aberto no funil", () => {
    expect(decidirMovimento(FOLLOW_UP, null)).toEqual({ mover: false, motivo: "sem_card_aberto" });
  });
});

/** Um cliente falso: cada tabela devolve a linha dada e guarda os filtros pedidos. */
function clienteFalso(linhas: Record<string, unknown>) {
  const filtros: Record<string, Array<[string, unknown]>> = {};
  const admin = {
    from(tabela: string) {
      filtros[tabela] = [];
      const consulta = {
        select: () => consulta,
        eq: (coluna: string, valor: unknown) => {
          filtros[tabela]!.push([coluna, valor]);
          return consulta;
        },
        order: () => consulta,
        limit: () => consulta,
        maybeSingle: async () => ({ data: linhas[tabela] ?? null, error: null }),
      };
      return consulta;
    },
  };
  return { admin: admin as unknown as SupabaseClient, filtros };
}

const POINTER_DE_ETAPA = {
  active_version_id: "00000000-0000-4000-8000-000000000009",
  trigger_config: { kind: "stage_change", params: { stage_id: FOLLOW_UP } },
  surface: "followup",
};

const entrada = {
  organizationId: ORG,
  pointerId: FLUXO,
  contactId: CONTATO,
  actor: { type: "user" as const, id: "00000000-0000-4000-8000-0000000000e0" },
  requestId: "req-1",
};

describe("levarCardParaEtapaDoFluxo", () => {
  it("move o card aberto do contato para a etapa do gatilho, em nome de quem clicou", async () => {
    const { admin, filtros } = clienteFalso({
      followup_flow_pointers: POINTER_DE_ETAPA,
      crm_stages: { pipeline_id: FUNIL },
      crm_leads: { id: CARD, stage_id: EM_ATENDIMENTO },
    });
    const mover = vi.fn().mockResolvedValue({});

    const resultado = await levarCardParaEtapaDoFluxo(admin, entrada, { mover });

    expect(resultado).toEqual({ movido: true, leadId: CARD, etapaId: FOLLOW_UP });
    expect(mover).toHaveBeenCalledWith(
      admin,
      { organization_id: ORG, actor: entrada.actor, requestId: "req-1" },
      CARD,
      { to_stage_id: FOLLOW_UP },
    );
    // Só o card aberto, do contato, no funil da etapa, na organização.
    expect(filtros.crm_leads).toEqual([
      ["organization_id", ORG],
      ["contact_id", CONTATO],
      ["pipeline_id", FUNIL],
      ["status", "open"],
    ]);
  });

  it("fluxo de gatilho manual não move nada", async () => {
    const { admin } = clienteFalso({
      followup_flow_pointers: { ...POINTER_DE_ETAPA, trigger_config: { kind: "manual" } },
    });
    const mover = vi.fn();

    expect(await levarCardParaEtapaDoFluxo(admin, entrada, { mover })).toEqual({
      movido: false,
      motivo: "fluxo_sem_etapa",
    });
    expect(mover).not.toHaveBeenCalled();
  });

  it("card que já está na etapa fica onde está", async () => {
    const { admin } = clienteFalso({
      followup_flow_pointers: POINTER_DE_ETAPA,
      crm_stages: { pipeline_id: FUNIL },
      crm_leads: { id: CARD, stage_id: FOLLOW_UP },
    });
    const mover = vi.fn();

    expect(await levarCardParaEtapaDoFluxo(admin, entrada, { mover })).toEqual({
      movido: false,
      motivo: "ja_na_etapa",
    });
    expect(mover).not.toHaveBeenCalled();
  });
});
