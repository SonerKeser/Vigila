import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowUpRight, FlaskConical, Library, Plus, Send } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router";
import { PageHeader } from "../components/AppShell";
import { AnimatedNumber } from "../components/bits";
import { ActivityBars, TrendLine } from "../components/charts";
import { LivePanel } from "../components/LivePanel";
import { useToast } from "../components/toast";
import { Button, ErrorNote, PageLoader, Pill, SectionTitle } from "../components/ui";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { date, fmt, greeting, originLabel, relative, statusLabel } from "../lib/format";
import type { SessionListItem } from "../lib/types";
import { flushPending } from "../runner/pending";

export function StatusPill({ status }: { status: SessionListItem["status"] }) {
  const tone = status === "completed" ? "success" : status === "aborted" ? "warn" : "neutral";
  return <Pill tone={tone}>{statusLabel[status]}</Pill>;
}

function Onboarding() {
  const steps = [
    { title: "Medyayı yükleyin", text: "Ana videoyu, uyaran görsellerini ve seslerini kütüphaneye ekleyin.", to: "/medya", icon: Library, cta: "Kütüphaneyi aç" },
    { title: "Deneyi tasarlayın", text: "Uyaran havuzunu, gösterim süresini ve yerleşimi seçin; planı zaman çizelgesinde görün.", to: "/deneyler", icon: FlaskConical, cta: "Deney oluştur" },
    { title: "Katılımcıları davet edin", text: "Katılım bağlantısını paylaşın ya da oturumu laboratuvarda kendiniz başlatın.", to: "/deneyler", icon: Send, cta: "Deneylere git" },
  ];
  return (
    <ol className="grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line md:grid-cols-3">
      {steps.map((s, i) => (
        <li key={s.title} className="flex flex-col gap-3 bg-ink-850 p-6">
          <span className="display text-[44px] leading-none text-haze">{i + 1}</span>
          <h3 className="text-[17px] font-semibold">{s.title}</h3>
          <p className="flex-1 text-sm text-mist">{s.text}</p>
          <Link to={s.to} className="inline-flex items-center gap-1.5 text-sm font-medium text-paper hover:text-av">
            {s.cta}
            <ArrowUpRight className="size-4" />
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function DashboardPage() {
  const me = useMe().data!;
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });

  useEffect(() => {
    void flushPending().then((n) => {
      if (n > 0) {
        toast(`${n} oturumun bekleyen sonucu gönderildi.`, "info");
        void qc.invalidateQueries({ queryKey: ["dashboard"] });
      }
    });
  }, [toast, qc]);

  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const firstName = me.displayName.split(" ")[0];
  const fresh = d.experiments === 0 && d.sessionsCompleted === 0;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={fresh ? "Vigila'ya hoş geldiniz. Üç adımda ilk deneyinizi yürütebilirsiniz." : d.sessionsThisWeek > 0 ? `Son yedi günde ${d.sessionsThisWeek} oturum tamamlandı.` : "Son yedi günde tamamlanan oturum yok."}
        actions={
          <Link to="/deneyler?yeni=1">
            <Button variant="primary" icon={<Plus className="size-4" />}>
              Yeni deney
            </Button>
          </Link>
        }
      />

      <div className="mb-8">
        <LivePanel />
      </div>

      {fresh ? (
        <Onboarding />
      ) : (
        <>
          <section className="panel grid grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Tamamlanan oturum", value: d.sessionsCompleted, f: fmt.int, note: `${d.experiments} etkin deney` },
              { label: "Katılımcı", value: d.participants, f: fmt.int, note: `${d.activeLinks} açık katılım bağlantısı` },
              { label: "Ortalama isabet", value: d.meanHitRate, f: (v: number) => fmt.percent(v), note: "Tamamlanan oturumlar" },
              { label: "Ortalama tepki süresi", value: d.meanRt, f: (v: number) => fmt.ms(v), note: null },
            ].map((s, i) => (
              <div key={s.label} className={clsx("flex flex-col gap-2 p-5 sm:p-6", i % 2 === 1 && "border-l border-line", i >= 2 && "border-t border-line lg:border-t-0", i === 2 && "lg:border-l")}>
                <span className="text-[13px] text-mist">{s.label}</span>
                <AnimatedNumber value={s.value} format={s.f} className="display text-[44px] leading-none tabular-nums sm:text-[52px]" />
                {s.note ? (
                  <span className="text-[12px] text-haze">{s.note}</span>
                ) : (
                  <TrendLine
                    height={28}
                    points={d.trend.map((t) => ({ label: date(t.at), value: t.meanRt }))}
                    format={(v) => fmt.ms(v)}
                    color="var(--color-av)"
                  />
                )}
              </div>
            ))}
          </section>

          <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_340px]">
            <section>
              <SectionTitle aside={<Link to="/oturumlar" className="text-sm text-mist hover:text-paper">Tümünü gör</Link>}>Son oturumlar</SectionTitle>
              {d.recent.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-mist">Henüz oturum yok. Bir deneyin katılım sekmesinden ilk oturumu başlatın.</p>
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {d.recent.map((s) => (
                    <li key={s.id}>
                      <Link to={`/oturumlar/${s.id}`} className="group grid grid-cols-[1fr_auto] items-center gap-4 px-1 py-3.5 sm:grid-cols-[1.2fr_1fr_110px_90px]">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-paper group-hover:text-av">{s.participantCode}</p>
                          <p className="truncate text-[13px] text-haze">{s.experimentName}</p>
                        </div>
                        <div className="hidden text-[13px] text-mist sm:block">
                          {originLabel[s.origin]}, {relative(s.completedAt ?? s.createdAt)}
                        </div>
                        <div className="hidden text-right sm:block">
                          {s.status === "completed" ? (
                            <>
                              <p className="text-sm text-paper tabular-nums">{fmt.ms(s.meanRt)}</p>
                              <div className="mt-1 ml-auto h-1 w-20 overflow-hidden rounded-full bg-ink-950">
                                <div className="h-full rounded-full bg-success" style={{ width: `${(s.hitRate ?? 0) * 100}%` }} />
                              </div>
                            </>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <StatusPill status={s.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <aside className="space-y-8">
              <div>
                <SectionTitle>Son 14 gün</SectionTitle>
                <ActivityBars days={d.activity} />
              </div>
              <div className="panel p-5">
                <p className="text-[13px] text-mist">Kalan oturum kredisi</p>
                <p className="display mt-1 text-[40px] leading-none">{d.creditsRemaining == null ? "Sınırsız" : fmt.int(d.creditsRemaining)}</p>
                <p className="mt-2 text-[12.5px] text-haze">Her yeni oturum bir kredi kullanır. Bugüne dek {fmt.int(d.creditsUsed)} kredi kullanıldı.</p>
              </div>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
