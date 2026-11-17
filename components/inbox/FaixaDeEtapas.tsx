"use client";

/**
 * A faixa de etapas no topo do Inbox (personalização da Mergulho, nov/2026).
 *
 * Um botão por etapa do funil: o número à esquerda é quantos cards estão na
 * etapa, o vermelho é quantas conversas não lidas os contatos dela têm. Clicar
 * aplica a etiqueta-espelho da etapa no MESMO filtro de etiqueta do Inbox (o
 * seletor "Filtrar por tag" mostra a escolha); clicar de novo tira o filtro.
 *
 * A etapa com PASSOS (o follow-up de 7 mensagens) tem os passos DENTRO do botão:
 * a setinha ao lado do nome abre a lista "01" … "07", com quantos contatos estão
 * em cada passo e as não lidas. O nome filtra quem está em qualquer passo; o
 * item da lista, só quem está naquele passo (e o botão mostra qual, "· 02").
 *
 * A regra mora em `lib/inbox/faixa-de-etapas.ts`; os números, em
 * `/api/v1/inbox/faixa-de-etapas`. Sem dados (rota falhou, funil sem etapas,
 * nenhuma etapa com etiqueta) a faixa não aparece: o Inbox fica como era.
 */
import { useQuery } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  /** A etapa inteira está escolhida. */
  etapaInteira: boolean;
  /** O passo escolhido desta etapa, ou `null`. */
  passoAtivo: string | null;
  onEscolher: (etiquetas: string[] | null) => void;
}

function BotaoDaEtapa({ etapa, cor, etapaInteira, passoAtivo, onEscolher }: BotaoProps) {
  const t = useT();
  const semFiltro = etapa.etiquetas.length === 0;
  const marcada = etapaInteira || passoAtivo !== null;
  const rotuloDoPasso = passoAtivo ? etapa.passos.find((p) => p.etiqueta === passoAtivo)?.rotulo : null;
  const temPassos = etapa.passos.length > 0;

  return (
    <div
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-md text-xs font-semibold uppercase tracking-wide text-white transition",
        marcada ? "ring-2 ring-black/70 ring-offset-1 dark:ring-white/80" : "opacity-85 hover:opacity-100",
        semFiltro && "opacity-40",
      )}
      style={{ backgroundColor: cor }}
    >
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
        className={cn("inline-flex items-center gap-1.5 px-2.5 py-1", semFiltro && "cursor-not-allowed")}
      >
        <span className="rounded bg-black/25 px-1.5 tabular-nums">{etapa.cards}</span>
        <span>
          {etapa.nome}
          {rotuloDoPasso ? ` · ${rotuloDoPasso}` : ""}
        </span>
        <NaoLidas total={etapa.novas} rotulo={t("conversas não lidas")} />
      </button>
      {temPassos && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("Passos de {etapa}").replace("{etapa}", etapa.nome)}
              title={t("Ver os passos")}
              className="border-l border-white/30 px-1.5 hover:bg-black/15"
            >
              <span aria-hidden>▾</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[13rem]">
            <DropdownMenuLabel className="text-xs">{etapa.nome}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onEscolher(etapaInteira ? null : etapa.etiquetas)}>
              <span className="flex-1">{t("Todos os passos")}</span>
              <span className="tabular-nums text-muted-foreground">{etapa.cards}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {etapa.passos.map((passo) => {
              const ativo = passoAtivo === passo.etiqueta;
              return (
                <DropdownMenuItem
                  key={passo.etiqueta}
                  onSelect={() => onEscolher(ativo ? null : [passo.etiqueta])}
                  className={cn(ativo && "font-semibold")}
                >
                  <span className="flex-1">
                    {t("Passo {n}").replace("{n}", passo.rotulo)}
                    {ativo ? " ✓" : ""}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{passo.contatos}</span>
                  {passo.novas > 0 && (
                    <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-[11px] tabular-nums text-white">
                      {passo.novas}
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
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
          etapaInteira={ativa?.etapaId === etapa.id && ativa.passo === null}
          passoAtivo={ativa?.etapaId === etapa.id ? ativa.passo : null}
          onEscolher={onEscolher}
        />
      ))}
      <span className="ml-auto text-xs text-text-muted">
        {t("Número à esquerda: cards · Vermelho: não lidas")}
      </span>
    </div>
  );
}
