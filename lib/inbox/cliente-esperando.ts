/**
 * O AVISO "CLIENTE ESPERANDO RESPOSTA" (personalização da Mergulho, 25/11/2026).
 *
 * ─── O pedido ──────────────────────────────────────────────────────────────
 *
 * Um alerta na tela quando o cliente fica 20 minutos sem resposta, mesmo com o
 * CRM minimizado. O alerta é um aviso da Central (`agent_inbox_items`, kind
 * `cliente_esperando`, migration 9349): o banco anuncia todo aviso novo
 * (`fn_emit_aviso_da_central`) e o push dos avisos o leva ao navegador
 * (`lib/notifications/push-dos-avisos.ts`). Com o CRM aberto, a Central toca o
 * som de "pede gente" (`somDoAviso`).
 *
 * ─── Quem está esperando ───────────────────────────────────────────────────
 *
 * A conta mora no banco (`fn_conversas_com_cliente_esperando`): a espera começa
 * na primeira mensagem do cliente depois da última resposta de uma PESSOA — pelo
 * CRM ou pelo celular. Boas-vindas automática, campanha, follow-up e IA não
 * contam como resposta. Ficam de fora conversa encerrada, grupo, contato
 * pessoal, quem pediu para sair e contato interno (etiquetas da organização).
 *
 * ─── O ciclo de vida do aviso (laço fechado) ──────────────────────────────
 *
 *   - NASCE uma vez por espera: o índice único parcial (um aberto por conversa)
 *     fecha a corrida entre duas rodadas, e o 23505 é ignorado;
 *   - vai para o RESPONSÁVEL pela conversa (`para_user_id`); sem responsável,
 *     para o time (o push sem destinatário vai a todos que alcançam a Central);
 *   - MORRE sozinho (`resolved`) assim que a conversa deixa de esperar: alguém
 *     respondeu, a conversa fechou, ou a espera passou da janela de horas — aí a
 *     tarefa de 24 h da regra S1 assume;
 *   - só NASCE dentro do horário de atendimento (`AVISO_DE_ESPERA`). Quem escreveu
 *     de madrugada gera o aviso às 8h, se ninguém respondeu. A resolução roda a
 *     qualquer hora.
 *
 * Toda escrita leva `organization_id`: o client é admin e ignora a RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { idsDeOrgsParadas } from "@/lib/organizacao/operante";

/** Os parâmetros do aviso. Para mudar: troque aqui e publique uma imagem nova. */
export const AVISO_DE_ESPERA = {
  /** Minutos sem resposta de uma pessoa até o aviso. */
  minutos: 20,
  /** Só nascem avisos de [inicio, fim) no fuso abaixo — todos os dias. */
  janelaInicioHora: 8,
  janelaFimHora: 18,
  fuso: "America/Sao_Paulo",
  /** Espera mais velha que isto fica com a tarefa de 24 h (regra S1). */
  horasMaximas: 24,
} as const;

export type ConfigDoAviso = typeof AVISO_DE_ESPERA;

export const KIND_CLIENTE_ESPERANDO = "cliente_esperando" as const;

/** Teto de avisos lidos/criados por rodada: o resto fica para o minuto seguinte. */
const LOTE = 200;

export interface ConversaEsperando {
  organization_id: string;
  conversation_id: string;
  assigned_to_user_id: string | null;
  esperando_desde: string;
}

export interface ResultadoDaRodada {
  esperando: number;
  criados: number;
  resolvidos: number;
  foraDaJanela: boolean;
}

/** A hora local (0–23) no fuso dado. */
export function horaNoFuso(agora: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: fuso }).formatToParts(agora);
  return Number(partes.find((p) => p.type === "hour")?.value ?? "0");
}

export function dentroDaJanela(agora: Date, cfg: Pick<ConfigDoAviso, "janelaInicioHora" | "janelaFimHora" | "fuso">): boolean {
  const hora = horaNoFuso(agora, cfg.fuso);
  return hora >= cfg.janelaInicioHora && hora < cfg.janelaFimHora;
}

/** "HH:MM" no fuso — o aviso é linha gravada, então o horário vai formatado. */
export function horarioNoFuso(iso: string, fuso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: fuso }).format(new Date(iso));
}

export function textoDoAviso(c: Pick<ConversaEsperando, "esperando_desde">, cfg: Pick<ConfigDoAviso, "minutos" | "fuso">): { title: string; body: string } {
  // Sem nome, número nem trecho de mensagem: o aviso vai à Central e ao push, e a
  // doutrina dos avisos é não carregar dado do cliente. Quem abre vê a conversa.
  return {
    title: `Cliente esperando resposta há mais de ${cfg.minutos} minutos`,
    body: `O cliente escreveu às ${horarioNoFuso(c.esperando_desde, cfg.fuso)} e ainda não teve resposta de ninguém da equipe. Este aviso some sozinho quando alguém responder.`,
  };
}

/**
 * Uma rodada: resolve os avisos de quem já não espera e, dentro do horário, abre
 * os de quem passou do prazo. Nunca lança por falha de UM aviso: o que não entrou
 * fica para o minuto seguinte. Lança só quando nem a lista de quem espera veio.
 */
export async function rodadaDoClienteEsperando(
  admin: SupabaseClient,
  agora: Date,
  cfg: ConfigDoAviso = AVISO_DE_ESPERA,
): Promise<ResultadoDaRodada> {
  const { data, error } = await admin.rpc("fn_conversas_com_cliente_esperando", {
    p_minutos: cfg.minutos,
    p_horas_max: cfg.horasMaximas,
  });
  if (error) throw new Error(`cliente-esperando: leitura — ${error.message}`);
  const esperando = (data ?? []) as ConversaEsperando[];
  const esperandoPorChave = new Set(esperando.map((c) => `${c.organization_id}:${c.conversation_id}`));

  // ─── Resolver: aviso aberto cuja conversa não espera mais ───
  const { data: abertos, error: erroAbertos } = await admin
    .from("agent_inbox_items")
    .select("id, organization_id, ref_id")
    .eq("kind", KIND_CLIENTE_ESPERANDO)
    .neq("status", "resolved")
    .limit(LOTE);
  if (erroAbertos) throw new Error(`cliente-esperando: avisos abertos — ${erroAbertos.message}`);
  const linhasAbertas = (abertos ?? []) as Array<{ id: string; organization_id: string; ref_id: string | null }>;
  const comAviso = new Set(linhasAbertas.map((a) => `${a.organization_id}:${a.ref_id}`));

  let resolvidos = 0;
  for (const aviso of linhasAbertas) {
    if (esperandoPorChave.has(`${aviso.organization_id}:${aviso.ref_id}`)) continue;
    const { error: erroResolver } = await admin
      .from("agent_inbox_items")
      .update({ status: "resolved", resolved_at: agora.toISOString() })
      .eq("organization_id", aviso.organization_id)
      .eq("id", aviso.id)
      .neq("status", "resolved");
    if (!erroResolver) resolvidos++;
  }

  // ─── Criar: só no horário, só organização operante, um por conversa ───
  const foraDaJanela = !dentroDaJanela(agora, cfg);
  let criados = 0;
  if (!foraDaJanela && esperando.length > 0) {
    const paradas = new Set(await idsDeOrgsParadas(admin));
    for (const c of esperando.slice(0, LOTE)) {
      if (paradas.has(c.organization_id)) continue;
      if (comAviso.has(`${c.organization_id}:${c.conversation_id}`)) continue;
      const { title, body } = textoDoAviso(c, cfg);
      const { error: erroCriar } = await admin.from("agent_inbox_items").insert({
        organization_id: c.organization_id,
        kind: KIND_CLIENTE_ESPERANDO,
        severity: "warn",
        title,
        body,
        ref_kind: "conversation",
        ref_id: c.conversation_id,
        para_user_id: c.assigned_to_user_id,
      });
      // 23505: outra rodada abriu o mesmo aviso no meio — é o índice fazendo o papel dele.
      if (!erroCriar) criados++;
    }
  }

  return { esperando: esperando.length, criados, resolvidos, foraDaJanela };
}
