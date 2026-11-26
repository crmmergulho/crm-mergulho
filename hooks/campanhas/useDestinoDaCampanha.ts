"use client";
/**
 * As listas que a campanha precisa para dizer ONDE o card nasce e QUEM atende:
 * funis, etapas do funil escolhido, e agentes publicados.
 *
 * Fica junto das campanhas e não em `hooks/pipelines/` porque lá não há leitura:
 * o Kanban carrega funis pelo Server Component, de propósito (a tela é aberta a
 * qualquer papel e a rota de funis exige `manager`).
 *
 * Mergulho (26/11/2026): as três listas vêm de UMA leitura, `/api/v1/campaigns/destinos`,
 * que passa pelo mesmo portão das campanhas. Antes cada uma ia à rota geral
 * (`/api/v1/pipelines`, `/stages`, `/api/v1/ai/agents`), que exige Gerente — e a
 * Atendente liberada para campanhas via o formulário sem funil. A forma que cada
 * hook devolve não mudou: quem consome segue lendo `data` como antes.
 */
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface FunilDaCampanha {
  id: string;
  name: string;
  is_default: boolean;
  channel_session_id?: string | null;
}

export interface EtapaDoFunil {
  id: string;
  name: string;
  position: number | null;
  is_won: boolean;
  is_lost: boolean;
}

export interface AgenteDisponivel {
  id: string;
  name: string;
  published_version_id?: string | null;
  archived_at?: string | null;
}

/** O ritmo padrão da empresa (Campanhas › Configurações). `null` = herda o número. */
export interface PadroesDaCampanha {
  intervalo_segundos: number | null;
  teto_diario: number | null;
  teto_horario: number | null;
  janela_inicio_hora: number | null;
  janela_fim_hora: number | null;
}

interface DestinosDaCampanha {
  funis: Array<FunilDaCampanha & { etapas: EtapaDoFunil[] }>;
  agentes: AgenteDisponivel[];
  padroes?: PadroesDaCampanha;
}

const CHAVE = ["campanhas-destinos"] as const;

async function lerDestinos(): Promise<DestinosDaCampanha> {
  return (await apiClient.get<{ data: DestinosDaCampanha }>("/api/v1/campaigns/destinos")).data;
}

export function useFunis() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: lerDestinos,
    staleTime: 60_000,
    select: (d): FunilDaCampanha[] => d.funis.map(({ etapas: _etapas, ...funil }) => funil),
  });
}

export function useEtapas(pipelineId: string | null) {
  return useQuery({
    queryKey: CHAVE,
    queryFn: lerDestinos,
    // Sem funil escolhido não há etapa possível.
    enabled: !!pipelineId,
    staleTime: 60_000,
    select: (d): EtapaDoFunil[] => d.funis.find((f) => f.id === pipelineId)?.etapas ?? [],
  });
}

/** Mergulho (26/11/2026): o ritmo padrão, para a campanha nova já abrir com ele. */
export function usePadroesDaCampanha() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: lerDestinos,
    staleTime: 60_000,
    select: (d): PadroesDaCampanha | null => d.padroes ?? null,
  });
}

export function useAgentesPublicados() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: lerDestinos,
    staleTime: 60_000,
    // Só agente PUBLICADO pode atender: um rascunho escolhido aqui viraria
    // silêncio na conversa, e o operador não teria como saber por quê.
    select: (d): AgenteDisponivel[] => d.agentes.filter((a) => !!a.published_version_id && !a.archived_at),
  });
}
