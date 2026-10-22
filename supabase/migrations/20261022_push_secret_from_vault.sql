-- Утечка ключей push-уведомлений: секрет send-push лежал прямо в тексте триггерной функции
-- (и в supabase/DEPLOY.md публичного репозитория). Теперь функция берёт его из Supabase Vault.
--
-- Перед применением: в Vault должен быть секрет send_push_secret — то же значение, что
-- SEND_PUSH_SECRET в секретах Edge Functions (Dashboard → Project Settings → Vault или
-- select vault.create_secret('<значение>', 'send_push_secret');). Значение сюда не пишем.
--
-- Триггер clients.on_session_change срабатывает на каждое изменение active_session (во время
-- тренировки — часто), поэтому функция не должна падать ни при каких условиях:
--   * секрета в Vault нет — запрос не отправляем, уведомлений не будет, тренировка сохраняется;
--   * любая ошибка чтения секрета или постановки запроса — только WARNING в лог, UPDATE проходит.
-- net.http_post (pg_net) лишь ставит запрос в очередь; ответ функции send-push на
-- сохранение клиента не влияет.
--
-- search_path = '': все объекты указаны со схемой (vault., net.), а row_to_json и
-- jsonb_build_object из pg_catalog, который Postgres ищет всегда. Пустой путь исключает
-- подмену объектов через схемы в search_path — строже, чем 'public' (lint 0011).

create or replace function public.notify_trainer_on_session_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if old.active_session is distinct from new.active_session then
    begin
      select decrypted_secret into v_secret
      from vault.decrypted_secrets
      where name = 'send_push_secret'
      limit 1;

      if v_secret is not null then
        perform net.http_post(
          url := 'https://epbrivrgtbkptqnhkxnr.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-webhook-secret', v_secret
          ),
          body := jsonb_build_object(
            'type', 'UPDATE',
            'table', 'clients',
            'schema', 'public',
            'record', row_to_json(new),
            'old_record', row_to_json(old)
          )
        );
      end if;
    exception when others then
      -- Текст ошибки без значения секрета; сохранение клиента не срываем
      raise warning 'notify_trainer_on_session_change: push не отправлен (%): %', sqlstate, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

-- create or replace у существующей функции права сохраняет, но если функции не было
-- (новая база), EXECUTE снова выдан PUBLIC. Повторяем закрытие из 20261021_revoke_anon_rpc.sql:
-- триггерную функцию вызывает только сам триггер.
revoke execute on function public.notify_trainer_on_session_change() from public, anon, authenticated;
