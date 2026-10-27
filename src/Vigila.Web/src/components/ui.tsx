import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { LoaderCircle, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: "bg-paper text-ink-950 hover:bg-white shadow-[0_0_0_1px_rgb(255_255_255/0.4),0_8px_24px_-12px_rgb(154_108_240/0.8)]",
  secondary: "bg-ink-800 text-paper border border-line-strong hover:border-[rgb(148_160_255/0.4)] hover:bg-ink-700",
  ghost: "text-mist hover:text-paper hover:bg-ink-800",
  danger: "bg-danger/12 text-danger border border-danger/30 hover:bg-danger/20",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[9px]",
  md: "h-10 px-4 text-sm gap-2 rounded-[var(--radius-control)]",
  lg: "h-12 px-6 text-[15px] gap-2.5 rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background,border-color,color,transform] duration-150 active:scale-[0.98] disabled:opacity-45 disabled:active:scale-100",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx("inline-flex size-9 items-center justify-center rounded-[9px] text-mist transition-colors hover:bg-ink-800 hover:text-paper disabled:opacity-40", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (id: string, describedBy?: string) => ReactNode;
  className?: string;
  trailing?: ReactNode;
}

export function Field({ label, hint, error, children, className, trailing }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-paper">
          {label}
        </label>
        {trailing}
      </div>
      {children(id, hint || error ? hintId : undefined)}
      {(error || hint) && (
        <p id={hintId} className={clsx("text-[12.5px] leading-snug", error ? "text-danger" : "text-haze")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={clsx("field", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx("field min-h-28 resize-y leading-relaxed", className)} {...rest} />;
});

/** Birimli sayı alanı (ms, % vb.). */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  id,
  invalid,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  id?: string;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("relative", className)}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className={clsx("field tabular-nums", unit && "pr-12")}
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      />
      {unit && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-haze">{unit}</span>}
    </div>
  );
}

export function Slider({ value, onChange, min, max, step, id, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; id?: string; label?: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      id={id}
      aria-label={label}
      type="range"
      className="range"
      style={{ ["--fill" as string]: `${fill}%` }}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Switch({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string; disabled?: boolean }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx("relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40", checked ? "border-av/60 bg-av/80" : "border-line-strong bg-ink-950")}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 600, damping: 34 }}
        className={clsx("absolute top-0.5 size-[18px] rounded-full bg-paper shadow", checked ? "right-0.5" : "left-0.5")}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  label: string;
  size?: "sm" | "md";
}) {
  const group = useId();
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex w-full rounded-[11px] border border-line bg-ink-950 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={clsx(
              "relative flex flex-1 items-center justify-center gap-1.5 rounded-[8px] font-medium transition-colors",
              size === "sm" ? "h-7 px-2 text-[12.5px]" : "h-8 px-3 text-[13px]",
              active ? "text-paper" : "text-haze hover:text-mist",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${group}`}
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-[8px] border border-line-strong bg-ink-700"
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  const group = useId();
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={clsx("relative -mb-px flex h-11 items-center gap-2 px-3.5 text-sm font-medium transition-colors", active ? "text-paper" : "text-haze hover:text-mist")}
          >
            {t.label}
            {t.count != null && <span className="rounded-full bg-ink-800 px-1.5 text-[11px] tabular-nums text-mist">{t.count}</span>}
            {active && <motion.span layoutId={`tab-${group}`} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-paper" />}
          </button>
        );
      })}
    </div>
  );
}

export function Pill({ tone = "neutral", children, className }: { tone?: "neutral" | "visual" | "audio" | "av" | "warn" | "danger" | "success"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-ink-800 text-mist border-line",
    visual: "bg-visual/10 text-visual border-visual/25",
    audio: "bg-audio/10 text-audio border-audio/25",
    av: "bg-av/10 text-av border-av/25",
    warn: "bg-warn/10 text-warn border-warn/25",
    danger: "bg-danger/10 text-danger border-danger/25",
    success: "bg-success/10 text-success border-success/25",
  };
  return <span className={clsx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={clsx("inline-flex min-w-7 items-center justify-center rounded-md border border-b-2 border-line-strong bg-ink-800 px-1.5 py-0.5 font-sans text-[12px] font-medium text-paper", className)}>
      {children}
    </kbd>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={clsx("animate-spin text-haze", className ?? "size-5")} />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-panel)] border border-dashed border-line-strong px-6 py-14 text-center">
      {icon && <div className="text-haze">{icon}</div>}
      <h3 className="display text-2xl">{title}</h3>
      {children && <p className="max-w-md text-sm text-mist">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const detail = (error as { detail?: string }).detail;
  return (
    <div role="alert" className={clsx("rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger", className)}>
      <p className="font-medium">{message}</p>
      {detail && <p className="mt-0.5 text-danger/80">{detail}</p>}
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => panelRef.current?.querySelector<HTMLElement>("input,textarea,select,button[data-autofocus]")?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      previous?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-ink-950/75 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="panel relative max-h-[90dvh] w-full overflow-y-auto p-6 shadow-[0_40px_120px_-30px_rgb(0_0_0/0.8)]"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="display text-[28px]">
                  {title}
                </h2>
                {description && <div className="mt-1.5 text-sm text-mist">{description}</div>}
              </div>
              <IconButton label="Kapat" onClick={onClose} className="-mt-1 -mr-2">
                <X className="size-4" />
              </IconButton>
            </div>
            {children}
            {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  loading,
  danger = true,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  loading?: boolean;
  danger?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export function SectionTitle({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-4 flex items-end justify-between gap-4", className)}>
      <h2 className="display text-[26px] leading-none">{children}</h2>
      {aside}
    </div>
  );
}
