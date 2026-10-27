import { clsx } from "clsx";
import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** Marka işareti: düz bir sinyal, bir uyaran anı (sıçrama) ve köşedeki uyaran noktası. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx("shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--color-ink-700)" />
      <path d="M5 19h6l2.5-9 4 14 2.5-5H27" fill="none" stroke="var(--color-paper)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24.5" cy="9.5" r="3" fill="var(--color-visual)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="size-8" />
      <span className="display text-[26px] leading-none tracking-tight">Vigila</span>
    </span>
  );
}

/** Görünür olduğunda hedef değere doğru sayan gösterge. */
export function AnimatedNumber({ value, format, className }: { value: number | null | undefined; format: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value ?? 0);
  const from = useRef(0);

  useEffect(() => {
    if (value == null || !inView) return;
    if (reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, inView, reduce]);

  return (
    <span ref={ref} className={className}>
      {value == null ? "–" : format(display)}
    </span>
  );
}

/** Ses dosyasının tepe değerlerinden çizilen dalga biçimi. */
export function Waveform({ peaks, className, color = "var(--color-audio)", progress }: { peaks: number[] | null; className?: string; color?: string; progress?: number }) {
  const bars = peaks && peaks.length > 0 ? peaks : Array.from({ length: 48 }, (_, i) => 20 + ((i * 37) % 50));
  const n = bars.length;
  const w = 100 / n;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={className} aria-hidden="true">
      {bars.map((p, i) => {
        const h = Math.max(2, (p / 100) * 36);
        const played = progress != null && i / n <= progress;
        return <rect key={i} x={i * w + w * 0.18} y={20 - h / 2} width={w * 0.64} height={h} rx={w * 0.3} fill={color} opacity={progress == null ? 0.85 : played ? 1 : 0.35} />;
      })}
    </svg>
  );
}
