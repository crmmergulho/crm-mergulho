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
 * Puro, sem I/O.
 */
import { normalizarTag } from "@/lib/contacts/tag-normalizada";

/** O que esta regra lê de cada linha de `automation_rules`. */
export interface RegraComEtiquetas {
  is_active: boolean;
  actions: unknown;
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
  return [...vistas];
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
