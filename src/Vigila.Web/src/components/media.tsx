import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleAlert, Film, Image as ImageIcon, Music, Pause, Play, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { api, uploadMedia } from "../lib/api";
import { bytes, duration, mediaKindLabel } from "../lib/format";
import { acceptAttribute, kindOf, probe } from "../lib/probe";
import type { MediaItem, MediaKind } from "../lib/types";
import { Waveform } from "./bits";
import { Button, Dialog, EmptyState, Spinner } from "./ui";

export const kindIcon: Record<MediaKind, typeof Film> = { video: Film, image: ImageIcon, audio: Music };

/** Medyanın küçük önizlemesi: video için kapak, görsel için kendisi, ses için dalga biçimi. */
export function MediaThumb({ item, className, hoverPlay = false }: { item: MediaItem; className?: string; hoverPlay?: boolean }) {
  const [hover, setHover] = useState(false);
  if (item.kind === "image") {
    return (
      <div className={clsx("checker relative overflow-hidden", className)}>
        <img src={item.url} alt="" loading="lazy" className="absolute inset-0 size-full object-contain p-2" />
      </div>
    );
  }
  if (item.kind === "video") {
    return (
      <div className={clsx("relative overflow-hidden bg-black", className)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {item.posterUrl ? <img src={item.posterUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" /> : <Film className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-haze" />}
        {hoverPlay && hover && <video src={item.url} muted autoPlay loop playsInline className="absolute inset-0 size-full object-cover" />}
        {item.durationMs != null && <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums text-paper">{duration(item.durationMs)}</span>}
      </div>
    );
  }
  return (
    <div className={clsx("relative flex items-center bg-ink-950 px-3", className)}>
      <Waveform peaks={item.peaks} className="h-1/2 w-full" />
    </div>
  );
}

/** Ses dosyasını dinletmek için küçük oynat düğmesi. */
export function AudioPreviewButton({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => ref.current?.pause(), []);
  const toggle = () => {
    if (!ref.current) {
      ref.current = new Audio(url);
      ref.current.onended = () => setPlaying(false);
    }
    if (playing) {
      ref.current.pause();
      ref.current.currentTime = 0;
      setPlaying(false);
    } else {
      void ref.current.play();
      setPlaying(true);
    }
  };
  return (
    <button type="button" onClick={toggle} aria-label={playing ? "Durdur" : "Dinle"} className="grid size-8 shrink-0 place-items-center rounded-full bg-audio/15 text-audio hover:bg-audio/25">
      {playing ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}
    </button>
  );
}

interface UploadTask {
  id: string;
  name: string;
  kind: MediaKind | null;
  progress: number;
  stage: "probing" | "uploading" | "done" | "error";
  error?: string;
}

/** Sürükle-bırak ile çoklu yükleme. Her dosya önce tarayıcıda incelenir, sonra ilerleme göstergesiyle yüklenir. */
export function UploadZone({ kinds, onUploaded, compact = false }: { kinds?: MediaKind[]; onUploaded?: (item: MediaItem) => void; compact?: boolean }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [dragging, setDragging] = useState(false);
  const allowed = kinds ?? (["video", "image", "audio"] as MediaKind[]);

  const update = (id: string, patch: Partial<UploadTask>) => setTasks((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const id = `${file.name}-${file.size}-${Math.random()}`;
        const kind = kindOf(file);
        setTasks((list) => [...list, { id, name: file.name, kind, progress: 0, stage: "probing" }]);
        if (!kind || !allowed.includes(kind)) {
          update(id, { stage: "error", error: kind ? `Burada yalnız ${allowed.map((k) => mediaKindLabel[k].toLocaleLowerCase("tr")).join(" ve ")} yüklenebilir.` : "Bu dosya türü desteklenmiyor." });
          continue;
        }
        try {
          const meta = await probe(file);
          update(id, { stage: "uploading" });
          const item = await uploadMedia(
            file,
            { name: file.name.replace(/\.[^.]+$/, ""), durationMs: meta.durationMs, width: meta.width, height: meta.height, peaks: meta.peaks },
            meta.poster,
            (p) => update(id, { progress: p }),
          );
          update(id, { stage: "done", progress: 1 });
          onUploaded?.(item);
          void qc.invalidateQueries({ queryKey: ["media"] });
          setTimeout(() => setTasks((list) => list.filter((t) => t.id !== id)), 2500);
        } catch (e) {
          update(id, { stage: "error", error: e instanceof Error ? e.message : "Yükleme başarısız oldu." });
        }
      }
    },
    [allowed, onUploaded, qc],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={clsx(
          "relative flex items-center gap-4 rounded-[var(--radius-panel)] border border-dashed transition-colors",
          compact ? "px-4 py-3" : "px-6 py-7",
          dragging ? "border-av bg-av/8" : "border-line-strong bg-ink-950/50 hover:border-[rgb(148_160_255/0.4)]",
        )}
      >
        <div className={clsx("grid shrink-0 place-items-center rounded-xl bg-ink-800 text-mist", compact ? "size-9" : "size-12")}>
          <UploadCloud className={compact ? "size-4" : "size-5"} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-paper">{dragging ? "Bırakın, yükleyelim" : "Dosyaları buraya sürükleyin"}</p>
          <p className="text-[12.5px] text-haze">
            {allowed.includes("video") && "MP4 ya da WebM video, "}
            {allowed.includes("image") && "PNG, JPG, WebP görsel, "}
            {allowed.includes("audio") && "MP3, WAV, OGG ses"}
          </p>
        </div>
        <Button size={compact ? "sm" : "md"} onClick={() => inputRef.current?.click()}>
          Dosya seç
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptAttribute}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <AnimatePresence initial={false}>
        {tasks.length > 0 && (
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 space-y-2">
            {tasks.map((t) => {
              const Icon = t.kind ? kindIcon[t.kind] : CircleAlert;
              return (
                <motion.li key={t.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-3 rounded-xl border border-line bg-ink-850 px-3 py-2.5">
                  <Icon className="size-4 shrink-0 text-haze" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="truncate text-paper">{t.name}</span>
                      <span className={clsx("shrink-0", t.stage === "error" ? "text-danger" : "text-haze")}>
                        {t.stage === "probing" && "İnceleniyor"}
                        {t.stage === "uploading" && `%${Math.round(t.progress * 100)}`}
                        {t.stage === "done" && "Yüklendi"}
                        {t.stage === "error" && "Yüklenemedi"}
                      </span>
                    </div>
                    {t.stage === "error" ? (
                      <p className="text-[12px] text-danger/90">{t.error}</p>
                    ) : (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-950">
                        <motion.div className={clsx("h-full rounded-full", t.stage === "done" ? "bg-success" : "bg-av")} animate={{ width: `${Math.max(4, t.progress * 100)}%` }} transition={{ ease: "easeOut" }} />
                      </div>
                    )}
                  </div>
                  {t.stage === "done" && <Check className="size-4 text-success" />}
                  {t.stage === "error" && (
                    <button className="text-[12px] text-haze hover:text-paper" onClick={() => setTasks((list) => list.filter((x) => x.id !== t.id))}>
                      Kapat
                    </button>
                  )}
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Deney düzenleyicisinde kütüphaneden dosya seçme penceresi; aynı yerden yükleme de yapılabilir. */
export function MediaPicker({
  open,
  onClose,
  kind,
  multiple,
  selected,
  onConfirm,
  title,
}: {
  open: boolean;
  onClose: () => void;
  kind: MediaKind;
  multiple: boolean;
  selected: string[];
  onConfirm: (ids: string[]) => void;
  title: string;
}) {
  const media = useQuery({ queryKey: ["media"], queryFn: () => api.media(), enabled: open });
  const [picked, setPicked] = useState<string[]>(selected);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Seçim yalnız pencere açılırken sıfırlanır; üst bileşen yeniden çizildiğinde kullanıcının seçimi korunur.
  useEffect(() => {
    if (open) setPicked(selectedRef.current);
  }, [open]);

  const items = (media.data ?? []).filter((m) => m.kind === kind);
  const toggle = (id: string) => setPicked((list) => (multiple ? (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]) : [id]));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={760}
      description={multiple ? "Birden fazla dosya seçebilirsiniz. Yeni yüklenen dosyalar otomatik seçilir." : "Bir dosya seçin ya da yeni bir dosya yükleyin."}
      footer={
        <>
          <span className="mr-auto self-center text-[13px] text-haze">{picked.length} dosya seçili</span>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onConfirm(picked);
              onClose();
            }}
          >
            Seçimi uygula
          </Button>
        </>
      }
    >
      <UploadZone kinds={[kind]} compact onUploaded={(item) => setPicked((list) => (multiple ? [...list, item.id] : [item.id]))} />
      <div className="mt-4 max-h-[46vh] overflow-y-auto pr-1">
        {media.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="Kütüphane boş">Yukarıdan dosya yükleyerek başlayın.</EmptyState>
        ) : (
          <div className={clsx("grid gap-3", kind === "audio" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4")}>
            {items.map((m) => {
              const on = picked.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  aria-pressed={on}
                  className={clsx("group relative overflow-hidden rounded-xl border text-left transition-[border-color,box-shadow]", on ? "border-av shadow-[0_0_0_3px_rgb(154_108_240/0.3)]" : "border-line hover:border-line-strong")}
                >
                  <MediaThumb item={m} className={kind === "audio" ? "h-14" : "aspect-video"} />
                  <div className="flex items-center justify-between gap-2 bg-ink-850 px-2.5 py-2">
                    <span className="truncate text-[12.5px] text-paper">{m.name}</span>
                    <span className="shrink-0 text-[11px] text-haze">{m.kind === "image" ? `${m.width}×${m.height}` : duration(m.durationMs)}</span>
                  </div>
                  <span className={clsx("absolute top-2 right-2 grid size-6 place-items-center rounded-full border transition-colors", on ? "border-av bg-av text-white" : "border-paper/40 bg-ink-950/60 text-transparent")}>
                    <Check className="size-3.5" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <p className="mt-3 text-[12px] text-haze">Toplam {bytes(items.reduce((a, m) => a + m.sizeBytes, 0))}</p>
    </Dialog>
  );
}
