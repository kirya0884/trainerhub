// Раздел не загрузился — говорим об этом прямо, а не «пока нет», и даём повторить запрос
export default function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="text-center py-6">
      <p className="text-sm text-zinc-400">Не удалось загрузить</p>
      <button onClick={onRetry} className="mt-2 h-10 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold text-zinc-100 transition">Повторить</button>
    </div>
  );
}
