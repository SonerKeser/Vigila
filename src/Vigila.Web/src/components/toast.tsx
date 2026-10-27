import { AnimatePresence, motion } from "motion/react";
import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3200);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ type: "spring", stiffness: 500, damping: 36 }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line-strong bg-ink-800/95 px-4 py-3 text-sm shadow-[0_20px_50px_-20px_rgb(0_0_0/0.7)] backdrop-blur"
            >
              {t.tone === "success" && <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />}
              {t.tone === "error" && <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />}
              {t.tone === "info" && <Info className="mt-0.5 size-4 shrink-0 text-av" />}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
