-- Разбор путей, группа 4 (5.22), 01.11.2026.
-- Клиенту строку trainers база не отдаёт (политика trainer_self), поэтому в кабинете не было
-- ни бренда с правилами тренера, ни контактов для «Написать тренеру». Функция отдаёт только
-- нужные клиенту поля — и только тренера карточки, которая принадлежит вызывающему.
create or replace function public.client_trainer_card(p_client_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select jsonb_build_object(
    'brand', t.brand,
    'logo_url', t.logo_url,
    'training_rules', t.profile ->> 'trainingRules',
    'name', t.profile ->> 'name',
    'avatar_url', t.profile ->> 'avatarUrl',
    'phone', t.profile ->> 'phone',
    'telegram', t.profile ->> 'telegram',
    'whatsapp', t.profile ->> 'whatsapp'
  )
  from public.clients c
  join public.trainers t on t.id = c.trainer_id
  where c.id = p_client_id
    and c.auth_user_id = (select auth.uid())
    and c.deleted_at is null
$$;
revoke all on function public.client_trainer_card(uuid) from public, anon;
grant execute on function public.client_trainer_card(uuid) to authenticated;
