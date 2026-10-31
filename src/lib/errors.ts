import { isNetworkError } from "./outbox";

// Текст ошибки для человека: переводит частые ответы Supabase Auth и сетевые сбои,
// а всё непонятное (английское, коды, «HTTP 500») заменяет на fallback.
export function humanError(e: unknown, fallback = "Не получилось. Попробуй ещё раз"): string {
  const msg = String((e as any)?.message ?? e ?? "");
  if (isNetworkError(e) || isNetworkError(msg)) return "Нет интернета. Проверь подключение и попробуй ещё раз";
  if (/invalid login credentials/i.test(msg)) return "Неверный email или пароль";
  if (/email not confirmed/i.test(msg)) return "Email не подтверждён — проверь почту и перейди по ссылке из письма";
  if (/user already registered/i.test(msg)) return "Аккаунт с таким email уже есть — войди";
  if (/new password should be different/i.test(msg)) return "Новый пароль должен отличаться от старого";
  if (/password should be at least|password is too short/i.test(msg)) return "Пароль слишком короткий (минимум 6 символов)";
  if (/password should contain|weak password/i.test(msg)) return "Пароль слишком простой — добавь цифры и буквы разного регистра";
  if (/for security purposes|rate limit|too many/i.test(msg)) return "Слишком много попыток — подожди минуту и попробуй снова";
  if (/invalid format|email address .*is invalid|unable to validate email/i.test(msg)) return "Проверь email — похоже, в адресе ошибка";
  if (/signups not allowed for otp/i.test(msg)) return "Для этой почты нет доступа. Попроси тренера отправить приглашение";
  if (/jwt|session.*(expired|missing)|not authenticated|refresh token/i.test(msg)) return "Вход устарел — выйди и войди снова";
  if (/permission denied|row-level security|violates row-level/i.test(msg)) return "Нет прав на это действие";
  // Русский текст от наших функций (raise exception '…', register-client) показываем как есть —
  // в нём бывают email и названия латиницей; префикс «log_workout: » снимаем
  const ru = msg.replace(/^[a-z_]+:\s*/i, "");
  if (/[а-яё]/i.test(ru)) return ru;
  return fallback;
}
