-- update_session_progress не проверял вызывающего: SECURITY DEFINER + EXECUTE для anon,
-- и любой, зная UUID клиента, мог перезаписать его текущую тренировку (а триггер
-- notify_trainer_on_session_change слал тренеру push на каждую запись).
-- Теперь — та же проверка, что в start/finish/cancel_client_session: только свой клиент.
-- Плюс: прогресс пишется лишь в идущую тренировку — запоздалый запрос после завершения
-- или отмены раньше создавал active_session без плана («призрачную» тренировку).
create or replace function public.update_session_progress(p_client_id uuid, p_progress jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform 1 from clients where id = p_client_id and auth_user_id = auth.uid();
  if not found then raise exception 'not authorized'; end if;
  update clients
  set active_session = jsonb_set(active_session, '{progress}', p_progress, true)
  where id = p_client_id and auth_user_id = auth.uid() and active_session is not null;
end;
$function$;
