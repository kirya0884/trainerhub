import { supabase } from "./supabase";
import { patchCache } from "./offlineCache";

// PIN — доп. защита экрана на общем устройстве, не основной auth-фактор.
// Хэш (bcrypt) и счётчик попыток живут на сервере в закрытой таблице user_pins — клиенту
// хэш не отдаётся; всё через RPC для текущего входа (тренер или клиент — без разницы).
// Проверка только онлайн: без сети PIN-экран не открывается (миграция 20261030_stage1_security).

// Задан ли PIN — сразу и в кэш для зала: без сети следующий запуск должен знать, что PIN есть
// PIN — на вход, а не на карточку: и у тренера, и у клиента (с любым числом карточек) лежит сверху
const rememberPin = (hasPin: boolean) => patchCache<{ hasPin?: boolean }>("access", (a) => ({ ...a, hasPin }));

/** 5 неверных PIN подряд — сервер блокирует проверку на 5 минут */
export class PinLockedError extends Error {}

export async function hasMyPin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_my_pin");
  if (error) throw error;
  return !!data;
}

export async function checkMyPin(pin: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_my_pin", { p_pin: pin });
  if (error) throw error.message === "pin_locked" ? new PinLockedError("pin_locked") : error;
  return !!data;
}

export async function setMyPin(pin: string) {
  const { error } = await supabase.rpc("set_my_pin", { p_pin: pin });
  if (error) throw error;
  rememberPin(true);
}

export async function clearMyPin() {
  const { error } = await supabase.rpc("clear_my_pin");
  if (error) throw error;
  rememberPin(false);
}
