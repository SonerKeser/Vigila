import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Input, NumberInput, Switch } from "../../components/ui";
import { questionTypeLabel } from "../../lib/format";
import type { Question, QuestionType } from "../../lib/types";

/** Tepki süresi araştırmalarında sık sorulan hazır sorular. */
const presets: { label: string; make: () => Question }[] = [
  { label: "Yaş", make: () => ({ id: "yas", label: "Yaşınız", type: "number", options: null, required: true, min: 18, max: 99 }) },
  { label: "Cinsiyet", make: () => ({ id: "cinsiyet", label: "Cinsiyetiniz", type: "choice", options: ["Kadın", "Erkek", "Belirtmek istemiyorum"], required: false, min: null, max: null }) },
  { label: "El tercihi", make: () => ({ id: "el", label: "Hangi elinizi daha çok kullanırsınız?", type: "choice", options: ["Sağ", "Sol", "İkisi de"], required: true, min: null, max: null }) },
  { label: "Görme", make: () => ({ id: "gorme", label: "Normal ya da düzeltilmiş normal görmeye sahip misiniz?", type: "choice", options: ["Evet", "Hayır"], required: true, min: null, max: null }) },
  { label: "İşitme", make: () => ({ id: "isitme", label: "Bilinen bir işitme sorununuz var mı?", type: "choice", options: ["Hayır", "Evet"], required: true, min: null, max: null }) },
  { label: "Yorgunluk", make: () => ({ id: "yorgunluk", label: "Şu anda kendinizi ne kadar yorgun hissediyorsunuz?", type: "scale", options: null, required: false, min: 1, max: 7 }) },
];

function uniqueId(base: string, taken: Set<string>) {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  return id;
}

export function QuestionBuilder({ questions, onChange, error }: { questions: Question[]; onChange: (q: Question[]) => void; error?: string }) {
  const ids = new Set(questions.map((q) => q.id));
  const update = (i: number, patch: Partial<Question>) => onChange(questions.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...questions];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    onChange(next);
  };
  const add = (q: Question) => onChange([...questions, { ...q, id: uniqueId(q.id, ids) }]);

  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence initial={false}>
        {questions.map((q, i) => (
          <motion.div key={q.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="rounded-xl border border-line bg-ink-950/60 p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2.5 w-5 text-right text-[12px] text-haze tabular-nums">{i + 1}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Input value={q.label} placeholder="Soru metni" aria-label={`Soru ${i + 1} metni`} onChange={(e) => update(i, { label: e.target.value })} />
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Soru türü"
                    value={q.type}
                    onChange={(e) => {
                      const type = e.target.value as QuestionType;
                      update(i, {
                        type,
                        options: type === "choice" ? q.options ?? ["", ""] : null,
                        min: type === "scale" ? q.min ?? 1 : type === "number" ? q.min : null,
                        max: type === "scale" ? q.max ?? 5 : type === "number" ? q.max : null,
                      });
                    }}
                    className="field h-9 w-auto py-1 text-[13px]"
                  >
                    {(Object.keys(questionTypeLabel) as QuestionType[]).map((t) => (
                      <option key={t} value={t}>
                        {questionTypeLabel[t]}
                      </option>
                    ))}
                  </select>
                  {(q.type === "scale" || q.type === "number") && (
                    <>
                      <NumberInput className="w-24" value={q.min ?? NaN} onChange={(v) => update(i, { min: Number.isNaN(v) ? null : v })} unit="en az" />
                      <NumberInput className="w-24" value={q.max ?? NaN} onChange={(v) => update(i, { max: Number.isNaN(v) ? null : v })} unit="en çok" />
                    </>
                  )}
                  <label className="ml-auto flex items-center gap-2 text-[12.5px] text-mist">
                    <Switch label="Zorunlu" checked={q.required} onChange={(v) => update(i, { required: v })} /> Zorunlu
                  </label>
                </div>
                {q.type === "choice" && (
                  <textarea
                    aria-label="Seçenekler"
                    className="field min-h-16 resize-y text-[13px]"
                    placeholder="Her satıra bir seçenek"
                    value={(q.options ?? []).join("\n")}
                    onChange={(e) => update(i, { options: e.target.value.split("\n") })}
                  />
                )}
              </div>
              <div className="flex flex-col">
                <button type="button" aria-label="Yukarı taşı" disabled={i === 0} onClick={() => move(i, -1)} className="grid size-7 place-items-center rounded-md text-haze hover:bg-ink-800 hover:text-paper disabled:opacity-30">
                  <ArrowUp className="size-3.5" />
                </button>
                <button type="button" aria-label="Aşağı taşı" disabled={i === questions.length - 1} onClick={() => move(i, 1)} className="grid size-7 place-items-center rounded-md text-haze hover:bg-ink-800 hover:text-paper disabled:opacity-30">
                  <ArrowDown className="size-3.5" />
                </button>
                <button type="button" aria-label="Soruyu sil" onClick={() => onChange(questions.filter((_, k) => k !== i))} className="grid size-7 place-items-center rounded-md text-haze hover:bg-danger/10 hover:text-danger">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {error && <p className="text-[12.5px] text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => add({ id: "soru", label: "", type: "text", options: null, required: false, min: null, max: null })}>
          Soru ekle
        </Button>
        <span className="text-[12px] text-haze">Hazır:</span>
        {presets
          .filter((p) => !ids.has(p.make().id))
          .map((p) => (
            <button key={p.label} type="button" onClick={() => add(p.make())} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-mist hover:border-line-strong hover:text-paper">
              {p.label}
            </button>
          ))}
      </div>
    </div>
  );
}
