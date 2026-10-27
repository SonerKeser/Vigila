import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Film, Grid2x2, ImagePlus, Keyboard, Map as MapIcon, MonitorPlay, Music, Shuffle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Waveform } from "../../components/bits";
import { AudioPreviewButton, MediaPicker, MediaThumb } from "../../components/media";
import { StageMap, StagePlayer, type StagePlayerHandle } from "../../components/Stage";
import { Timeline } from "../../components/Timeline";
import { Button, Field, Input, Kbd, NumberInput, Segmented, Slider, Switch, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { duration, keyLabel, pairingHelp, pairingLabel, positionLabel, responseModeLabel } from "../../lib/format";
import type { Experiment, ExperimentDraft, ExperimentSettings, MediaItem, MediaKind, PairingMode, ParticipantLanguage, PositionMode, ResponseMode } from "../../lib/types";
import { QuestionBuilder } from "./QuestionBuilder";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const randomSeed = () => Math.floor(Math.random() * 2_000_000_000) + 1;

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line py-7 first:border-t-0 first:pt-0">
      <h2 className="display text-[26px] leading-none">{title}</h2>
      {description && <p className="mt-1.5 text-[13px] text-haze">{description}</p>}
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  );
}

function VideoSlot({ label, hint, item, onPick, onClear }: { label: string; hint?: string; item: MediaItem | undefined; onPick: () => void; onClear?: () => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-paper">{label}</p>
      {item ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-ink-950/60 p-2 pr-3">
          <MediaThumb item={item} className="aspect-video w-28 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{item.name}</p>
            <p className="text-[12px] text-haze">
              {item.width}×{item.height}, {duration(item.durationMs)}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onPick}>
            Değiştir
          </Button>
          {onClear && (
            <button aria-label="Kaldır" onClick={onClear} className="grid size-8 place-items-center rounded-lg text-haze hover:bg-ink-800 hover:text-paper">
              <X className="size-4" />
            </button>
          )}
        </div>
      ) : (
        <button type="button" onClick={onPick} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-4 text-left text-sm text-mist transition-colors hover:border-av hover:text-paper">
          <Film className="size-5" />
          <span>Kütüphaneden video seçin</span>
        </button>
      )}
      {hint && <p className="mt-1.5 text-[12.5px] text-haze">{hint}</p>}
    </div>
  );
}

/** Yanıt tuşunu yazmak yerine basarak seçtirir. */
function KeyCapture({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") onChange(e.code);
      setListening(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [listening, onChange]);
  return (
    <button
      type="button"
      onClick={() => setListening(true)}
      className={clsx("flex h-11 w-full items-center gap-3 rounded-[var(--radius-control)] border px-3 text-left text-sm transition-colors", listening ? "border-av bg-av/10 text-paper" : "border-line-strong bg-ink-950 text-mist hover:border-[rgb(148_160_255/0.4)]")}
    >
      <Keyboard className="size-4 shrink-0" />
      {listening ? <span>Bir tuşa basın (vazgeçmek için Esc)</span> : <span className="flex items-center gap-2">Yanıt tuşu <Kbd>{keyLabel(value)}</Kbd></span>}
      {!listening && <span className="ml-auto text-[12px] text-haze">Değiştirmek için tıklayın</span>}
    </button>
  );
}

export function DesignTab({ experiment, draft, onChange, errors }: { experiment: Experiment; draft: ExperimentDraft; onChange: (d: ExperimentDraft) => void; errors: Record<string, string[]> }) {
  const media = useQuery({ queryKey: ["media"], queryFn: () => api.media() });
  const [picker, setPicker] = useState<null | { kind: MediaKind; target: "video" | "instruction" | "images" | "audios" }>(null);
  const [seed, setSeed] = useState(randomSeed);
  const [mode, setMode] = useState<"map" | "live">("map");
  const [hover, setHover] = useState<number | null>(null);
  const [active, setActive] = useState<Set<number>>(new Set());
  const [playhead, setPlayhead] = useState<number | null>(null);
  const playerRef = useRef<StagePlayerHandle | null>(null);
  const s = draft.settings;

  const byId = useMemo(() => new Map((media.data ?? []).map((m) => [m.id, m])), [media.data]);
  const imageUrls = useMemo(() => new Map((media.data ?? []).filter((m) => m.kind === "image").map((m) => [m.id, m.url])), [media.data]);
  const audioUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const id of draft.audioIds) {
      const url = byId.get(id)?.url;
      if (url) map.set(id, url);
    }
    return map;
  }, [draft.audioIds, byId]);
  const video = draft.videoId ? byId.get(draft.videoId) : undefined;

  const debounced = useDebounced(draft, 350);
  const effectiveSeed = s.seedMode === "fixed" ? s.fixedSeed : seed;
  const preview = useQuery({
    queryKey: ["preview", experiment.id, debounced, effectiveSeed],
    queryFn: () => api.preview(experiment.id, debounced, effectiveSeed),
    placeholderData: keepPreviousData,
  });
  const plan = preview.data;
  const stimuli = useMemo(() => plan?.stimuli ?? [], [plan]);

  const set = (patch: Partial<ExperimentSettings>) => onChange({ ...draft, settings: { ...s, ...patch } });
  const err = (field: string) => errors[field]?.[0] ?? errors[`settings.${field}`]?.[0];

  const pickerSelected = picker
    ? picker.target === "video"
      ? draft.videoId ? [draft.videoId] : []
      : picker.target === "instruction"
        ? draft.instructionVideoId ? [draft.instructionVideoId] : []
        : picker.target === "images" ? draft.imageIds : draft.audioIds
    : [];

  const applyPick = (ids: string[]) => {
    if (!picker) return;
    if (picker.target === "video") onChange({ ...draft, videoId: ids[0] ?? null });
    if (picker.target === "instruction") onChange({ ...draft, instructionVideoId: ids[0] ?? null });
    if (picker.target === "images") onChange({ ...draft, imageIds: ids });
    if (picker.target === "audios") onChange({ ...draft, audioIds: ids });
  };

  const utilization = plan ? plan.capacity.utilization : 0;
  const meterTone = !plan?.ok ? "bg-danger" : utilization > 0.85 ? "bg-warn" : "bg-av";

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      {/* Ayarlar */}
      <div>
        <Section title="Genel">
          <Field label="Deney adı" error={err("name")}>
            {(id) => <Input id={id} value={draft.name} maxLength={160} onChange={(e) => onChange({ ...draft, name: e.target.value })} invalid={!!err("name")} />}
          </Field>
          <Field label="Açıklama" hint="Yalnız araştırmacılar görür.">
            {(id) => <Textarea id={id} rows={2} className="min-h-16" value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} />}
          </Field>
        </Section>

        <Section title="Video ve yönerge" description="Katılımcı önce yönergeyi okur, varsa yönerge videosunu izler, ardından ana video başlar.">
          <VideoSlot label="Ana video" item={video} onPick={() => setPicker({ kind: "video", target: "video" })} />
          <VideoSlot
            label="Yönerge videosu"
            hint="İsteğe bağlı. Deneyden önce katılımcıya bir kez gösterilir."
            item={draft.instructionVideoId ? byId.get(draft.instructionVideoId) : undefined}
            onPick={() => setPicker({ kind: "video", target: "instruction" })}
            onClear={draft.instructionVideoId ? () => onChange({ ...draft, instructionVideoId: null }) : undefined}
          />
          <Field label="Yönerge metni" error={err("instructionText")}>
            {(id) => <Textarea id={id} rows={5} value={draft.instructionText} onChange={(e) => onChange({ ...draft, instructionText: e.target.value })} />}
          </Field>
        </Section>

        <Section title="Uyaran havuzu" description="Her tekrar, havuzdaki her uyaranı bir kez içeren karışık bir bloktur.">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium">Görseller <span className="text-haze">({draft.imageIds.length})</span></p>
              <Button size="sm" variant="ghost" icon={<ImagePlus className="size-4" />} onClick={() => setPicker({ kind: "image", target: "images" })}>
                Görsel ekle
              </Button>
            </div>
            {draft.imageIds.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-haze">Görsel yok.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                <AnimatePresence initial={false}>
                  {draft.imageIds.map((id) => {
                    const m = byId.get(id);
                    return (
                      <motion.div key={id} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="group relative aspect-square overflow-hidden rounded-lg border border-line">
                        {m && <MediaThumb item={m} className="size-full" />}
                        <button
                          aria-label="Havuzdan çıkar"
                          onClick={() => onChange({ ...draft, imageIds: draft.imageIds.filter((x) => x !== id) })}
                          className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-ink-950/80 text-mist opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                        >
                          <X className="size-3.5" />
                        </button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium">Sesler <span className="text-haze">({draft.audioIds.length})</span></p>
              <Button size="sm" variant="ghost" icon={<Music className="size-4" />} onClick={() => setPicker({ kind: "audio", target: "audios" })}>
                Ses ekle
              </Button>
            </div>
            {draft.audioIds.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-haze">Ses yok.</p>
            ) : (
              <ul className="space-y-1.5">
                {draft.audioIds.map((id) => {
                  const m = byId.get(id);
                  return (
                    <li key={id} className="flex items-center gap-3 rounded-lg border border-line bg-ink-950/60 px-2 py-1.5">
                      {m && <AudioPreviewButton url={m.url} />}
                      <span className="w-28 truncate text-[13px]">{m?.name ?? "Silinmiş dosya"}</span>
                      <Waveform peaks={m?.peaks ?? null} className="h-6 flex-1" />
                      <span className="w-12 text-right text-[12px] text-haze tabular-nums">{duration(m?.durationMs)}</span>
                      <button aria-label="Havuzdan çıkar" onClick={() => onChange({ ...draft, audioIds: draft.audioIds.filter((x) => x !== id) })} className="grid size-7 place-items-center rounded-md text-haze hover:bg-ink-800 hover:text-paper">
                        <X className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Field label="Sunum biçimi" hint={pairingHelp[s.pairing]}>
            {() => <Segmented<PairingMode> label="Sunum biçimi" value={s.pairing} onChange={(v) => set({ pairing: v })} options={(["independent", "paired", "mixed"] as PairingMode[]).map((v) => ({ value: v, label: pairingLabel[v] }))} />}
          </Field>
          <Field label="Tekrar sayısı" hint={`Her oturumda ${plan?.capacity.trialCount ?? experiment.trialCount} uyaran sunulur.`} error={err("repetitions")}>
            {(id) => <NumberInput id={id} value={s.repetitions} min={1} max={50} onChange={(v) => set({ repetitions: v })} invalid={!!err("repetitions")} />}
          </Field>
        </Section>

        <Section title="Zamanlama" description="Uyaranlar hiçbir zaman çakışmaz; yanıt pencereleri de birbirine girmez.">
          <div className="grid grid-cols-2 gap-4">
            <Field label="En kısa gösterim" error={err("durationMinMs")}>
              {(id) => <NumberInput id={id} unit="ms" step={50} value={s.durationMinMs} onChange={(v) => set({ durationMinMs: v })} invalid={!!err("durationMinMs")} />}
            </Field>
            <Field label="En uzun gösterim" error={err("durationMaxMs")}>
              {(id) => <NumberInput id={id} unit="ms" step={50} value={s.durationMaxMs} onChange={(v) => set({ durationMaxMs: v })} invalid={!!err("durationMaxMs")} />}
            </Field>
          </div>
          <p className="-mt-2 text-[12.5px] text-haze">İki değer eşitse süre sabittir; farklıysa her uyaran için bu aralıktan rastgele seçilir.</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Yanıt penceresi" hint="Başlangıçtan sonra isabet sayılan süre." error={err("responseWindowMs")}>
              {(id) => <NumberInput id={id} unit="ms" step={100} value={s.responseWindowMs} onChange={(v) => set({ responseWindowMs: v })} invalid={!!err("responseWindowMs")} />}
            </Field>
            <Field label="En kısa ara" hint="Bir pencere bitip sonraki uyarana dek." error={err("minGapMs")}>
              {(id) => <NumberInput id={id} unit="ms" step={100} value={s.minGapMs} onChange={(v) => set({ minGapMs: v })} invalid={!!err("minGapMs")} />}
            </Field>
            <Field label="Başlangıç boşluğu" error={err("leadInMs")}>
              {(id) => <NumberInput id={id} unit="ms" step={500} value={s.leadInMs} onChange={(v) => set({ leadInMs: v })} invalid={!!err("leadInMs")} />}
            </Field>
            <Field label="Bitiş boşluğu" error={err("tailMs")}>
              {(id) => <NumberInput id={id} unit="ms" step={500} value={s.tailMs} onChange={(v) => set({ tailMs: v })} invalid={!!err("tailMs")} />}
            </Field>
          </div>
        </Section>

        <Section title="Yerleşim" description="Görseller video karesine göre konumlanır; ekran boyutu değişse de oranlar korunur.">
          <Field label="Konum" hint={s.positioning === "balancedQuadrants" ? "Her dört görselden biri her çeyreğe düşer; uzamsal dikkat karşılaştırması için." : undefined}>
            {() => (
              <Segmented<PositionMode>
                label="Konum"
                value={s.positioning}
                onChange={(v) => set({ positioning: v })}
                options={(["random", "balancedQuadrants", "center"] as PositionMode[]).map((v) => ({ value: v, label: positionLabel[v], icon: v === "balancedQuadrants" ? <Grid2x2 className="size-3.5" /> : undefined }))}
              />
            )}
          </Field>
          <Field label="Görsel genişliği" trailing={<span className="text-[13px] text-mist tabular-nums">videonun %{Math.round(s.imageScale * 100)}'i</span>}>
            {(id) => <Slider id={id} min={0.04} max={0.6} step={0.01} value={s.imageScale} onChange={(v) => set({ imageScale: v })} />}
          </Field>
          <Field label="Kenar payı" trailing={<span className="text-[13px] text-mist tabular-nums">%{Math.round(s.safeMargin * 100)}</span>}>
            {(id) => <Slider id={id} min={0} max={0.2} step={0.01} value={s.safeMargin} onChange={(v) => set({ safeMargin: v })} />}
          </Field>
        </Section>

        <Section title="Yanıt">
          <Field label="Yanıt yöntemi" hint={s.responseMode === "keyboard" ? undefined : "Dokunma ya da fare tıklaması da yanıt sayılır; tablet ve dokunmatik ekranlı laboratuvarlar için."}>
            {() => (
              <Segmented<ResponseMode>
                label="Yanıt yöntemi"
                value={s.responseMode}
                onChange={(v) => set({ responseMode: v })}
                options={(["keyboard", "pointer", "both"] as ResponseMode[]).map((v) => ({ value: v, label: responseModeLabel[v] }))}
              />
            )}
          </Field>
          {s.responseMode !== "pointer" && (
            <Field label="Yanıt tuşu" error={err("responseKey")}>
              {() => <KeyCapture value={s.responseKey} onChange={(code) => set({ responseKey: code })} />}
            </Field>
          )}
          <Field label="En kısa geçerli tepki" hint="Bundan kısa basışlar gerçek tepki sayılmaz, erken basış olarak işaretlenir." error={err("minValidRtMs")}>
            {(id) => <NumberInput id={id} unit="ms" step={10} value={s.minValidRtMs} onChange={(v) => set({ minValidRtMs: v })} invalid={!!err("minValidRtMs")} />}
          </Field>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium">Duraklatmaya izin ver</p>
              <p className="text-[12.5px] text-haze">Katılımcı Esc ile duraklatabilir; her duraklatma kayda geçer.</p>
            </div>
            <Switch label="Duraklatmaya izin ver" checked={s.allowPause} onChange={(v) => set({ allowPause: v })} />
          </div>
        </Section>

        <Section title="Alıştırma" description="Asıl deneyden önce videosuz bir sahnede kısa bir deneme yapılır; katılımcı görevi kavramadan veri toplanmaz.">
          <Field label="Alıştırma uyaranı" hint={s.practiceTrials === 0 ? "0 seçiliyse alıştırma yapılmaz." : `Katılımcı ${s.practiceTrials} uyaranla alıştırma yapar. Sonuçlar puanlamaya katılmaz.`} error={err("practiceTrials")}>
            {(id) => <NumberInput id={id} min={0} max={20} value={s.practiceTrials} onChange={(v) => set({ practiceTrials: v })} invalid={!!err("practiceTrials")} />}
          </Field>
          {s.practiceTrials > 0 && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium">Geri bildirim göster</p>
                <p className="text-[12.5px] text-haze">Her uyarandan sonra isabet ve tepki süresi gösterilir.</p>
              </div>
              <Switch label="Geri bildirim göster" checked={s.practiceFeedback} onChange={(v) => set({ practiceFeedback: v })} />
            </div>
          )}
        </Section>

        <Section title="Onam ve katılımcı formu" description="Onam metni doluysa katılımcı onaylamadan deneye başlayamaz. Yanıtlar oturumla birlikte saklanır ve CSV'ye sütun olarak eklenir.">
          <Field label="Onam metni" error={err("consentText")}>
            {(id) => (
              <Textarea
                id={id}
                rows={4}
                placeholder="Ör. Bu araştırmaya gönüllü olarak katılıyorum. İstediğim an ayrılabileceğimi ve verilerimin anonim olarak saklanacağını biliyorum."
                value={draft.consentText}
                onChange={(e) => onChange({ ...draft, consentText: e.target.value })}
              />
            )}
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-medium">Sorular</p>
            <QuestionBuilder questions={draft.questions} onChange={(questions) => onChange({ ...draft, questions })} error={err("questions")} />
          </div>
        </Section>

        <Section title="Katılımcı deneyimi">
          <Field label="Katılımcı ekranlarının dili" hint="Yönerge ve onam metnini de seçtiğiniz dilde yazın.">
            {() => (
              <Segmented<ParticipantLanguage>
                label="Dil"
                value={s.language}
                onChange={(v) => set({ language: v })}
                options={[
                  { value: "tr", label: "Türkçe" },
                  { value: "en", label: "English" },
                ]}
              />
            )}
          </Field>
          {s.responseMode === "keyboard" && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium">Yalnız dokunmatik cihazları engelle</p>
                <p className="text-[12.5px] text-haze">Klavyesi olmayan telefon ve tabletler katılamaz.</p>
              </div>
              <Switch label="Yalnız dokunmatik cihazları engelle" checked={s.blockTouchOnly} onChange={(v) => set({ blockTouchOnly: v })} />
            </div>
          )}
        </Section>

        <Section title="Ses düzeyleri">
          <Field label="Uyaran sesleri" trailing={<span className="text-[13px] text-mist tabular-nums">%{Math.round(s.audioVolume * 100)}</span>}>
            {(id) => <Slider id={id} min={0} max={1} step={0.05} value={s.audioVolume} onChange={(v) => set({ audioVolume: v })} />}
          </Field>
          <Field label="Video sesi" trailing={<span className="text-[13px] text-mist tabular-nums">%{Math.round(s.videoVolume * 100)}</span>}>
            {(id) => <Slider id={id} min={0} max={1} step={0.05} value={s.videoVolume} onChange={(v) => set({ videoVolume: v })} />}
          </Field>
        </Section>

        <Section title="Tekrarlanabilirlik" description="Plan, bir tohum sayısından üretilir. Aynı tohum her zaman aynı planı verir.">
          <Segmented
            label="Tohum"
            value={s.seedMode}
            onChange={(v) => set({ seedMode: v })}
            options={[
              { value: "perSession", label: "Her oturuma yeni plan" },
              { value: "fixed", label: "Herkese aynı plan" },
            ]}
          />
          {s.seedMode === "fixed" && (
            <Field label="Tohum sayısı" error={err("fixedSeed")}>
              {(id) => <NumberInput id={id} value={s.fixedSeed} min={0} onChange={(v) => set({ fixedSeed: v })} invalid={!!err("fixedSeed")} />}
            </Field>
          )}
        </Section>
      </div>

      {/* Önizleme */}
      <div className="xl:sticky xl:top-6 xl:self-start">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="w-[300px]">
            <Segmented
              label="Önizleme türü"
              size="sm"
              value={mode}
              onChange={(v) => {
                setMode(v);
                setPlayhead(null);
                setActive(new Set());
              }}
              options={[
                { value: "map", label: "Konum haritası", icon: <MapIcon className="size-3.5" /> },
                { value: "live", label: "Canlı önizleme", icon: <MonitorPlay className="size-3.5" /> },
              ]}
            />
          </div>
          <Button size="sm" variant="ghost" icon={<Shuffle className="size-4" />} disabled={s.seedMode === "fixed"} onClick={() => setSeed(randomSeed())} title={s.seedMode === "fixed" ? "Sabit tohumda plan değişmez" : undefined}>
            Yeniden karıştır
          </Button>
        </div>

        {mode === "live" && video ? (
          <StagePlayer
            videoUrl={video.url}
            posterUrl={video.posterUrl}
            videoWidth={video.width ?? 1920}
            videoHeight={video.height ?? 1080}
            stimuli={stimuli}
            imageUrls={imageUrls}
            audioUrls={audioUrls}
            audioVolume={s.audioVolume}
            videoVolume={s.videoVolume}
            handleRef={playerRef}
            onTick={setPlayhead}
            onActiveChange={setActive}
          />
        ) : (
          <StageMap width={video?.width ?? 1920} height={video?.height ?? 1080} posterUrl={video?.posterUrl ?? null} stimuli={stimuli} imageUrls={imageUrls} highlight={hover} positioning={s.positioning} safeMargin={s.safeMargin} />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="min-w-[220px] flex-1">
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-mist">Videonun doluluğu</span>
              <span className="text-paper tabular-nums">{plan?.ok ? `%${Math.round(utilization * 100)}` : "Sığmıyor"}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-950">
              <motion.div className={clsx("h-full rounded-full", meterTone)} animate={{ width: `${Math.min(100, utilization * 100)}%` }} transition={{ type: "spring", stiffness: 160, damping: 24 }} />
            </div>
          </div>
          <div className="text-[13px] text-mist">
            <span className="display mr-1.5 text-[26px] text-paper tabular-nums">{plan?.capacity.trialCount ?? 0}</span>uyaran
            {plan && plan.capacity.maxTrials > 0 && <span className="text-haze">, en fazla {plan.capacity.maxTrials}</span>}
          </div>
          <div className="text-[12.5px] text-haze tabular-nums">Tohum {effectiveSeed}</div>
        </div>
        {plan && !plan.ok && <p className="mt-3 rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-[13px] text-warn">{plan.error}</p>}

        <Timeline
          className="mt-5"
          durationMs={video?.durationMs ?? 60_000}
          items={stimuli.map((x) => ({ index: x.index, kind: x.kind, onsetMs: x.onsetMs, durationMs: x.durationMs }))}
          windowMs={s.responseWindowMs}
          leadInMs={s.leadInMs}
          tailMs={s.tailMs}
          playheadMs={mode === "live" ? playhead : null}
          activeIndices={active}
          onHover={setHover}
          onSeek={mode === "live" ? (ms) => playerRef.current?.seek(ms) : undefined}
        />
        <p className="mt-2 text-[12px] text-haze">
          {mode === "map" ? "Bir uyaranın üzerine gelin; görseli haritada yerinde görünür. Taralı alanlara uyaran konmaz." : "Zaman çizelgesine tıklayarak videoyu o ana sarın."}
        </p>
      </div>

      {picker && (
        <MediaPicker
          open
          onClose={() => setPicker(null)}
          kind={picker.kind}
          multiple={picker.target === "images" || picker.target === "audios"}
          selected={pickerSelected}
          onConfirm={applyPick}
          title={picker.target === "video" ? "Ana videoyu seçin" : picker.target === "instruction" ? "Yönerge videosunu seçin" : picker.target === "images" ? "Uyaran görselleri" : "Uyaran sesleri"}
        />
      )}
    </div>
  );
}
