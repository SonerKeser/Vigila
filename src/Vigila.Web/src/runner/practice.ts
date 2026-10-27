import type { PracticeResult, ScheduledStimulus } from "../lib/types";
import type { AudioEngine } from "./audio";
import { StimulusClock } from "./engine";

export interface PracticeFeedback {
  index: number;
  outcome: "hit" | "miss" | "early";
  rtMs: number | null;
}

interface PracticeOptions {
  layer: HTMLElement;
  stimuli: ScheduledStimulus[];
  durationMs: number;
  imageUrls: Map<string, string>;
  audio: AudioEngine | null;
  buffers: Map<string, AudioBuffer>;
  responseKey: string | null;
  pointer: boolean;
  windowMs: number;
  minValidRtMs: number;
  onFeedback: (f: PracticeFeedback) => void;
  onEnded: (r: PracticeResult) => void;
}

/**
 * Videosuz alıştırma: zaman, video yerine performance.now() ile ilerler. Uyaranlar asıl deneydeki gibi
 * sunulur; her yanıt penceresi kapanınca katılımcıya isabet bilgisi verilir. Sonuç yalnız özet olarak saklanır.
 */
export class PracticeEngine {
  private readonly clock: StimulusClock;
  private readonly byIndex: Map<number, ScheduledStimulus>;
  private readonly elements = new Map<number, HTMLElement>();
  private readonly onsets = new Map<number, number>();
  private readonly evaluated = new Set<number>();
  private readonly responses: number[] = [];
  private readonly rts: number[] = [];
  private hits = 0;
  private t0 = 0;
  private raf = 0;
  private done = false;

  constructor(private readonly o: PracticeOptions) {
    this.clock = new StimulusClock(o.stimuli);
    this.byIndex = new Map(o.stimuli.map((s) => [s.index, s]));
  }

  start() {
    for (const s of this.o.stimuli) {
      if (!s.box || !s.imageId) continue;
      const img = document.createElement("img");
      img.src = this.o.imageUrls.get(s.imageId) ?? "";
      img.alt = "";
      Object.assign(img.style, {
        position: "absolute",
        left: `${s.box.x * 100}%`,
        top: `${s.box.y * 100}%`,
        width: `${s.box.w * 100}%`,
        height: `${s.box.h * 100}%`,
        objectFit: "contain",
        visibility: "hidden",
        pointerEvents: "none",
      } satisfies Partial<CSSStyleDeclaration>);
      this.o.layer.appendChild(img);
      this.elements.set(s.index, img);
    }
    window.addEventListener("keydown", this.onKey, { capture: true });
    if (this.o.pointer) window.addEventListener("pointerdown", this.onPointer, { capture: true });
    this.raf = requestAnimationFrame((t) => {
      this.t0 = t;
      this.loop(t);
    });
  }

  stop() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKey, { capture: true });
    window.removeEventListener("pointerdown", this.onPointer, { capture: true });
    for (const el of this.elements.values()) el.remove();
    this.elements.clear();
  }

  private loop = (now: number) => {
    const t = now - this.t0;
    for (const change of this.clock.advance(t)) {
      const s = this.byIndex.get(change.index)!;
      const el = this.elements.get(s.index);
      if (change.action === "show") {
        if (el) el.style.visibility = "visible";
        let onset = now;
        if (s.audioId && this.o.audio) {
          const buffer = this.o.buffers.get(s.audioId);
          if (buffer) {
            const sound = this.o.audio.play(buffer, s.durationMs);
            onset = el ? Math.min(now, sound.onset) : sound.onset;
          }
        }
        this.onsets.set(s.index, onset);
      } else if (el) {
        el.style.visibility = "hidden";
      }
    }

    for (const [index, onset] of this.onsets) {
      if (this.evaluated.has(index)) continue;
      const s = this.byIndex.get(index)!;
      if (now < onset + Math.max(this.o.windowMs, s.durationMs)) continue;
      this.evaluated.add(index);
      const first = this.responses.find((r) => r >= onset && r <= onset + this.o.windowMs);
      if (first == null) this.o.onFeedback({ index, outcome: "miss", rtMs: null });
      else if (first - onset < this.o.minValidRtMs) this.o.onFeedback({ index, outcome: "early", rtMs: Math.round(first - onset) });
      else {
        this.hits++;
        this.rts.push(first - onset);
        this.o.onFeedback({ index, outcome: "hit", rtMs: Math.round(first - onset) });
      }
    }

    if (t >= this.o.durationMs && this.evaluated.size >= this.onsets.size && !this.done) {
      this.done = true;
      this.stop();
      const mean = this.rts.length ? this.rts.reduce((a, b) => a + b, 0) / this.rts.length : null;
      this.o.onEnded({ trials: this.o.stimuli.length, hits: this.hits, meanRt: mean == null ? null : Math.round(mean) });
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.o.responseKey || e.code !== this.o.responseKey) return;
    e.preventDefault();
    if (!e.repeat) this.responses.push(e.timeStamp);
  };

  private readonly onPointer = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest?.("button")) return;
    this.responses.push(e.timeStamp);
  };
}
