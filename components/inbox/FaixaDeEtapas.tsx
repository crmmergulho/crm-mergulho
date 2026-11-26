"use client";

/**
 * A faixa de etapas no topo do Inbox (personalização da Mergulho, nov/2026).
 *
 * Um botão por etapa do funil: o número à esquerda é quantos cards estão na
 * etapa — TODOS os da organização, de qualquer dono — e o vermelho, quando
 * aparece, é quantas conversas não lidas os contatos dela têm.
 *
 * CLICAR ABRE A LISTA DA ETAPA (26/11/2026): Funis › Lista, só com os cards
 * daquela etapa (`?visao=lista&etapa=`). Antes o clique filtrava as CONVERSAS do
 * Inbox pela etiqueta-espelho da etapa, e o número não batia com o que aparecia:
 * a conversa podia estar fechada, com outra pessoa, sem a etiqueta (tirada à
 * mão) ou nem existir (na Geladeira, 111 de 163 nunca tiveram conversa). A
 * Lista é dos CARDS, a mesma coisa que o número conta: clicou, apareceu.
 *
 * Para a Atendente, as etapas de fim (Matriculado e Perdido) não aparecem
 * (`lib/inbox/abas-da-mergulho.ts`): a matrícula se marca pela etiqueta
 * `matriculado`, e o card vai sozinho para a etapa.
 *
 * Os números vêm de `/api/v1/inbox/faixa-de-etapas`. Sem dados (rota falhou,
 * funil sem etapas) a faixa não aparece: o Inbox fica como era.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { type EtapaDaFaixa, type FaixaDeEtapas as DadosDaFaixa } from "@/lib/inbox/faixa-de-etapas";

/** Cor de reserva quando a etapa não tem cor própria cadastrada. */
const PALETA = ["#2563eb", "#0891b2", "#7c3aed", "#d97706", "#475569", "#db2777", "#16a34a", "#dc2626"];

export function useFaixaDeEtapas(orgId: string | null) {
  return useQuery({
    queryKey: ["faixa-de-etapas", orgId],
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: () =>
      apiClient
        .get<{ data: DadosDaFaixa }>("/api/v1/inbox/faixa-de-etapas")
        .then((r) => r.data),
  });
}

interface Props {
  orgId: string | null;
}

function NaoLidas({ total, rotulo }: { total: number; rotulo: string }) {
  if (total <= 0) return null;
  return (
    <span className="rounded-full bg-red-600 px-1.5 tabular-nums text-white" aria-label={rotulo}>
      {total}
    </span>
  );
}

/** O endereço da lista de UMA etapa: Funis › Lista, filtrada por ela. */
export function hrefDaListaDaEtapa(funilId: string, etapaId: string): string {
  const p = new URLSearchParams({ visao: "lista", etapa: etapaId });
  return `/app/pipelines/${funilId}?${p.toString()}`;
}

function BotaoDaEtapa({ etapa, cor, funilId }: { etapa: EtapaDaFaixa; cor: string; funilId: string }) {
  const t = useT();
  return (
    <Link
      href={hrefDaListaDaEtapa(funilId, etapa.id)}
      title={t("Ver a lista desta etapa")}
      data-testid={`faixa-etapa-${etapa.id}`}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white opacity-85 transition hover:opacity-100"
      style={{ backgroundColor: cor }}
    >
      <span className="rounded-sm bg-black/25 px-1.5 tabular-nums" aria-label={t("cards na etapa")}>
        {etapa.cards}
      </span>
      <span>{etapa.nome}</span>
      <NaoLidas total={etapa.novas} rotulo={t("conversas não lidas")} />
    </Link>
  );
}

export function FaixaDeEtapas({ orgId }: Props) {
  const t = useT();
  const { data } = useFaixaDeEtapas(orgId);
  const etapas = data?.etapas ?? [];
  if (!data?.funil || etapas.length === 0) return null;
  const funilId = data.funil.id;

  return (
    <div
      role="toolbar"
      aria-label={t("Etapas do funil")}
      className="hidden w-full shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 md:flex"
    >
      <span className="mr-1 text-sm font-semibold">{data.funil.nome}</span>
      {etapas.map((etapa, indice) => (
        <BotaoDaEtapa
          key={etapa.id}
          etapa={etapa}
          funilId={funilId}
          cor={etapa.cor ?? PALETA[indice % PALETA.length] ?? "#475569"}
        />
      ))}
      <span className="ml-auto text-xs text-text-muted">
        {t("Número: cards na etapa · Vermelho: conversas não lidas · Clique para ver a lista")}
      </span>
    </div>
  );
}
