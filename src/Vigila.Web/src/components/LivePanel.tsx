import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/api";
import { duration, originLabel } from "../lib/format";

/** Şu anda süren oturumlar: yürütücüler 10 saniyede bir konum bildirir, panel 5 saniyede bir yenilenir. */
export function LivePanel({ experimentId }: { experimentId?: string }) {
  const q = useQuery({ queryKey: ["live"], queryFn: api.live, refetchInterval: 5000, refetchIntervalInBackground: false });
  const list = (q.data ?? []).filter((l) => !experimentId || l.experimentId === experimentId);

  return (
    <AnimatePresence initial={false}>
      {list.length > 0 && (
        <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
          <div className="panel p-5">
            <h2 className="flex items-center gap-2.5 text-[15px] font-semibold">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-success" />
              </span>
              Şu anda süren {list.length} oturum
            </h2>
            <ul className="mt-4 space-y-3">
              {list.map((l) => {
                const fraction = l.durationMs > 0 ? Math.min(1, l.progressMs / l.durationMs) : 0;
                return (
                  <li key={l.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[180px_1fr_150px]">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{l.participantCode}</p>
                      {!experimentId && <p className="truncate text-[12px] text-haze">{l.experimentName}</p>}
                    </div>
                    <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-ink-950 sm:col-span-1">
                      <motion.div className="h-full rounded-full bg-success" initial={false} animate={{ width: `${fraction * 100}%` }} transition={{ ease: "linear", duration: 0.8 }} />
                    </div>
                    <p className="row-start-1 text-right text-[12px] text-mist tabular-nums sm:row-auto">
                      %{Math.round(fraction * 100)}, {duration(Math.max(0, l.durationMs - l.progressMs))} kaldı
                      <span className="block text-haze">{originLabel[l.origin]}</span>
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
