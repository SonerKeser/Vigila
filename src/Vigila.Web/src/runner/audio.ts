export interface PlayingSound {
  /** Sesin hoparlörden çıkacağı an, performance.now() zaman tabanında (ms). */
  onset: number;
  stop(): void;
}

/**
 * Uyaran seslerini Web Audio ile çalar. HTMLAudioElement'in aksine çalma anı örnek düzeyinde
 * bilinir ve getOutputTimestamp() ile klavye olaylarının zaman tabanına çevrilebilir.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly active = new Set<AudioBufferSourceNode>();

  constructor(volume = 1) {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.master.gain.value = volume;
    this.master.connect(this.ctx.destination);
  }

  resume(): Promise<void> {
    return this.ctx.state === "suspended" ? this.ctx.resume() : Promise.resolve();
  }

  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  set volume(v: number) {
    this.master.gain.value = v;
  }

  /** Sesi hemen başlatır; maxMs dolunca 12 ms'lik yumuşak kısma ile keser (tık sesi olmasın diye). */
  play(buffer: AudioBuffer, maxMs: number): PlayingSound {
    return this.playAt(buffer, maxMs, this.ctx.currentTime);
  }

  /** Sesi bağlam zamanında verilen anda başlatır (ileriye zamanlama). Geçmiş bir an verilirse hemen başlar. */
  playAt(buffer: AudioBuffer, maxMs: number, when: number): PlayingSound {
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buffer;
    src.connect(gain).connect(this.master);

    const t0 = Math.max(when, this.ctx.currentTime);
    src.start(t0);
    const end = t0 + maxMs / 1000;
    if (buffer.duration > maxMs / 1000) {
      gain.gain.setValueAtTime(1, Math.max(t0, end - 0.012));
      gain.gain.linearRampToValueAtTime(0, end);
      src.stop(end + 0.005);
    }
    this.active.add(src);
    src.onended = () => this.active.delete(src);

    return {
      onset: this.toPerformanceTime(t0),
      stop: () => {
        try {
          const now = this.ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.01);
          src.stop(now + 0.012);
        } catch {
          /* zaten durmuş */
        }
      },
    };
  }

  /** Katılımcının ses düzeyini ayarlayabilmesi için kısa bir deneme tonu. */
  tone(frequency = 880, ms = 220) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = frequency;
    osc.connect(gain).connect(this.master);
    const t0 = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.4, t0 + 0.01);
    gain.gain.setValueAtTime(0.4, t0 + ms / 1000 - 0.03);
    gain.gain.linearRampToValueAtTime(0, t0 + ms / 1000);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.01);
  }

  /**
   * AudioContext zamanını performance zamanına çevirir. getOutputTimestamp, cihazdan o anda çıkan örneğin
   * bağlam zamanını ve çıkış anını verir; aradaki fark çıkış gecikmesini de kapsar.
   */
  toPerformanceTime(contextTime: number): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.performanceTime && ts.contextTime) {
      return ts.performanceTime + (contextTime - ts.contextTime) * 1000;
    }
    const latency = (this.ctx.outputLatency || this.ctx.baseLatency || 0) * 1000;
    return performance.now() + (contextTime - this.ctx.currentTime) * 1000 + latency;
  }

  /** performance zamanındaki bir anda hoparlörden ses çıkması için gereken bağlam zamanı (toPerformanceTime'ın tersi). */
  contextTimeFor(performanceTime: number): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.performanceTime && ts.contextTime) return ts.contextTime + (performanceTime - ts.performanceTime) / 1000;
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return this.ctx.currentTime + (performanceTime - performance.now()) / 1000 - latency;
  }

  get latency() {
    return {
      outputMs: this.ctx.outputLatency ? this.ctx.outputLatency * 1000 : null,
      baseMs: this.ctx.baseLatency ? this.ctx.baseLatency * 1000 : null,
    };
  }

  stopAll() {
    for (const src of this.active) {
      try {
        src.stop();
      } catch {
        /* zaten durmuş */
      }
    }
    this.active.clear();
  }

  close() {
    this.stopAll();
    void this.ctx.close();
  }
}
