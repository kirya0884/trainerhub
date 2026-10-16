-- Сроки хранения (политика обработки ПДн, п. 7):
-- 1) карточка подопечного, удалённая навсегда, уносит и его вход в кабинет — иначе почта
--    и пароль оставались бы в auth.users без карточки;
-- 2) корзина хранится 30 дней, затем удаляется автоматически (pg_cron, раз в сутки).
--    Первая автоочистка — не раньше 17.11.2026: у всего, что уже лежит в корзине, есть
--    полные 30 дней с момента объявления срока.

create or replace function public.clients_drop_login() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.auth_user_id is not null
     -- вход тренера не трогаем никогда
     and not exists (select 1 from public.trainers t where t.id = old.auth_user_id)
     -- тот же человек может быть подопечным у другого тренера — тогда вход ему ещё нужен
     and not exists (select 1 from public.clients c where c.auth_user_id = old.auth_user_id and c.id <> old.id)
  then
    delete from auth.users where id = old.auth_user_id;
  end if;
  return old;
end $$;
revoke execute on function public.clients_drop_login() from public, anon, authenticated;
create trigger clients_drop_login after delete on public.clients
  for each row execute function public.clients_drop_login();

create or replace function public.purge_trash() returns void
language plpgsql security definer set search_path = '' as $$
declare
  cutoff timestamptz := now() - interval '30 days';
  touched uuid[];
begin
  if now() < timestamptz '2026-11-17 00:00+03' then return; end if;
  -- Записи календаря, которые держались только на удаляемых подопечных, — как в permanentlyDeleteClient
  select array_agg(distinct bc.booking_id) into touched
    from public.booking_clients bc join public.clients c on c.id = bc.client_id
   where c.deleted_at < cutoff;
  delete from public.clients where deleted_at < cutoff;
  delete from public.bookings b
   where b.id = any(coalesce(touched, '{}'))
     and not exists (select 1 from public.booking_clients bc where bc.booking_id = b.id);
  delete from public.plans where deleted_at < cutoff;
  delete from public.plan_sessions where deleted_at < cutoff;
end $$;
revoke execute on function public.purge_trash() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('purge-trash', '17 0 * * *', 'select public.purge_trash()');
