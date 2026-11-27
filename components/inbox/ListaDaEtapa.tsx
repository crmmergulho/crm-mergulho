"use client";

/**
 * A LISTA DA ETAPA no lugar da lista de conversas (personalização da Mergulho,
 * 27/11/2026) — o que aparece na coluna da esquerda do Inbox quando a SDR clica
 * numa etapa da faixa.
 *
 * Uma linha por CARD da etapa: a mesma quantidade que o número do botão. Cada
 * linha traz a conversa mais recente do contato, esteja ela na Fila, em Minhas,
 * com outra pessoa ou fechada — clicar abre a conversa ali mesmo, no centro. Quem
 * ainda não tem conversa (a Geladeira tem muitos assim) ganha o botão "Iniciar
 * conversa". O X (ou clicar de novo na etapa) volta para a lista de sempre.
 *
 * Os dados vêm de `/api/v1/inbox/faixa-de-etapas/leads`; a montagem, de
 * `lib/inbox/lista-da-etapa.ts`.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useConversaNovaComEscolhaDeCanal } from "@/components/channels/SeletorDeCanalParaConversa";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { LinhaDaEtapa, ListaDaEtapa as DadosDaLista } from "@/lib/inbox/lista-da-etapa";
import { cn } from "@/lib/utils";

interface Props {
  etapa: { id: string; nome: string };
  selectedId: string | null;
  onSelect: (conversationId: string) => void;
  onFechar: () => void;
}

export function useListaDaEtapa(etapaId: string | null) {
  return useQuery({
    queryKey: ["lista-da-etapa", etapaId],
    enabled: !!etapaId,
    refetchInterval: 15_000,
    queryFn: () =>
      apiClient
        .get<{ data: DadosDaLista }>(`/api/v1/inbox/faixa-de-etapas/leads?etapa=${etapaId}`)
        .then((r) => r.data),
  });
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const letras = partes.length > 1 ? `${partes[0]![0]}${partes[partes.length - 1]![0]}` : (partes[0] ?? "?").slice(0, 2);
  return letras.toUpperCase();
}

function Situacao({ linha }: { linha: LinhaDaEtapa }) {
  const t = useT();
  const v = linha.conversa;
  const [texto, classe] = !v
    ? [t("Sem conversa"), "bg-muted text-muted-foreground"]
    : v.status === "closed" || v.status === "archived" || v.status === "resolved"
      ? [t("Fechada"), "bg-muted text-muted-foreground"]
      : v.dono_nome
        ? [`${t("Com")} ${v.dono_nome}`, "bg-info-bg text-info-fg"]
        : [t("Na Fila"), "bg-warning-bg text-warning-fg"];
  return <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", classe)}>{texto}</span>;
}

export function ListaDaEtapa({ etapa, selectedId, onSelect, onFechar }: Props) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { data, isLoading, error, refetch } = useListaDaEtapa(etapa.id);
  const { iniciarConversa, abrindo, seletor } = useConversaNovaComEscolhaDeCanal({
    aoAbrir: async (conversationId) => {
      await refetch();
      onSelect(conversationId);
    },
  });
  const hora = useMemo(
    () => new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    [tag],
  );
  const linhas = data?.linhas ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="lista-da-etapa">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 text-sm">
          <span className="font-semibold">{etapa.nome}</span>
          {data && (
            <span className="ml-1 text-muted-foreground">
              · {linhas.length} {linhas.length === 1 ? t("lead") : t("leads")}
            </span>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onFechar}>
          {t("Voltar para a lista")} ✕
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="p-4 text-sm text-destructive">{t("Não consegui carregar os leads desta etapa.")}</p>
        ) : isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">{t("Carregando…")}</p>
        ) : linhas.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("Nenhum lead nesta etapa.")}</p>
        ) : (
          <ul>
            {linhas.map((linha) => {
              const v = linha.conversa;
              const selecionada = !!v && v.id === selectedId;
              return (
                <li key={linha.lead_id} className="border-b border-border">
                  <div
                    role={v ? "button" : undefined}
                    tabIndex={v ? 0 : undefined}
                    aria-current={selecionada ? "true" : undefined}
                    onClick={v ? () => onSelect(v.id) : undefined}
                    onKeyDown={
                      v
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelect(v.id);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "flex items-start gap-3 px-3 py-2.5",
                      v && "cursor-pointer hover:bg-muted/60",
                      selecionada && "bg-muted",
                    )}
                  >
                    <span
                      aria-hidden
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                    >
                      {iniciais(linha.contato.nome)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{linha.contato.nome}</span>
                        {v?.ultima_mensagem_em && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {hora.format(new Date(v.ultima_mensagem_em))}
                          </span>
                        )}
                      </div>
                      {v?.previa && <p className="truncate text-xs text-muted-foreground">{v.previa}</p>}
                      <div className="mt-1 flex items-center gap-1.5">
                        <Situacao linha={linha} />
                        {v && v.nao_lidas > 0 && (
                          <span className="rounded-full bg-red-600 px-1.5 text-[11px] text-white tabular-nums">
                            {v.nao_lidas}
                          </span>
                        )}
                        {!v && linha.contato.telefone && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="ml-auto h-7"
                            disabled={abrindo}
                            onClick={() =>
                              void iniciarConversa({
                                contact_id: linha.contato.id,
                                phone_number: linha.contato.telefone ?? undefined,
                                name: linha.contato.nome,
                              })
                            }
                          >
                            {t("Iniciar conversa")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {seletor}
    </div>
  );
}
