-- Заработок тренера по проведённым тренировкам: каждое списание из абонемента — строка
-- с ценой одной тренировки на момент списания. Цена фиксируется: если потом поменять
-- стоимость пакета, прошлые дни не пересчитываются.
--   workout — тренировка проведена тренером (завершение или отметка «проведена» в календаре)
--   client  — клиент провёл сам (списание на сервере, finish_client_session)
--   no_show — «Не пришёл» со списанием
--   refund  — возврат тренировки по уважительной причине (сумма со знаком минус)

-- Числа в абонементе — текст, который вводит тренер («12 000», «1500,5»): разбираем мягко
create or replace function public.num_or_null(t text) returns numeric
language sql immutable set search_path = '' as $$
  select nullif(replace(regexp_replace(coalesce(t, ''), '[^0-9.,]', '', 'g'), ',', '.'), '')::numeric
$$;

-- Цена одной тренировки текущего блока: remainingPrice, иначе пакет / число тренировок
create or replace function public.session_price(m jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(public.num_or_null(m->>'remainingPrice'), 0),
    case when coalesce(public.num_or_null(m->>'total'), 0) > 0
         then coalesce(public.num_or_null(m->>'packagePrice'), 0) / public.num_or_null(m->>'total') end,
    public.num_or_null(m->>'pricePerSession'),
    0)
$$;

create table public.session_charges (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null default auth.uid() references public.trainers(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  date date not null default current_date,
  amount numeric not null default 0,
  kind text not null check (kind in ('workout', 'client', 'no_show', 'refund')),
  created_at timestamptz not null default now()
);
create index session_charges_trainer_date_idx on public.session_charges (trainer_id, date);
create index session_charges_client_idx on public.session_charges (client_id);

alter table public.session_charges enable row level security;
create policy session_charges_select_own on public.session_charges for select to authenticated
  using (trainer_id = (select auth.uid()));
create policy session_charges_insert_own on public.session_charges for insert to authenticated
  with check (trainer_id = (select auth.uid())
    and exists (select 1 from public.clients c where c.id = client_id and c.trainer_id = (select auth.uid())));
revoke all on public.session_charges from anon;

-- Клиент сам завершил тренировку: списание и строка заработка — на сервере
create or replace function public.finish_client_session(p_client_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare m jsonb; left_n numeric; extra_n numeric; partner_id uuid; t_id uuid; price numeric;
begin
  select membership, trainer_id into m, t_id from clients where id = p_client_id and auth_user_id = auth.uid();
  if not found then raise exception 'not authorized'; end if;
  if (m->>'type') is distinct from 'subscription' and (m->>'remaining') is not null and (m->>'remaining') <> '' then
    left_n := (m->>'remaining')::numeric;
    if left_n > 0 then
      price := public.session_price(m);
      m := jsonb_set(m, '{remaining}', to_jsonb((left_n - 1)::text));
      -- основной блок закончился — доп. блок (другая цена) встаёт на его место
      extra_n := coalesce(nullif(m->>'extraRemaining', '')::numeric, 0);
      if left_n - 1 <= 0 and extra_n > 0 then
        m := m || jsonb_build_object('remaining', m->'extraRemaining', 'remainingPrice', coalesce(m->'extraPricePerSession', '""'::jsonb),
                                     'remainingTotal', m->'extraRemaining', 'extraRemaining', '', 'extraPricePerSession', '');
      end if;
      insert into session_charges (trainer_id, client_id, amount, kind) values (t_id, p_client_id, coalesce(price, 0), 'client');
    end if;
  end if;
  update clients set active_session = null, membership = m where id = p_client_id and auth_user_id = auth.uid();

  if (m->>'split') = 'true' and (m->>'partnerClientId') is not null and (m->>'partnerClientId') <> '' then
    partner_id := (m->>'partnerClientId')::uuid;
    -- только поля, которые есть у клиента (как { ...partner, ...fields } на клиенте)
    update clients set membership = membership || jsonb_strip_nulls(jsonb_build_object(
      'remaining', m->'remaining',
      'remainingPrice', m->'remainingPrice',
      'extraRemaining', m->'extraRemaining',
      'extraPricePerSession', m->'extraPricePerSession'))
    where id = partner_id;
  end if;
end; $function$;

-- Прошлое: одна строка на подопечного и день проведённой тренировки, по ТЕКУЩЕЙ цене абонемента
-- (цен на те даты не сохранялось). Только абонементы с пакетом тренировок.
insert into public.session_charges (trainer_id, client_id, date, amount, kind, created_at)
select c.trainer_id, c.id, s.date, public.session_price(c.membership),
       case when bool_or(s.from_client) and not bool_or(not s.from_client) then 'client' else 'workout' end, now()
from public.plan_sessions s
join public.plans p on p.id = s.plan_id
join public.clients c on c.id = p.client_id
where s.deleted_at is null and c.is_self = false and (c.membership->>'type') is distinct from 'subscription'
group by c.trainer_id, c.id, s.date, c.membership;
