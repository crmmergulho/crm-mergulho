"use client";

/**
 * A faixa de etapas no topo do Inbox (personalização da Mergulho, nov/2026).
 *
 * Um botão por etapa do funil: o número à esquerda é quantos cards estão na
 * etapa, o vermelho é quantas conversas não lidas os contatos dela têm. Clicar
 * aplica a etiqueta-espelho da etapa no MESMO filtro de etiqueta do Inbox (o
 * seletor "Filtrar por tag" mostra a escolha); clicar de novo tira o filtro.
 *
 * A etapa com PASSOS (o follow-up de 7 mensagens) ganha, ao lado do botão dela,
 * um botão pequeno por passo ("01" … "07"), com quantos contatos estão naquele
 * passo e as não lidas. O botão da etapa filtra quem está em qualquer passo;
 * o do passo, só quem está nele.
 *
 * A regra mora em `lib/inbox/faixa-de-etapas.ts`; os números, em
 * `/api/v1/inbox/faixa-de-etapas`. Sem dados (rota falhou, funil sem etapas,
 * nenhuma etapa com etiqueta) a faixa não aparece: o Inbox fica como era.
 */
import { useQuery } from "@tanstack/react-query";

import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { escolhaAtiva, type FaixaDeEtapas as DadosDaFaixa } from "@/lib/inbox/faixa-de-etapas";
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
      {etapas.map((etapa, indice) => {
        const cor = etapa.cor ?? PALETA[indice % PALETA.length];
        const semFiltro = etapa.etiquetas.length === 0;
        const etapaInteira = ativa?.etapaId === etapa.id && ativa.passo === null;
        return (
          <div key={etapa.id} className="inline-flex items-center gap-1">
            <button
              type="button"
              disabled={semFiltro}
              aria-pressed={etapaInteira}
              title={
                semFiltro
                  ? t("Esta etapa ainda não tem etiqueta automática")
                  : etapaInteira
                    ? t("Clique para tirar o filtro")
                    : t("Mostrar só os contatos desta etapa")
              }
              onClick={() => onEscolher(etapaInteira ? null : etapa.etiquetas)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white transition",
                etapaInteira ? "ring-2 ring-black/70 ring-offset-1 dark:ring-white/80" : "opacity-85 hover:opacity-100",
                semFiltro && "cursor-not-allowed opacity-40",
              )}
              style={{ backgroundColor: cor }}
            >
              <span className="rounded bg-black/25 px-1.5 tabular-nums">{etapa.cards}</span>
              <span>{etapa.nome}</span>
              <NaoLidas total={etapa.novas} rotulo={t("conversas não lidas")} />
            </button>
            {etapa.passos.length > 0 && (
              <div
                role="group"
                aria-label={t("Passos de {etapa}").replace("{etapa}", etapa.nome)}
                className="inline-flex items-center gap-1 rounded-md border px-1 py-0.5"
                style={{ borderColor: cor }}
              >
                {etapa.passos.map((passo) => {
                  const passoAtivo = ativa?.etapaId === etapa.id && ativa.passo === passo.etiqueta;
                  return (
                    <button
                      key={passo.etiqueta}
                      type="button"
                      aria-pressed={passoAtivo}
                      title={
                        passoAtivo
                          ? t("Clique para tirar o filtro")
                          : t("Mostrar só quem está em {passo}").replace("{passo}", passo.etiqueta)
                      }
                      onClick={() => onEscolher(passoAtivo ? null : [passo.etiqueta])}
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition",
                        passoAtivo ? "text-white" : "hover:opacity-80",
                      )}
                      style={passoAtivo ? { backgroundColor: cor } : { color: cor }}
                    >
                      <span>{passo.rotulo}</span>
                      <span className={cn("rounded px-1", passoAtivo ? "bg-black/25" : "bg-black/5 dark:bg-white/10")}>
                        {passo.contatos}
                      </span>
                      <NaoLidas total={passo.novas} rotulo={t("conversas não lidas")} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <span className="ml-auto text-xs text-text-muted">
        {t("Número à esquerda: cards · Vermelho: não lidas")}
      </span>
    </div>
  );
}
