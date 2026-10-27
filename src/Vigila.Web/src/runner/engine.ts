import type { Interruption, ResponseEvent, ScheduledStimulus, StimulusPresentation } from "../lib/types";
import type { AudioEngine, PlayingSound } from "./audio";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** object-fit: contain ile yerleşen videonun kap içindeki gerçek görüntü alanı. */
export function fitContain(containerW: number, containerH: number, videoW: number, videoH: number): Rect {
  if (containerW <= 0 || containerH <= 0 || videoW <= 0 || videoH <= 0) return { left: 0, top: 0, width: containerW, height: containerH };
  const scale = Math.min(containerW / videoW, containerH / videoH);
  const width = videoW * scale;
  const height = videoH * scale;
  return { left: (containerW - width) / 2, top: (containerH - height) / 2, width, height };
}

export interface StimulusChange {
  index: number;
  action: "show" | "hide" | "skip";
}

type State = "pending" | "shown" | "done";

/**
 * Video zamanına bakarak hangi uyaranın görünmesi ya da gizlenmesi gerektiğine karar veren saf durum makinesi.
 * DOM'a dokunmaz; bu sayede birim testleriyle doğrulanabilir.
 */
export class StimulusClock {
  private readonly sorted: ScheduledStimulus[];
  private readonly state: State[];
  private next = 0;

  constructor(stimuli: ScheduledStimulus[]) {
    this.sorted = [...stimuli].sort((a, b) => a.onsetMs - b.onsetMs);
    this.state = this.sorted.map(() => "pending");
  }

  advance(mediaMs: number): StimulusChange[] {
    const changes: StimulusChange[] = [];
    for (let i = this.next; i < this.sorted.length; i++) {
      const s = this.sorted[i];
      if (s.onsetMs > mediaMs) break;
      const end = s.onsetMs + s.durationMs;
      if (this.state[i] === "pending") {
        if (mediaMs < end) {
          this.state[i] = "shown";
          changes.push({ index: s.index, action: "show" });
        } else {
          this.state[i] = "done";
          changes.push({ index: s.index, action: "skip" });
        }
      } else if (this.state[i] === "shown" && mediaMs >= end) {
        this.state[i] = "done";
        changes.push({ index: s.index, action: "hide" });
      }
    }
    while (this.next < this.sorted.length && this.state[this.next] === "done") this.next++;
    return changes;
  }

  /** Henüz başlamamış ve başlangıcı verilen ufuk içindeki uyaranlar (sesin önceden zamanlanması için). */
  upcoming(mediaMs: number, horizonMs: number): ScheduledStimulus[] {
    const list: ScheduledStimulus[] = [];
    for (let i = this.next; i < this.sorted.length; i++) {
      const s = this.sorted[i];
      if (s.onsetMs > mediaMs + horizonMs) break;
      if (this.state[i] === "pending" && s.onsetMs > mediaMs) list.push(s);
    }
    return list;
  }

  /** Görünür uyaranları kesintiye uğramış sayıp kapatır; dizinlerini döndürür. */
  interruptVisible(): number[] {
    const closed: number[] = [];
    this.state.forEach((st, i) => {
      if (st === "shown") {
        this.state[i] = "done";
        closed.push(this.sorted[i].index);
      }
    });
    return closed;
  }

  /** Ön izlemede sarma: durumu verilen zamana göre yeniden kurar, görünürlük farklarını döndürür. */
  seek(mediaMs: number): StimulusChange[] {
    const changes: StimulusChange[] = [];
    this.sorted.forEach((s, i) => {
      const end = s.onsetMs + s.durationMs;
      const desired: State = mediaMs < s.onsetMs ? "pending" : mediaMs < end ? "shown" : "done";
      if (desired === "shown" && this.state[i] !== "shown") changes.push({ index: s.index, action: "show" });
      if (desired !== "shown" && this.state[i] === "shown") changes.push({ index: s.index, action: "hide" });
      this.state[i] = desired;
    });
    this.next = this.state.findIndex((st) => st !== "done");
    if (this.next < 0) this.next = this.sorted.length;
    return changes;
  }
}

export interface EngineOptions {
  video: HTMLVideoElement;
  layer: HTMLElement;
  stimuli: ScheduledStimulus[];
  imageUrls: Map<string, string>;
  audio: AudioEngine | null;
  buffers: Map<string, AudioBuffer>;
  /** false: araştırmacı ön izlemesi (kesinti ve tuş kaydı yapılmaz). */
  record: boolean;
  responseKey?: string | null;
  /** Dokunma ve fare tıklamaları da yanıt sayılsın mı? Klavye yanıtı için responseKey verilir. */
  pointer?: boolean;
  allowPause?: boolean;
  onInterrupt?: (reason: Interruption["reason"]) => void;
  onResponse?: (response: ResponseEvent) => void;
  onTick?: (mediaMs: number) => void;
  onStimulus?: (index: number, visible: boolean) => void;
  onEnded?: () => void;
}

export interface EngineData {
  presentations: StimulusPresentation[];
  responses: ResponseEvent[];
  interruptions: Interruption[];
  observedDurationMs: number;
}

/**
 * Deney sırasında uyaranları videonun üstünde sunar ve zamanlamayı kaydeder.
 *
 * Zaman tabanı: tüm kayıtlar performance.now() tabanındadır. Görsel başlangıcı, requestVideoFrameCallback'in
 * verdiği expectedDisplayTime'dır (uyaran, o video karesiyle aynı ekran yenilemesinde görünür). Ses başlangıcı,
 * AudioContext'in çıkış zaman damgasından hesaplanır. Tuş basışları KeyboardEvent.timeStamp ile alınır.
 * Böylece tepki süresi, ağ ve React çizim gecikmelerinden bağımsız ölçülür.
 */
export class TrialEngine {
  private readonly clock: StimulusClock;
  private readonly byIndex: Map<number, ScheduledStimulus>;
  private readonly elements = new Map<number, HTMLElement>();
  private readonly sounds = new Map<number, PlayingSound>();
  /** Çıkış gecikmesi telafisi için önceden zamanlanmış, henüz gösterim anı gelmemiş sesler. */
  private readonly scheduled = new Map<number, PlayingSound>();
  private readonly presentations = new Map<number, StimulusPresentation>();
  private readonly responses: ResponseEvent[] = [];
  private readonly interruptions: Interruption[] = [];
  private frameHandle = 0;
  private rafHandle = 0;
  /** Videonun kare süresi (ms); requestVideoFrameCallback verilerinden ölçülür, ses kareye hizalanırken kullanılır. */
  private frameMs = 0;
  private lastFrame: { mediaMs: number; presented: number } | null = null;
  private running = false;
  private paused = false;
  private buffering: Interruption | null = null;
  readonly usesFrameCallback: boolean;

  constructor(private readonly o: EngineOptions) {
    this.clock = new StimulusClock(o.stimuli);
    this.byIndex = new Map(o.stimuli.map((s) => [s.index, s]));
    this.usesFrameCallback = typeof o.video.requestVideoFrameCallback === "function";
  }

  attach() {
    for (const s of this.o.stimuli) {
      if (!s.box || !s.imageId) continue;
      const img = document.createElement("img");
      img.src = this.o.imageUrls.get(s.imageId) ?? "";
      img.alt = "";
      img.draggable = false;
      Object.assign(img.style, {
        position: "absolute",
        left: `${s.box.x * 100}%`,
        top: `${s.box.y * 100}%`,
        width: `${s.box.w * 100}%`,
        height: `${s.box.h * 100}%`,
        objectFit: "contain",
        visibility: "hidden",
        pointerEvents: "none",
        userSelect: "none",
      } satisfies Partial<CSSStyleDeclaration>);
      img.dataset.index = String(s.index);
      this.o.layer.appendChild(img);
      this.elements.set(s.index, img);
    }

    const v = this.o.video;
    v.addEventListener("play", this.onPlay);
    v.addEventListener("ended", this.onEnded);
    v.addEventListener("seeked", this.onSeeked);
    v.addEventListener("waiting", this.onWaiting);
    v.addEventListener("playing", this.onPlaying);
    window.addEventListener("keydown", this.onKey, { capture: true });
    if (this.o.pointer) window.addEventListener("pointerdown", this.onPointer, { capture: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    document.addEventListener("fullscreenchange", this.onFullscreen);
    if (!v.paused) this.startLoop();
  }

  detach() {
    this.running = false;
    if (this.frameHandle) this.o.video.cancelVideoFrameCallback?.(this.frameHandle);
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    const v = this.o.video;
    v.removeEventListener("play", this.onPlay);
    v.removeEventListener("ended", this.onEnded);
    v.removeEventListener("seeked", this.onSeeked);
    v.removeEventListener("waiting", this.onWaiting);
    v.removeEventListener("playing", this.onPlaying);
    window.removeEventListener("keydown", this.onKey, { capture: true });
    window.removeEventListener("pointerdown", this.onPointer, { capture: true });
    document.removeEventListener("visibilitychange", this.onVisibility);
    document.removeEventListener("fullscreenchange", this.onFullscreen);
    for (const el of this.elements.values()) el.remove();
    this.elements.clear();
    for (const s of this.sounds.values()) s.stop();
    this.sounds.clear();
    this.cancelScheduled();
  }

  private cancelScheduled() {
    for (const s of this.scheduled.values()) s.stop();
    this.scheduled.clear();
  }

  get isPaused() {
    return this.paused;
  }

  data(): EngineData {
    return {
      presentations: [...this.presentations.values()].sort((a, b) => a.index - b.index),
      responses: [...this.responses],
      interruptions: [...this.interruptions],
      observedDurationMs: Math.round(this.o.video.currentTime * 1000),
    };
  }

  /** Katılımcı duraklattığında, sekme değiştirdiğinde ya da tam ekrandan çıktığında çağrılır. */
  interrupt(reason: Interruption["reason"]) {
    if (this.paused) return;
    this.paused = true;
    const now = performance.now();
    this.interruptions.push({ reason, atMediaMs: Math.round(this.o.video.currentTime * 1000), atTime: now, resumedAt: null });
    this.o.video.pause();
    this.cancelScheduled();
    for (const index of this.clock.interruptVisible()) {
      this.setVisible(index, false);
      this.sounds.get(index)?.stop();
      const p = this.presentations.get(index);
      if (p) {
        p.interrupted = true;
        p.offset = now;
      }
    }
    this.o.onInterrupt?.(reason);
  }

  async resume() {
    if (!this.paused) return;
    this.paused = false;
    const last = this.interruptions.at(-1);
    if (last && last.resumedAt == null) last.resumedAt = performance.now();
    await this.o.video.play();
  }

  /** Yalnız ön izlemede: videoyu verilen zamana sarar. */
  seek(mediaMs: number) {
    if (this.o.record) return;
    this.o.video.currentTime = mediaMs / 1000;
  }

  private startLoop() {
    if (this.running) return;
    this.running = true;
    this.scheduleFrame();
  }

  private scheduleFrame() {
    if (!this.running) return;
    if (this.usesFrameCallback) this.frameHandle = this.o.video.requestVideoFrameCallback(this.onFrame);
    else this.rafHandle = requestAnimationFrame(this.onAnimationFrame);
  }

  private readonly onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
    const mediaMs = meta.mediaTime * 1000;
    const last = this.lastFrame;
    if (last && meta.presentedFrames > last.presented) {
      // Atlanan kareler ortalamayı bozmasın diye fark, arada sunulan kare sayısına bölünür.
      const perFrame = (mediaMs - last.mediaMs) / (meta.presentedFrames - last.presented);
      if (perFrame > 4 && perFrame < 100) this.frameMs = this.frameMs ? this.frameMs * 0.9 + perFrame * 0.1 : perFrame;
    }
    this.lastFrame = { mediaMs, presented: meta.presentedFrames };
    this.tick(mediaMs, meta.expectedDisplayTime);
    this.scheduleFrame();
  };

  private readonly onAnimationFrame = (now: number) => {
    if (!this.o.video.paused) this.tick(this.o.video.currentTime * 1000, now);
    this.scheduleFrame();
  };

  private tick(mediaMs: number, displayAt: number) {
    for (const change of this.clock.advance(mediaMs)) {
      const s = this.byIndex.get(change.index)!;
      if (change.action === "show") this.show(s, mediaMs, displayAt);
      else if (change.action === "hide") this.hide(s, displayAt);
      else {
        this.scheduled.get(s.index)?.stop();
        this.scheduled.delete(s.index);
      }
    }
    this.scheduleAhead(mediaMs, displayAt);
    this.o.onTick?.(mediaMs);
  }

  /**
   * Ses kartının çıkış gecikmesi (genelde 10-50 ms, Bluetooth'ta daha fazla) yüzünden "şimdi" başlatılan ses geç duyulur.
   * Yaklaşan uyaranların sesi önceden zamanlanır: hedef, görselin belireceği video karesinin ekrana geleceği andır
   * (görsel, başlangıç zamanını geçen ilk karede görünür). Böylece görsel-işitsel uyaranlarda görüntü ve ses aynı anda algılanır.
   */
  private scheduleAhead(mediaMs: number, displayAt: number) {
    const audio = this.o.audio;
    if (!audio || this.paused || this.o.video.playbackRate !== 1) return;
    const horizon = Math.max(150, (audio.latency.outputMs ?? 0) + 80);
    for (const s of this.clock.upcoming(mediaMs, horizon)) {
      if (!s.audioId || this.scheduled.has(s.index)) continue;
      const buffer = this.o.buffers.get(s.audioId);
      if (!buffer) continue;
      const frameOnset = this.frameMs > 0 ? mediaMs + Math.ceil((s.onsetMs - mediaMs) / this.frameMs - 1e-6) * this.frameMs : s.onsetMs;
      const when = audio.contextTimeFor(displayAt + (frameOnset - mediaMs));
      if (when <= audio.ctx.currentTime + 0.003) continue;
      this.scheduled.set(s.index, audio.playAt(buffer, s.durationMs, when));
    }
  }

  private show(s: ScheduledStimulus, mediaMs: number, displayAt: number) {
    const visual = this.setVisible(s.index, true);
    let audioOnset: number | null = null;
    if (s.audioId && this.o.audio) {
      const ahead = this.scheduled.get(s.index);
      const buffer = this.o.buffers.get(s.audioId);
      if (ahead) {
        this.scheduled.delete(s.index);
        this.sounds.set(s.index, ahead);
        audioOnset = ahead.onset;
      } else if (buffer) {
        const sound = this.o.audio.play(buffer, s.durationMs);
        this.sounds.set(s.index, sound);
        audioOnset = sound.onset;
      }
    }
    this.presentations.set(s.index, {
      index: s.index,
      visualOnset: visual ? round(displayAt) : null,
      audioOnset: audioOnset == null ? null : round(audioOnset),
      offset: null,
      mediaOnsetMs: round(mediaMs),
      interrupted: false,
    });
    this.o.onStimulus?.(s.index, true);
  }

  private hide(s: ScheduledStimulus, displayAt: number) {
    this.setVisible(s.index, false);
    this.sounds.delete(s.index);
    const p = this.presentations.get(s.index);
    if (p) p.offset = round(displayAt);
    this.o.onStimulus?.(s.index, false);
  }

  private setVisible(index: number, visible: boolean): boolean {
    const el = this.elements.get(index);
    if (!el) return false;
    el.style.visibility = visible ? "visible" : "hidden";
    return true;
  }

  private readonly onPlay = () => this.startLoop();

  private readonly onEnded = () => {
    this.running = false;
    for (const index of this.clock.interruptVisible()) this.setVisible(index, false);
    this.o.onEnded?.();
  };

  private readonly onSeeked = () => {
    if (this.o.record) return;
    for (const s of this.sounds.values()) s.stop();
    this.sounds.clear();
    this.cancelScheduled();
    this.lastFrame = null;
    for (const change of this.clock.seek(this.o.video.currentTime * 1000)) {
      this.setVisible(change.index, change.action === "show");
      this.o.onStimulus?.(change.index, change.action === "show");
    }
    this.o.onTick?.(this.o.video.currentTime * 1000);
  };

  private readonly onWaiting = () => {
    if (!this.o.record || this.paused || this.buffering) return;
    this.buffering = { reason: "buffering", atMediaMs: Math.round(this.o.video.currentTime * 1000), atTime: performance.now(), resumedAt: null };
    this.interruptions.push(this.buffering);
  };

  private readonly onPlaying = () => {
    if (this.buffering) {
      this.buffering.resumedAt = performance.now();
      this.buffering = null;
    }
  };

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      if (this.o.record && this.o.allowPause && !this.paused) this.interrupt("pause");
      return;
    }
    if (!this.o.responseKey || e.code !== this.o.responseKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat || this.paused) return;
    this.respond(e.timeStamp, e.code);
  };

  /** Dokunma ya da fare tıklaması; birincil düğme dışındaki basışlar sayılmaz. */
  private readonly onPointer = (e: PointerEvent) => {
    if (this.paused || (e.pointerType === "mouse" && e.button !== 0)) return;
    if ((e.target as HTMLElement | null)?.closest?.("button")) return;
    this.respond(e.timeStamp, POINTER_KEY);
  };

  private respond(timeStamp: number, key: string) {
    const response: ResponseEvent = { time: round(timeStamp), mediaMs: round(this.o.video.currentTime * 1000), key };
    if (this.o.record) this.responses.push(response);
    this.o.onResponse?.(response);
  }

  private readonly onVisibility = () => {
    if (this.o.record && document.visibilityState === "hidden") this.interrupt("hidden");
  };

  private readonly onFullscreen = () => {
    if (this.o.record && !document.fullscreenElement && !this.o.video.ended) this.interrupt("fullscreen");
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Sunucudaki SessionScorer.PointerKey ile aynı olmalı. */
export const POINTER_KEY = "Pointer";
