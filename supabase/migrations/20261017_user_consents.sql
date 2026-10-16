-- Журнал согласий: кто, когда и какую редакцию документов принял (152-ФЗ — оператор должен
-- уметь доказать согласие). Строки только добавляются: правка и удаление запрещены политиками;
-- при удалении учётной записи журнал уходит вместе с ней.
create table public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('terms', 'consent', 'consent_client', 'health', 'guardian')),
  version text not null,
  accepted_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);
create index user_consents_user_idx on public.user_consents (user_id, version);

alter table public.user_consents enable row level security;
create policy user_consents_select_own on public.user_consents for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_consents_insert_own on public.user_consents for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on public.user_consents from anon;
grant select, insert on public.user_consents to authenticated;
