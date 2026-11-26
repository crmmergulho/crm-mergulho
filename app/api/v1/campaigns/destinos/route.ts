/**
 * GET /api/v1/campaigns/destinos — os funis (com as etapas) e os agentes
 * publicados que a tela de campanha oferece: "Com negócio no funil", "Vira card
 * no funil / Na etapa" e "Quem atende a resposta".
 *
 * Personalização da Mergulho (26/11/2026). A tela lia `/api/v1/pipelines`,
 * `/api/v1/pipelines/[id]/stages` e `/api/v1/ai/agents`, que exigem Gerente. Com
 * a Atendente liberada para campanhas na empresa da SDR
 * (`lib/campanhas/quem-usa-campanhas.ts`), as três listas voltavam 403 e o
 * formulário ficava sem funil. Em vez de abrir aquelas rotas para toda Atendente
 * de toda empresa, esta leitura mora DENTRO de campanhas e passa pelo MESMO
 * portão: quem pode montar campanha pode ver para onde ela manda.
 *
 * Só leitura, pela sessão (a RLS de leitura de funil, etapa e agente é da equipe
 * inteira), sempre com a organização do papel. Devolve só o que a tela usa.
 *
 * Mergulho (26/11/2026): devolve também os PADRÕES de ritmo da empresa
 * (`settings.campanhas`, Campanhas › Configurações), para a campanha nova já
 * abrir com eles preenchidos. Antes a tela abria em branco, e em branco a
 * campanha segue o ritmo do número — que, com o número aquecido, é rápido.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { lerConfiguracao } from "@/lib/campanhas/configuracao";
import { exigirPapelDeCampanhas } from "@/lib/campanhas/quem-usa-campanhas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface LinhaDoFunil {
  id: string;
  name: string;
  is_default: boolean | null;
}

interface LinhaDaEtapa {
  id: string;
  name: string;
  position: number | null;
  is_won: boolean | null;
  is_lost: boolean | null;
  pipeline_id: string;
}

interface LinhaDoAgente {
  id: string;
  name: string;
  published_version_id: string | null;
  archived_at: string | null;
}

/** Só o ritmo: a janela de atribuição dos padrões não é da tela de campanha nova. */
function padroesDoRitmo(settings: unknown) {
  const c = lerConfiguracao(settings);
  return {
    intervalo_segundos: c.intervalo_segundos,
    teto_diario: c.teto_diario,
    teto_horario: c.teto_horario,
    janela_inicio_hora: c.janela_inicio_hora,
    janela_fim_hora: c.janela_fim_hora,
  };
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await exigirPapelDeCampanhas({ requestId });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;
  const supabase = await createClient();

  const [funis, etapas, agentes, empresa] = await Promise.all([
    supabase
      .from("crm_pipelines")
      .select("id, name, is_default")
      .eq("organization_id", org)
      .eq("is_archived", false)
      .order("is_default", { ascending: false })
      .order("position", { ascending: true }),
    supabase
      .from("crm_stages")
      .select("id, name, position, is_won, is_lost, pipeline_id")
      .eq("organization_id", org)
      .eq("is_archived", false)
      .order("position", { ascending: true }),
    supabase
      .from("ai_agents")
      .select("id, name, published_version_id, archived_at")
      .eq("organization_id", org)
      .not("published_version_id", "is", null)
      .is("archived_at", null),
    // Os padrões moram em `organizations.settings`; a organização é a do papel.
    createAdminClient().from("organizations").select("settings").eq("id", org).maybeSingle(),
  ]);
  if (funis.error || etapas.error || agentes.error || empresa.error) {
    return fail("internal_error", "Failed to read campaign destinations.", 500, { requestId });
  }

  const etapasPorFunil = new Map<string, Array<Omit<LinhaDaEtapa, "pipeline_id">>>();
  for (const e of (etapas.data ?? []) as LinhaDaEtapa[]) {
    const lista = etapasPorFunil.get(e.pipeline_id) ?? [];
    lista.push({ id: e.id, name: e.name, position: e.position, is_won: e.is_won === true, is_lost: e.is_lost === true });
    etapasPorFunil.set(e.pipeline_id, lista);
  }

  return ok(
    {
      funis: ((funis.data ?? []) as LinhaDoFunil[]).map((f) => ({
        id: f.id,
        name: f.name,
        is_default: f.is_default === true,
        etapas: etapasPorFunil.get(f.id) ?? [],
      })),
      agentes: (agentes.data ?? []) as LinhaDoAgente[],
      padroes: padroesDoRitmo((empresa.data as { settings?: unknown } | null)?.settings),
    },
    { requestId },
  );
}
