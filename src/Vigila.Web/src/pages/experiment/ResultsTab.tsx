import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { FileSpreadsheet } from "lucide-react";
import { Link } from "react-router";
import { AnimatedNumber } from "../../components/bits";
import { BlockTrend, KindComparison, QuadrantMap, RtHistogram } from "../../components/charts";
import { LivePanel } from "../../components/LivePanel";
import { Button, EmptyState, ErrorNote, PageLoader, SectionTitle } from "../../components/ui";
import { api } from "../../lib/api";
import { date, dec, fmt, kindColor, kindLabel, originLabel, pValue } from "../../lib/format";
import type { Experiment } from "../../lib/types";
import { StatusPill } from "../DashboardPage";

export function ResultsTab({ experiment }: { experiment: Experiment }) {
  const analytics = useQuery({ queryKey: ["analytics", experiment.id], queryFn: () => api.analytics(experiment.id) });
  const sessions = useQuery({ queryKey: ["experiment-sessions", experiment.id], queryFn: () => api.experimentSessions(experiment.id) });

  if (analytics.isLoading || sessions.isLoading) return <PageLoader />;
  if (analytics.error) return <ErrorNote error={analytics.error} />;
  const a = analytics.data!;
  const list = sessions.data ?? [];

  if (a.sessions === 0) {
    return (
      <div className="space-y-6">
        <LivePanel experimentId={experiment.id} />
        <EmptyState title="Henüz oturum yok">
          Katılım sekmesinden bağlantıyı açın ya da oturumu laboratuvarda başlatın. Tamamlanan her oturum burada toplu analize eklenir.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <LivePanel experimentId={experiment.id} />
      <section className="flex flex-wrap items-end justify-between gap-6">
        <dl className="grid flex-1 grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-5">
          {[
            { label: "Tamamlanan oturum", value: a.completed, f: fmt.int },
            { label: "Katılımcı", value: a.participants, f: fmt.int },
            { label: "Ortalama isabet", value: a.meanHitRate, f: (v: number) => fmt.percent(v) },
            { label: "Ortalama tepki", value: a.meanRt, f: (v: number) => fmt.ms(v) },
            { label: "Ortalama d′", value: a.meanDPrime, f: (v: number) => dec(v) },
          ].map((s) => (
            <div key={s.label}>
              <dt className="text-[13px] text-mist">{s.label}</dt>
              <dd>
                <AnimatedNumber value={s.value} format={s.f} className="display text-[44px] leading-none tabular-nums" />
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/experiments/${experiment.id}/export`} download>
            <Button icon={<FileSpreadsheet className="size-4" />}>Deneme verisi (CSV)</Button>
          </a>
          <a href={`/api/experiments/${experiment.id}/export?kind=sessions`} download>
            <Button variant="ghost">Oturum özetleri (CSV)</Button>
          </a>
        </div>
      </section>

      {a.completed > 0 && (
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <section>
            <SectionTitle>Tepki süresi dağılımı</SectionTitle>
            <RtHistogram groups={a.hitRts} />
            <p className="mt-3 text-[12.5px] text-haze">Tüm tamamlanan oturumlardaki isabetli yanıtlar. Ortalama, katılımcı ortalamalarının ortalamasıdır; ortanca tüm yanıtlardan hesaplanır.</p>
          </section>
          <div className="space-y-10">
            <section>
              <SectionTitle>Kanala göre</SectionTitle>
              <KindComparison rows={a.byKind.map((k) => ({ kind: k.kind, meanRt: k.meanRt, hitRate: k.hitRate, trials: k.trials }))} />
            </section>
            {a.byQuadrant.length > 0 && (
              <section>
                <SectionTitle>Ekran çeyrekleri</SectionTitle>
                <QuadrantMap rows={a.byQuadrant} />
              </section>
            )}
          </div>
        </div>
      )}

      {a.comparisons.length > 0 && (
        <section>
          <SectionTitle>Kanallar arası karşılaştırma</SectionTitle>
          <p className="-mt-2 mb-4 max-w-3xl text-[13px] text-haze">
            Eşleştirilmiş t-testi; her katılımcının kanal ortalamaları karşılaştırılır. Fark A − B olarak verilir, dz etki büyüklüğüdür (0,2 küçük, 0,5 orta, 0,8 büyük).
          </p>
          <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[12.5px] text-haze">
                  <th className="px-4 py-3 font-medium">Karşılaştırma</th>
                  <th className="px-4 py-3 text-right font-medium">N</th>
                  <th className="px-4 py-3 text-right font-medium">Fark</th>
                  <th className="px-4 py-3 text-right font-medium">t</th>
                  <th className="px-4 py-3 text-right font-medium">p</th>
                  <th className="px-4 py-3 text-right font-medium">dz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {a.comparisons.map((c) => {
                  const significant = c.test.p != null && c.test.p < 0.05;
                  return (
                    <tr key={`${c.a}-${c.b}`}>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2">
                          <span className="size-2.5 rounded-[3px]" style={{ background: kindColor[c.a] }} />
                          {kindLabel[c.a]}
                          <span className="text-haze">ile</span>
                          <span className="size-2.5 rounded-[3px]" style={{ background: kindColor[c.b] }} />
                          {kindLabel[c.b]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.test.n}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt.ms(c.test.meanDiff)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {c.test.t != null ? `t(${c.test.df}) = ${dec(c.test.t)}` : "–"}
                      </td>
                      <td className={clsx("px-4 py-3 text-right tabular-nums", significant ? "font-semibold text-paper" : "text-mist")}>{pValue(c.test.p)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{dec(c.test.dz)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {a.byBlock.length > 1 && (
        <section>
          <SectionTitle>Zamana göre performans</SectionTitle>
          <p className="-mt-2 mb-4 max-w-3xl text-[13px] text-haze">Her tekrar bloğunda katılımcı ortalamaları. Tepki süresinin uzaması ya da isabetin düşmesi dikkat yorgunluğuna işaret eder.</p>
          <BlockTrend blocks={a.byBlock} />
        </section>
      )}

      <section>
        <SectionTitle>Oturumlar</SectionTitle>
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[12.5px] text-haze">
                <th className="px-4 py-3 font-medium">Katılımcı</th>
                <th className="px-4 py-3 font-medium">Kaynak</th>
                <th className="px-4 py-3 font-medium">Tarih</th>
                <th className="px-4 py-3 font-medium">Durum</th>
                <th className="px-4 py-3 text-right font-medium">İsabet</th>
                <th className="px-4 py-3 text-right font-medium">Ort. tepki</th>
                <th className="px-4 py-3 text-right font-medium">Yanlış alarm</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((s) => (
                <tr key={s.id} className="transition-colors hover:bg-ink-850">
                  <td className="px-4 py-3">
                    <Link to={`/oturumlar/${s.id}`} className="font-medium text-paper hover:text-av">
                      {s.participantCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-mist">{originLabel[s.origin]}</td>
                  <td className="px-4 py-3 text-mist">{date(s.completedAt ?? s.createdAt)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt.percent(s.hitRate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt.ms(s.meanRt)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt.int(s.falseAlarms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
