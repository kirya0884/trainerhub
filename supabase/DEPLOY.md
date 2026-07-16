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
  VAPID_PUBLIC_KEY="BKrFISh2J82hX76IrbQnEZZMi3c7ahtb6kPrk8hMnGLDBNFbd4VQ_2yRqyro3Vfo3shN5pzKrXamOJ6Qk_J_Dlc" \
  VAPID_PRIVATE_KEY="FE8WC7e3qq9e2tNmkkNpCq1HX_VRIpADwcdvIsfaOjk" \
  VAPID_SUBJECT="mailto:your@email.com" \
  SEND_PUSH_SECRET="nm81pQk17TYl2ERdHzGjWSeGfjxTSQcnYaJSk5dIAZ8"
```

> ⚠️ VAPID_PRIVATE_KEY — секрет. Не коммитить в git!

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
| HTTP Headers   | x-webhook-secret: nm81pQk17TYl2ERdHzGjWSeGfjxTSQcnYaJSk5dIAZ8 |

## 6. Применить SQL-миграцию

Dashboard → SQL Editor → вставить содержимое migrations/20260714_push_subscriptions.sql
