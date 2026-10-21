import { useEffect, useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import ModalShell from "./ModalShell";
import { DOCS, type DocSlug, type LegalDoc } from "../legal/docs";

function Body({ doc }: { doc: LegalDoc }) {
  return (
    <div className="space-y-3 text-sm text-zinc-300 leading-relaxed">
      {doc.sections.map((s, i) => (
        <section key={i} className="space-y-1.5">
          {s.h && <h3 className="font-semibold text-zinc-100 pt-1">{s.h}</h3>}
          {s.p.map((t, j) => <p key={j}>{t}</p>)}
        </section>
      ))}
    </div>
  );
}

/** Документ в окне — из регистрации, профиля, экрана согласия */
export function LegalModal({ slug, onClose }: { slug: DocSlug; onClose: () => void }) {
  const doc = DOCS[slug];
  return (
    <ModalShell title={doc.title} icon={<FileText size={17} className="text-lime-400" />} onClose={onClose} wide>
      <div className="p-4"><Body doc={doc} /></div>
    </ModalShell>
  );
}

/** Список документов (из профиля тренера и кабинета клиента) */
export function LegalList({ slugs, onClose }: { slugs: DocSlug[]; onClose: () => void }) {
  const [open, setOpen] = useState<DocSlug | null>(null);
  return (
    <>
      <ModalShell title="Документы" icon={<FileText size={17} className="text-lime-400" />} onClose={onClose}>
        <div className="p-3 space-y-1">
          {slugs.map((s) => (
            <button key={s} onClick={() => setOpen(s)} className="w-full flex items-center gap-3 px-3 min-h-12 py-2 rounded-xl hover:bg-zinc-800 transition text-left">
              <FileText size={18} className="text-zinc-400 shrink-0" /><span className="font-medium">{DOCS[s].title}</span>
            </button>
          ))}
        </div>
      </ModalShell>
      {open && <LegalModal slug={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Публичная страница #/legal/<slug> — открывается без входа (ссылка для магазинов приложений и сайта) */
export function LegalPage({ slug, onClose }: { slug: DocSlug; onClose: () => void }) {
  const doc = DOCS[slug];
  useEffect(() => {
    const prev = document.title;
    document.title = `${doc.title} — Reps`;
    window.scrollTo(0, 0);
    return () => { document.title = prev; };
  }, [doc]);
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-6">
      <div className="max-w-2xl mx-auto">
        <button onClick={onClose} className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 mb-4"><ArrowLeft size={16} /> Reps</button>
        <h1 className="text-2xl font-extrabold tracking-tight mb-4">{doc.title}</h1>
        <Body doc={doc} />
        <nav className="mt-8 pt-4 border-t border-zinc-800 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {Object.values(DOCS).filter((d) => d.slug !== slug).map((d) => <a key={d.slug} href={`#/legal/${d.slug}`} className="text-zinc-400 hover:text-zinc-100 underline underline-offset-2">{d.short}</a>)}
        </nav>
      </div>
    </div>
  );
}
