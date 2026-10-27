import { clsx } from "clsx";
import { motion } from "motion/react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { fmt, kindColor, kindLabel, quadrantLabel } from "../lib/format";
import type { StimulusKind } from "../lib/types";

const KIND_ORDER: StimulusKind[] = ["visual", "auditory", "audiovisual"];

function Legend({ kinds }: { kinds: StimulusKind[] }) {
  if (kinds.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-mist">
      {kinds.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: kindColor[k] }} />
          {kindLabel[k]}
        </span>
      ))}
    </div>
  );
}

function Tip({ x, children }: { x: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute -top-2 z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-line-strong bg-ink-950/95 px-3 py-2 text-[12px] leading-relaxed whitespace-nowrap shadow-xl" style={{ left: x }}>
      {children}
    </div>
  );
}

/**
 * Tepki süresi dağılımı: 50 ms'lik kutular, kanala göre yığılmış. Kesik çizgi ortancayı gösterir.
 */
export function RtHistogram({ groups, binMs = 50, height = 180 }: { groups: { kind: StimulusKind; values: number[] }[]; binMs?: number; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const kinds = KIND_ORDER.filter((k) => groups.some((g) => g.kind === k && g.values.length > 0));
  const all = groups.flatMap((g) => g.values);

  const { bins, maxCount, start, median } = useMemo(() => {
    if (all.length === 0) return { bins: [], maxCount: 0, start: 0, median: null as number | null };
    const sorted = [...all].sort((a, b) => a - b);
    const lo = Math.floor(sorted[0] / binMs) * binMs;
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
    const hi = Math.max(lo + binMs * 6, Math.ceil(p99 / binMs) * binMs + binMs);
    const n = Math.min(60, Math.round((hi - lo) / binMs));
    const list = Array.from({ length: n }, (_, i) => ({ from: lo + i * binMs, counts: Object.fromEntries(KIND_ORDER.map((k) => [k, 0])) as Record<StimulusKind, number> }));
    for (const g of groups) for (const v of g.values) {
      const i = Math.min(n - 1, Math.max(0, Math.floor((v - lo) / binMs)));
      list[i].counts[g.kind]++;
    }
    const max = Math.max(1, ...list.map((b) => KIND_ORDER.reduce((a, k) => a + b.counts[k], 0)));
    const mid = Math.floor(sorted.length / 2);
    return { bins: list, maxCount: max, start: lo, median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 };
  }, [groups, binMs, all]);

  if (all.length === 0) return <p className="py-10 text-center text-sm text-haze">Henüz isabetli yanıt yok.</p>;
  const span = bins.length * binMs;
  const labelEvery = Math.max(1, Math.ceil(bins.length / 8));

  return (
    <div>
      <Legend kinds={kinds} />
      <div className="relative mt-4" style={{ height }}>
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {bins.map((b, i) => {
            const total = KIND_ORDER.reduce((a, k) => a + b.counts[k], 0);
            return (
              <div key={b.from} className="relative flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <motion.div
                  className="flex flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px]"
                  initial={{ height: 0 }}
                  animate={{ height: `${(total / maxCount) * 100}%` }}
                  transition={{ type: "spring", stiffness: 180, damping: 26, delay: i * 0.012 }}
                >
                  {kinds.map((k) =>
                    b.counts[k] > 0 ? <div key={k} style={{ flexGrow: b.counts[k], background: kindColor[k], opacity: hover == null || hover === i ? 1 : 0.45 }} /> : null,
                  )}
                </motion.div>
                {hover === i && total > 0 && (
                  <Tip x="50%">
                    <p className="font-medium text-paper">
                      {b.from}–{b.from + binMs} ms
                    </p>
                    {kinds.filter((k) => b.counts[k] > 0).map((k) => (
                      <p key={k} className="text-mist">
                        {kindLabel[k]}: {b.counts[k]}
                      </p>
                    ))}
                  </Tip>
                )}
              </div>
            );
          })}
        </div>
        {median != null && (
          <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-paper/60" style={{ left: `${((median - start) / span) * 100}%` }}>
            <span className="absolute -top-5 left-1 text-[11px] whitespace-nowrap text-paper">Ortanca {fmt.ms(median)}</span>
          </div>
        )}
      </div>
      <div className="relative mt-1.5 h-4 border-t border-line text-[10.5px] text-haze tabular-nums">
        {bins.map((b, i) =>
          i % labelEvery === 0 ? (
            <span key={b.from} className="absolute top-1 -translate-x-1/2" style={{ left: `${(i / bins.length) * 100}%` }}>
              {b.from}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/** Kanal başına ortalama tepki süresi (çubuk), standart sapma (bıyık) ve isabet oranı. */
export function KindComparison({ rows }: { rows: { kind: StimulusKind; meanRt: number | null; sdRt?: number | null; hitRate: number; trials: number }[] }) {
  const [hover, setHover] = useState<StimulusKind | null>(null);
  const ordered = KIND_ORDER.map((k) => rows.find((r) => r.kind === k)).filter((r): r is NonNullable<typeof r> => !!r);
  const max = Math.max(1, ...ordered.map((r) => (r.meanRt ?? 0) + (r.sdRt ?? 0))) * 1.08;
  if (ordered.length === 0) return <p className="py-6 text-center text-sm text-haze">Veri yok.</p>;

  return (
    <div className="space-y-4">
      {ordered.map((r) => (
        <div key={r.kind} onMouseEnter={() => setHover(r.kind)} onMouseLeave={() => setHover(null)}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="inline-flex items-center gap-2 text-paper">
              <span className="size-2.5 rounded-[3px]" style={{ background: kindColor[r.kind] }} />
              {kindLabel[r.kind]}
            </span>
            <span className="flex gap-3 text-mist tabular-nums">
              <span>{fmt.ms(r.meanRt)}</span>
              <span className="text-haze">isabet {fmt.percent(r.hitRate)}</span>
            </span>
          </div>
          <div className="relative h-3 rounded-full bg-ink-950">
            {r.meanRt != null && (
              <>
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: kindColor[r.kind], opacity: hover && hover !== r.kind ? 0.5 : 1 }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(r.meanRt / max) * 100}%` }}
                  transition={{ type: "spring", stiffness: 140, damping: 24 }}
                />
                {r.sdRt != null && (
                  <div
                    className="absolute top-1/2 h-px -translate-y-1/2 bg-paper/80"
                    style={{ left: `${(Math.max(0, r.meanRt - r.sdRt) / max) * 100}%`, width: `${((Math.min(max, r.meanRt + r.sdRt) - Math.max(0, r.meanRt - r.sdRt)) / max) * 100}%` }}
                  >
                    <span className="absolute -top-1 left-0 h-2 w-px bg-paper/80" />
                    <span className="absolute -top-1 right-0 h-2 w-px bg-paper/80" />
                  </div>
                )}
              </>
            )}
          </div>
          {hover === r.kind && (
            <p className="mt-1 text-[12px] text-haze">
              {r.trials} deneme{r.sdRt != null && `, standart sapma ${fmt.ms(r.sdRt)}`}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Ekranın dört çeyreğinde isabet oranı: tek tonlu yoğunluk (açık = düşük, dolgun = yüksek).
 * Her hücre değerini yazıyla da taşır; renk tek başına bilgi değildir.
 */
export function QuadrantMap({ rows, aspect = 16 / 9 }: { rows: { quadrant: number; trials: number; hitRate: number; meanRt: number | null }[]; aspect?: number }) {
  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-[2px] overflow-hidden rounded-xl border border-line bg-line" style={{ aspectRatio: aspect }}>
      {[0, 1, 2, 3].map((q) => {
        const r = rows.find((x) => x.quadrant === q);
        const alpha = r ? 0.12 + r.hitRate * 0.68 : 0;
        return (
          <div key={q} className="relative flex flex-col justify-between bg-ink-950 p-3" title={r ? `${quadrantLabel[q]}: ${r.trials} deneme` : undefined}>
            <div className="absolute inset-0" style={{ background: `rgb(154 108 240 / ${alpha})` }} />
            <span className="relative text-[11.5px] text-mist">{quadrantLabel[q]}</span>
            {r ? (
              <span className="relative">
                <span className="display block text-[28px] leading-none text-paper">{fmt.percent(r.hitRate)}</span>
                <span className="text-[12px] text-mist tabular-nums">{fmt.ms(r.meanRt)}</span>
              </span>
            ) : (
              <span className="relative text-[12px] text-haze">Uyaran yok</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Son 14 günde tamamlanan oturum sayısı. */
export function ActivityBars({ days }: { days: { date: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div>
      <div className="relative flex h-28 items-end gap-[3px]">
        {days.map((d, i) => (
          <div key={d.date} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <motion.div
              className={clsx("w-full rounded-t-[4px]", d.count === 0 ? "bg-ink-700" : "bg-av")}
              style={{ opacity: hover == null || hover === i ? 1 : 0.5 }}
              initial={{ height: 2 }}
              animate={{ height: d.count === 0 ? 2 : `${(d.count / max) * 100}%` }}
              transition={{ type: "spring", stiffness: 160, damping: 22, delay: i * 0.025 }}
            />
            {hover === i && (
              <Tip x="50%">
                <p className="font-medium text-paper">{new Date(d.date).toLocaleDateString("tr-TR", { day: "numeric", month: "long" })}</p>
                <p className="text-mist">{d.count} oturum</p>
              </Tip>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-haze">
        <span>{days[0] && new Date(days[0].date).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}</span>
        <span>Bugün</span>
      </div>
    </div>
  );
}

/**
 * Tekrar bloklarına göre performans: zamanla dikkat düşüşünü (vigilance decrement) gösterir.
 * Tepki süresi ve isabet oranı farklı ölçeklerde olduğu için iki ayrı küçük grafik çizilir.
 */
export function BlockTrend({ blocks }: { blocks: { block: number; hitRate: number; meanRt: number | null }[] }) {
  if (blocks.length < 2) return <p className="text-[13px] text-haze">Blok eğilimi için en az iki tekrar gerekir.</p>;
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const rtChange = first.meanRt != null && last.meanRt != null ? last.meanRt - first.meanRt : null;
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <div className="mb-2 flex items-baseline justify-between text-[13px]">
          <span className="text-mist">Ortalama tepki</span>
          {rtChange != null && <span className={rtChange > 0 ? "text-warn" : "text-success"}>{rtChange > 0 ? "+" : ""}{fmt.ms(rtChange)} ilk bloktan son bloğa</span>}
        </div>
        <TrendLine height={90} color="var(--color-av)" points={blocks.map((b) => ({ label: `Blok ${b.block}`, value: b.meanRt }))} format={(v) => fmt.ms(v)} />
        <div className="mt-1 flex justify-between text-[11px] text-haze">
          <span>Blok {first.block}</span>
          <span>Blok {last.block}</span>
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-baseline justify-between text-[13px]">
          <span className="text-mist">İsabet oranı</span>
          <span className="text-haze">
            {fmt.percent(first.hitRate)} → {fmt.percent(last.hitRate)}
          </span>
        </div>
        <TrendLine height={90} color="var(--color-audio)" points={blocks.map((b) => ({ label: `Blok ${b.block}`, value: b.hitRate }))} format={(v) => fmt.percent(v)} />
        <div className="mt-1 flex justify-between text-[11px] text-haze">
          <span>Blok {first.block}</span>
          <span>Blok {last.block}</span>
        </div>
      </div>
    </div>
  );
}

/** Tek serili eğilim çizgisi; üzerine gelinen noktanın değeri gösterilir. */
export function TrendLine({ points, format, height = 64, color = "var(--color-paper)" }: { points: { label: string; value: number | null }[]; format: (v: number) => string; height?: number; color?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  const valid = points.map((p, i) => ({ ...p, i })).filter((p): p is { label: string; value: number; i: number } => p.value != null);
  if (valid.length < 2) return <p className="text-[12px] text-haze">Eğilim için en az iki oturum gerekir.</p>;
  const values = valid.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = hi - lo || 1;
  const n = points.length - 1 || 1;
  const xy = valid.map((p) => ({ x: (p.i / n) * 100, y: 8 + (1 - (p.value - lo) / range) * 84, p }));
  const path = xy.map((c, k) => `${k === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  const h = hover == null ? null : xy.find((c) => c.p.i === hover) ?? null;

  return (
    <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
      {/* Çizgi soldan sağa açılan bir kırpma maskesiyle belirir; pathLength animasyonu ölçeklenmeyen konturla kesik görünür. */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <defs>
          <clipPath id={clipId}>
            <motion.rect x={-2} y={-10} height={120} initial={{ width: 0 }} animate={{ width: 104 }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
          </clipPath>
        </defs>
        <path d={path} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${clipId})`} />
      </svg>
      <div className="absolute inset-0 flex">
        {points.map((_, i) => (
          <div key={i} className="h-full flex-1" onMouseEnter={() => setHover(i)} />
        ))}
      </div>
      {h && (
        <>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-paper/30" style={{ left: `${h.x}%` }} />
          <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-900" style={{ left: `${h.x}%`, top: `${h.y}%`, background: color }} />
          <Tip x={`clamp(60px, ${h.x}%, calc(100% - 60px))`}>
            <p className="font-medium text-paper">{format(h.p.value)}</p>
            <p className="text-mist">{h.p.label}</p>
          </Tip>
        </>
      )}
    </div>
  );
}
