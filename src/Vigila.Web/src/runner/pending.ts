import { ApiError, api } from "../lib/api";

const PREFIX = "vigila.pending.";

interface Pending {
  key: string;
  body: unknown;
  savedAt: number;
}

/** Sonuç sunucuya ulaşmadan sekme kapanırsa ya da ağ koparsa veri kaybolmasın diye yerelde tutulur. */
export function savePending(sessionId: string, key: string, body: unknown) {
  try {
    localStorage.setItem(PREFIX + sessionId, JSON.stringify({ key, body, savedAt: Date.now() } satisfies Pending));
  } catch {
    /* depolama kapalı ya da dolu: gönderim yine de denenir */
  }
}

export function clearPending(sessionId: string) {
  try {
    localStorage.removeItem(PREFIX + sessionId);
  } catch {
    /* yok say */
  }
}

/** Bekleyen sonuçları göndermeyi dener; gönderilen sayısını döndürür. */
export async function flushPending(): Promise<number> {
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
  } catch {
    return 0;
  }

  let sent = 0;
  for (const storageKey of keys) {
    const sessionId = storageKey.slice(PREFIX.length);
    try {
      const pending = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Pending | null;
      if (!pending) continue;
      await api.complete(sessionId, pending.key, pending.body);
      clearPending(sessionId);
      sent++;
    } catch (e) {
      // Oturum silinmiş ya da anahtar geçersizse yeniden denemenin anlamı yok.
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) clearPending(sessionId);
    }
  }
  return sent;
}
