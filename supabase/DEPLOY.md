# Supabase Edge Functions — деплой

## 1. Установить Supabase CLI

```bash
npm install -g supabase
supabase login
supabase link --project-ref <ВАШ_PROJECT_REF>
```

## 2. Задать секреты

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY="<новый публичный VAPID>" \
  VAPID_PRIVATE_KEY="<новый приватный VAPID>" \
  VAPID_SUBJECT="mailto:your@email.com" \
  SEND_PUSH_SECRET="<сгенерируйте: openssl rand -base64 32>"
```

> ⚠️ VAPID_PRIVATE_KEY — секрет. Не коммитить в git!

> ⚠️ Реальные ключи в репозиторий не коммитить — в этом файле только плейсхолдеры.

### Секрет send_push_secret в Vault

Триггер `notify_trainer_on_session_change` (миграция `migrations/20261022_push_secret_from_vault.sql`)
читает секрет из Supabase Vault. Значение — то же, что `SEND_PUSH_SECRET` выше.
Dashboard → Project Settings → Vault → Add new secret, имя `send_push_secret`, либо в SQL Editor:

```sql
select vault.create_secret('<значение SEND_PUSH_SECRET>', 'send_push_secret');
```

Без этого секрета тренировки сохраняются, но push-уведомления тренеру не уходят.

## 3. Деплой функции

```bash
supabase functions deploy send-push --no-verify-jwt
```

`--no-verify-jwt` нужен, потому что вызов идёт от Database Webhook
(не от пользователя с JWT), а верификацию мы делаем через x-webhook-secret.

## 4. Получить URL функции

```
https://<PROJECT_REF>.supabase.co/functions/v1/send-push
```

## 5. Настроить Database Webhook в Dashboard

Dashboard → Database → Webhooks → Create Webhook

| Поле           | Значение                                                |
|----------------|---------------------------------------------------------|
| Name           | notify-trainer-on-session                               |
| Table          | public.clients                                          |
| Events         | ✅ UPDATE                                               |
| Type           | HTTP Request                                            |
| URL            | https://<PROJECT_REF>.supabase.co/functions/v1/send-push |
| HTTP Method    | POST                                                    |
| HTTP Headers   | x-webhook-secret: <значение SEND_PUSH_SECRET> |

## 6. Применить SQL-миграцию

Dashboard → SQL Editor → вставить содержимое migrations/20260714_push_subscriptions.sql
