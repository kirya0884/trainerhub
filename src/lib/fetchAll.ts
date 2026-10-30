// Supabase (PostgREST) отдаёт за один запрос не больше 1000 строк (max_rows) и об обрезке
// не сообщает: календарь, заработок и бэкап через несколько месяцев стали бы неполными молча.
// fetchAll выбирает страницами, пока страница не придёт неполной.
//
// Запрос обязан быть упорядочен по уникальному ключу (обычно .order("id"), или
// .order("date").order("id")) — иначе страницы могут пересекаться и терять строки.
//   const rows = await fetchAll((from, to) => supabase.from("bookings").select("*").eq("trainer_id", id).order("id").range(from, to));
const PAGE = 1000; // = max_rows в настройках API Supabase; меньше нельзя — неполная страница сочтётся последней

export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** Длинный список id в .in() не влезает в адрес запроса — делим на части */
export async function fetchAllIn<T>(ids: string[], page: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, size = 150): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    out.push(...(await fetchAll((from, to) => page(chunk, from, to))));
  }
  return out;
}
