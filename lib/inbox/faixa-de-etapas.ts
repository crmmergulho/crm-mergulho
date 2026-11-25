/**
 * A FAIXA DE ETAPAS DO INBOX — personalização da instalação da Mergulho (nov/2026).
 *
 * Um botão por etapa do funil no topo do Inbox: clicar filtra a lista pelos
 * contatos daquela etapa. O filtro NÃO é uma régua nova: cada etapa tem uma
 * etiqueta-espelho no CONTATO, posta e tirada por automação ("QUANDO um lead
 * mudar de etapa SE etapa de destino = X ENTÃO tira as outras e põe a de X"), e o
 * clique aplica essa etiqueta pelo filtro de marcador que o Inbox já tem — o que
 * filtra no banco pelo campo calculado do contato e não tem teto de ids na URL.
 *
 * Quem diz qual etiqueta espelha qual etapa são as PRÓPRIAS regras ativas, e não
 * um nome montado a partir da etapa: renomear a etapa não quebra a faixa, e a
 * etiqueta continua sendo a que a automação de fato grava.
 *
 * ─── Passos dentro de uma etapa ────────────────────────────────────────────
 *
 * Quando a etiqueta-espelho de uma etapa é numerada a partir de 1 ("01 - Follow-up"),
 * as etiquetas com o MESMO resto e outro número ("02 - Follow-up" … "07 - Follow-up")
 * que alguma regra ativa põe no contato viram PASSOS da etapa: um botão pequeno
 * para cada um, e o botão da etapa passa a filtrar quem está em QUALQUER passo.
 * É o follow-up de 7 mensagens da Mergulho, em que cada mensagem troca a
 * etiqueta do contato (regras P2 a P7).
 *
 * ─── Maiúsculas ─────────────────────────────────────────────────────────────
 *
 * A etiqueta sai COMO A REGRA A ESCREVE ("Em atendimento"): é assim que a ação
 * `add_tag` a grava no contato, e o filtro do Inbox (`cs`) compara byte a byte.
 * A faixa conta e filtra pela MESMA grafia, para o número do botão bater com a
 * lista que o clique abre. O editor de etiquetas da tela grava em minúsculas:
 * um contato marcado à mão como "em atendimento" fica fora dos dois, do mesmo
 * jeito. Só o reconhecimento do filtro ativo ignora maiúsculas.
 *
 * Puro, sem I/O.
 */

/** O que a faixa lê de cada linha de `automation_rules`. */
export interface RegraParaAFaixa {
  trigger_event: string;
  is_active: boolean;
  conditions: unknown;
  actions: unknown;
}

interface CondicaoSolta {
  field?: unknown;
  op?: unknown;
  value?: unknown;
}

/**
 * As condições que valem TODAS juntas. Um grupo `{"any": […]}` não serve para
 * dizer "esta regra é da etapa X" — qualquer uma das condições bastaria — e por
 * isso fica de fora.
 */
function condicoesEmE(condicoes: unknown): CondicaoSolta[] {
  if (Array.isArray(condicoes)) return condicoes as CondicaoSolta[];
  if (condicoes && typeof condicoes === "object") {
    const grupo = condicoes as { all?: unknown };
    if (Array.isArray(grupo.all)) return grupo.all as CondicaoSolta[];
  }
  return [];
}

/** A chave de comparação: aparada e em minúsculas. Nunca é o que se grava. */
function chave(etiqueta: string): string {
  return etiqueta.trim().toLowerCase();
}

/** As etiquetas que UMA ação `add_tag` põe no contato (vazio para qualquer outra ação). */
function etiquetasDoContatoNaAcao(acao: unknown): string[] {
  if (!acao || typeof acao !== "object") return [];
  const { type, config } = acao as { type?: unknown; config?: unknown };
  if (type !== "add_tag" || !config || typeof config !== "object") return [];
  const { destino, tags } = config as { destino?: unknown; tags?: unknown };
  if (destino !== "contato" || !Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim());
}

/**
 * De cada etapa, a etiqueta-espelho que a automação ativa põe no contato.
 *
 * Só conta a regra que tem EXATAMENTE uma etiqueta adicionada no contato: com
 * duas, não dá para saber qual delas representa a etapa. Duas regras para a
 * mesma etapa: vale a primeira lida — a faixa não inventa desempate.
 */
export function etiquetasDasEtapas(regras: readonly RegraParaAFaixa[]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const regra of regras) {
    if (!regra.is_active || regra.trigger_event !== "lead.stage_changed") continue;
    const destino = condicoesEmE(regra.conditions).find(
      (c) => c.field === "event.to_stage_id" && c.op === "eq" && typeof c.value === "string",
    );
    if (!destino || typeof destino.value !== "string") continue;
    const etapaId = destino.value;
    if (mapa.has(etapaId)) continue;
    const acoes = Array.isArray(regra.actions) ? (regra.actions as unknown[]) : [];
    for (const acao of acoes) {
      const validas = etiquetasDoContatoNaAcao(acao);
      const unica = validas[0];
      if (validas.length === 1 && unica !== undefined) {
        mapa.set(etapaId, unica);
        break;
      }
    }
  }
  return mapa;
}

/**
 * Toda etiqueta que alguma regra ATIVA põe no contato, de qualquer gatilho.
 * Uma por nome (sem olhar maiúsculas); vale a primeira grafia lida.
 */
export function etiquetasDeContatoNasRegras(regras: readonly RegraParaAFaixa[]): string[] {
  const vistas = new Map<string, string>();
  for (const regra of regras) {
    if (!regra.is_active) continue;
    const acoes = Array.isArray(regra.actions) ? (regra.actions as unknown[]) : [];
    for (const acao of acoes) {
      for (const etiqueta of etiquetasDoContatoNaAcao(acao)) {
        if (!vistas.has(chave(etiqueta))) vistas.set(chave(etiqueta), etiqueta);
      }
    }
  }
  return [...vistas.values()];
}

const NUMERADA = /^(\d{1,2})\s*-\s*(.+)$/;

/** Um passo de uma etapa, como a faixa o desenha. */
export interface PassoDaFaixa {
  etiqueta: string;
  /** O número do passo com dois dígitos ("01"). */
  rotulo: string;
  /** Quantos contatos têm a etiqueta deste passo. */
  contatos: number;
  /** Conversas não lidas de contatos neste passo. */
  novas: number;
}

/**
 * Os passos de uma etapa, em ordem: só quando a etiqueta da etapa é a de número
 * 1 ("01 - X" ou "1 - X") e existem pelo menos mais um "N - X" nas regras.
 * Números repetidos ficam com a primeira grafia lida.
 */
export function passosDaEtapa(
  etiquetaDaEtapa: string,
  etiquetasDasRegras: readonly string[],
): Pick<PassoDaFaixa, "etiqueta" | "rotulo">[] {
  const base = NUMERADA.exec(etiquetaDaEtapa.trim());
  if (!base || base[2] === undefined || Number(base[1]) !== 1) return [];
  const resto = chave(base[2]);
  const porNumero = new Map<number, string>();
  for (const etiqueta of [etiquetaDaEtapa.trim(), ...etiquetasDasRegras]) {
    const m = NUMERADA.exec(etiqueta.trim());
    if (!m || m[2] === undefined || chave(m[2]) !== resto) continue;
    const numero = Number(m[1]);
    if (numero < 1 || porNumero.has(numero)) continue;
    porNumero.set(numero, etiqueta.trim());
  }
  if (porNumero.size < 2) return [];
  return [...porNumero.entries()]
    .sort(([a], [b]) => a - b)
    .map(([numero, etiqueta]) => ({ etiqueta, rotulo: String(numero).padStart(2, "0") }));
}

/** A cor da etapa só entra quando é um hex de verdade (`#rrggbb`). */
export function corDaEtapa(cor: string | null | undefined): string | null {
  return typeof cor === "string" && /^#[0-9a-f]{6}$/i.test(cor) ? cor : null;
}

/** Uma etapa como a faixa a desenha. */
export interface EtapaDaFaixa {
  id: string;
  nome: string;
  cor: string | null;
  /** A etiqueta-espelho; `null` = a etapa não tem regra e o botão não filtra. */
  etiqueta: string | null;
  /** O que o botão da etapa filtra: os passos, quando há, senão a etiqueta-espelho. */
  etiquetas: string[];
  /** Os passos da etapa (vazio na etapa comum). */
  passos: PassoDaFaixa[];
  /** Quantos negócios (cards) estão nesta etapa. */
  cards: number;
  /** Conversas não lidas de contatos desta etapa (o número em vermelho). */
  novas: number;
  ganha: boolean;
  perdida: boolean;
}

export interface FaixaDeEtapas {
  funil: { id: string; nome: string } | null;
  etapas: EtapaDaFaixa[];
}

/**
 * As etapas que a faixa mostra para quem pediu (Mergulho, 25/11/2026). Sem
 * `verPerdidas`, sai toda etapa de PERDA (`perdida`, que vem de
 * `crm_stages.is_lost`); as outras seguem na mesma ordem. Quem decide quem vê é
 * a rota, pelo papel; aqui fica só o recorte, para o teste não depender de sessão.
 */
export function etapasDaFaixaParaOPapel(
  etapas: readonly EtapaDaFaixa[],
  verPerdidas: boolean,
): EtapaDaFaixa[] {
  return verPerdidas ? [...etapas] : etapas.filter((etapa) => !etapa.perdida);
}

/** O que o filtro atual representa na faixa: uma etapa inteira ou um passo dela. */
export interface EscolhaDaFaixa {
  etapaId: string;
  /** A etiqueta do passo escolhido; `null` = a etapa inteira. */
  passo: string | null;
}

function mesmoConjunto(a: readonly string[], b: readonly string[]): boolean {
  const ca = new Set(a.map(chave));
  const cb = new Set(b.map(chave));
  return ca.size === cb.size && [...ca].every((x) => cb.has(x));
}

/**
 * A etapa (ou o passo) que o filtro de etiqueta atual representa. O filtro marca
 * uma etapa quando é EXATAMENTE o conjunto que o botão dela aplica, e um passo
 * quando é só a etiqueta dele. Qualquer outro filtro não marca nada.
 */
export function escolhaAtiva(
  etapas: readonly EtapaDaFaixa[],
  filtro: string | readonly string[] | undefined,
): EscolhaDaFaixa | null {
  const lista = typeof filtro === "string" ? [filtro] : [...(filtro ?? [])];
  if (lista.length === 0) return null;
  for (const etapa of etapas) {
    if (etapa.etiquetas.length > 0 && mesmoConjunto(etapa.etiquetas, lista)) {
      return { etapaId: etapa.id, passo: null };
    }
  }
  const unica = lista[0];
  if (lista.length !== 1 || unica === undefined) return null;
  const escolhida = chave(unica);
  for (const etapa of etapas) {
    const passo = etapa.passos.find((p) => chave(p.etiqueta) === escolhida);
    if (passo) return { etapaId: etapa.id, passo: passo.etiqueta };
  }
  return null;
}
