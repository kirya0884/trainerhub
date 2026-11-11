// Тесты логики помощника. Запуск из папки app: node --test supabase/functions/assistant/logic.test.ts
// (Node 22.6+ понимает TypeScript сам). На сервере этот файл не исполняется.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCommand, commandPrompt, defaultDayName, matchClient, normTime, parseModelJson, resolveDate, todayIn, topNames,
} from "./logic.ts";

const TODAY = "2026-11-11"; // среда

test("сегодня в часовом поясе тренера", () => {
  const now = new Date("2026-11-11T22:30:00Z");
  assert.equal(todayIn("Europe/Moscow", now), "2026-11-12"); // в Москве уже 01:30 следующего дня
  assert.equal(todayIn("Asia/Vladivostok", now), "2026-11-12");
  assert.equal(todayIn("America/New_York", now), "2026-11-11");
  assert.equal(todayIn("Нет/Такого", now), "2026-11-12"); // неизвестный пояс → Москва
});

test("даты словами", () => {
  assert.equal(resolveDate({ type: "today" }, TODAY), "2026-11-11");
  assert.equal(resolveDate({ type: "tomorrow" }, TODAY), "2026-11-12");
  assert.equal(resolveDate({ type: "day_after_tomorrow" }, TODAY), "2026-11-13");
  assert.equal(resolveDate({ type: "in_days", days: 10 }, TODAY), "2026-11-21");
  assert.equal(resolveDate({ type: "none" }, TODAY), null);
  assert.equal(resolveDate(undefined, TODAY), null);
});

test("дни недели", () => {
  assert.equal(resolveDate({ type: "weekday", weekday: 4 }, TODAY), "2026-11-12"); // четверг
  assert.equal(resolveDate({ type: "weekday", weekday: 5 }, TODAY), "2026-11-13"); // пятница
  assert.equal(resolveDate({ type: "weekday", weekday: 3 }, TODAY), "2026-11-11"); // среда = сегодня
  assert.equal(resolveDate({ type: "weekday", weekday: 1 }, TODAY), "2026-11-16"); // понедельник
  assert.equal(resolveDate({ type: "weekday", weekday: 4, nextWeek: true }, TODAY), "2026-11-19");
  assert.equal(resolveDate({ type: "weekday", weekday: 1, nextWeek: true }, TODAY), "2026-11-16");
  assert.equal(resolveDate({ type: "weekday", weekday: 9 }, TODAY), null);
});

test("числа и месяцы", () => {
  assert.equal(resolveDate({ type: "date", day: 15, month: 11 }, TODAY), "2026-11-15");
  assert.equal(resolveDate({ type: "date", day: 5, month: 1 }, TODAY), "2027-01-05"); // январь в ноябре — следующий год
  assert.equal(resolveDate({ type: "date", day: 1, month: 11 }, TODAY), "2026-11-01"); // недавно прошедшая — этот год
  assert.equal(resolveDate({ type: "date", day: 31, month: 11 }, TODAY), null);
  assert.equal(resolveDate({ type: "date", day: 3, month: 3, year: 2026 }, TODAY), "2026-03-03"); // год назван — не трогаем
});

const CLIENTS = [
  { id: "1", name: "Анна Котова" },
  { id: "2", name: "Анна Смирнова" },
  { id: "3", name: "Игорь Седов" },
  { id: "4", name: "Анжела Ким" },
  { id: "5", name: "Ёлка Олегова" },
];

test("клиент по имени в разных падежах", () => {
  const igor = matchClient("Игорю", ["Игорь"], CLIENTS);
  assert.equal(igor.status, "ok");
  assert.equal(igor.candidates[0].id, "3");
  assert.equal(matchClient("Котовой", ["Котова"], CLIENTS).candidates[0].id, "1");
  assert.equal(matchClient("Анне Котовой", ["Анна Котова"], CLIENTS).status, "ok");
  assert.equal(matchClient("Седову", [], CLIENTS).candidates[0].id, "3"); // только упоминание, без именительного
  assert.equal(matchClient("Ёлке", ["Елка"], CLIENTS).candidates[0].id, "5"); // ё = е
});

test("две Анны — спросить, Анжела не путается с Анной", () => {
  const r = matchClient("Ане", ["Аня", "Анна"], CLIENTS);
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(r.candidates.map((c) => c.id).sort(), ["1", "2"]);
});

test("клиента нет или не назван", () => {
  assert.equal(matchClient("Диме", ["Дима", "Дмитрий"], CLIENTS).status, "not_found");
  assert.equal(matchClient("Диме", ["Дима"], CLIENTS).mention, "Диме");
  assert.equal(matchClient("", [], CLIENTS).status, "none");
});

test("время", () => {
  assert.equal(normTime("18:00"), "18:00");
  assert.equal(normTime("9.30"), "09:30");
  assert.equal(normTime("25:00"), "");
  assert.equal(normTime("вечером"), "");
  assert.equal(normTime(undefined), "");
});

test("название дня по умолчанию", () => {
  assert.equal(defaultDayName("2026-11-13"), "Тренировка 13 ноя");
  assert.equal(defaultDayName(null), "Тренировка");
});

test("частые упражнения тренера, без дублей", () => {
  assert.deepEqual(topNames(["Жим лёжа", "жим лежа", "Присед", "Жим лёжа", " ", "Планка"], 2), ["Жим лёжа", "Присед"]);
});

test("команда с упражнениями — как в прототипе", () => {
  const raw = {
    action: "create_workout",
    clientMention: "Игорю",
    clientNames: ["Игорь"],
    date: { type: "weekday" as const, weekday: 5 },
    time: "",
    dayName: "Грудь и ноги",
    exercises: [
      { name: "Жим лёжа", sets: 4, reps: "8" },
      { name: "приседания со штангой", sets: 5, reps: "5", weight: "100" },
      { name: "Разводка гантелей лёжа", sets: 3, reps: "12", weight: "14,5" },
      { name: "Планка", sets: 3, duration: "1 мин" },
      { name: "", sets: 3 },
      { name: "Тяга", sets: 999, reps: "10" },
    ],
  };
  const c = buildCommand(raw, TODAY, CLIENTS, ["Жим лёжа", "Приседания со штангой", "Планка"]);
  assert.equal(c.action, "create_workout");
  assert.equal(c.client.status, "ok");
  assert.equal(c.date, "2026-11-13");
  assert.equal(c.dayName, "Грудь и ноги");
  assert.equal(c.exercises.length, 5); // пустое название выброшено
  assert.deepEqual(c.exercises[1], { name: "Приседания со штангой", sets: 5, reps: "5", weight: "100", duration: "", note: "", known: true });
  assert.equal(c.exercises[2].weight, "14.5");
  assert.equal(c.exercises[2].known, false);
  assert.equal(c.exercises[3].duration, "1 мин");
  assert.equal(c.exercises[4].sets, 0); // 999 подходов — не верим
});

test("короткая команда — пустая тренировка с временем", () => {
  const c = buildCommand(
    { action: "create_workout", clientMention: "Анне Котовой", clientNames: ["Анна Котова"], date: { type: "weekday", weekday: 4 }, time: "18:00", dayName: "", exercises: [] },
    TODAY, CLIENTS, [],
  );
  assert.equal(c.client.candidates[0].id, "1");
  assert.equal(c.date, "2026-11-12");
  assert.equal(c.time, "18:00");
  assert.equal(c.dayName, "Тренировка 12 ноя");
  assert.deepEqual(c.exercises, []);
});

test("не команда — понятный ответ", () => {
  const c = buildCommand({ action: "unknown", reply: "" }, TODAY, CLIENTS, []);
  assert.equal(c.action, "unknown");
  assert.match(c.reply, /создавать тренировки/);
  assert.equal(buildCommand({ action: "что-то" } as any, TODAY, CLIENTS, []).action, "unknown");
  assert.equal(buildCommand(null as any, TODAY, CLIENTS, []).action, "unknown");
});

test("ответ модели в обёртке ```json", () => {
  assert.deepEqual(parseModelJson('```json\n{"action":"unknown"}\n```'), { action: "unknown" });
  assert.equal(parseModelJson("не json"), null);
  assert.equal(parseModelJson("42"), null);
});

test("в задании есть сегодняшний день и упражнения тренера", () => {
  const p = commandPrompt(TODAY, ["Жим лёжа", "Планка"]);
  assert.match(p, /Сегодня среда, 11\.11\.2026/);
  assert.match(p, /Жим лёжа; Планка/);
  assert.match(commandPrompt(TODAY, []), /Известных упражнений у тренера пока нет/);
});
