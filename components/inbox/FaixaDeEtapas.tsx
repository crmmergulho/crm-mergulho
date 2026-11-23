"use client";

/**
 * A faixa de etapas no topo do Inbox (personalização da Mergulho, nov/2026).
 *
 * Um botão por etapa do funil, só com o NOME (o número de cards saiu em
 * 23/11/2026, a pedido: contava só os cards que o perfil vê, e confundia). O
 * vermelho, quando aparece, é quantas conversas não lidas os contatos têm. Clicar
 * aplica a etiqueta-espelho da etapa no MESMO filtro de etiqueta do Inbox (o
 * seletor "Filtrar por tag" mostra a escolha); clicar de novo tira o filtro.
 *
 * A etapa com PASSOS (o follow-up de 7 mensagens) é UM botão só: ele filtra
 * quem está em qualquer passo (as etiquetas "01" … "07" em "ou"). A lista dos
 * passos dentro do botão (setinha ▾) saiu em 17/11/2026, a pedido: na
 * distribuição dos atendimentos ela confundia mais do que ajudava. As
 * etiquetas de passo continuam no contato e o fluxo segue igual; só a divisão
 * na faixa foi tirada.
 *
 * A regra mora em `lib/inbox/faixa-de-etapas.ts`; os números, em
 * `/api/v1/inbox/faixa-de-etapas`. Sem dados (rota falhou, funil sem etapas,
 * nenhuma etapa com etiqueta) a faixa não aparece: o Inbox fica como era.
 */
import { useQuery } from "@tanstack/react-query";

import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import {
  escolhaAtiva,
  type EtapaDaFaixa,
  type FaixaDeEtapas as DadosDaFaixa,
} from "@/lib/inbox/faixa-de-etapas";
import { cn } from "@/lib/utils";

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
  /** O filtro de etiqueta atual do Inbox. */
  filtro: string | readonly string[] | undefined;
  /** As etiquetas escolhidas (uma ou várias, em "ou"), ou `null` para tirar o filtro. */
  onEscolher: (etiquetas: string[] | null) => void;
}

function NaoLidas({ total, rotulo }: { total: number; rotulo: string }) {
  if (total <= 0) return null;
  return (
    <span className="rounded-full bg-red-600 px-1.5 tabular-nums text-white" aria-label={rotulo}>
      {total}
    </span>
  );
}

interface BotaoProps {
  etapa: EtapaDaFaixa;
  cor: string;
  /**
   * A etapa está escolhida — inteira, ou por um passo dela posto à mão no
   * filtro de etiqueta. Nos dois casos o botão aparece marcado, e clicar tira o
   * filtro.
   */
  marcada: boolean;
  onEscolher: (etiquetas: string[] | null) => void;
}

function BotaoDaEtapa({ etapa, cor, marcada, onEscolher }: BotaoProps) {
  const t = useT();
  const semFiltro = etapa.etiquetas.length === 0;

  return (
    <button
      type="button"
      disabled={semFiltro}
      aria-pressed={marcada}
      title={
        semFiltro
          ? t("Esta etapa ainda não tem etiqueta automática")
          : marcada
            ? t("Clique para tirar o filtro")
            : t("Mostrar só os contatos desta etapa")
      }
      onClick={() => onEscolher(marcada ? null : etapa.etiquetas)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white transition",
        marcada ? "ring-2 ring-black/70 ring-offset-1 dark:ring-white/80" : "opacity-85 hover:opacity-100",
        semFiltro && "cursor-not-allowed opacity-40",
      )}
      style={{ backgroundColor: cor }}
    >
      <span>{etapa.nome}</span>
      <NaoLidas total={etapa.novas} rotulo={t("conversas não lidas")} />
    </button>
  );
}

export function FaixaDeEtapas({ orgId, filtro, onEscolher }: Props) {
  const t = useT();
  const { data } = useFaixaDeEtapas(orgId);
  const etapas = data?.etapas ?? [];
  if (!data?.funil || !etapas.some((e) => e.etiquetas.length > 0)) return null;
  const ativa = escolhaAtiva(etapas, filtro);

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
          cor={etapa.cor ?? PALETA[indice % PALETA.length] ?? "#475569"}
          marcada={ativa?.etapaId === etapa.id}
          onEscolher={onEscolher}
        />
      ))}
      <span className="ml-auto text-xs text-text-muted">
        {t("Vermelho: conversas não lidas")}
      </span>
    </div>
  );
}
