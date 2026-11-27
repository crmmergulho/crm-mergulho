/**
 * A LISTA DA ETAPA no Inbox (personalização da Mergulho, 27/11/2026).
 *
 * Clicar numa etapa da faixa troca a lista da esquerda pelos LEADS daquela etapa
 * — os cards, a mesma coisa que o número do botão conta. Cada linha traz a
 * conversa mais recente do contato, de qualquer aba, de qualquer dono e aberta
 * ou fechada; quem ainda não tem conversa aparece também, para a SDR iniciar.
 *
 * Antes o clique filtrava as CONVERSAS da aba aberta pela etiqueta da etapa, e a
 * lista vinha vazia sempre que a conversa estava na outra aba (Minhas × Fila),
 * com outra pessoa, fechada, sem a etiqueta ou nem existia.
 *
 * Aqui mora só a montagem (pura, testada); quem lê o banco é
 * `app/api/v1/inbox/faixa-de-etapas/leads/route.ts`.
 */

export interface CardDaEtapa {
  id: string;
  contact_id: string | null;
  updated_at: string;
}

export interface ContatoDaEtapa {
  id: string;
  name: string | null;
  display_name: string | null;
  phone_number: string | null;
}

export interface ConversaDaEtapa {
  id: string;
  contact_id: string;
  status: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count_for_assignee: number | null;
  assigned_to_user_id: string | null;
  assigned_to_user_name: string | null;
}

export interface LinhaDaEtapa {
  lead_id: string;
  contato: { id: string; nome: string; telefone: string | null };
  /** A conversa mais recente do contato; `null` = ainda não houve conversa. */
  conversa: {
    id: string;
    status: string;
    ultima_mensagem_em: string | null;
    previa: string | null;
    nao_lidas: number;
    dono_id: string | null;
    dono_nome: string | null;
  } | null;
}

export interface ListaDaEtapa {
  etapa: { id: string; nome: string };
  linhas: LinhaDaEtapa[];
}

function nomeDoContato(c: ContatoDaEtapa | undefined): string {
  const nome = (c?.display_name ?? "").trim() || (c?.name ?? "").trim();
  return nome || (c?.phone_number ?? "").trim() || "Contato sem nome";
}

function instante(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Uma linha por CARD, na ordem em que a SDR quer ver: primeiro quem tem conversa,
 * da mais recente para a mais antiga; depois quem ainda não tem, do card mexido
 * por último para o mais antigo. Contato com mais de uma conversa (um por número)
 * mostra a mais recente.
 */
export function montarLinhasDaEtapa(
  cards: readonly CardDaEtapa[],
  contatos: readonly ContatoDaEtapa[],
  conversas: readonly ConversaDaEtapa[],
): LinhaDaEtapa[] {
  const contatoPorId = new Map(contatos.map((c) => [c.id, c]));
  const conversaPorContato = new Map<string, ConversaDaEtapa>();
  for (const v of conversas) {
    const atual = conversaPorContato.get(v.contact_id);
    if (!atual || instante(v.last_message_at) > instante(atual.last_message_at)) {
      conversaPorContato.set(v.contact_id, v);
    }
  }

  const linhas = cards
    .filter((card) => card.contact_id !== null)
    .map((card) => {
      const contato = contatoPorId.get(card.contact_id as string);
      const v = conversaPorContato.get(card.contact_id as string);
      const linha: LinhaDaEtapa & { _ordemDoCard: number } = {
        lead_id: card.id,
        contato: { id: card.contact_id as string, nome: nomeDoContato(contato), telefone: contato?.phone_number ?? null },
        conversa: v
          ? {
              id: v.id,
              status: v.status,
              ultima_mensagem_em: v.last_message_at,
              previa: v.last_message_preview,
              nao_lidas: v.unread_count_for_assignee ?? 0,
              dono_id: v.assigned_to_user_id,
              dono_nome: v.assigned_to_user_name,
            }
          : null,
        _ordemDoCard: instante(card.updated_at),
      };
      return linha;
    });

  linhas.sort((a, b) => {
    if (a.conversa && !b.conversa) return -1;
    if (!a.conversa && b.conversa) return 1;
    if (a.conversa && b.conversa) {
      return instante(b.conversa.ultima_mensagem_em) - instante(a.conversa.ultima_mensagem_em);
    }
    return b._ordemDoCard - a._ordemDoCard;
  });

  return linhas.map(({ _ordemDoCard: _, ...linha }) => linha);
}
