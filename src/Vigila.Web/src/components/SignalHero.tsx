import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { kindColor } from "../lib/format";
import type { StimulusKind } from "../lib/types";

interface Pulse {
  id: number;
  kind: StimulusKind;
  x: number;
  y: number;
  shape: number;
  rt: number | null;
  born: number;
}

const WINDOW_MS = 9000;
const KINDS: StimulusKind[] = ["visual", "auditory", "visual", "audiovisual", "auditory", "visual"];

function Shape({ shape, color }: { shape: number; color: string }) {
  if (shape === 0) return <circle cx="20" cy="20" r="15" fill={color} />;
  if (shape === 1) return <rect x="6" y="6" width="28" height="28" rx="7" fill={color} />;
  return <path d="M20 4 L36 34 H4 Z" fill={color} strokeLinejoin="round" />;
}

/**
 * Giriş ekranındaki canlı sahne: soyut bir video üzerinde uyaranlar belirir, alttaki zaman çizelgesinde
 * her uyaranın bloğu ve katılımcının tepki süresi akar. Ürünün ne ölçtüğünü tek bakışta anlatır.
 */
export function SignalHero() {
  const reduce = useReducedMotion();
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [now, setNow] = useState(() => performance.now());
  const counter = useRef(0);

  useEffect(() => {
    const spawn = () => {
      const id = counter.current++;
      const kind = KINDS[id % KINDS.length];
      const missed = id % 7 === 5;
      setPulses((list) => [
        ...list.filter((p) => performance.now() - p.born < WINDOW_MS + 500),
        {
          id,
          kind,
          x: 0.12 + Math.random() * 0.7,
          y: 0.14 + Math.random() * 0.56,
          shape: id % 3,
          rt: missed ? null : Math.round(260 + Math.random() * 240 - (kind === "audiovisual" ? 60 : 0)),
          born: performance.now(),
        },
      ]);
    };
    spawn();
    if (reduce) return;
    const timer = setInterval(spawn, 1700);
    let raf = 0;
    const loop = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  const visible = pulses.filter((p) => now - p.born < 1100);
  const last = [...pulses].reverse().find((p) => p.rt != null && now - p.born > p.rt);
  const hits = pulses.filter((p) => p.rt != null && now - p.born > p.rt).length;
  const shown = pulses.filter((p) => now - p.born > 900).length;

  return (
    <div className="relative w-full max-w-[560px]">
      <div className="relative aspect-[16/10] overflow-hidden rounded-[22px] border border-line-strong bg-black shadow-[0_50px_120px_-40px_rgb(154_108_240/0.45)]">
        {/* Soyut "video": yavaşça gezinen ışık lekeleri */}
        <motion.div
          className="absolute -inset-1/4 opacity-80"
          style={{ background: "radial-gradient(circle at 30% 35%, #2a3290 0, transparent 38%), radial-gradient(circle at 70% 65%, #4a1f63 0, transparent 40%), radial-gradient(circle at 55% 20%, #13505f 0, transparent 30%)" }}
          animate={reduce ? undefined : { rotate: [0, 8, -4, 0], scale: [1, 1.08, 1.02, 1] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_60%,rgb(0_0_0/0.55))]" />

        <AnimatePresence>
          {visible.map((p) => {
            const color = kindColor[p.kind];
            const hasImage = p.kind !== "auditory";
            const hasSound = p.kind !== "visual";
            return (
              <motion.div key={p.id} className="absolute" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
                {hasImage && (
                  <motion.svg viewBox="0 0 40 40" className="size-11 drop-shadow-[0_0_18px_currentColor]" style={{ color }} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
                    <Shape shape={p.shape} color={color} />
                  </motion.svg>
                )}
                {hasSound &&
                  [0, 1, 2].map((ring) => (
                    <motion.span
                      key={ring}
                      className="absolute top-1/2 left-1/2 rounded-full border-2"
                      style={{ borderColor: color, width: 44, height: 44, marginLeft: -22, marginTop: hasImage ? -44 : -22 }}
                      initial={{ scale: 0.4, opacity: 0.9 }}
                      animate={{ scale: 2.6, opacity: 0 }}
                      transition={{ duration: 1.1, delay: ring * 0.18, ease: "easeOut" }}
                    />
                  ))}
              </motion.div>
            );
          })}
        </AnimatePresence>

        <div className="absolute inset-x-4 bottom-3 flex items-end justify-between text-[12px]">
          <div>
            <p className="text-mist">Son tepki</p>
            <p className="display text-[30px] leading-none tabular-nums">{last ? `${last.rt} ms` : "–"}</p>
          </div>
          <div className="text-right">
            <p className="text-mist">İsabet</p>
            <p className="display text-[30px] leading-none tabular-nums">{shown > 0 ? `%${Math.round((hits / shown) * 100)}` : "–"}</p>
          </div>
        </div>
      </div>

      {/* Kayan zaman çizelgesi: sağdan girip sola akar */}
      <div className="relative mt-4 h-[74px] overflow-hidden rounded-2xl border border-line bg-ink-950/80">
        <div className="absolute inset-x-0 top-[22px] h-px bg-line" />
        <div className="absolute inset-x-0 top-[48px] h-px bg-line" />
        <span className="absolute top-1 left-3 text-[10.5px] text-haze">Uyaranlar</span>
        <span className="absolute top-[52px] left-3 text-[10.5px] text-haze">Tepkiler</span>
        {pulses.map((p) => {
          const age = now - p.born;
          const x = 100 - (age / WINDOW_MS) * 100;
          if (x < -12) return null;
          const responded = p.rt != null && age > p.rt;
          const missed = p.rt == null && age > 1200;
          const rtWidth = p.rt == null ? 0 : (p.rt / WINDOW_MS) * 100;
          return (
            <div key={p.id} className="absolute top-0 h-full w-full" style={{ left: `${x}%` }}>
              <div
                className="absolute top-[26px] h-[18px] w-[22px] rounded-[4px] border"
                style={{ background: missed ? "transparent" : kindColor[p.kind], borderColor: missed ? "var(--color-warn)" : kindColor[p.kind], borderStyle: missed ? "dashed" : "solid" }}
              />
              {responded && (
                <>
                  <div className="absolute top-[58px] h-[3px] rounded-full" style={{ width: `${rtWidth}%`, background: kindColor[p.kind] }} />
                  <span className="absolute top-[52px] h-[14px] w-0.5 rounded bg-paper" style={{ left: `${rtWidth}%` }} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
