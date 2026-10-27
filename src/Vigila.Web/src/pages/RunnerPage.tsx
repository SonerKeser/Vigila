import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { CircleCheck, Headphones, Maximize, MousePointerClick, RotateCcw, TriangleAlert, Volume2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Logo } from "../components/bits";
import { Button, Input, Kbd, Spinner } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { fmt } from "../lib/format";
import type { Interruption, ParticipantLanguage, PracticeResult, Question, RunInfo, RunPayload, SessionSummary } from "../lib/types";
import { AudioEngine } from "../runner/audio";
import { TrialEngine, fitContain, type Rect } from "../runner/engine";
import { dictionaries, durationText, keyName, type RunnerText } from "../runner/i18n";
import { clearPending, flushPending, savePending } from "../runner/pending";
import { PracticeEngine, type PracticeFeedback } from "../runner/practice";
import { clientInfo, measureRefreshRate, prepareRun, type PreparedRun } from "../runner/preload";

type Stage =
  | { kind: "loading" }
  | { kind: "error"; error: unknown; retry?: () => void }
  | { kind: "blocked"; message: string }
  | { kind: "welcome" }
  | { kind: "form" }
  | { kind: "instructionVideo" }
  | { kind: "keycheck" }
  | { kind: "preparing"; progress: number; label: string }
  | { kind: "ready" }
  | { kind: "practice"; run: number }
  | { kind: "practiceDone"; result: PracticeResult }
  | { kind: "countdown"; n: number }
  | { kind: "running" }
  | { kind: "paused"; reason: Interruption["reason"] }
  | { kind: "submitting" }
  | { kind: "done"; summary: SessionSummary | null; savedLocally?: boolean; redirectUrl?: string | null };

const stepOf = (k: Stage["kind"]) =>
  k === "welcome" || k === "form" || k === "instructionVideo" ? 0 : k === "keycheck" ? 1 : k === "preparing" || k === "ready" ? 2 : 3;

/**
 * Tarayıcı izni gerektiren çağrılar (tam ekran, ses bağlamı, ekran uyanık kilidi) bazı ortamlarda hiç
 * sonuçlanmayabilir. Deney bunlara takılıp kalmasın diye en fazla verilen süre kadar beklenir.
 */
function settle<T>(promise: Promise<T> | undefined, ms = 1500): Promise<T | undefined> {
  if (!promise) return Promise.resolve(undefined);
  return Promise.race([promise.catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}

const fallbackLang = (): ParticipantLanguage => (navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en");
const doneKey = (token: string) => `vigila.done.${token}`;
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) != null;
  } catch {
    return false;
  }
};

function Shell({ stage, t, children }: { stage: Stage; t: RunnerText; children: ReactNode }) {
  const step = stepOf(stage.kind);
  return (
    <div className="flex min-h-dvh flex-col bg-black px-5 py-6 text-paper">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <Logo className="opacity-80" />
        <ol className="hidden items-center gap-5 text-[12.5px] sm:flex" aria-label="Adımlar">
          {t.steps.map((label, i) => (
            <li key={label} className={clsx("flex items-center gap-2", i === step ? "text-paper" : i < step ? "text-mist" : "text-haze")}>
              <span className={clsx("grid size-5 place-items-center rounded-full border text-[11px] tabular-nums", i < step ? "border-success/50 bg-success/15 text-success" : i === step ? "border-paper" : "border-haze/50")}>
                {i < step ? "✓" : i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-10">
        <AnimatePresence mode="wait">
          <motion.div key={stage.kind} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

/** Onam metni ve katılımcı soruları. */
function ConsentForm({
  info,
  t,
  answers,
  setAnswers,
  consented,
  setConsented,
  onDone,
}: {
  info: RunInfo;
  t: RunnerText;
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  consented: boolean;
  setConsented: (v: boolean) => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (info.consentText && !consented) return setError(t.consentRequired);
    const missing = info.questions.find((q) => q.required && !answers[q.id]?.trim());
    if (missing) return setError(t.answerRequired(missing.label));
    setError(null);
    onDone();
  };
  const field = (q: Question) => {
    const value = answers[q.id] ?? "";
    const set = (v: string) => setAnswers({ ...answers, [q.id]: v });
    if (q.type === "choice")
      return (
        <div role="radiogroup" className="flex flex-wrap gap-2">
          {(q.options ?? []).map((o) => (
            <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => set(o)} className={clsx("rounded-full border px-3.5 py-1.5 text-sm transition-colors", value === o ? "border-av bg-av/20 text-paper" : "border-line-strong text-mist hover:text-paper")}>
              {o}
            </button>
          ))}
        </div>
      );
    if (q.type === "scale") {
      const min = q.min ?? 1;
      const max = q.max ?? 5;
      return (
        <div role="radiogroup" className="flex flex-wrap gap-1.5">
          {Array.from({ length: max - min + 1 }, (_, i) => String(min + i)).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => set(v)} className={clsx("grid size-10 place-items-center rounded-lg border text-sm tabular-nums transition-colors", value === v ? "border-av bg-av/20 text-paper" : "border-line-strong text-mist hover:text-paper")}>
              {v}
            </button>
          ))}
        </div>
      );
    }
    return <Input id={`q-${q.id}`} type={q.type === "number" ? "number" : "text"} min={q.min ?? undefined} max={q.max ?? undefined} value={value} maxLength={1000} onChange={(e) => set(e.target.value)} />;
  };

  return (
    <div>
      {info.consentText && (
        <section>
          <h1 className="display text-[40px]">{t.consentTitle}</h1>
          <div className="mt-4 max-h-[38vh] overflow-y-auto rounded-xl border border-line bg-ink-950 p-4 text-[14.5px] leading-relaxed whitespace-pre-line text-mist">{info.consentText}</div>
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-paper">
            <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-av)]" />
            {t.consentAgree}
          </label>
        </section>
      )}
      {info.questions.length > 0 && (
        <section className={info.consentText ? "mt-10" : ""}>
          <h2 className="display text-[34px]">{t.formTitle}</h2>
          <div className="mt-5 flex flex-col gap-5">
            {info.questions.map((q) => (
              <div key={q.id}>
                <label htmlFor={`q-${q.id}`} className="mb-2 block text-[14px] font-medium">
                  {q.label} {q.required && <span className="text-[12px] font-normal text-haze">({t.required})</span>}
                </label>
                {field(q)}
              </div>
            ))}
          </div>
        </section>
      )}
      {error && <p className="mt-5 text-sm text-warn">{error}</p>}
      <Button variant="primary" size="lg" className="mt-8" onClick={submit}>
        {t.continue}
      </Button>
    </div>
  );
}

/** Yanıt yönteminin çalıştığını katılımcıya gösteren deneme adımı (tuş, dokunma ya da ikisi). */
function ResponseCheck({ info, t, onReady }: { info: RunInfo; t: RunnerText; onReady: () => void }) {
  const [presses, setPresses] = useState(0);
  const [flash, setFlash] = useState(0);
  const touch = info.responseMode === "pointer";
  const keyboard = info.responseMode !== "pointer";

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== info.responseKey) return;
      e.preventDefault();
      if (e.repeat) return;
      setPresses((p) => p + 1);
      setFlash((f) => f + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, info.responseKey]);

  const tap = () => {
    if (info.responseMode === "keyboard") return;
    setPresses((p) => p + 1);
    setFlash((f) => f + 1);
  };

  return (
    <div className="text-center">
      <h1 className="display text-[44px]">{touch ? t.touchTitle : t.keyTitle}</h1>
      <p className="mx-auto mt-3 max-w-md text-mist">{touch ? t.touchBody : t.keyBody}</p>
      <div className="relative mx-auto mt-10 grid size-44 place-items-center" onPointerDown={tap}>
        <AnimatePresence>
          <motion.span key={flash} className="absolute inset-0 rounded-[32px] border-2 border-av" initial={{ scale: 1, opacity: flash ? 0.9 : 0 }} animate={{ scale: 1.5, opacity: 0 }} transition={{ duration: 0.7, ease: "easeOut" }} />
        </AnimatePresence>
        <motion.div
          key={`k-${flash}`}
          initial={{ y: flash ? 6 : 0 }}
          animate={{ y: 0 }}
          transition={{ type: "spring", stiffness: 600, damping: 18 }}
          className={clsx("grid size-36 place-items-center rounded-[28px] border border-b-[6px] text-[26px] font-semibold transition-colors", presses > 0 ? "border-av bg-av/15 text-paper" : "border-line-strong bg-ink-800 text-mist", !keyboard && "cursor-pointer")}
        >
          {touch ? <MousePointerClick className="size-10" /> : keyName(info.responseKey, info.language)}
        </motion.div>
      </div>
      {touch && <p className="mt-3 text-[13px] text-haze">{t.touchHere}</p>}
      <p className={clsx("mt-6 h-6 text-sm", presses > 0 ? "text-success" : "text-haze")}>{presses > 0 ? t.detected(presses) : t.waiting}</p>
      <Button variant="primary" size="lg" className="mt-6" disabled={presses === 0} onClick={onReady}>
        {t.ready}
      </Button>
    </div>
  );
}

/** Videosuz alıştırma sahnesi; her yanıt penceresinden sonra geri bildirim gösterir. */
function PracticeStage({ payload, prepared, audio, t, onEnded }: { payload: RunPayload; prepared: PreparedRun; audio: AudioEngine | null; t: RunnerText; onEnded: (r: PracticeResult) => void }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const s = payload.settings;

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !payload.practice) return;
    let timer = 0;
    const engine = new PracticeEngine({
      layer,
      stimuli: payload.practice.stimuli,
      durationMs: payload.practice.durationMs,
      imageUrls: prepared.imageUrls,
      audio,
      buffers: prepared.buffers,
      responseKey: s.responseMode === "pointer" ? null : s.responseKey,
      pointer: s.responseMode !== "keyboard",
      windowMs: s.responseWindowMs,
      minValidRtMs: s.minValidRtMs,
      onFeedback: (f) => {
        if (!s.practiceFeedback) return;
        setFeedback(f);
        clearTimeout(timer);
        timer = window.setTimeout(() => setFeedback(null), 1100);
      },
      onEnded: (r) => endedRef.current(r),
    });
    engine.start();
    return () => {
      clearTimeout(timer);
      engine.stop();
    };
  }, [payload, prepared, audio, s]);

  return (
    <div className="fixed inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-black px-5">
      <p className="text-[13px] text-mist">
        {t.practiceTitle}: {s.responseMode === "pointer" ? t.practiceHintTouch : t.practiceHintKey(keyName(s.responseKey, s.language))}
      </p>
      <div className="relative w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-ink-950" style={{ aspectRatio: `${payload.video.width} / ${payload.video.height}` }}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(48_55_124/0.35),transparent_70%)]" />
        <div className="absolute top-1/2 left-1/2 text-[28px] text-haze select-none" aria-hidden="true">
          <span className="-translate-1/2 absolute">+</span>
        </div>
        <div ref={layerRef} className="absolute inset-0" />
      </div>
      <div className="h-10">
        <AnimatePresence>
          {feedback && (
            <motion.span
              key={feedback.index}
              initial={{ opacity: 0, y: 6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              className={clsx("inline-flex rounded-full border px-4 py-2 text-sm font-medium", feedback.outcome === "hit" ? "border-success/40 bg-success/15 text-success" : "border-warn/40 bg-warn/15 text-warn")}
            >
              {feedback.outcome === "hit" ? t.feedbackHit(feedback.rtMs!) : feedback.outcome === "early" ? t.feedbackEarly : t.feedbackMiss}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function RunnerPage({ mode }: { mode: "lab" | "link" }) {
  const { id = "", token = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [info, setInfo] = useState<RunInfo | null>(null);
  const urlCode = new URLSearchParams(location.search);
  const [code, setCode] = useState<string>(((location.state as { code?: string } | null)?.code ?? urlCode.get("kod") ?? urlCode.get("pid") ?? urlCode.get("PROLIFIC_PID") ?? "").trim());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [consented, setConsented] = useState(false);
  const [instructionDone, setInstructionDone] = useState(false);
  const [smallScreen, setSmallScreen] = useState(false);

  const audioRef = useRef<AudioEngine | null>(null);
  const payloadRef = useRef<RunPayload | null>(null);
  const preparedRef = useRef<PreparedRun | null>(null);
  const engineRef = useRef<TrialEngine | null>(null);
  const practiceRef = useRef<PracticeResult | null>(null);
  const refreshRef = useRef<number | null>(null);
  const finishingRef = useRef(false);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const beatRef = useRef(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect>({ left: 0, top: 0, width: 0, height: 0 });

  const lang = info?.language ?? fallbackLang();
  const t = dictionaries[lang];

  const loadInfo = useCallback(async () => {
    setStage({ kind: "loading" });
    try {
      void flushPending();
      const runInfo = mode === "lab" ? await api.labRunInfo(id) : await api.linkRunInfo(token);
      setInfo(runInfo);
      const text = dictionaries[runInfo.language];

      // Cihaz denetimi: klavye gerektiren deneyde yalnız dokunmatik cihaz, eksik tarayıcı özellikleri.
      const touchOnly = matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
      if (!("AudioContext" in window) || !("ReadableStream" in window)) return setStage({ kind: "blocked", message: text.deviceBrowser });
      if (runInfo.responseMode === "keyboard" && runInfo.blockTouchOnly && touchOnly) return setStage({ kind: "blocked", message: text.deviceTouchOnly });
      if (mode === "link" && runInfo.preventRepeat && readFlag(doneKey(token))) return setStage({ kind: "blocked", message: text.alreadyDone });
      setSmallScreen(screen.width < 1024);
      setStage({ kind: "welcome" });
    } catch (e) {
      if (e instanceof ApiError && mode === "link" && (e.status === 410 || e.status === 404 || e.status === 409)) {
        const text = dictionaries[fallbackLang()];
        setStage({ kind: "blocked", message: e.status === 404 ? text.linkMissing : text.linkClosed });
      } else setStage({ kind: "error", error: e, retry: loadInfo });
    }
  }, [mode, id, token]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  // Temizlik: motor, ses, indirilen dosyalar, tam ekran, ekran uyanık kilidi, canlı izleme.
  useEffect(
    () => () => {
      clearInterval(beatRef.current);
      engineRef.current?.detach();
      preparedRef.current?.release();
      audioRef.current?.close();
      void wakeRef.current?.release().catch(() => undefined);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );

  // Deney sürerken sayfadan ayrılma uyarısı.
  useEffect(() => {
    const active = ["preparing", "ready", "practice", "practiceDone", "countdown", "running", "paused", "submitting"].includes(stage.kind);
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [stage.kind]);

  // Bağlantıyla tamamlanan oturumda yönlendirme adresine geçiş.
  useEffect(() => {
    if (stage.kind !== "done" || !stage.redirectUrl) return;
    const target = stage.redirectUrl;
    const timer = setTimeout(() => window.location.assign(target), 4000);
    return () => clearTimeout(timer);
  }, [stage]);

  const payload = payloadRef.current;
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !payload) return;
    const update = () => setRect(fitContain(el.clientWidth, el.clientHeight, payload.video.width, payload.video.height));
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [payload, stage.kind]);

  const ensureAudio = () => {
    if (!audioRef.current) audioRef.current = new AudioEngine(0.8);
    void audioRef.current.resume();
    return audioRef.current;
  };

  const afterWelcome = () => {
    ensureAudio();
    if (info && (info.consentText || info.questions.length > 0)) setStage({ kind: "form" });
    else afterForm();
  };

  const afterForm = () => setStage(info?.instructionVideoUrl && !instructionDone ? { kind: "instructionVideo" } : { kind: "keycheck" });

  const prepare = async () => {
    const audio = ensureAudio();
    setStage({ kind: "preparing", progress: 0, label: "…" });
    try {
      const refresh = measureRefreshRate().then((hz) => (refreshRef.current = hz));
      if (!payloadRef.current) {
        const body = { participantCode: code, client: clientInfo(), answers, consented };
        payloadRef.current = mode === "lab" ? await api.startLabSession(id, body) : await api.startLinkSession(token, body);
        if (mode === "lab") void qc.invalidateQueries({ queryKey: ["me"] });
      }
      const p = payloadRef.current;
      audio.volume = p.settings.audioVolume;
      preparedRef.current?.release();
      preparedRef.current = await prepareRun(p, audio, (progress) => setStage({ kind: "preparing", progress, label: "" }));
      await refresh;
      setStage({ kind: "ready" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) setStage({ kind: "blocked", message: t.linkClosed });
      else setStage({ kind: "error", error: e, retry: prepare });
    }
  };

  const submit = async (aborted: boolean) => {
    const p = payloadRef.current;
    const engine = engineRef.current;
    if (!p || !engine) return;
    clearInterval(beatRef.current);
    const data = engine.data();
    engine.detach();
    engineRef.current = null;
    audioRef.current?.stopAll();
    void wakeRef.current?.release().catch(() => undefined);
    if (document.fullscreenElement) await settle(document.exitFullscreen());

    const audio = audioRef.current;
    const body = {
      ...data,
      client: clientInfo({
        refreshRateHz: refreshRef.current,
        audioOutputLatencyMs: audio?.latency.outputMs ?? null,
        audioBaseLatencyMs: audio?.latency.baseMs ?? null,
        videoFrameCallback: engine.usesFrameCallback,
        fullscreen: true,
      }),
      aborted,
      practice: practiceRef.current,
    };
    savePending(p.sessionId, p.sessionKey, body);
    setStage({ kind: "submitting" });

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await api.complete(p.sessionId, p.sessionKey, body);
        clearPending(p.sessionId);
        if (mode === "link" && !aborted) {
          try {
            localStorage.setItem(doneKey(token), new Date().toISOString());
          } catch {
            /* depolama kapalı */
          }
        }
        setStage({ kind: "done", summary: result.summary, redirectUrl: result.redirectUrl });
        return;
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) break;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    setStage({ kind: "done", summary: null, savedLocally: true });
  };

  /** Tam ekrana geçer; alıştırma varsa önce onu, yoksa asıl deneyi başlatır. */
  const start = async () => {
    await settle(rootRef.current?.requestFullscreen?.());
    await settle(audioRef.current?.resume());
    wakeRef.current = (await settle(navigator.wakeLock?.request("screen"))) ?? null;
    if (payloadRef.current?.practice) setStage({ kind: "practice", run: 1 });
    else void beginMain();
  };

  const beginMain = async () => {
    const p = payloadRef.current;
    const prepared = preparedRef.current;
    const video = videoRef.current;
    const layer = layerRef.current;
    if (!p || !prepared || !video || !layer) return;
    if (!document.fullscreenElement) await settle(rootRef.current?.requestFullscreen?.());

    video.volume = p.settings.videoVolume;
    finishingRef.current = false;
    const engine = new TrialEngine({
      video,
      layer,
      stimuli: p.stimuli,
      imageUrls: prepared.imageUrls,
      audio: audioRef.current,
      buffers: prepared.buffers,
      record: true,
      responseKey: p.settings.responseMode === "pointer" ? null : p.settings.responseKey,
      pointer: p.settings.responseMode !== "keyboard",
      allowPause: p.settings.allowPause,
      onInterrupt: (reason) => setStage({ kind: "paused", reason }),
      onEnded: () => {
        if (finishingRef.current) return;
        finishingRef.current = true;
        setTimeout(() => void submit(false), 400);
      },
    });
    engine.attach();
    engineRef.current = engine;

    for (const n of [3, 2, 1]) {
      setStage({ kind: "countdown", n });
      await new Promise((r) => setTimeout(r, 850));
    }
    void api.markStarted(p.sessionId, p.sessionKey).catch(() => undefined);
    const beat = () => void api.heartbeat(p.sessionId, p.sessionKey, video.currentTime * 1000).catch(() => undefined);
    beat();
    beatRef.current = window.setInterval(beat, 10_000);
    setStage({ kind: "running" });
    try {
      await video.play();
    } catch {
      engine.interrupt("pause");
    }
  };

  const resume = async () => {
    if (!document.fullscreenElement) await settle(rootRef.current?.requestFullscreen?.());
    await settle(audioRef.current?.resume());
    setStage({ kind: "running" });
    await engineRef.current?.resume();
  };

  const stopEarly = () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    void submit(true);
  };

  const restartForNextParticipant = () => {
    preparedRef.current?.release();
    preparedRef.current = null;
    payloadRef.current = null;
    practiceRef.current = null;
    setCode("");
    setAnswers({});
    setConsented(false);
    setInstructionDone(false);
    setStage({ kind: "welcome" });
  };

  const onStage = ["ready", "practice", "practiceDone", "countdown", "running", "paused"].includes(stage.kind);
  const keyText = info ? keyName(info.responseKey, lang) : "";

  return (
    <div ref={rootRef} className={clsx("min-h-dvh bg-black", (stage.kind === "running" || stage.kind === "practice") && "cursor-none")}>
      {/* Deney sahnesi: dosyalar hazırlandıktan sonra hep yerinde durur, böylece video çözücü ısınmış olur. */}
      {preparedRef.current && payload && (
        <div ref={boxRef} className={clsx("fixed inset-0 bg-black", onStage ? "visible" : "invisible")} aria-hidden={stage.kind !== "running"}>
          <video ref={videoRef} src={preparedRef.current.videoSrc} preload="auto" playsInline disablePictureInPicture className="absolute inset-0 size-full object-contain" />
          <div ref={layerRef} className="pointer-events-none absolute" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
        </div>
      )}

      {stage.kind === "practice" && payload && preparedRef.current && (
        <PracticeStage
          key={stage.run}
          payload={payload}
          prepared={preparedRef.current}
          audio={audioRef.current}
          t={t}
          onEnded={(result) => {
            practiceRef.current = result;
            setStage({ kind: "practiceDone", result });
          }}
        />
      )}

      {stage.kind === "practiceDone" && (
        <div className="fixed inset-0 z-10 grid place-items-center bg-black px-5">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md text-center">
            <h1 className="display text-[48px]">{t.practiceDoneTitle}</h1>
            <p className="mt-3 text-mist">{t.practiceDoneBody(stage.result.hits, stage.result.trials)}</p>
            {stage.result.meanRt != null && <p className="display mt-6 text-[40px]">{fmt.ms(stage.result.meanRt)}</p>}
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Button variant="primary" size="lg" onClick={() => void beginMain()}>
                {t.startMain}
              </Button>
              <Button variant="ghost" size="lg" icon={<RotateCcw className="size-4" />} onClick={() => setStage({ kind: "practice", run: Date.now() })}>
                {t.practiceAgain}
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      <AnimatePresence>
        {stage.kind === "countdown" && (
          <motion.div className="fixed inset-0 z-10 grid place-items-center bg-black" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
            <AnimatePresence mode="popLayout">
              <motion.span key={stage.n} className="display text-[180px] leading-none" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.4 }} transition={{ type: "spring", stiffness: 300, damping: 22 }}>
                {stage.n}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {stage.kind === "paused" && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/85 px-5 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md text-center">
            <h2 className="display text-[44px]">{t.pausedTitle}</h2>
            <p className="mt-3 text-mist">
              {t.pauseReason[stage.reason]} {t.pausedBody}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button variant="primary" size="lg" icon={<Maximize className="size-4" />} onClick={resume}>
                {t.resume}
              </Button>
              <Button variant="ghost" size="lg" onClick={stopEarly}>
                {t.finish}
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {!onStage && (
        <Shell stage={stage} t={t}>
          {stage.kind === "loading" && (
            <div className="flex justify-center">
              <Spinner className="size-7" />
            </div>
          )}

          {stage.kind === "error" && (
            <div className="text-center">
              <TriangleAlert className="mx-auto size-10 text-warn" />
              <h1 className="display mt-4 text-[40px]">{stage.error instanceof Error ? stage.error.message : t.genericError}</h1>
              {stage.error instanceof ApiError && stage.error.detail && <p className="mt-2 text-mist">{stage.error.detail}</p>}
              {stage.retry && (
                <Button className="mt-8" size="lg" icon={<RotateCcw className="size-4" />} onClick={stage.retry}>
                  {t.retry}
                </Button>
              )}
            </div>
          )}

          {stage.kind === "blocked" && (
            <div className="text-center">
              <TriangleAlert className="mx-auto size-10 text-warn" />
              <h1 className="display mt-4 text-[38px]">{stage.message}</h1>
            </div>
          )}

          {stage.kind === "welcome" && info && (
            <div>
              <h1 className="display text-[48px] sm:text-[56px]">{info.experimentName}</h1>
              <p className="mt-6 text-[16px] leading-relaxed whitespace-pre-line text-mist">{info.instructionText}</p>
              <ul className="mt-8 space-y-2.5 text-sm text-mist">
                <li className="flex items-center gap-3">
                  <Headphones className="size-4 shrink-0 text-audio" /> {t.headphones}
                </li>
                <li className="flex items-center gap-3">
                  <Maximize className="size-4 shrink-0 text-av" /> {t.fullscreenDuration(durationText(info.videoDurationMs, lang))}
                </li>
                <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-4 text-center text-visual">●</span>
                  {info.responseMode === "pointer" ? (
                    t.responseTouch
                  ) : (
                    <>
                      {t.responseKey} <Kbd>{keyText}</Kbd>
                    </>
                  )}
                  {info.allowPause && <span className="text-haze">{t.escToPause}</span>}
                </li>
                {smallScreen && (
                  <li className="flex items-center gap-3 text-warn">
                    <TriangleAlert className="size-4 shrink-0" /> {t.deviceSmall}
                  </li>
                )}
              </ul>
              <div className="mt-8">
                <label htmlFor="participant-code" className="text-[13px] font-medium">
                  {mode === "lab" ? t.codeLabelLab : t.codeLabelLink}
                </label>
                <Input id="participant-code" className="mt-1.5" value={code} maxLength={64} placeholder={mode === "lab" ? t.codePlaceholderLab : t.codePlaceholderLink} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button variant="primary" size="lg" onClick={afterWelcome}>
                  {t.continue}
                </Button>
                <Button variant="ghost" size="lg" icon={<Volume2 className="size-4" />} onClick={() => ensureAudio().tone()}>
                  {t.testSound}
                </Button>
              </div>
              {mode === "lab" && (
                <Link to={`/deneyler/${id}?sekme=katilim`} className="mt-10 inline-block text-[13px] text-haze hover:text-paper">
                  {t.backToExperiment}
                </Link>
              )}
            </div>
          )}

          {stage.kind === "form" && info && <ConsentForm info={info} t={t} answers={answers} setAnswers={setAnswers} consented={consented} setConsented={setConsented} onDone={afterForm} />}

          {stage.kind === "instructionVideo" && info?.instructionVideoUrl && (
            <div>
              <h1 className="display text-[40px]">{t.instructionVideo}</h1>
              <video src={info.instructionVideoUrl} autoPlay controls playsInline className="mt-6 w-full rounded-2xl border border-line bg-ink-950" onEnded={() => setInstructionDone(true)} />
              <div className="mt-6 flex gap-3">
                <Button variant="primary" size="lg" disabled={!instructionDone && mode === "link"} onClick={() => setStage({ kind: "keycheck" })}>
                  {t.continue}
                </Button>
                {!instructionDone && mode === "link" && <span className="self-center text-[13px] text-haze">{t.continueAfterVideo}</span>}
              </div>
            </div>
          )}

          {stage.kind === "keycheck" && info && <ResponseCheck info={info} t={t} onReady={prepare} />}

          {stage.kind === "preparing" && (
            <div className="text-center">
              <h1 className="display text-[44px]">{t.preparingTitle}</h1>
              <p className="mt-3 text-mist">{t.preparingBody}</p>
              <div className="mx-auto mt-10 h-1.5 max-w-sm overflow-hidden rounded-full bg-ink-800">
                <motion.div className="h-full rounded-full bg-av" animate={{ width: `${Math.max(3, stage.progress * 100)}%` }} transition={{ ease: "easeOut" }} />
              </div>
              <p className="mt-3 text-[13px] text-haze tabular-nums">%{Math.round(stage.progress * 100)}</p>
            </div>
          )}

          {stage.kind === "submitting" && (
            <div className="text-center">
              <Spinner className="mx-auto size-8" />
              <h1 className="display mt-6 text-[40px]">{t.submittingTitle}</h1>
              <p className="mt-2 text-mist">{t.submittingBody}</p>
            </div>
          )}

          {stage.kind === "done" && (
            <div className="text-center">
              {stage.savedLocally ? <TriangleAlert className="mx-auto size-10 text-warn" /> : <CircleCheck className="mx-auto size-12 text-success" />}
              <h1 className="display mt-5 text-[48px]">{stage.savedLocally ? t.savedLocallyTitle : t.thanks}</h1>
              <p className="mx-auto mt-3 max-w-md text-mist">
                {stage.savedLocally ? t.savedLocallyBody : mode === "link" ? t.thanksLink : `${payloadRef.current?.participantCode} katılımcısının oturumu kaydedildi.`}
              </p>
              {stage.redirectUrl && (
                <p className="mt-6 text-sm text-mist">
                  {t.redirecting}{" "}
                  <a href={stage.redirectUrl} className="text-av underline">
                    {t.goNow}
                  </a>
                </p>
              )}
              {mode === "lab" && stage.summary && (
                <div className="mx-auto mt-10 grid max-w-sm grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line text-left">
                  <div className="bg-ink-950 p-4">
                    <p className="text-[12.5px] text-mist">İsabet</p>
                    <p className="display text-[36px] leading-none">{fmt.percent(stage.summary.hitRate)}</p>
                  </div>
                  <div className="bg-ink-950 p-4">
                    <p className="text-[12.5px] text-mist">Ortalama tepki</p>
                    <p className="display text-[36px] leading-none">{fmt.ms(stage.summary.meanRt)}</p>
                  </div>
                </div>
              )}
              {mode === "lab" && (
                <div className="mt-10 flex flex-wrap justify-center gap-3">
                  {!stage.savedLocally && (
                    <Button variant="primary" size="lg" onClick={() => navigate(`/oturumlar/${payloadRef.current?.sessionId}`)}>
                      Sonuçları aç
                    </Button>
                  )}
                  <Button size="lg" onClick={restartForNextParticipant}>
                    Sıradaki katılımcı
                  </Button>
                </div>
              )}
            </div>
          )}
        </Shell>
      )}

      {stage.kind === "ready" && (
        <div className="fixed inset-0 z-10 grid place-items-center bg-black px-5">
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md text-center">
            <h1 className="display text-[52px]">{t.allSetTitle}</h1>
            <p className="mt-3 text-mist">
              {t.allSetBody} {payload?.practice ? t.allSetPractice(payload.practice.stimuli.length) : t.allSetMain}
            </p>
            <Button variant="primary" size="lg" className="mt-10" icon={<Maximize className="size-4" />} onClick={start}>
              {t.start}
            </Button>
          </motion.div>
        </div>
      )}
    </div>
  );
}
