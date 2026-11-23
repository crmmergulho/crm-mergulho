/**
 * O que a barra do Inbox mostra NESTA instalação (personalização da Mergulho,
 * 18/11/2026).
 *
 * A Mergulho atende só com gente: não há agente de IA, então a aba
 * "Automático" (o que o robô conduz) ficava sempre vazia; e nenhum grupo de
 * WhatsApp está ligado em Conexões › Grupos, então o botão "Grupos" filtrava
 * para uma lista vazia. As duas ocupavam espaço na barra sem uso, e saíram a
 * pedido.
 *
 * Desligar aqui só ESCONDE: as rotas, as contagens e o filtro `is_group`
 * continuam no código, e os testes do produto os exercitam com as duas chaves
 * ligadas (`vi.mock` deste módulo). Para trazer de volta quando a Mergulho
 * ligar IA ou grupos: troque para `true` e publique uma imagem nova.
 */
export const ABA_AUTOMATICO_VISIVEL = false;
export const FILTRO_DE_GRUPOS_VISIVEL = false;

/**
 * Abas que a ATENDENTE (papel `agent`) não vê: Fechadas e Arquivadas (pedido de
 * 18/11/2026, feito em 23/11/2026). A administradora continua vendo as duas,
 * para consultar o histórico.
 *
 * A Atendente não perde conversa: a fechada reabre sozinha quando o cliente
 * escreve (`fn_service_inbound`), e ela abre qualquer conversa dela por
 * Contatos › ícone de balão (`/app/inbox?id=…`) e usa o botão Reabrir.
 */
export const ABAS_ESCONDIDAS_DA_ATENDENTE: readonly string[] = ["closed", "archived"];
