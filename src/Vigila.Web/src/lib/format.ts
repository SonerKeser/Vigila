import type { MediaKind, PairingMode, PositionMode, QuestionType, ResponseMode, SessionOrigin, SessionStatus, StimulusKind, TrialOutcome } from "./types";

const tr = "tr-TR";
const int = new Intl.NumberFormat(tr, { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat(tr, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const pct = new Intl.NumberFormat(tr, { style: "percent", maximumFractionDigits: 0 });
const pct1 = new Intl.NumberFormat(tr, { style: "percent", maximumFractionDigits: 1 });

export const fmt = {
  int: (v: number | null | undefined) => (v == null ? "–" : int.format(v)),
  one: (v: number | null | undefined) => (v == null ? "–" : one.format(v)),
  ms: (v: number | null | undefined) => (v == null ? "–" : `${int.format(v)} ms`),
  percent: (v: number | null | undefined, precise = false) => (v == null ? "–" : (precise ? pct1 : pct).format(v)),
  seconds: (ms: number) => `${one.format(ms / 1000)} sn`,
};

/** 83400 → "01:23" ; saat varsa "1:02:03". İsteğe bağlı onda bir saniye. */
export function clock(ms: number, tenths = false): string {
  const neg = ms < 0;
  const total = Math.abs(ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const t = Math.floor((total % 1000) / 100);
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return `${neg ? "-" : ""}${base}${tenths ? `,${t}` : ""}`;
}

/** Uzun süreleri okunur biçimde verir: "4 dk 12 sn". */
export function duration(ms: number | null | undefined): string {
  if (ms == null) return "–";
  if (ms < 10_000) return `${one.format(Math.round(ms / 100) / 10)} sn`;
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} sa ${m} dk`;
  if (m > 0) return s > 0 ? `${m} dk ${s} sn` : `${m} dk`;
  return `${s} sn`;
}

const pad = (n: number) => n.toString().padStart(2, "0");

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${one.format(v)} ${units[i]}`;
}

export function date(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString(tr, withTime ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "long", year: "numeric" });
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return "–";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(tr, { numeric: "auto" });
  if (diff < 60) return "az önce";
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), "day");
  return date(iso, false);
}

export const kindLabel: Record<StimulusKind, string> = {
  visual: "Görsel",
  auditory: "İşitsel",
  audiovisual: "Görsel-işitsel",
};

/** Kanal renkleri CSS değişkenleri olarak; grafikler ve zaman çizelgesi aynı kaynağı kullanır. */
export const kindColor: Record<StimulusKind, string> = {
  visual: "var(--color-visual)",
  auditory: "var(--color-audio)",
  audiovisual: "var(--color-av)",
};

export const mediaKindLabel: Record<MediaKind, string> = { video: "Video", image: "Görsel", audio: "Ses" };

export const pairingLabel: Record<PairingMode, string> = {
  independent: "Ayrı",
  paired: "Eşleşik",
  mixed: "Karma",
};

export const pairingHelp: Record<PairingMode, string> = {
  independent: "Her görsel ve her ses ayrı bir uyaran olarak sunulur.",
  paired: "Görseller seslerle eşleştirilip aynı anda sunulur.",
  mixed: "Görsel, işitsel ve eşleşik uyaranlar bir arada; çok duyulu kazanç ölçülür.",
};

export const positionLabel: Record<PositionMode, string> = {
  random: "Rastgele",
  balancedQuadrants: "Dengeli çeyrek",
  center: "Orta",
};

export const outcomeLabel: Record<TrialOutcome, string> = {
  hit: "İsabet",
  miss: "Kaçırıldı",
  anticipation: "Erken basış",
  notPresented: "Sunulmadı",
};

export const statusLabel: Record<SessionStatus, string> = {
  created: "Hazırlanıyor",
  running: "Sürüyor",
  completed: "Tamamlandı",
  aborted: "Yarıda kaldı",
};

export const originLabel: Record<SessionOrigin, string> = { lab: "Laboratuvar", link: "Bağlantı" };

export const quadrantLabel = ["Sol üst", "Sağ üst", "Sol alt", "Sağ alt"];

export const responseModeLabel: Record<ResponseMode, string> = { keyboard: "Klavye", pointer: "Dokunma / fare", both: "İkisi de" };

export const questionTypeLabel: Record<QuestionType, string> = { text: "Kısa metin", number: "Sayı", choice: "Seçmeli", scale: "Ölçek" };

/** p değerini APA biçiminde yazar: p < ,001 ya da p = ,034. */
export function pValue(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "–";
  if (p < 0.001) return "p < ,001";
  return `p = ${p.toFixed(3).replace("0.", ",")}`;
}

export const dec = (v: number | null | undefined, digits = 2) =>
  v == null || Number.isNaN(v) ? "–" : new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);

/** KeyboardEvent.code değerini okunur tuş adına çevirir. */
export function keyLabel(code: string): string {
  if (code === "Space") return "Boşluk";
  if (code === "Enter") return "Enter";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  if (code.startsWith("Arrow")) return { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" }[code] ?? code;
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
  return code;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 6) return "İyi geceler";
  if (h < 12) return "Günaydın";
  if (h < 18) return "İyi günler";
  return "İyi akşamlar";
}
