-- Уборка по замечаниям Supabase Security Advisor.
-- Старые перегрузки update_client_self_profile: приложение вызывает только версию с 9
-- параметрами (src/lib/clientPortal.ts), эти две — остатки прошлых миграций.
drop function if exists public.update_client_self_profile(uuid, text, text, text, text);
drop function if exists public.update_client_self_profile(uuid, text, text, text, text, text);

-- Фиксированный search_path у SECURITY DEFINER-функций (lint 0011). Тела ссылаются
-- только на public.clients и на net.http_post с явной схемой.
alter function public.update_session_progress(uuid, jsonb) set search_path = public;
alter function public.notify_trainer_on_session_change() set search_path = public;
