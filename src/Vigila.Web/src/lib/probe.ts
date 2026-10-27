import type { MediaKind } from "./types";

const extensions: Record<string, MediaKind> = {
  mp4: "video", m4v: "video", webm: "video", ogv: "video",
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", avif: "image",
  mp3: "audio", wav: "audio", ogg: "audio", oga: "audio", opus: "audio", m4a: "audio", aac: "audio", flac: "audio",
};

export const acceptAttribute = Object.keys(extensions).map((e) => `.${e}`).join(",");

export function kindOf(file: File): MediaKind | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return extensions[ext] ?? null;
}

export interface Probed {
  kind: MediaKind;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  peaks: number[] | null;
  poster: Blob | null;
}

/**
 * Dosyayı yüklemeden önce tarayıcıda açar: süre, boyut, video kapağı ve ses dalga biçimi çıkarılır.
 * Tarayıcının oynatamadığı dosya burada yakalanır; deney sırasında sürpriz yaşanmaz.
 */
export async function probe(file: File): Promise<Probed> {
  const kind = kindOf(file);
  if (!kind) throw new Error("Bu dosya türü desteklenmiyor.");
  if (kind === "image") return { kind, ...(await probeImage(file)), durationMs: null, peaks: null, poster: null };
  if (kind === "audio") return { kind, ...(await probeAudio(file)), width: null, height: null, poster: null };
  return { kind, ...(await probeVideo(file)), peaks: null };
}

async function probeImage(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    throw new Error("Görsel açılamadı; dosya bozuk olabilir.");
  }
}

async function probeAudio(file: File) {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    return { durationMs: Math.round(buffer.duration * 1000), peaks: peaksOf(buffer, 120) };
  } catch {
    throw new Error("Ses dosyası bu tarayıcıda çözülemedi.");
  } finally {
    void ctx.close();
  }
}

export function peaksOf(buffer: AudioBuffer, buckets: number): number[] {
  const data = buffer.getChannelData(0);
  const size = Math.max(1, Math.floor(data.length / buckets));
  const peaks: number[] = [];
  let max = 0;
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const end = Math.min(data.length, (b + 1) * size);
    for (let i = b * size; i < end; i += 4) peak = Math.max(peak, Math.abs(data[i]));
    peaks.push(peak);
    max = Math.max(max, peak);
  }
  return peaks.map((p) => (max > 0 ? Math.round((p / max) * 100) : 0));
}

function probeVideo(file: File): Promise<{ durationMs: number; width: number; height: number; poster: Blob | null }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    let settled = false;

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };

    const timer = setTimeout(() => done(() => reject(new Error("Video okunamadı; tarayıcı bu biçimi oynatamıyor olabilir."))), 20000);

    video.onerror = () => done(() => reject(new Error("Bu video tarayıcıda oynatılamıyor. H.264 MP4 ya da WebM kullanın.")));
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.videoWidth === 0) {
        done(() => reject(new Error("Videonun süresi ya da boyutu okunamadı.")));
        return;
      }
      video.currentTime = Math.min(1.5, video.duration * 0.15);
    };
    video.onseeked = () => {
      const meta = { durationMs: Math.round(video.duration * 1000), width: video.videoWidth, height: video.videoHeight };
      const scale = Math.min(1, 720 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      try {
        canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => done(() => resolve({ ...meta, poster: blob })), "image/jpeg", 0.82);
      } catch {
        done(() => resolve({ ...meta, poster: null }));
      }
    };
    video.src = url;
  });
}
