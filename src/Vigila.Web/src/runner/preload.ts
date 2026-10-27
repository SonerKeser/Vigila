import type { ClientInfo, RunPayload } from "../lib/types";
import type { AudioEngine } from "./audio";

/** Bu boyutun altındaki videolar tamamen belleğe indirilir; deney sırasında ağ takılması olmaz. */
const FULL_DOWNLOAD_LIMIT = 1.5 * 1024 ** 3;

export async function fetchBlob(url: string, onBytes?: (delta: number) => void, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error("Deney dosyalarından biri indirilemedi.");
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    onBytes?.(value.byteLength);
  }
  return new Blob(chunks, { type: res.headers.get("Content-Type") ?? "" });
}

export interface PreparedRun {
  videoSrc: string;
  streamed: boolean;
  imageUrls: Map<string, string>;
  buffers: Map<string, AudioBuffer>;
  release(): void;
}

/**
 * Deneyden önce tüm dosyaları indirir: görseller çözülür (img.decode), sesler AudioBuffer'a dönüştürülür.
 * Böylece uyaran anında hiçbir indirme ya da çözme gecikmesi yaşanmaz.
 */
export async function prepareRun(payload: RunPayload, audio: AudioEngine, onProgress: (fraction: number, label: string) => void, signal?: AbortSignal): Promise<PreparedRun> {
  const streamed = payload.video.sizeBytes > FULL_DOWNLOAD_LIMIT;
  const total = (streamed ? 0 : payload.video.sizeBytes) + payload.images.reduce((a, i) => a + i.sizeBytes, 0) + payload.audios.reduce((a, i) => a + i.sizeBytes, 0);
  let loaded = 0;
  const objectUrls: string[] = [];
  const keepAlive: HTMLImageElement[] = [];
  const bump = (label: string) => (delta: number) => {
    loaded += delta;
    onProgress(total > 0 ? Math.min(1, loaded / total) : 1, label);
  };

  try {
    const imageUrls = new Map<string, string>();
    for (const image of payload.images) {
      const blob = await fetchBlob(image.url, bump("Görseller hazırlanıyor"), signal);
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      const el = new Image();
      el.src = url;
      await el.decode().catch(() => undefined);
      keepAlive.push(el);
      imageUrls.set(image.id, url);
    }

    const buffers = new Map<string, AudioBuffer>();
    for (const sound of payload.audios) {
      const blob = await fetchBlob(sound.url, bump("Sesler hazırlanıyor"), signal);
      buffers.set(sound.id, await audio.decode(await blob.arrayBuffer()));
    }

    let videoSrc = payload.video.url;
    if (!streamed) {
      const blob = await fetchBlob(payload.video.url, bump("Video indiriliyor"), signal);
      videoSrc = URL.createObjectURL(blob);
      objectUrls.push(videoSrc);
    }

    onProgress(1, "Hazır");
    return {
      videoSrc,
      streamed,
      imageUrls,
      buffers,
      release: () => {
        objectUrls.forEach((u) => URL.revokeObjectURL(u));
        keepAlive.length = 0;
      },
    };
  } catch (e) {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    throw e;
  }
}

/** Ekran yenileme hızını requestAnimationFrame aralıklarının ortancasından kestirir. */
export function measureRefreshRate(frames = 72): Promise<number | null> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let last = 0;
    const step = (t: number) => {
      if (last) deltas.push(t - last);
      last = t;
      if (deltas.length < frames) requestAnimationFrame(step);
      else {
        const sorted = deltas.sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        resolve(median > 0 ? Math.round((1000 / median) * 10) / 10 : null);
      }
    };
    requestAnimationFrame(step);
    setTimeout(() => resolve(null), 4000);
  });
}

export function clientInfo(extra: Partial<ClientInfo> = {}): ClientInfo {
  return {
    userAgent: navigator.userAgent,
    screenWidth: screen.width,
    screenHeight: screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
    refreshRateHz: null,
    audioOutputLatencyMs: null,
    audioBaseLatencyMs: null,
    videoFrameCallback: "requestVideoFrameCallback" in HTMLVideoElement.prototype,
    fullscreen: !!document.fullscreenElement,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    ...extra,
  };
}
