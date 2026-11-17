/**
 * AS ETIQUETAS QUE SE PÕEM À MÃO — personalização da Mergulho (nov/2026).
 *
 * O editor de etiquetas do Inbox, com o campo vazio, sugeria só as etiquetas
 * que já estavam em algum contato. Numa instalação nova isso é quase nada, e
 * quem atende não sabia quais existiam. Agora ele mostra a lista inteira das
 * etiquetas MANUAIS: as do vocabulário da organização (criadas na tela de
 * etiquetas, com cor), menos as AUTOMÁTICAS.
 *
 * Automática é a etiqueta que alguma regra ativa põe ou tira do CONTATO
 * (`add_tag`/`remove_tag` com `destino: "contato"`): as de etapa ("Geladeira")
 * e as de passo ("02 - Follow-up"). Quem cuida delas são as regras; posta à
 * mão, ela não move o card e faz a faixa de etapas contar errado. Por isso o
 * editor também não as sugere quando se digita.
 *
 * A etiqueta que a regra põe no CARD (a modalidade, copiada do contato ao
 * entrar em Follow-up) não é automática do contato: quem a põe no contato é a
 * pessoa, e ela continua na lista.
 *
 * E a etiqueta que uma regra USA COMO GATILHO ("quando o contato ganhar
 * «aula experimental», mova o card para Aula Experimental") é manual por
 * definição, mesmo que outra regra também a ponha sozinha: ela existe para ser
 * posta à mão. Por isso entra na lista e sai das automáticas
 * (`etiquetasQueAcionamRegras`).
 *
 * Puro, sem I/O.
 */
import { normalizarTag } from "@/lib/contacts/tag-normalizada";

/** O que esta regra lê de cada linha de `automation_rules`. */
export interface RegraComEtiquetas {
  is_active: boolean;
  actions: unknown;
  trigger_event?: string;
  conditions?: unknown;
}

/** As condições de uma regra, achatadas: lista solta, grupo `all` ou grupo `any`. */
function condicoesDaRegra(condicoes: unknown): Array<{ field?: unknown; op?: unknown; value?: unknown }> {
  if (Array.isArray(condicoes)) return condicoes;
  if (condicoes && typeof condicoes === "object") {
    const grupo = condicoes as { all?: unknown; any?: unknown };
    if (Array.isArray(grupo.all)) return grupo.all;
    if (Array.isArray(grupo.any)) return grupo.any;
  }
  return [];
}

/**
 * As etiquetas que disparam alguma regra ATIVA de "contato ganhou etiqueta"
 * (`contact.tag_added`, condição em `event.added_tags`), normalizadas.
 */
export function etiquetasQueAcionamRegras(regras: readonly RegraComEtiquetas[]): string[] {
  const vistas = new Set<string>();
  for (const regra of regras) {
    if (!regra.is_active || regra.trigger_event !== "contact.tag_added") continue;
    for (const condicao of condicoesDaRegra(regra.conditions)) {
      if (condicao.field !== "event.added_tags") continue;
      if (condicao.op !== "contains" && condicao.op !== "eq") continue;
      if (typeof condicao.value !== "string") continue;
      const normalizada = normalizarTag(condicao.value);
      if (normalizada) vistas.add(normalizada);
    }
  }
  return [...vistas];
}

/** As etiquetas que regras ATIVAS põem ou tiram do contato, normalizadas e sem repetir. */
export function etiquetasAutomaticasDoContato(regras: readonly RegraComEtiquetas[]): string[] {
  const vistas = new Set<string>();
  for (const regra of regras) {
    if (!regra.is_active || !Array.isArray(regra.actions)) continue;
    for (const acao of regra.actions as unknown[]) {
      if (!acao || typeof acao !== "object") continue;
      const { type, config } = acao as { type?: unknown; config?: unknown };
      if ((type !== "add_tag" && type !== "remove_tag") || !config || typeof config !== "object") continue;
      const { destino, tags } = config as { destino?: unknown; tags?: unknown };
      if (destino !== "contato" || !Array.isArray(tags)) continue;
      for (const tag of tags) {
        if (typeof tag !== "string") continue;
        const normalizada = normalizarTag(tag);
        if (normalizada) vistas.add(normalizada);
      }
    }
  }
  const acionam = new Set(etiquetasQueAcionamRegras(regras));
  return [...vistas].filter((tag) => !acionam.has(tag));
}

/** O vocabulário sem as automáticas: normalizado, sem repetir, em ordem alfabética. */
export function etiquetasManuais(vocabulario: readonly string[], automaticas: readonly string[]): string[] {
  const fora = new Set(automaticas.map(normalizarTag));
  const vistas = new Set<string>();
  for (const tag of vocabulario) {
    const normalizada = normalizarTag(tag);
    if (normalizada && !fora.has(normalizada)) vistas.add(normalizada);
  }
  return [...vistas].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
