import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { motion } from "motion/react";
import { Archive, ArchiveRestore, Copy, FlaskConical, Link2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "../components/AppShell";
import { useToast } from "../components/toast";
import { Button, ConfirmDialog, Dialog, EmptyState, ErrorNote, Field, Input, PageLoader, Pill, Segmented, Textarea } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { duration, fmt, relative } from "../lib/format";
import type { ExperimentListItem } from "../lib/types";

function RowMenu({ item, onDelete }: { item: ExperimentListItem; onDelete: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const duplicate = async () => {
    setOpen(false);
    const copy = await api.duplicateExperiment(item.id);
    void qc.invalidateQueries({ queryKey: ["experiments"] });
    toast("Deney çoğaltıldı.");
    navigate(`/deneyler/${copy.id}`);
  };
  const archive = async () => {
    setOpen(false);
    await api.archiveExperiment(item.id, !item.isArchived);
    void qc.invalidateQueries({ queryKey: ["experiments"] });
    toast(item.isArchived ? "Deney arşivden çıkarıldı." : "Deney arşivlendi.");
  };

  return (
    <div ref={ref} className="relative">
      <button aria-label="Deney işlemleri" aria-expanded={open} onClick={() => setOpen(!open)} className="grid size-9 place-items-center rounded-lg text-haze hover:bg-ink-800 hover:text-paper">
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="absolute top-10 right-0 z-20 w-48 rounded-xl border border-line-strong bg-ink-800 p-1 shadow-2xl">
          <button onClick={duplicate} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-mist hover:bg-ink-700 hover:text-paper">
            <Copy className="size-4" /> Çoğalt
          </button>
          <button onClick={archive} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-mist hover:bg-ink-700 hover:text-paper">
            {item.isArchived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            {item.isArchived ? "Arşivden çıkar" : "Arşivle"}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger/10"
          >
            <Trash2 className="size-4" /> Sil
          </button>
        </motion.div>
      )}
    </div>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => api.createExperiment(name, description),
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: ["experiments"] });
      onClose();
      navigate(`/deneyler/${e.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Dialog open={open} onClose={onClose} title="Yeni deney" description="Adını verin; video, uyaranlar ve zamanlamayı bir sonraki ekranda seçeceksiniz.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Deney adı" error={create.error instanceof ApiError ? create.error.field("name") : undefined}>
          {(id) => <Input id={id} required maxLength={160} placeholder="Ör. Sürüş videosunda çevresel dikkat" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Kısa açıklama" hint="İsteğe bağlı; yalnız siz görürsünüz.">
          {(id) => <Textarea id={id} rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-20" />}
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Deney oluştur
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ExperimentsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [toDelete, setToDelete] = useState<ExperimentListItem | null>(null);
  const q = useQuery({ queryKey: ["experiments"], queryFn: api.experiments });
  const creating = params.get("yeni") === "1";

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteExperiment(id),
    onSuccess: () => {
      setToDelete(null);
      void qc.invalidateQueries({ queryKey: ["experiments"] });
      toast("Deney ve oturumları silindi.");
    },
  });

  const list = (q.data ?? []).filter((e) => (filter === "active" ? !e.isArchived : e.isArchived));
  const archivedCount = (q.data ?? []).filter((e) => e.isArchived).length;

  return (
    <>
      <PageHeader
        title="Deneyler"
        description="Her deney bir video, bir uyaran havuzu ve zamanlama kurallarından oluşur. Her oturum bu kurallardan kendi rastgele planını üretir."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setParams({ yeni: "1" })}>
            Yeni deney
          </Button>
        }
      />

      {archivedCount > 0 && (
        <div className="mb-5 w-64">
          <Segmented value={filter} onChange={setFilter} label="Deney filtresi" size="sm" options={[{ value: "active", label: "Etkin" }, { value: "archived", label: `Arşiv (${archivedCount})` }]} />
        </div>
      )}

      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<FlaskConical className="size-8" />}
          title={filter === "archived" ? "Arşiv boş" : "İlk deneyinizi oluşturun"}
          action={filter === "active" && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setParams({ yeni: "1" })}>Yeni deney</Button>}
        >
          {filter === "active" && "Önce medya kütüphanesine bir video ve birkaç uyaran yüklediyseniz deneyi birkaç dakikada hazırlayabilirsiniz."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.map((e, i) => (
            <motion.li key={e.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }} className="flex items-center gap-4 py-4">
              <Link to={`/deneyler/${e.id}`} className="group flex min-w-0 flex-1 items-center gap-4">
                <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg border border-line bg-ink-950 sm:w-36">
                  {e.posterUrl ? <img src={e.posterUrl} alt="" className="size-full object-cover" /> : <FlaskConical className="absolute top-1/2 left-1/2 size-5 -translate-1/2 text-haze" />}
                  {e.videoDurationMs != null && <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10.5px] tabular-nums">{duration(e.videoDurationMs)}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-[17px] font-semibold text-paper group-hover:text-av">{e.name}</h3>
                    {e.ready ? <Pill tone="success">Hazır</Pill> : <Pill tone="warn">Eksik ayar</Pill>}
                    {e.runLinkEnabled && (
                      <Pill tone="av">
                        <Link2 className="size-3" /> Bağlantı açık
                      </Pill>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-haze">{e.description || e.videoName || "Video seçilmedi"}</p>
                  <p className="mt-1 text-[12.5px] text-mist">
                    {e.imageCount} görsel, {e.audioCount} ses, oturum başına {e.trialCount} uyaran
                  </p>
                </div>
              </Link>
              <div className={clsx("hidden w-28 text-right md:block")}>
                <p className="display text-[26px] leading-none tabular-nums">{e.completedCount}</p>
                <p className="text-[12px] text-haze">tamamlanan</p>
              </div>
              <div className="hidden w-28 text-right lg:block">
                <p className="display text-[26px] leading-none tabular-nums">{e.meanRt != null ? fmt.int(e.meanRt) : "–"}</p>
                <p className="text-[12px] text-haze">ort. tepki, ms</p>
              </div>
              <div className="hidden w-28 text-right text-[12.5px] text-haze xl:block">{e.lastSessionAt ? relative(e.lastSessionAt) : relative(e.updatedAt)}</div>
              <RowMenu item={e} onDelete={() => setToDelete(e)} />
            </motion.li>
          ))}
        </ul>
      )}

      <CreateDialog open={creating} onClose={() => setParams({})} />
      <ConfirmDialog
        open={toDelete != null}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        loading={remove.isPending}
        title="Deneyi sil"
        description={
          toDelete && toDelete.sessionCount > 0 ? (
            <>
              “{toDelete.name}” ve <strong className="text-paper">{toDelete.sessionCount} oturumun bütün verisi</strong> kalıcı olarak silinecek. Verileri saklamak istiyorsanız silmek yerine arşivleyin ya da önce CSV olarak indirin.
            </>
          ) : (
            <>“{toDelete?.name}” kalıcı olarak silinecek.</>
          )
        }
        confirmLabel="Deneyi sil"
      />
    </>
  );
}
