import { clsx } from "clsx";
import { motion } from "motion/react";
import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { clock, fmt, kindColor, kindLabel, outcomeLabel } from "../lib/format";
import type { StimulusKind, TrialOutcome } from "../lib/types";

export interface TimelineItem {
  index: number;
  kind: StimulusKind;
  onsetMs: number;
  durationMs: number;
  outcome?: TrialOutcome;
  rtMs?: number | null;
  label?: string;
}

export interface TimelineResponse {
  mediaMs: number;
  falseAlarm: boolean;
}

interface TimelineProps {
  durationMs: number;
  items: TimelineItem[];
  windowMs?: number;
  leadInMs?: number;
  tailMs?: number;
  responses?: TimelineResponse[];
  playheadMs?: number | null;
  activeIndices?: ReadonlySet<number>;
  highlight?: number | null;
  onHover?: (index: number | null) => void;
  onSeek?: (ms: number) => void;
  className?: string;
}

const ZOOMS = [1, 2, 4, 8, 16];
const TICK_STEPS = [1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_200_000];

type Track = "visual" | "audio";

const onTrack = (kind: StimulusKind, track: Track) => kind === "audiovisual" || (track === "visual" ? kind === "visual" : kind === "auditory");

/**
 * Uyaranları kurgu yazılımlarındaki gibi izler üzerinde gösterir.
 * Görsel-işitsel uyaranlar iki izde de aynı anda görünür. Sonuç ekranında isabetler dolu,
 * kaçırılanlar kesik çizgili çizilir; yanıt izinde tepki süresi uyaran başlangıcından basışa uzanan çubuktur.
 */
export function Timeline({ durationMs, items, windowMs, leadInMs = 0, tailMs = 0, responses, playheadMs, activeIndices, highlight, onHover, onSeek, className }: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(800);
  const [hovered, setHovered] = useState<number | null>(null);
  const animated = items.length <= 300;
  const showResponses = responses !== undefined;
  const duration = Math.max(1, durationMs);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / duration) * 100))}%`;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const ticks = useMemo(() => {
    const inner = width * zoom;
    const step = TICK_STEPS.find((s) => (inner / duration) * s >= 72) ?? TICK_STEPS.at(-1)!;
    const list: number[] = [];
    for (let t = 0; t <= duration; t += step) list.push(t);
    return list;
  }, [width, zoom, duration]);

  // Yakınlaştırılmışken oynatma başı görünür alanın dışına çıkarsa kaydır.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || playheadMs == null || zoom === 1) return;
    const x = (playheadMs / duration) * el.scrollWidth;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth * 0.85) el.scrollTo({ left: x - el.clientWidth * 0.2 });
  }, [playheadMs, zoom, duration]);

  const seekFrom = (e: MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration)));
  };

  const setHover = (index: number | null) => {
    setHovered(index);
    onHover?.(index);
  };

  const hoveredItem = hovered == null ? null : items.find((i) => i.index === hovered);
  const focus = highlight ?? hovered;

  const block = (item: TimelineItem, track: Track, order: number) => {
    const color = kindColor[item.kind];
    const missed = item.outcome === "miss";
    const early = item.outcome === "anticipation";
    const absent = item.outcome === "notPresented";
    const isActive = activeIndices?.has(item.index);
    const isFocus = focus === item.index;
    const style = {
      left: pct(item.onsetMs),
      width: `max(4px, ${(item.durationMs / duration) * 100}%)`,
    };
    const key = `${track}-${item.index}`;
    const common = {
      onMouseEnter: () => setHover(item.index),
      onMouseLeave: () => setHover(null),
      className: clsx(
        "absolute top-1.5 bottom-1.5 rounded-[4px] border transition-[box-shadow,opacity] duration-150",
        isFocus && "z-10",
        absent && "opacity-35",
      ),
      "aria-label": `${kindLabel[item.kind]} uyaran ${item.index + 1}, ${clock(item.onsetMs, true)}`,
    };
    const visual = {
      backgroundColor: missed || early || absent ? "transparent" : color,
      borderColor: missed ? "var(--color-warn)" : early ? "var(--color-warn)" : color,
      borderStyle: missed || absent ? "dashed" : "solid",
      boxShadow: isActive || isFocus ? `0 0 0 2px var(--color-paper), 0 0 18px ${color}` : undefined,
    } as const;

    if (!animated) return <div key={key} {...common} style={{ ...style, ...visual }} />;
    return (
      <motion.div
        key={key}
        {...common}
        initial={{ opacity: 0, scaleY: 0.2, left: style.left }}
        animate={{ opacity: absent ? 0.35 : 1, scaleY: 1, left: style.left, width: style.width }}
        transition={{ type: "spring", stiffness: 260, damping: 30, delay: Math.min(order * 0.006, 0.5) }}
        style={visual}
      />
    );
  };

  return (
    <div className={clsx("panel overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-mist">
          {(["visual", "auditory", "audiovisual"] as StimulusKind[])
            .filter((k) => items.some((i) => i.kind === k))
            .map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: kindColor[k] }} />
                {kindLabel[k]}
              </span>
            ))}
          {showResponses && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-0.5 rounded bg-paper" />
                Tepki
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rotate-45 bg-warn" />
                Yanlış alarm
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Uzaklaştır"
            disabled={zoom === ZOOMS[0]}
            onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}
            className="grid size-7 place-items-center rounded-md text-mist hover:bg-ink-700 hover:text-paper disabled:opacity-30"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="w-9 text-center text-[12px] tabular-nums text-mist">{zoom}×</span>
          <button
            type="button"
            aria-label="Yakınlaştır"
            disabled={zoom === ZOOMS.at(-1)}
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}
            className="grid size-7 place-items-center rounded-md text-mist hover:bg-ink-700 hover:text-paper disabled:opacity-30"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex">
        <div className="w-[76px] shrink-0 border-r border-line pt-7 text-[12px] text-haze">
          <div className="flex h-11 items-center px-3">Görsel</div>
          <div className="flex h-11 items-center border-t border-line px-3">İşitsel</div>
          {showResponses && <div className="flex h-11 items-center border-t border-line px-3">Yanıt</div>}
        </div>

        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative" style={{ width: `${zoom * 100}%` }}>
            {/* Cetvel */}
            <div className={clsx("relative h-7 border-b border-line", onSeek && "cursor-pointer")} onClick={seekFrom}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full" style={{ left: pct(t) }}>
                  <div className="h-1.5 w-px bg-line-strong" />
                  <span className="absolute top-1.5 left-1 text-[10.5px] whitespace-nowrap text-haze tabular-nums">{clock(t)}</span>
                </div>
              ))}
            </div>

            <div className={clsx("relative", onSeek && "cursor-crosshair")} onClick={seekFrom}>
              {/* Uyaran konmayan başlangıç ve bitiş bölgeleri */}
              {leadInMs > 0 && <div className="hatch absolute inset-y-0 left-0" style={{ width: pct(leadInMs) }} />}
              {tailMs > 0 && <div className="hatch absolute inset-y-0 right-0" style={{ width: pct(tailMs) }} />}
              {ticks.map((t) => (
                <div key={t} className="absolute inset-y-0 w-px bg-line/60" style={{ left: pct(t) }} />
              ))}

              {(["visual", "audio"] as Track[]).map((track, ti) => (
                <div key={track} className={clsx("relative h-11", ti > 0 && "border-t border-line")}>
                  {windowMs != null &&
                    items
                      .filter((i) => onTrack(i.kind, track))
                      .map((i) => (
                        <div
                          key={`w-${track}-${i.index}`}
                          className="absolute top-3.5 bottom-3.5 rounded-r-[3px]"
                          style={{ left: pct(i.onsetMs), width: `${(Math.max(windowMs, i.durationMs) / duration) * 100}%`, background: kindColor[i.kind], opacity: 0.14 }}
                        />
                      ))}
                  {items.filter((i) => onTrack(i.kind, track)).map((i, order) => block(i, track, order))}
                </div>
              ))}

              {showResponses && (
                <div className="relative h-11 border-t border-line">
                  {items
                    .filter((i) => i.rtMs != null && i.outcome !== "notPresented")
                    .map((i) => (
                      <div key={`rt-${i.index}`} className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ left: pct(i.onsetMs), width: `${(i.rtMs! / duration) * 100}%`, background: kindColor[i.kind], opacity: 0.8 }}>
                        <span className="absolute -top-[5px] -right-px h-[13px] w-0.5 rounded bg-paper" />
                      </div>
                    ))}
                  {responses!
                    .filter((r) => r.falseAlarm)
                    .map((r, k) => (
                      <span key={`fa-${k}`} title={`Yanlış alarm ${clock(r.mediaMs, true)}`} className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-warn" style={{ left: pct(r.mediaMs) }} />
                    ))}
                </div>
              )}

              {playheadMs != null && (
                <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-paper" style={{ left: pct(playheadMs) }}>
                  <span className="absolute -top-1 -left-[3px] size-[7px] rounded-full bg-paper" />
                </div>
              )}
            </div>

            {hoveredItem && (
              <div
                className="pointer-events-none absolute top-8 z-30 -translate-x-1/2 rounded-lg border border-line-strong bg-ink-950/95 px-3 py-2 text-[12px] leading-relaxed shadow-xl backdrop-blur"
                style={{ left: `clamp(90px, ${pct(hoveredItem.onsetMs + hoveredItem.durationMs / 2)}, calc(100% - 90px))` }}
              >
                <p className="font-medium text-paper">
                  {hoveredItem.label ?? `Uyaran ${hoveredItem.index + 1}`}, {kindLabel[hoveredItem.kind].toLocaleLowerCase("tr")}
                </p>
                <p className="text-mist">
                  {clock(hoveredItem.onsetMs, true)} başlangıç, {fmt.seconds(hoveredItem.durationMs)}
                </p>
                {hoveredItem.outcome && (
                  <p className={hoveredItem.outcome === "hit" ? "text-success" : "text-warn"}>
                    {outcomeLabel[hoveredItem.outcome]}
                    {hoveredItem.rtMs != null && `, ${fmt.ms(hoveredItem.rtMs)}`}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
