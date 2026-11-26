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
 * 18/11/2026, feito em 23/11/2026) e Todas (pedido de 24/11/2026, feito em
 * 25/11/2026). Ela trabalha só com Fila e Minhas. A administradora continua
 * vendo todas as abas, para consultar o histórico e o que está com cada pessoa.
 *
 * Esconder a aba NÃO é o mesmo que mudar a visibilidade. A organização segue em
 * "Todos veem tudo" (Configurações › Atendimento): se a visibilidade voltasse a
 * "só as dela + sem dono", a aba Todas também sumiria, mas a Atendente deixaria
 * de abrir a conversa que está com outra pessoa — foi assim que uma conversa
 * "sumiu" para a SDR em 23/11.
 *
 * A Atendente não perde conversa: a fechada reabre sozinha quando o cliente
 * escreve (`fn_service_inbound`), e ela abre qualquer conversa por
 * Contatos › ícone de balão (`/app/inbox?id=…`), com o botão Reabrir quando
 * está fechada e o Assumir quando está sem dono (responder não assume:
 * "a conversa fica com quem atendeu" está desligado).
 */
export const ABAS_ESCONDIDAS_DA_ATENDENTE: readonly string[] = ["all", "closed", "archived"];

/**
 * As etapas de FIM na faixa de etapas do Inbox: a Atendente não as vê. Perdido
 * saiu em 25/11/2026 ("apenas adm veem") e Matriculado em 26/11/2026 (a matrícula
 * se marca pela etiqueta `matriculado`, o card vai sozinho para a etapa e a SDR
 * fecha o atendimento). Vale para toda etapa marcada como perda ou ganho no funil
 * (`crm_stages.is_lost` / `is_won`), nas cinco empresas, e não para o nome:
 * renomear a etapa não a traz de volta. Gerente e administradora seguem vendo.
 * É só a faixa: o quadro do funil não muda.
 *
 * `true` mostra para todos, como no produto.
 */
export const ETAPAS_DE_FIM_NA_FAIXA_DA_ATENDENTE = false;
