-- Этап 11: несколько оплаченных блоков у клиента.
--
-- Было: один абонемент в clients.membership (JSON). Признак «сплит» относился ко всему
-- абонементу, поэтому оплата сплита сливала персональный остаток с общим (и копировала его
-- партнёру) или уводила его в «доп. блок», затирая прежний доп. блок.
--
-- Стало: каждый оплаченный блок — строка client_blocks: вид (personal / split / group),
-- остаток, «из скольки», цена тренировки, цвет. Сплит-блок один на двоих: client_id —
-- владелец, partner_client_id — партнёр, остаток общий без копирования.
-- Списания и платежи помнят свой блок (block_id): удаление тренировки или платежа
-- возвращает тренировки именно туда.
--
-- Совместимость: membership.remaining / remainingTotal / remainingPrice остаются сводкой
-- (сумма по блокам) — их по-прежнему читают бейджи, кабинет клиента, предупреждения и
-- телефоны со старой версией. Сводку пересчитывает blocks_sync после каждого изменения.
-- extraRemaining больше не используется (обнуляется): доп. блок стал обычным блоком.
--
-- Новые необязательные параметры (p_block_id, p_blocks) — в конце списка с default,
-- поэтому старые вызовы с прежними именами аргументов продолжают работать.

begin;

-- ───────────────────────── Таблица блоков ─────────────────────────
create table public.client_blocks (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null default auth.uid() references public.trainers(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  partner_client_id uuid references public.clients(id) on delete set null,
  kind text not null default 'personal' check (kind in ('personal', 'split', 'group')),
  total integer not null default 0 check (total >= 0),
  remaining integer not null default 0,
  price numeric not null default 0 check (price >= 0),
  color smallint not null default 0 check (color between 0 and 2),
  paid_at date,
  created_at timestamptz not null default now(),
  check (partner_client_id is null or partner_client_id <> client_id)
);
create index client_blocks_client_idx on public.client_blocks (client_id);
create index client_blocks_partner_idx on public.client_blocks (partner_client_id) where partner_client_id is not null;
create index client_blocks_trainer_idx on public.client_blocks (trainer_id);

alter table public.client_blocks enable row level security;
-- Тренер — свои блоки (как с абонементом в clients.membership); клиент только читает свои
create policy trainer_owns on public.client_blocks for all to authenticated
  using (trainer_id = (select auth.uid()))
  with check (
    trainer_id = (select auth.uid())
    and exists (select 1 from public.clients c where c.id = client_id and c.trainer_id = (select auth.uid()))
    and (partner_client_id is null
         or exists (select 1 from public.clients c where c.id = partner_client_id and c.trainer_id = (select auth.uid())))
  );
create policy client_reads_own on public.client_blocks for select to authenticated
  using (exists (select 1 from public.clients c
                 where c.id in (client_id, partner_client_id) and c.auth_user_id = (select auth.uid())));
revoke all on public.client_blocks from anon;
grant select, insert, update, delete on public.client_blocks to authenticated;

alter table public.session_charges add column block_id uuid references public.client_blocks(id) on delete set null;
alter table public.client_payments add column block_id uuid references public.client_blocks(id) on delete set null;
create index session_charges_block_idx on public.session_charges (block_id) where block_id is not null;
create index client_payments_block_idx on public.client_payments (block_id) where block_id is not null;

-- ───────────────────────── Служебные функции ─────────────────────────

-- Свободный цвет: первый, которого нет у блоков клиента с остатком (0 вольт, 1 бирюза, 2 сирень)
create or replace function public.block_free_color(p_client uuid, p_partner uuid)
returns smallint language sql stable security invoker set search_path = '' as $$
  select coalesce(min(x)::smallint, 0::smallint) from generate_series(0, 2) x
  where not exists (select 1 from public.client_blocks b
                    where b.remaining <> 0 and b.color = x
                      and (b.client_id in (p_client, p_partner) or b.partner_client_id in (p_client, p_partner)))
$$;

-- Сводка в membership: остаток = сумма по блокам клиента (свои и общие сплиты).
-- Клиента без единого блока не трогаем — у него абонемент «по-старому» (или его нет).
create or replace function public.blocks_sync(p_client uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_rem bigint; v_total bigint; v_price numeric; v_last integer; m jsonb;
begin
  if p_client is null then return null; end if;
  if not exists (select 1 from public.client_blocks b where p_client in (b.client_id, b.partner_client_id)) then
    return (select c.membership from public.clients c where c.id = p_client);
  end if;
  select coalesce(sum(b.remaining), 0), coalesce(sum(b.total) filter (where b.remaining <> 0), 0)
    into v_rem, v_total
  from public.client_blocks b where p_client in (b.client_id, b.partner_client_id);
  if v_total = 0 then
    select b.total into v_last from public.client_blocks b
    where p_client in (b.client_id, b.partner_client_id) order by b.created_at desc limit 1;
    v_total := coalesce(v_last, 0);
  end if;
  v_price := (select b.price from public.client_blocks b
              where p_client in (b.client_id, b.partner_client_id) and b.remaining > 0
              order by b.paid_at nulls first, b.created_at limit 1);
  update public.clients c
  set membership = coalesce(c.membership, '{}'::jsonb) || jsonb_build_object(
        'remaining', v_rem::text, 'remainingTotal', v_total::text,
        'remainingPrice', coalesce(v_price, 0)::text, 'extraRemaining', '', 'extraPricePerSession', '')
  where c.id = p_client
  returning c.membership into m;
  return m;
end; $$;

-- Клиент с остатком «по-старому» (восстановлен из копии, старый телефон): завести блоки
-- из абонемента — основной остаток и доп. блок. Повторный вызов ничего не делает.
create or replace function public.blocks_ensure(p_client uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare m jsonb; t uuid; v_rem numeric; v_extra numeric; v_paid date;
begin
  if exists (select 1 from public.client_blocks b where p_client in (b.client_id, b.partner_client_id)) then return; end if;
  select c.membership, c.trainer_id into m, t from public.clients c where c.id = p_client;
  if not found or (m->>'type') is not distinct from 'subscription' then return; end if;
  if coalesce(m->>'remaining', '') !~ '^\s*-?\d+(\.\d+)?\s*$' then return; end if;
  v_rem := trunc(public.membership_num(m->>'remaining'));
  v_extra := trunc(public.membership_num(m->>'extraRemaining'));
  v_paid := case when m->>'paymentDate' ~ '^\d{4}-\d{2}-\d{2}$' then (m->>'paymentDate')::date end;
  if v_extra > 0 then
    -- Доп. блок — более старый пакет: раньше по дате создания
    insert into public.client_blocks (trainer_id, client_id, kind, total, remaining, price, color, paid_at, created_at)
    values (t, p_client, 'personal', v_extra, v_extra, round(public.membership_num(m->>'extraPricePerSession')::numeric, 2), 1, null, now() - interval '1 second');
  end if;
  insert into public.client_blocks (trainer_id, client_id, kind, total, remaining, price, color, paid_at)
  values (t, p_client, 'personal',
          greatest(trunc(coalesce(nullif(public.membership_num(m->>'remainingTotal'), 0), public.membership_num(m->>'total'))), v_rem, 0),
          v_rem, round(coalesce(public.session_price(m), 0), 2), 0, v_paid);
  perform public.blocks_sync(p_client);
end; $$;

-- Блок по умолчанию для списания: сплит, если партнёр по нему есть в записи календаря;
-- иначе сначала не-сплиты; внутри — оплаченный раньше.
create or replace function public.block_pick(p_client uuid, p_booking uuid default null)
returns uuid language sql stable security invoker set search_path = '' as $$
  select b.id from public.client_blocks b
  where p_client in (b.client_id, b.partner_client_id) and b.remaining > 0
  order by
    (b.kind = 'split' and p_booking is not null and exists (
       select 1 from public.booking_clients bc where bc.booking_id = p_booking
         and bc.client_id = case when b.client_id = p_client then b.partner_client_id else b.client_id end)) desc,
    (b.kind = 'split') asc,
    b.paid_at nulls first, b.created_at
  limit 1
$$;

-- Блокировка подопечных в порядке id: партнёры по абонементу и по общим блокам тоже
create or replace function public.lock_clients(p_ids uuid[])
returns void language plpgsql set search_path = '' as $$
begin
  perform 1 from public.clients c
  where c.id in (
    select x from unnest(coalesce(p_ids, '{}')) x where x is not null
    union
    select (c2.membership->>'partnerClientId')::uuid from public.clients c2
    where c2.id = any(p_ids) and (c2.membership->>'split') = 'true'
      and (c2.membership->>'partnerClientId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union
    select case when b.client_id = any(p_ids) then b.partner_client_id else b.client_id end
    from public.client_blocks b
    where b.client_id = any(p_ids) or b.partner_client_id = any(p_ids))
  order by c.id
  for update;
end; $$;

-- ───────────────────────── Списание ─────────────────────────
-- Списать 1 тренировку: из указанного блока (если он этого клиента и в нём есть остаток),
-- иначе из блока по умолчанию. Возвращает membership клиента или null — списывать нечего.
drop function public.apply_session_charge(uuid, text, date, uuid, date);
create function public.apply_session_charge(p_client_id uuid, p_kind text, p_date date,
  p_booking_id uuid default null, p_occ_date date default null, p_block_id uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare m jsonb; t_id uuid; blk public.client_blocks%rowtype; v_other uuid;
begin
  select c.membership, c.trainer_id into m, t_id from public.clients c where c.id = p_client_id for update;
  if not found then return null; end if;
  if (m->>'type') is not distinct from 'subscription' then return null; end if;
  perform public.blocks_ensure(p_client_id);

  if p_block_id is not null then
    select * into blk from public.client_blocks b
    where b.id = p_block_id and p_client_id in (b.client_id, b.partner_client_id) and b.remaining > 0 for update;
  end if;
  if blk.id is null then
    select * into blk from public.client_blocks b where b.id = public.block_pick(p_client_id, p_booking_id) for update;
  end if;
  if blk.id is null then return null; end if;

  update public.client_blocks set remaining = remaining - 1 where id = blk.id;
  insert into public.session_charges (trainer_id, client_id, date, amount, kind, booking_id, occ_date, block_id)
  values (t_id, p_client_id, p_date, round(blk.price, 2), p_kind, p_booking_id, p_occ_date, blk.id);

  v_other := case when blk.client_id = p_client_id then blk.partner_client_id else blk.client_id end;
  if v_other is not null then perform public.blocks_sync(v_other); end if;
  return public.blocks_sync(p_client_id);
end; $$;
revoke all on function public.apply_session_charge(uuid, text, date, uuid, date, uuid) from public, anon, authenticated;

drop function public.charge_session(uuid, text, date);
create function public.charge_session(p_client_id uuid, p_kind text, p_date date, p_block_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m jsonb;
begin
  if p_kind is null or p_kind not in ('workout', 'no_show') then
    raise exception 'unknown charge kind %', p_kind using errcode = '22023';
  end if;
  perform 1 from public.clients c where c.id = p_client_id and c.trainer_id = (select auth.uid());
  if not found then raise exception 'not authorized' using errcode = '42501'; end if;
  perform public.lock_clients(array[p_client_id]);

  m := public.apply_session_charge(p_client_id, p_kind, coalesce(p_date, current_date), null, null, p_block_id);
  if m is not null then return jsonb_build_object('charged', true, 'membership', m); end if;
  return jsonb_build_object('charged', false,
    'membership', (select c.membership from public.clients c where c.id = p_client_id));
end; $$;
revoke all on function public.charge_session(uuid, text, date, uuid) from public, anon;
grant execute on function public.charge_session(uuid, text, date, uuid) to authenticated;

-- ───────────────────────── Возврат и разовая ─────────────────────────
-- Возврат (p_refund_date) — в блок, с которого за эту дату списали; разовая оплаченная
-- (p_payment_*) — +1 в персональный блок по этой цене или новым блоком.
drop function public.credit_session(uuid, date, uuid, date, numeric);
create function public.credit_session(p_client_id uuid, p_refund_date date default null,
  p_payment_id uuid default null, p_payment_date date default null, p_payment_amount numeric default null,
  p_block_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m jsonb; t_id uuid; v_block uuid; v_price numeric; v_other uuid; blk public.client_blocks%rowtype;
begin
  perform 1 from public.clients c where c.id = p_client_id and c.trainer_id = (select auth.uid());
  if not found then raise exception 'not authorized' using errcode = '42501'; end if;
  perform public.lock_clients(array[p_client_id]);
  select c.membership, c.trainer_id into m, t_id from public.clients c
  where c.id = p_client_id and c.trainer_id = (select auth.uid()) for update;
  m := coalesce(m, '{}'::jsonb);
  if p_payment_id is not null and (p_payment_amount is null or p_payment_amount < 0) then
    raise exception 'credit_session: нужна сумма платежа >= 0' using errcode = '22023';
  end if;
  if p_payment_id is not null and exists (select 1 from public.client_payments p where p.id = p_payment_id) then
    return jsonb_build_object('credited', false, 'duplicate', true, 'membership', m);
  end if;
  if (m->>'type') is not distinct from 'subscription' then
    return jsonb_build_object('credited', false, 'duplicate', false, 'membership', m);
  end if;
  if coalesce(trim(m->>'remaining'), '') <> '' and trim(m->>'remaining') !~ '^-?\d+(\.\d+)?$' then
    return jsonb_build_object('credited', false, 'duplicate', false, 'membership', m);
  end if;
  perform public.blocks_ensure(p_client_id);

  -- Куда вернуть: указанный блок → блок последнего списания за эту дату → блок по умолчанию
  if p_block_id is not null then
    select b.id into v_block from public.client_blocks b where b.id = p_block_id and p_client_id in (b.client_id, b.partner_client_id);
  end if;
  if v_block is null and p_refund_date is not null then
    select s.block_id into v_block from public.session_charges s
    join public.client_blocks b on b.id = s.block_id
    where s.client_id = p_client_id and s.date = p_refund_date and s.kind in ('workout', 'client', 'no_show')
    order by s.created_at desc limit 1;
  end if;
  if v_block is null and p_payment_id is not null then
    -- Разовая: персональный блок с той же ценой и остатком; нет — новый блок на 1
    select b.id into v_block from public.client_blocks b
    where b.client_id = p_client_id and b.kind = 'personal' and b.remaining > 0 and round(b.price) = round(p_payment_amount)
    order by b.paid_at nulls first, b.created_at limit 1;
    if v_block is null then
      insert into public.client_blocks (trainer_id, client_id, kind, total, remaining, price, color, paid_at)
      values (t_id, p_client_id, 'personal', 0, 0, round(p_payment_amount, 2), public.block_free_color(p_client_id, null), coalesce(p_payment_date, current_date))
      returning id into v_block;
    end if;
  end if;
  if v_block is null then
    v_block := public.block_pick(p_client_id, null);
  end if;
  if v_block is null then
    select b.id into v_block from public.client_blocks b
    where p_client_id in (b.client_id, b.partner_client_id) order by b.created_at desc limit 1;
  end if;
  if v_block is null then
    insert into public.client_blocks (trainer_id, client_id, kind, total, remaining, price, color)
    values (t_id, p_client_id, 'personal', 0, 0, 0, 0) returning id into v_block;
  end if;

  update public.client_blocks
  set remaining = remaining + 1,
      total = case when p_payment_id is not null then total + 1 else greatest(total, remaining + 1) end
  where id = v_block
  returning * into blk;
  v_price := round(blk.price, 2);

  if p_refund_date is not null then
    insert into public.session_charges (trainer_id, client_id, date, amount, kind, block_id)
    values (t_id, p_client_id, p_refund_date, -v_price, 'refund', v_block);
  end if;
  if p_payment_id is not null then
    insert into public.client_payments (id, client_id, date, amount, type, note, promo_applied, sessions_delta, pay_status, block_id)
    values (p_payment_id, p_client_id, coalesce(p_payment_date, current_date), p_payment_amount, 'single', 'Разовая тренировка', '', 1, 'paid', v_block);
  end if;

  v_other := case when blk.client_id = p_client_id then blk.partner_client_id else blk.client_id end;
  if v_other is not null then perform public.blocks_sync(v_other); end if;
  m := public.blocks_sync(p_client_id);
  return jsonb_build_object('credited', true, 'duplicate', false, 'membership', m);
end; $$;
revoke all on function public.credit_session(uuid, date, uuid, date, numeric, uuid) from public, anon;
grant execute on function public.credit_session(uuid, date, uuid, date, numeric, uuid) to authenticated;

-- ───────────────────────── Оплата ─────────────────────────
-- Пакет того же вида, с тем же партнёром и по той же цене прибавляется к блоку с остатком;
-- иначе — новый блок рядом (старые остатки не трогаем). p_block_id — явно «прибавить сюда».
drop function public.record_payment(uuid, uuid, date, numeric, text, text, jsonb);
create function public.record_payment(p_payment_id uuid, p_client_id uuid, p_date date, p_amount numeric,
  p_pay_status text default 'paid', p_promo text default '', p_package jsonb default '{}'::jsonb,
  p_block_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  m jsonb; v_type text; v_total integer; v_price numeric; v_kind text; v_partner uuid;
  v_block uuid; v_half numeric;
begin
  if p_payment_id is null or p_client_id is null or p_date is null or p_amount is null or p_amount < 0 then
    raise exception 'record_payment: нужны id платежа, подопечный, дата и сумма >= 0' using errcode = '22023';
  end if;
  if p_pay_status is null or p_pay_status not in ('paid', 'deferred', 'installment') then
    raise exception 'record_payment: неизвестный статус оплаты %', p_pay_status using errcode = '22023';
  end if;
  p_package := coalesce(p_package, '{}'::jsonb);
  if jsonb_typeof(p_package) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_package) k
                where k not in ('type', 'total', 'packagePrice', 'pricePerSession', 'split')) then
    raise exception 'record_payment: в p_package допустимы только type, total, packagePrice, pricePerSession, split'
      using errcode = '22023';
  end if;

  perform 1 from public.clients c where c.id = p_client_id and c.trainer_id = v_uid;
  if not found then raise exception 'record_payment: подопечный не найден' using errcode = '42501'; end if;
  perform public.lock_clients(array[p_client_id]);
  select c.membership into m from public.clients c where c.id = p_client_id and c.trainer_id = v_uid for update;

  if exists (select 1 from public.client_payments p where p.id = p_payment_id) then
    return jsonb_build_object('membership', m, 'duplicate', true);
  end if;

  m := coalesce(m, '{}'::jsonb) || p_package;
  v_type := case when (m->>'type') = 'subscription' then 'subscription' else 'sessions' end;

  if v_type = 'subscription' then
    m := m || jsonb_build_object('nextPaymentDate', to_char(p_date + interval '1 month', 'YYYY-MM-DD'),
                                 'paymentDate', to_char(p_date, 'YYYY-MM-DD'));
    update public.clients set membership = m where id = p_client_id;
    insert into public.client_payments (id, client_id, date, amount, type, note, promo_applied, sessions_delta, pay_status)
    values (p_payment_id, p_client_id, p_date, p_amount, v_type, '', coalesce(p_promo, ''), null, p_pay_status);
    return jsonb_build_object('membership', m, 'duplicate', false);
  end if;

  perform public.blocks_ensure(p_client_id);
  v_total := round(public.membership_num(m->>'total'))::integer;
  v_price := round((case when v_total > 0 then public.membership_num(m->>'packagePrice') / v_total
                         else public.membership_num(m->>'pricePerSession') end)::numeric, 2);
  if (m->>'split') = 'true' then
    v_kind := 'split';
    if (m->>'partnerClientId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_partner := (m->>'partnerClientId')::uuid;
      perform 1 from public.clients c where c.id = v_partner and c.trainer_id = v_uid;
      if not found or v_partner = p_client_id then v_partner := null; end if;
    end if;
  else
    v_kind := 'personal';
  end if;

  if p_block_id is not null then
    select b.id into v_block from public.client_blocks b
    where b.id = p_block_id and p_client_id in (b.client_id, b.partner_client_id) and b.trainer_id = v_uid;
  end if;
  if v_block is null then
    select b.id into v_block from public.client_blocks b
    where b.trainer_id = v_uid and b.remaining > 0 and b.kind = v_kind and round(b.price) = round(v_price)
      and ((v_kind <> 'split' and b.client_id = p_client_id)
        or (v_kind = 'split' and v_partner is null and b.client_id = p_client_id and b.partner_client_id is null)
        or (v_kind = 'split' and v_partner is not null
            and ((b.client_id = p_client_id and b.partner_client_id = v_partner)
              or (b.client_id = v_partner and b.partner_client_id = p_client_id))))
    order by b.paid_at nulls first, b.created_at limit 1;
  end if;

  if v_block is not null then
    update public.client_blocks
    set remaining = remaining + v_total, total = (case when remaining > 0 then total else 0 end) + v_total,
        paid_at = p_date
    where id = v_block;
  else
    insert into public.client_blocks (trainer_id, client_id, partner_client_id, kind, total, remaining, price, color, paid_at)
    values (v_uid, p_client_id, case when v_kind = 'split' then v_partner end, v_kind, v_total, v_total, v_price,
            public.block_free_color(p_client_id, v_partner), p_date)
    returning id into v_block;
  end if;

  update public.clients set membership = m || jsonb_build_object('paymentDate', to_char(p_date, 'YYYY-MM-DD'))
  where id = p_client_id;
  m := public.blocks_sync(p_client_id);

  if v_kind = 'split' and v_partner is not null then
    update public.clients
    set membership = coalesce(membership, '{}'::jsonb) || jsonb_build_object('paymentDate', to_char(p_date, 'YYYY-MM-DD'))
    where id = v_partner and trainer_id = v_uid;
    perform public.blocks_sync(v_partner);
    v_half := round(p_amount / 2);
    insert into public.client_payments (id, client_id, date, amount, type, note, promo_applied, sessions_delta, pay_status, block_id)
    values (p_payment_id, p_client_id, p_date, v_half, v_type, 'сплит 50/50', coalesce(p_promo, ''), v_total, p_pay_status, v_block);
    insert into public.client_payments (client_id, date, amount, type, note, promo_applied, sessions_delta, pay_status, block_id)
    values (v_partner, p_date, p_amount - v_half, v_type, 'сплит 50/50 (партнёр)', coalesce(p_promo, ''), null, p_pay_status, v_block);
  else
    insert into public.client_payments (id, client_id, date, amount, type, note, promo_applied, sessions_delta, pay_status, block_id)
    values (p_payment_id, p_client_id, p_date, p_amount, v_type, '', coalesce(p_promo, ''), v_total, p_pay_status, v_block);
  end if;

  return jsonb_build_object('membership', m, 'duplicate', false, 'block_id', v_block);
end; $$;
revoke all on function public.record_payment(uuid, uuid, date, numeric, text, text, jsonb, uuid) from public, anon;
grant execute on function public.record_payment(uuid, uuid, date, numeric, text, text, jsonb, uuid) to authenticated;

-- Удалить платёж: тренировки уходят из его блока. Старые платежи без блока — из последнего блока.
create or replace function public.delete_payment(p_payment_id uuid, p_client_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  m jsonb; v_delta integer; v_block uuid; blk public.client_blocks%rowtype; v_other uuid;
begin
  if p_payment_id is null or p_client_id is null then
    raise exception 'delete_payment: нужны id платежа и подопечного' using errcode = '22023';
  end if;
  perform 1 from public.clients c where c.id = p_client_id and c.trainer_id = v_uid;
  if not found then raise exception 'delete_payment: подопечный не найден' using errcode = '42501'; end if;
  perform public.lock_clients(array[p_client_id]);
  select c.membership into m from public.clients c where c.id = p_client_id and c.trainer_id = v_uid for update;

  delete from public.client_payments p
  where p.id = p_payment_id and p.client_id = p_client_id
  returning p.sessions_delta, p.block_id into v_delta, v_block;
  if not found then return m; end if;
  if coalesce(v_delta, 0) = 0 or (m->>'type') = 'subscription' then return m; end if;

  perform public.blocks_ensure(p_client_id);
  if v_block is null then
    select b.id into v_block from public.client_blocks b
    where p_client_id in (b.client_id, b.partner_client_id) order by b.created_at desc limit 1;
  end if;
  if v_block is null then return m; end if;

  update public.client_blocks
  set remaining = greatest(0, remaining - v_delta), total = greatest(0, total - v_delta)
  where id = v_block returning * into blk;
  -- Блок только из этого платежа и без списаний — убираем совсем
  if blk.total = 0 and blk.remaining = 0
     and not exists (select 1 from public.session_charges s where s.block_id = blk.id)
     and not exists (select 1 from public.client_payments p where p.block_id = blk.id) then
    delete from public.client_blocks where id = blk.id;
  end if;

  v_other := case when blk.client_id = p_client_id then blk.partner_client_id else blk.client_id end;
  if v_other is not null then perform public.blocks_sync(v_other); end if;
  return public.blocks_sync(p_client_id);
end; $$;

revoke all on function public.delete_payment(uuid, uuid) from public, anon;
grant execute on function public.delete_payment(uuid, uuid) to authenticated;

-- ───────────────────────── Календарь и кабинет клиента ─────────────────────────
-- p_blocks — {"<client_id>": "<block_id>"}: тренер выбрал блок; кого нет — блок по умолчанию.
drop function public.mark_occurrence(uuid, date, text, uuid[], text);
create function public.mark_occurrence(p_booking_id uuid, p_occ_date date, p_status text,
  p_charge_client_ids uuid[] default '{}'::uuid[], p_note text default null, p_blocks jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings%rowtype; v_key text; v_prev text; v_date date; v_occ date; v_ex_date text;
  v_kind text; cid uuid; v_type text; v_blk uuid; charged uuid[] := '{}'; skipped jsonb := '[]'::jsonb;
begin
  if p_status is null or p_status not in ('scheduled', 'done', 'no-show', 'cancelled') then
    raise exception 'unknown status %', p_status using errcode = '22023';
  end if;
  perform public.lock_clients(array(select c.id from public.clients c
    where c.id = any(coalesce(p_charge_client_ids, '{}')) and c.trainer_id = (select auth.uid())));
  select * into b from public.bookings where id = p_booking_id and trainer_id = (select auth.uid()) for update;
  if not found then raise exception 'booking not found' using errcode = '42501'; end if;

  if b.recurring then
    if p_occ_date is null or p_occ_date < b.date
       or (b.recur_until is not null and p_occ_date > b.recur_until)
       or (p_occ_date - b.date) % 7 <> 0 then
      raise exception 'date % is not an occurrence of this series', p_occ_date using errcode = '22023';
    end if;
    v_key     := to_char(p_occ_date, 'YYYY-MM-DD');
    v_prev    := coalesce(b.exceptions -> v_key ->> 'status', b.status, 'scheduled');
    v_ex_date := b.exceptions -> v_key ->> 'date';
    v_date    := case when v_ex_date ~ '^\d{4}-\d{2}-\d{2}$' then v_ex_date::date else p_occ_date end;
    v_occ     := p_occ_date;
    update public.bookings
    set exceptions = coalesce(exceptions, '{}'::jsonb) || jsonb_build_object(v_key,
          coalesce(exceptions -> v_key, '{}'::jsonb)
          || jsonb_build_object('status', p_status)
          || case when p_note is not null then jsonb_build_object('note', p_note) else '{}'::jsonb end)
    where id = b.id;
  else
    v_prev := coalesce(b.status, 'scheduled');
    v_date := b.date;
    v_occ  := null;
    update public.bookings set status = p_status, note = coalesce(p_note, note) where id = b.id;
  end if;

  v_kind := case p_status when 'done' then 'workout' when 'no-show' then 'no_show' end;
  if v_kind is not null then
    for cid in select distinct x from unnest(coalesce(p_charge_client_ids, '{}')) x where x is not null loop
      if v_prev = p_status then
        skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'same_status');
        continue;
      end if;
      if not exists (select 1 from public.booking_clients bc where bc.booking_id = b.id and bc.client_id = cid) then
        skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'not_participant');
        continue;
      end if;
      if exists (select 1 from public.session_charges s
                 where s.booking_id = b.id and s.occ_date is not distinct from v_occ
                   and s.client_id = cid and s.kind in ('workout', 'no_show', 'client')) then
        skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'already');
        continue;
      end if;
      if v_kind = 'workout' then
        select c.membership->>'type' into v_type from public.clients c where c.id = cid;
        if v_type is distinct from 'sessions' then
          skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'no_membership');
          continue;
        end if;
        if exists (select 1 from public.plan_sessions s join public.plans p on p.id = s.plan_id
                   where p.client_id = cid and p.deleted_at is null
                     and s.date = v_date and s.deleted_at is null and s.total > 0) then
          skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'session');
          continue;
        end if;
      end if;
      v_blk := case when (p_blocks ->> cid::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    then (p_blocks ->> cid::text)::uuid end;
      if public.apply_session_charge(cid, v_kind, v_date, b.id, v_occ, v_blk) is not null then
        charged := charged || cid;
      else
        skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'nothing_to_charge');
      end if;
    end loop;
  end if;

  return jsonb_build_object('status', p_status, 'charged', to_jsonb(charged), 'skipped', skipped);
end; $$;
revoke all on function public.mark_occurrence(uuid, date, text, uuid[], text, jsonb) from public, anon;
grant execute on function public.mark_occurrence(uuid, date, text, uuid[], text, jsonb) to authenticated;

-- Клиент сам завершил тренировку: списание — блок по умолчанию (тренер может переложить)
create or replace function public.finish_client_session(p_client_id uuid, p_booking_id uuid default null, p_occ_date date default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m jsonb; t_id uuid; v_active jsonb;
  b bookings%rowtype; v_key text; v_status text; v_date date; v_ex_date text; v_charge_date date;
  v_occ date; v_has_booking boolean := false; v_skip boolean := false;
begin
  select trainer_id into t_id from clients where id = p_client_id and auth_user_id = auth.uid();
  if not found then raise exception 'not authorized'; end if;
  perform public.lock_clients(array[p_client_id]);
  select membership, active_session into m, v_active from clients
  where id = p_client_id and auth_user_id = auth.uid() for update;
  if not found then raise exception 'not authorized'; end if;
  if v_active is null then return; end if;

  if p_booking_id is not null then
    select * into b from bookings where id = p_booking_id and trainer_id = t_id for update;
    if found and exists (select 1 from booking_clients bc where bc.booking_id = b.id and bc.client_id = p_client_id) then
      if not b.recurring then
        v_status := coalesce(b.status, 'scheduled');
        v_date   := b.date;
        v_has_booking := true;
      elsif p_occ_date is not null and p_occ_date >= b.date
            and (b.recur_until is null or p_occ_date <= b.recur_until)
            and (p_occ_date - b.date) % 7 = 0 then
        v_key     := to_char(p_occ_date, 'YYYY-MM-DD');
        v_status  := coalesce(b.exceptions -> v_key ->> 'status', b.status, 'scheduled');
        v_ex_date := b.exceptions -> v_key ->> 'date';
        v_date    := case when v_ex_date ~ '^\d{4}-\d{2}-\d{2}$' then v_ex_date::date else p_occ_date end;
        v_occ     := p_occ_date;
        v_has_booking := true;
      end if;
    end if;
  end if;

  select s.date into v_charge_date
  from plan_sessions s join plans p on p.id = s.plan_id
  where p.client_id = p_client_id and s.from_client and s.deleted_at is null
    and s.created_at > now() - interval '12 hours'
    and s.date between current_date - 30 and current_date + 1
  order by s.created_at desc limit 1;
  if v_charge_date is null and p_occ_date between current_date - 1 and current_date + 1 then
    v_charge_date := p_occ_date;
  end if;
  v_charge_date := coalesce(v_charge_date, current_date);

  if v_has_booking and (v_status = 'done'
       or exists (select 1 from session_charges s where s.booking_id = b.id and s.occ_date is not distinct from v_occ
                  and s.client_id = p_client_id and s.kind in ('workout', 'no_show', 'client'))) then
    v_skip := true;
  elsif not v_has_booking and exists (select 1 from session_charges s where s.client_id = p_client_id and s.booking_id is not null
                  and s.kind = 'workout' and s.date = v_charge_date) then
    v_skip := true;
  end if;

  if not v_skip then
    perform public.apply_session_charge(p_client_id, 'client', v_charge_date,
      case when v_has_booking then b.id end, case when v_has_booking then v_occ end, null);
  end if;
  update clients set active_session = null where id = p_client_id and auth_user_id = auth.uid();

  if v_has_booking and v_status = 'scheduled' and v_date between current_date - 1 and current_date + 1
     and (select count(*) from booking_clients bc where bc.booking_id = b.id) = 1 then
    if b.recurring then
      update bookings
      set exceptions = coalesce(exceptions, '{}'::jsonb)
                       || jsonb_build_object(v_key, coalesce(exceptions -> v_key, '{}'::jsonb) || '{"status":"done"}'::jsonb)
      where id = b.id;
    else
      update bookings set status = 'done' where id = b.id;
    end if;
  end if;
end; $$;

-- Привязка сплит-пары: только настройки (вид следующей оплаты). Остатки больше не копируются —
-- общим становится только сплит-блок, оплаченный на двоих.
create or replace function public.link_split_partner(p_client_id uuid, p_partner_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); m jsonb; v_name text; v_pname text;
begin
  if p_client_id is null or p_partner_id is null or p_client_id = p_partner_id then
    raise exception 'link_split_partner: нужны два разных подопечных' using errcode = '22023';
  end if;
  perform 1 from public.clients c where c.id in (p_client_id, p_partner_id) and c.trainer_id = v_uid order by c.id for update;
  select c.membership, c.name into m, v_name from public.clients c where c.id = p_client_id and c.trainer_id = v_uid;
  if not found then raise exception 'link_split_partner: подопечный не найден' using errcode = '42501'; end if;
  select c.name into v_pname from public.clients c where c.id = p_partner_id and c.trainer_id = v_uid;
  if not found then raise exception 'link_split_partner: партнёр не найден' using errcode = '42501'; end if;

  m := coalesce(m, '{}'::jsonb) || jsonb_build_object('split', true, 'partnerClientId', p_partner_id::text, 'partnerName', v_pname);
  update public.clients set membership = m where id = p_client_id;
  update public.clients
  set membership = coalesce(membership, '{}'::jsonb)
    || jsonb_build_object('split', true, 'partnerClientId', p_client_id::text, 'partnerName', v_name)
  where id = p_partner_id;
  return m;
end; $$;

-- ───────────────────────── Перенос нынешних абонементов ─────────────────────────
-- Общий сплит-блок — только если пара ссылается друг на друга и остатки совпадают
-- (это и есть общий пул: раньше он копировался обоим). Иначе — у каждого свой персональный.
do $$
declare a record; p jsonb; v_rem integer; v_extra integer; v_paid date;
begin
  for a in
    select c.id, c.trainer_id, c.membership m from public.clients c
    where coalesce(c.membership->>'type', 'sessions') <> 'subscription'
      and coalesce(c.membership->>'remaining', '') ~ '^\s*-?\d+(\.\d+)?\s*$'
    order by c.id
  loop
    if exists (select 1 from public.client_blocks b where a.id in (b.client_id, b.partner_client_id)) then continue; end if;
    p := null;
    if (a.m->>'split') = 'true' and (a.m->>'partnerClientId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select jsonb_build_object('id', c.id, 'm', c.membership) into p from public.clients c
      where c.id = (a.m->>'partnerClientId')::uuid and c.trainer_id = a.trainer_id and c.id <> a.id
        and (c.membership->>'split') = 'true' and c.membership->>'partnerClientId' = a.id::text
        and coalesce(c.membership->>'remaining', '') ~ '^\s*-?\d+(\.\d+)?\s*$'
        and trunc(public.membership_num(c.membership->>'remaining')) = trunc(public.membership_num(a.m->>'remaining'))
        and trunc(public.membership_num(c.membership->>'extraRemaining')) = trunc(public.membership_num(a.m->>'extraRemaining'))
        and not exists (select 1 from public.client_blocks b where c.id in (b.client_id, b.partner_client_id));
    end if;

    if p is null then
      perform public.blocks_ensure(a.id);
      continue;
    end if;

    v_rem := trunc(public.membership_num(a.m->>'remaining'));
    v_extra := trunc(public.membership_num(a.m->>'extraRemaining'));
    v_paid := case when a.m->>'paymentDate' ~ '^\d{4}-\d{2}-\d{2}$' then (a.m->>'paymentDate')::date end;
    if v_extra > 0 then
      insert into public.client_blocks (trainer_id, client_id, partner_client_id, kind, total, remaining, price, color, created_at)
      values (a.trainer_id, a.id, (p->>'id')::uuid, 'split', v_extra, v_extra,
              round(public.membership_num(a.m->>'extraPricePerSession')::numeric, 2), 1, now() - interval '1 second');
    end if;
    insert into public.client_blocks (trainer_id, client_id, partner_client_id, kind, total, remaining, price, color, paid_at)
    values (a.trainer_id, a.id, (p->>'id')::uuid, 'split',
            greatest(trunc(coalesce(nullif(public.membership_num(a.m->>'remainingTotal'), 0), public.membership_num(a.m->>'total'))), v_rem, 0),
            v_rem, round(coalesce(public.session_price(a.m), 0), 2), 0, v_paid);
    perform public.blocks_sync(a.id);
    perform public.blocks_sync((p->>'id')::uuid);
  end loop;
end $$;

-- Служебные функции — только изнутри других функций
revoke all on function public.block_free_color(uuid, uuid) from public, anon, authenticated;
revoke all on function public.blocks_sync(uuid) from public, anon, authenticated;
revoke all on function public.blocks_ensure(uuid) from public, anon, authenticated;
revoke all on function public.block_pick(uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
