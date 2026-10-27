import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/AppShell";
import { AudioPreviewButton, MediaThumb, UploadZone } from "../components/media";
import { useToast } from "../components/toast";
import { ConfirmDialog, EmptyState, ErrorNote, IconButton, PageLoader, Pill, Tabs } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { bytes, duration } from "../lib/format";
import type { MediaItem, MediaKind } from "../lib/types";

function MediaCard({ item, onDelete }: { item: MediaItem; onDelete: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const rename = useMutation({
    mutationFn: () => api.renameMedia(item.id, name),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["media"] });
      toast("Ad güncellendi.");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const meta = item.kind === "image" ? `${item.width}×${item.height}` : item.kind === "video" ? `${item.width}×${item.height}, ${duration(item.durationMs)}` : duration(item.durationMs);

  return (
    <motion.li layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="group overflow-hidden rounded-[14px] border border-line bg-ink-850">
      <MediaThumb item={item} hoverPlay className={item.kind === "audio" ? "h-20" : "aspect-video"} />
      <div className="flex flex-col gap-1 p-3">
        {editing ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate();
            }}
          >
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="field h-8 py-1 text-[13px]" aria-label="Dosya adı" />
            <IconButton label="Kaydet" type="submit" className="size-8">
              <Check className="size-4" />
            </IconButton>
            <IconButton
              label="Vazgeç"
              type="button"
              className="size-8"
              onClick={() => {
                setEditing(false);
                setName(item.name);
              }}
            >
              <X className="size-4" />
            </IconButton>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            {item.kind === "audio" && <AudioPreviewButton url={item.url} />}
            <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-paper" title={item.fileName}>
              {item.name}
            </p>
            <div className="flex opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              <IconButton label="Yeniden adlandır" className="size-8" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
              </IconButton>
              <IconButton label="Sil" className="size-8 hover:text-danger" onClick={onDelete}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-[12px] text-haze">
          <span className="tabular-nums">
            {meta}, {bytes(item.sizeBytes)}
          </span>
          {item.usageCount > 0 && <Pill className="py-0 text-[11px]">{item.usageCount} deneyde</Pill>}
        </div>
      </div>
    </motion.li>
  );
}

export function MediaPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<MediaKind>("video");
  const [toDelete, setToDelete] = useState<MediaItem | null>(null);
  const q = useQuery({ queryKey: ["media"], queryFn: () => api.media() });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMedia(id),
    onSuccess: () => {
      setToDelete(null);
      void qc.invalidateQueries({ queryKey: ["media"] });
      toast("Dosya silindi.");
    },
    onError: (e) => {
      setToDelete(null);
      toast(e instanceof ApiError && e.detail ? `${e.message} ${e.detail}` : e.message, "error");
    },
  });

  const all = q.data ?? [];
  const items = all.filter((m) => m.kind === tab);
  const count = (k: MediaKind) => all.filter((m) => m.kind === k).length;

  return (
    <>
      <PageHeader title="Medya kütüphanesi" description="Deneylerde kullanacağınız videolar, uyaran görselleri ve sesleri. Dosyalar yüklenmeden önce tarayıcıda açılıp denetlenir." />

      <UploadZone onUploaded={(item) => setTab(item.kind)} />

      <div className="mt-10">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "video", label: "Videolar", count: count("video") },
            { value: "image", label: "Görseller", count: count("image") },
            { value: "audio", label: "Sesler", count: count("audio") },
          ]}
        />
      </div>

      <div className="mt-6">
        {q.isLoading ? (
          <PageLoader />
        ) : q.error ? (
          <ErrorNote error={q.error} />
        ) : items.length === 0 ? (
          <EmptyState title={tab === "video" ? "Henüz video yok" : tab === "image" ? "Henüz görsel yok" : "Henüz ses yok"}>
            {tab === "video" && "Katılımcının izleyeceği ana videoyu ve isterseniz bir yönerge videosunu yükleyin."}
            {tab === "image" && "Video üzerinde belirecek uyaran görsellerini yükleyin. Saydam PNG'ler en iyi sonucu verir."}
            {tab === "audio" && "Video sırasında çalınacak kısa uyaran seslerini yükleyin."}
          </EmptyState>
        ) : (
          <motion.ul layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence>
              {items.map((m) => (
                <MediaCard key={m.id} item={m} onDelete={() => setToDelete(m)} />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>

      <ConfirmDialog
        open={toDelete != null}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        loading={remove.isPending}
        title="Dosyayı sil"
        description={<>“{toDelete?.name}” kalıcı olarak silinecek. Bir deneyde kullanılıyorsa önce deneyden çıkarmanız gerekir.</>}
        confirmLabel="Dosyayı sil"
      />
    </>
  );
}
