import { Sparkles } from "lucide-react";
import { useState } from "react";
import ModalShell from "./ModalShell";

type Period = 1 | 3 | 12;

const PLANS = [
  {
    id: "start",
    name: "Старт",
    monthlyPrice: 0,
    clients: 3,
    color: "text-zinc-400",
    border: "border-zinc-700",
    badge: "",
    features: ["Конструктор планов тренировок", "Карточки клиентов", "Библиотека упражнений", "Графики прогрессии", "PDF-экспорт", "Бэкап данных"],
    cta: "Текущий тариф",
    ctaClass: "bg-zinc-800 text-zinc-400 cursor-default",
    highlight: false,
  },
  {
    id: "basic",
    name: "Базовый",
    monthlyPrice: 990,
    clients: 15,
    color: "text-cyan-400",
    border: "border-cyan-400/30",
    badge: "",
    features: ["Всё из тарифа Старт", "Модуль оплат: разовые", "Пакеты абонементов со скидкой", "История платежей"],
    cta: "Выбрать тариф",
    ctaClass: "bg-cyan-400 text-zinc-950 hover:bg-cyan-300",
    highlight: false,
  },
  {
    id: "pro",
    name: "Профи",
    monthlyPrice: 1690,
    clients: 40,
    color: "text-lime-400",
    border: "border-lime-400/50",
    badge: "Популярный",
    features: ["Всё из тарифа Базовый", "Сплит на двоих с автосписанием", "Расписание и календарь", "Портал клиента (личный кабинет)"],
    cta: "Выбрать тариф",
    ctaClass: "bg-lime-400 text-zinc-950 hover:bg-lime-300",
    highlight: true,
  },
  {
    id: "studio",
    name: "Студия",
    monthlyPrice: 2590,
    clients: 100,
    color: "text-violet-400",
    border: "border-violet-400/30",
    badge: "",
    features: ["Всё из тарифа Профи", "До 100 активных клиентов", "Приоритетная поддержка", "Ранний доступ к новым функциям"],
    cta: "Выбрать тариф",
    ctaClass: "bg-violet-400 text-zinc-950 hover:bg-violet-300",
    highlight: false,
  },
];

const PERIODS: { value: Period; label: string; discount: number }[] = [
  { value: 1, label: "1 месяц", discount: 0 },
  { value: 3, label: "3 месяца", discount: 5 },
  { value: 12, label: "12 месяцев", discount: 15 },
];

function calcPrice(monthly: number, period: Period): { perMonth: number; total: number } {
  if (monthly === 0) return { perMonth: 0, total: 0 };
  const disc = period === 3 ? 0.05 : period === 12 ? 0.15 : 0;
  const perMonth = Math.round(monthly * (1 - disc));
  return { perMonth, total: perMonth * period };
}

export default function SubscriptionModal({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<Period>(1);

  return (
    <ModalShell title="Подписка на Reps" icon={<Sparkles size={17} className="text-lime-400" />} onClose={onClose} wide>
      <div className="overflow-y-auto p-4 space-y-4">
        {/* Period switcher */}
        <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 w-fit mx-auto">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition relative ${period === p.value ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}
            >
              {p.label}
              {p.discount > 0 && (
                <span className={`ml-1.5 text-xs font-semibold ${period === p.value ? "text-zinc-700" : "text-lime-400"}`}>−{p.discount}%</span>
              )}
            </button>
          ))}
        </div>

        {period > 1 && (
          <p className="text-center text-xs text-zinc-500">
            Цена за месяц при оплате за {period} {period === 3 ? "месяца" : "месяцев"} · экономия {period === 3 ? "5%" : "15%"}
          </p>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PLANS.map((plan) => {
            const { perMonth, total } = calcPrice(plan.monthlyPrice, period);
            return (
              <div
                key={plan.id}
                className={`relative bg-zinc-800/60 border ${plan.border} rounded-2xl p-4 flex flex-col gap-3 ${plan.highlight ? "ring-1 ring-lime-400/40" : ""}`}
              >
                {plan.badge && (
                  <span className="absolute -top-2.5 left-4 bg-lime-400 text-zinc-950 text-[11px] font-bold px-2 py-0.5 rounded-full">{plan.badge}</span>
                )}
                <div>
                  <p className={`font-bold text-base ${plan.color}`}>{plan.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">до {plan.clients} активных клиентов</p>
                </div>

                <div>
                  {plan.monthlyPrice === 0 ? (
                    <p className="text-2xl font-extrabold text-zinc-100">Бесплатно</p>
                  ) : (
                    <>
                      <p className="text-2xl font-extrabold text-zinc-100">
                        {perMonth.toLocaleString("ru-RU")} ₽<span className="text-sm font-normal text-zinc-500">/мес</span>
                      </p>
                      {period > 1 && (
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Итого {total.toLocaleString("ru-RU")} ₽ за {period} {period === 3 ? "месяца" : "месяцев"}
                          {" "}· <span className="line-through">{(plan.monthlyPrice * period).toLocaleString("ru-RU")} ₽</span>
                        </p>
                      )}
                    </>
                  )}
                </div>

                <ul className="space-y-1.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-xs text-zinc-300">
                      <span className={`mt-0.5 shrink-0 ${plan.color}`}>✓</span>{f}
                    </li>
                  ))}
                </ul>

                {/* ponytail: кнопка не делает ничего — оплата подключится позже */}
                <button
                  onClick={() => {}}
                  className={`w-full rounded-xl py-2.5 text-sm font-semibold transition ${plan.ctaClass}`}
                >
                  {plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-zinc-600">
          Оплата подписки будет доступна после подключения платёжной системы
        </p>
      </div>
    </ModalShell>
  );
}
