-- Клиент сам завершает тренировку: списание как у тренера (lib/clients.decrementMembershipRemaining).
-- Раньше функция только уменьшала remaining и не переносила «доп. блок», когда основной
-- заканчивался; после этого и списания тренером переставали работать (остаток 0 при
-- доп. блоке > 0). Партнёру по сплиту теперь синхронизируются те же 4 поля, что и с клиента.
create or replace function public.finish_client_session(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare m jsonb; left_n numeric; extra_n numeric; partner_id uuid;
begin
  select membership into m from clients where id = p_client_id and auth_user_id = auth.uid();
  if not found then raise exception 'not authorized'; end if;
  if (m->>'type') is distinct from 'subscription' and (m->>'remaining') is not null and (m->>'remaining') <> '' then
    left_n := (m->>'remaining')::numeric;
    if left_n > 0 then
      m := jsonb_set(m, '{remaining}', to_jsonb((left_n - 1)::text));
      -- основной блок закончился — доп. блок (другая цена) встаёт на его место
      extra_n := coalesce(nullif(m->>'extraRemaining', '')::numeric, 0);
      if left_n - 1 <= 0 and extra_n > 0 then
        m := m || jsonb_build_object('remaining', m->'extraRemaining', 'remainingPrice', coalesce(m->'extraPricePerSession', '""'::jsonb),
                                     'remainingTotal', m->'extraRemaining', 'extraRemaining', '', 'extraPricePerSession', '');
      end if;
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
