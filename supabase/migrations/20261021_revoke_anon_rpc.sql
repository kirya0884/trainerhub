-- Аудит 2026-10-21, п. 7 и 9.
-- 7. SECURITY DEFINER-функции кабинета клиента и триггеры были доступны роли anon
--    (по умолчанию EXECUTE выдан PUBLIC). Внутри они проверяют auth.uid() и без входа
--    отказывают, так что это гигиена: вызывать их может только вошедший пользователь.
do $$
declare f text;
begin
  foreach f in array array[
    'public.cancel_client_session(uuid)',
    'public.finish_client_session(uuid)',
    'public.start_client_session(uuid, uuid, uuid, text)',
    'public.update_session_progress(uuid, jsonb)',
    'public.update_client_self_profile(uuid, text, text, text, text, text, text, text, jsonb)',
    'public.link_client_self()',
    'public.is_client_of_booking(uuid)',
    'public.is_trainer_of_booking(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Триггерные функции вызывает только сам триггер — права на вызов не нужны никому
  foreach f in array array[
    'public.handle_new_trainer()',
    'public.notify_trainer_on_session_change()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- 9. Два входа без тренера, карточки клиента и данных: неподтверждённая регистрация
--    сканера (oastify.com, 2026-09-19) и вход от 2026-08-02 без роли. Лишние ПДн не храним.
delete from auth.users
where id in ('1fd3d7a4-2933-4c59-af79-ae259f70947f', '9e7a72fe-17f7-46ff-91f9-6922d8199526')
  and not exists (select 1 from public.trainers t where t.id = auth.users.id)
  and not exists (select 1 from public.clients c where c.auth_user_id = auth.users.id);
