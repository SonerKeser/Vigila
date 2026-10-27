import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "../components/AppShell";
import { EmptyState, ErrorNote, PageLoader, Segmented } from "../components/ui";
import { api } from "../lib/api";
import { date, fmt, originLabel } from "../lib/format";
import type { SessionStatus } from "../lib/types";
import { StatusPill } from "./DashboardPage";

export function SessionsPage() {
  const q = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | SessionStatus>("all");

  const list = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("tr");
    return (q.data ?? []).filter(
      (s) => (status === "all" || s.status === status) && (!term || s.participantCode.toLocaleLowerCase("tr").includes(term) || s.experimentName.toLocaleLowerCase("tr").includes(term)),
    );
  }, [q.data, search, status]);

  return (
    <>
      <PageHeader title="Oturumlar" description="Bütün deneylerinizin oturumları, en yeniden eskiye." />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-haze" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Katılımcı ya da deney ara" aria-label="Ara" className="field pl-9" />
        </div>
        <div className="w-full max-w-md">
          <Segmented
            label="Durum"
            size="sm"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "Tümü" },
              { value: "completed", label: "Tamamlanan" },
              { value: "aborted", label: "Yarıda kalan" },
              { value: "running", label: "Süren" },
            ]}
          />
        </div>
      </div>

      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : list.length === 0 ? (
        <EmptyState title={q.data?.length ? "Eşleşen oturum yok" : "Henüz oturum yok"}>{q.data?.length ? "Aramayı ya da durum filtresini değiştirin." : "Bir deneyin Katılım sekmesinden ilk oturumu başlatın."}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[12.5px] text-haze">
                <th className="px-4 py-3 font-medium">Katılımcı</th>
                <th className="px-4 py-3 font-medium">Deney</th>
                <th className="px-4 py-3 font-medium">Kaynak</th>
                <th className="px-4 py-3 font-medium">Tarih</th>
                <th className="px-4 py-3 font-medium">Durum</th>
                <th className="px-4 py-3 text-right font-medium">İsabet</th>
                <th className="px-4 py-3 text-right font-medium">Ort. tepki</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((s) => (
                <tr key={s.id} className="hover:bg-ink-850">
                  <td className="px-4 py-3">
                    <Link to={`/oturumlar/${s.id}`} className="font-medium text-paper hover:text-av">
                      {s.participantCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/deneyler/${s.experimentId}?sekme=sonuclar`} className="text-mist hover:text-paper">
                      {s.experimentName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-mist">{originLabel[s.origin]}</td>
                  <td className="px-4 py-3 text-mist">{date(s.completedAt ?? s.createdAt)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt.percent(s.hitRate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt.ms(s.meanRt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
