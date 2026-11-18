-- manifest: Mergulho — tipo de contato aceita empresa e professor além de cliente e fornecedor (CHECK alargado; o tipo muda o selo, não o envio).
-- Alarga o CHECK da 0763. Só ACRESCENTA valores: nenhuma linha existente fica fora.
-- drop + add num bloco DO só, como na 0763: soltos, um add que falhasse deixaria a coluna sem CHECK.

do $$
begin
  alter table public.contacts
    drop constraint if exists contacts_contact_type_check;
  alter table public.contacts
    add constraint contacts_contact_type_check
      check (contact_type in ('cliente', 'fornecedor', 'empresa', 'professor'));
end
$$;

comment on column public.contacts.contact_type is
  'Tipo do contato: cliente (padrão), fornecedor, empresa ou professor (os dois últimos: personalização da Mergulho, migration 9348). Nenhum deles veta envio — ao contrário de is_personal; o tipo muda o selo do painel. Quem mudou/quando fica em auditoria + timeline, nunca aqui.';

notify pgrst, 'reload schema';
