-- manifest: Mergulho — aviso "cliente esperando resposta": kind novo `cliente_esperando` na Central (constraint reconstruída com o vocabulário completo do baseline), um aviso ABERTO por conversa (índice único parcial) e `fn_conversas_com_cliente_esperando`, que diz quem espera há N minutos sem resposta de uma PESSOA (mensagem automática, de campanha ou da IA não conta).
--
-- ─── O pedido ────────────────────────────────────────────────────────────────
--
-- A gestão da Mergulho pediu um alerta na tela quando um cliente fica 20 minutos
-- sem resposta, mesmo com o CRM minimizado. O alerta é um aviso da Central de
-- avisos: o gatilho `fn_emit_aviso_da_central` (migration 0442) já anuncia todo
-- aviso novo, e o push dos avisos (`lib/notifications/push-dos-avisos.ts`) o leva
-- ao navegador de quem ligou as notificações. Quem cria o aviso é o cron
-- `cliente-esperando` (`lib/inbox/cliente-esperando.ts`), a cada minuto.
--
-- ─── Quem está esperando ────────────────────────────────────────────────────
--
-- A espera começa na PRIMEIRA mensagem do cliente depois da última resposta de
-- uma pessoa. "Pessoa" é `sent_via` em ('user', 'external_device', 'crm'): o
-- atendente pelo CRM ou pelo próprio celular. A boas-vindas automática, a
-- mensagem de campanha, o follow-up e a IA (`automation`, `ai`, `system`) NÃO
-- contam como resposta — senão o cliente novo, que recebe a boas-vindas na hora,
-- nunca contaria como esperando.
--
-- Fora da conta: conversa encerrada ou arquivada, grupo, contato pessoal,
-- contato que pediu para sair (`is_blocked`) e contato interno (as etiquetas de
-- `settings.crm.internal_contact_tags` da organização). E só esperas que
-- começaram nas últimas `p_horas_max` horas: a espera mais velha que isso já é
-- da tarefa de 24 h da regra S1, e a primeira rodada não pode acordar a equipe
-- com o histórico inteiro.
--
-- A função é `security definer` porque o cron lê TODAS as organizações; por
-- isso só a `service_role` executa (as duas origens de EXECUTE revogadas, e
-- `authenticated` também). Quem chama filtra a organização parada em TS
-- (`idsDeOrgsParadas`).
--
-- Vocabulário COMPLETO da constraint (igual ao bloco único do baseline, cerca
-- `kind-check-migration-x-baseline`): o kind novo entra antes de 'other'. Em
-- bloco DO para o drop e o add andarem juntos.

do $$
begin
  alter table public.agent_inbox_items
    drop constraint if exists agent_inbox_items_kind_check;
  alter table public.agent_inbox_items
    add constraint agent_inbox_items_kind_check check (kind in (
    'appointment_outcome_required',
    'appointment_recovery_review',
    'qr_rescan',
    'routing_unassigned',
    'job_dead',
    'event_dead',
    'budget_exceeded',
    'handoff',
    'promotion_review',
    'judge_unaligned',
    'followup_dead',
    'snooze_expired',
    'next_action_ambiguous',
    'risk_backlog_seeded',
    'reactivation_expired',
    'capabilities_missing',
    'message_send_stuck',
    'midia_nao_lida',
    'channel_template_review',
    'channel_number_alert',
    'promise_unfulfilled',
    'contact_proposal_expired',
    'budget_warning',
    'conhecimento_nao_indexado',
    'voice_call_missed',
    'case_stale',
    'aviso_de_caso_nao_entregue',
    'followup_sem_agente',
    'canal_mudo_sem_numero',
    'proposal_expired_notice',
    'proposal_acceptance_rate_drop',
    'proposal_promised_not_created',
    'proposta_travada',
    'proposta_pronta_para_revisao',
    'org_reativada',
    'jev_pedido_de_humano',
    'jev_parar_de_receber',
    'canal_pausado',
    'cobranca',
    'email_de_login_trocado',
    'task_due',
    'task_overdue',
    'recuperacao_da_queda',
    'cliente_sem_resposta_na_queda',
    'assinatura_desconectada',
    'channel_template_review_direct',
    'routing_ia_wait_expired',
    'cliente_esperando',
    'other'
  ));
end;
$$;

-- Um aviso ABERTO (ou visto) por conversa: a rodada seguinte não duplica, e é o
-- banco que fecha a corrida entre duas rodadas (o cron trata o 23505).
create unique index if not exists agent_inbox_cliente_esperando_aberto_unico
  on public.agent_inbox_items (organization_id, ref_id)
  where kind = 'cliente_esperando' and status <> 'resolved';

create or replace function public.fn_conversas_com_cliente_esperando(p_minutos integer, p_horas_max integer)
returns table (organization_id uuid, conversation_id uuid, assigned_to_user_id uuid, esperando_desde timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.organization_id, c.id, c.assigned_to_user_id, w.esperando_desde
    from public.conversations c
    join public.organizations o on o.id = c.organization_id
    left join public.contacts ct on ct.id = c.contact_id and ct.organization_id = c.organization_id
    cross join lateral (
      select min(m.created_at) as esperando_desde
        from public.messages m
       where m.organization_id = c.organization_id
         and m.conversation_id = c.id
         and m.direction = 'inbound'
         and m.created_at > coalesce((
               select max(h.created_at)
                 from public.messages h
                where h.organization_id = c.organization_id
                  and h.conversation_id = c.id
                  and h.direction = 'outbound'
                  and h.sent_via in ('user', 'external_device', 'crm')
             ), '-infinity'::timestamptz)
    ) w
   where c.status not in ('closed', 'archived')
     and coalesce(c.is_group, false) = false
     and c.last_inbound_at > now() - make_interval(hours => greatest(p_horas_max, 1))
     and w.esperando_desde is not null
     and w.esperando_desde <= now() - make_interval(mins => greatest(p_minutos, 1))
     and w.esperando_desde >  now() - make_interval(hours => greatest(p_horas_max, 1))
     and not coalesce(ct.is_personal, false)
     and not coalesce(ct.is_blocked, false)
     and not coalesce(
       ct.tags && (case
         when jsonb_typeof(o.settings -> 'crm' -> 'internal_contact_tags') = 'array'
           then array(select jsonb_array_elements_text(o.settings -> 'crm' -> 'internal_contact_tags'))
         else '{}'::text[]
       end),
       false)
$$;

revoke execute on function public.fn_conversas_com_cliente_esperando(integer, integer) from public, anon, authenticated;
grant  execute on function public.fn_conversas_com_cliente_esperando(integer, integer) to service_role;

notify pgrst, 'reload schema';
