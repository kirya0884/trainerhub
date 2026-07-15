-- Web Push подписки тренеров
-- endpoint: URL браузерного push-сервиса (Google/Apple/Mozilla)
-- keys: { p256dh, auth } — ключи шифрования payload (не секреты, но хранить аккуратно)

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id  uuid NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  keys        jsonb NOT NULL,           -- { "p256dh": "...", "auth": "..." }
  created_at  timestamptz DEFAULT now(),
  UNIQUE (trainer_id, endpoint)
);

-- Тренер видит только свои подписки
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trainer sees own subscriptions"
  ON push_subscriptions FOR ALL
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

-- Edge Function читает подписки для рассылки push (service_role ключ)
-- Явных policy для service_role не нужно — он обходит RLS.
