import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowLeft, Braces, FileSpreadsheet, MonitorPlay, Trash2, TriangleAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "../components/AppShell";
import { AnimatedNumber } from "../components/bits";
import { BlockTrend, KindComparison, QuadrantMap, RtHistogram } from "../components/charts";
import { StagePlayer, type StagePlayerHandle } from "../components/Stage";
import { Timeline } from "../components/Timeline";
import { useToast } from "../components/toast";
import { Button, ConfirmDialog, ErrorNote, PageLoader, Pill, SectionTitle } from "../components/ui";
import { api } from "../lib/api";
import { clock, date, dec, duration, fmt, kindColor, kindLabel, originLabel, outcomeLabel, quadrantLabel } from "../lib/format";
import type { StimulusKind, TrialOutcome } from "../lib/types";
import { StatusPill } from "./DashboardPage";

const reasonLabel = { pause: "Duraklatma", hidden: "Sekme değişti", fullscreen: "Tam ekrandan çıkış", buffering: "Video takıldı" } as const;

function outcomeTone(o: TrialOutcome) {
  return o === "hit" ? "success" : o === "notPresented" ? "neutral" : "warn";
}

export function SessionPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["session", id], queryFn: () => api.session(id) });
  const [replay, setReplay] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [active, setActive] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const playerRef = useRef<StagePlayerHandle | null>(null);

  const remove = useMutation({
    mutationFn: () => api.deleteSession(id),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast("Oturum silindi.");
      navigate(q.data ? `/deneyler/${q.data.info.experimentId}?sekme=sonuclar` : "/oturumlar", { replace: true });
    },
  });

  const s = q.data;
  const urls = useMemo(() => {
    const images = new Map<string, string>();
    const audios = new Map<string, string>();
    for (const a of s?.assets ?? []) (a.kind === "image" ? images : audios).set(a.id, a.url);
    return { images, audios };
  }, [s]);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !s) return <ErrorNote error={q.error} />;
  const m = s.summary;
  const trialsByIndex = new Map(s.trials.map((t) => [t.index, t]));
  const assetName = new Map(s.assets.map((a) => [a.id, a.name]));

  const timelineItems = s.schedule.map((x) => {
    const t = trialsByIndex.get(x.index);
    return { index: x.index, kind: x.kind, onsetMs: x.onsetMs, durationMs: x.durationMs, outcome: t?.outcome, rtMs: t?.rtMs ?? null };
  });

  const rtGroups = (["visual", "auditory", "audiovisual"] as StimulusKind[]).map((kind) => ({
    kind,
    values: s.trials.filter((t) => t.kind === kind && t.outcome === "hit" && t.rtMs != null).map((t) => t.rtMs!),
  }));

  const sessionLength = s.info.completedAt && s.startedAt ? new Date(s.info.completedAt).getTime() - new Date(s.startedAt).getTime() : null;

  return (
    <>
      <PageHeader
        back={
          <Link to={`/deneyler/${s.info.experimentId}?sekme=sonuclar`} className="inline-flex items-center gap-1.5 text-sm text-mist hover:text-paper">
            <ArrowLeft className="size-4" /> {s.info.experimentName}
          </Link>
        }
        title={s.info.participantCode}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusPill status={s.info.status} />
            <span>{originLabel[s.info.origin]} oturumu</span>
            <span className="text-haze">{date(s.info.completedAt ?? s.info.createdAt)}</span>
            {sessionLength != null && <span className="text-haze">{duration(sessionLength)} sürdü</span>}
          </span>
        }
        actions={
          <>
            <a href={`/api/sessions/${id}/export`} download>
              <Button icon={<FileSpreadsheet className="size-4" />}>CSV</Button>
            </a>
            <a href={`/api/sessions/${id}/export?format=json`} download>
              <Button variant="ghost" icon={<Braces className="size-4" />}>
                Ham veri
              </Button>
            </a>
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)} aria-label="Oturumu sil" />
          </>
        }
      />

      {!m ? (
        <p className="rounded-xl border border-dashed border-line-strong px-5 py-10 text-center text-mist">
          Bu oturum henüz tamamlanmadı. Katılımcı deneyi bitirdiğinde sonuçlar burada görünür.
        </p>
      ) : (
        <div className="space-y-12">
          <section className="panel grid grid-cols-2 md:grid-cols-5">
            {[
              { label: "İsabet oranı", value: m.hitRate, f: (v: number) => fmt.percent(v), note: `${m.hits} / ${m.presented} uyaran` },
              { label: "Ortalama tepki", value: m.meanRt, f: (v: number) => fmt.ms(v), note: m.sdRt != null ? `SS ${fmt.ms(m.sdRt)}` : "" },
              { label: "Ortanca tepki", value: m.medianRt, f: (v: number) => fmt.ms(v), note: m.minRt != null ? `${fmt.int(m.minRt)}–${fmt.ms(m.maxRt)}` : "" },
              { label: "Yanlış alarm", value: m.falseAlarms, f: fmt.int, note: `dakikada ${fmt.one(m.falseAlarmsPerMinute)}` },
              { label: "Erken basış", value: m.anticipations, f: fmt.int, note: `${s.settings.minValidRtMs} ms altı` },
            ].map((k, i) => (
              <div
                key={k.label}
                className={clsx("border-line p-5", i % 2 === 1 && "border-l", i > 0 && i % 2 === 0 && "md:border-l", i >= 2 && "max-md:border-t")}
              >
                <p className="text-[13px] text-mist">{k.label}</p>
                <AnimatedNumber value={k.value} format={k.f} className="display mt-1 block text-[40px] leading-none tabular-nums" />
                <p className="mt-1.5 text-[12px] text-haze tabular-nums">{k.note}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-x-10 gap-y-6 lg:grid-cols-[1.3fr_1fr]">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
              {[
                { label: "Duyarlılık (d′)", value: dec(m.dPrime), hint: "Uyaranı gürültüden ayırma gücü; yüksek değer daha iyi ayrım." },
                { label: "Yanıt ölçütü (c)", value: dec(m.criterion), hint: "Pozitif değer temkinli, negatif değer gevşek yanıt eğilimi." },
                { label: "Yanlış alarm oranı", value: fmt.percent(m.falseAlarmRate, true), hint: "Uyaran dışındaki yanıt fırsatlarına oranla." },
                { label: "Ters etkinlik puanı", value: m.ies != null ? fmt.ms(m.ies) : "–", hint: "Ortalama tepki / isabet oranı; hız ve doğruluğu birleştirir." },
                { label: "Ayıklanmış ortalama", value: fmt.ms(m.trimmedMeanRt), hint: "Ortalamadan ±2,5 SS dışındaki tepkiler çıkarıldı." },
                { label: "Fazladan basış", value: fmt.int(m.extraResponses), hint: "Aynı uyaranın penceresinde ikinci ve sonraki basışlar." },
              ].map((x) => (
                <div key={x.label}>
                  <dt className="text-[12.5px] text-mist">{x.label}</dt>
                  <dd className="display text-[28px] leading-tight tabular-nums">{x.value}</dd>
                  <p className="text-[11.5px] leading-snug text-haze">{x.hint}</p>
                </div>
              ))}
            </dl>
            {(s.questions.length > 0 || s.consentAt || s.practice) && (
              <div className="panel p-5">
                <h3 className="text-[14px] font-semibold">Katılımcı bilgileri</h3>
                <dl className="mt-3 space-y-2 text-[13px]">
                  {s.questions.map((q) => (
                    <div key={q.id} className="flex justify-between gap-4">
                      <dt className="text-mist">{q.label}</dt>
                      <dd className="text-right text-paper">{s.answers[q.id] ?? "–"}</dd>
                    </div>
                  ))}
                  {s.consentAt && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-mist">Onam</dt>
                      <dd className="text-paper">{date(s.consentAt)}</dd>
                    </div>
                  )}
                  {s.practice && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-mist">Alıştırma</dt>
                      <dd className="text-paper">
                        {s.practice.hits} / {s.practice.trials} isabet{s.practice.meanRt != null && `, ${fmt.ms(s.practice.meanRt)}`}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </section>

          {m.redundancyGainMs != null && (
            <p className="text-[15px] text-mist">
              Görsel-işitsel uyaranlara verilen tepki, en hızlı tek kanallı ortalamadan{" "}
              <strong className="font-semibold text-paper">{fmt.ms(Math.abs(m.redundancyGainMs))} {m.redundancyGainMs >= 0 ? "daha hızlı" : "daha yavaş"}</strong>. Bu fark çok duyulu kazanç (artıklık etkisi) olarak yorumlanır.
            </p>
          )}

          <section>
            <SectionTitle
              aside={
                s.videoUrl && (
                  <Button size="sm" variant={replay ? "secondary" : "ghost"} icon={<MonitorPlay className="size-4" />} onClick={() => setReplay(!replay)}>
                    {replay ? "Oynatıcıyı gizle" : "Oturumu izle"}
                  </Button>
                )
              }
            >
              Zaman çizelgesi
            </SectionTitle>
            {replay && s.videoUrl && (
              <div className="mb-5 max-w-4xl">
                <StagePlayer
                  videoUrl={s.videoUrl}
                  posterUrl={s.posterUrl}
                  videoWidth={s.video.width}
                  videoHeight={s.video.height}
                  stimuli={s.schedule}
                  imageUrls={urls.images}
                  audioUrls={urls.audios}
                  audioVolume={s.settings.audioVolume}
                  videoVolume={s.settings.videoVolume}
                  handleRef={playerRef}
                  onTick={setPlayhead}
                  onActiveChange={setActive}
                />
              </div>
            )}
            <Timeline
              durationMs={s.video.durationMs}
              items={timelineItems}
              leadInMs={s.settings.leadInMs}
              tailMs={s.settings.tailMs}
              responses={s.falseAlarms.map((f) => ({ mediaMs: f.mediaMs, falseAlarm: true }))}
              playheadMs={replay ? playhead : null}
              activeIndices={active}
              onSeek={replay ? (ms) => playerRef.current?.seek(ms) : undefined}
            />
            <p className="mt-2 text-[12px] text-haze">Dolu bloklar isabet, kesik çizgililer kaçırılan uyaranlardır. Yanıt izindeki çubuk tepki süresini, eşkenar dörtgen yanlış alarmı gösterir.</p>
          </section>

          <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
            <section>
              <SectionTitle>Tepki süresi dağılımı</SectionTitle>
              <RtHistogram groups={rtGroups} />
            </section>
            <div className="space-y-10">
              <section>
                <SectionTitle>Kanala göre</SectionTitle>
                <KindComparison rows={m.byKind.map((k) => ({ kind: k.kind, meanRt: k.meanRt, sdRt: k.sdRt, hitRate: k.hitRate, trials: k.trials }))} />
              </section>
              {m.byQuadrant.length > 0 && (
                <section>
                  <SectionTitle>Ekran çeyrekleri</SectionTitle>
                  <QuadrantMap rows={m.byQuadrant} aspect={s.video.width / s.video.height} />
                </section>
              )}
            </div>
          </div>

          {m.byBlock && m.byBlock.length > 1 && (
            <section>
              <SectionTitle>Zamana göre performans</SectionTitle>
              <BlockTrend blocks={m.byBlock} />
            </section>
          )}

          <section>
            <SectionTitle>Ölçüm kalitesi</SectionTitle>
            {(m.timing.meanOnsetLagMs ?? 0) > 60 && (
              <p className="mb-4 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-[13px] text-warn">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  Uyaranlar plandan ortalama {fmt.int(m.timing.meanOnsetLagMs)} ms geç sunuldu. Tarayıcı sekmesi arka planda kalmış ya da cihaz yavaş olabilir. Tepki süreleri gerçek
                  başlangıçtan ölçüldüğü için geçerlidir, ancak bu oturumu analize katmadan önce değerlendirin.
                </span>
              </p>
            )}
            <dl className="grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Ekran yenileme", value: s.client?.refreshRateHz != null ? `${fmt.one(s.client.refreshRateHz)} Hz` : "–", hint: "Görsel başlangıç hassasiyeti bir kare süresiyle sınırlıdır." },
                { label: "Ses çıkış gecikmesi", value: s.client?.audioOutputLatencyMs != null ? fmt.ms(s.client.audioOutputLatencyMs) : "–", hint: "Ses başlangıcı bu gecikme hesaba katılarak kaydedildi." },
                { label: "Plandan sapma", value: m.timing.meanOnsetLagMs != null ? `${fmt.one(m.timing.meanOnsetLagMs)} ms` : "–", hint: m.timing.maxOnsetLagMs != null ? `En fazla ${fmt.one(m.timing.maxOnsetLagMs)} ms; video karesine hizalamadan kaynaklanır.` : "" },
                { label: "Görsel-ses eşzamanlılığı", value: m.timing.meanAvAsyncMs != null ? `${fmt.one(m.timing.meanAvAsyncMs)} ms` : "–", hint: "Eşleşik uyaranlarda ses başlangıcı eksi görsel başlangıcı." },
              ].map((x) => (
                <div key={x.label} className="bg-ink-850 p-5">
                  <dt className="text-[13px] text-mist">{x.label}</dt>
                  <dd className="display mt-1 text-[30px] leading-none tabular-nums">{x.value}</dd>
                  <p className="mt-2 text-[12px] text-haze">{x.hint}</p>
                </div>
              ))}
            </dl>
            <div className="mt-4 grid gap-4 text-[13px] text-mist md:grid-cols-2">
              <div>
                <p className="mb-1 font-medium text-paper">Kesintiler</p>
                {s.interruptions.length === 0 ? (
                  <p>Oturum kesintisiz tamamlandı.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {s.interruptions.map((x, i) => (
                      <li key={i}>
                        {clock(x.atMediaMs)} {reasonLabel[x.reason]}
                        {x.resumedAt != null && <span className="text-haze">, {fmt.seconds(x.resumedAt - x.atTime)} sonra devam</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1 font-medium text-paper">Cihaz</p>
                <p>
                  {s.client?.screenWidth ? `${s.client.screenWidth}×${s.client.screenHeight} ekran, ` : ""}
                  {s.client?.videoFrameCallback ? "kare eşzamanlı zamanlama" : "animasyon karesi zamanlaması"}
                  {s.client?.fullscreen === false && ", tam ekran değil"}
                </p>
                <p className="mt-0.5 truncate text-haze" title={s.client?.userAgent ?? undefined}>
                  {s.client?.userAgent}
                </p>
                <p className="mt-0.5 text-haze">Tohum {s.seed}</p>
              </div>
            </div>
          </section>

          <section>
            <SectionTitle>Denemeler</SectionTitle>
            <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[12.5px] text-haze">
                    <th className="px-4 py-3 font-medium">Sıra</th>
                    <th className="px-4 py-3 font-medium">Kanal</th>
                    <th className="px-4 py-3 font-medium">Uyaran</th>
                    <th className="px-4 py-3 font-medium">Başlangıç</th>
                    <th className="px-4 py-3 text-right font-medium">Süre</th>
                    <th className="px-4 py-3 font-medium">Konum</th>
                    <th className="px-4 py-3 font-medium">Sonuç</th>
                    <th className="px-4 py-3 text-right font-medium">Tepki</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.trials.map((t) => (
                    <tr key={t.index} className="hover:bg-ink-850">
                      <td className="px-4 py-2.5 text-haze tabular-nums">{t.index + 1}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span className="size-2.5 rounded-[3px]" style={{ background: kindColor[t.kind] }} />
                          {kindLabel[t.kind]}
                        </span>
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-2.5 text-mist">{[t.imageId, t.audioId].filter(Boolean).map((x) => assetName.get(x!) ?? "Silinmiş dosya").join(" + ")}</td>
                      <td className="px-4 py-2.5 text-mist tabular-nums">{clock(t.plannedOnsetMs, true)}</td>
                      <td className="px-4 py-2.5 text-right text-mist tabular-nums">{fmt.ms(t.durationMs)}</td>
                      <td className="px-4 py-2.5 text-mist">{t.quadrant != null ? quadrantLabel[t.quadrant] : "–"}</td>
                      <td className="px-4 py-2.5">
                        <Pill tone={outcomeTone(t.outcome)}>{outcomeLabel[t.outcome]}</Pill>
                        {t.extraResponses > 0 && <span className="ml-2 text-[12px] text-haze">+{t.extraResponses} basış</span>}
                        {t.interrupted && <span className="ml-2 text-[12px] text-haze">kesintili</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{fmt.ms(t.rtMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Oturumu sil"
        description={`${s.info.participantCode} katılımcısının bu oturumuna ait bütün veri kalıcı olarak silinecek.`}
        confirmLabel="Oturumu sil"
      />
    </>
  );
}
