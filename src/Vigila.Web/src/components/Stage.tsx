import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { clock } from "../lib/format";
import type { PositionMode, ScheduledStimulus } from "../lib/types";
import { AudioEngine } from "../runner/audio";
import { TrialEngine, fitContain, type Rect } from "../runner/engine";

/** Kabın boyutunu izleyip videonun gerçek görüntü alanını verir. */
function useContentRect(ref: RefObject<HTMLElement | null>, videoW: number, videoH: number): Rect {
  const [rect, setRect] = useState<Rect>({ left: 0, top: 0, width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setRect(fitContain(el.clientWidth, el.clientHeight, videoW, videoH));
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [ref, videoW, videoH]);
  return rect;
}

/**
 * Planlanan görsel konumlarının haritası: video karesi üzerinde her uyaranın kutusu.
 * Zaman çizelgesinde üzerine gelinen uyaranın görseli yerinde gösterilir.
 */
export function StageMap({
  width,
  height,
  posterUrl,
  stimuli,
  imageUrls,
  highlight,
  positioning,
  safeMargin,
}: {
  width: number;
  height: number;
  posterUrl: string | null;
  stimuli: ScheduledStimulus[];
  imageUrls: Map<string, string>;
  highlight: number | null;
  positioning: PositionMode;
  safeMargin: number;
}) {
  const visual = stimuli.filter((s) => s.box);
  const focus = highlight == null ? null : visual.find((s) => s.index === highlight) ?? null;
  return (
    <div className="relative w-full overflow-hidden rounded-[14px] border border-line bg-black" style={{ aspectRatio: `${width} / ${height}` }}>
      {posterUrl ? (
        <img src={posterUrl} alt="" className="absolute inset-0 size-full object-cover opacity-55" />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,#262d72,transparent_60%),radial-gradient(ellipse_at_80%_90%,#3a1d4f,transparent_55%)]" />
      )}
      <div className="absolute border border-dashed border-paper/25" style={{ inset: `${safeMargin * 100}%` }} />
      {positioning === "balancedQuadrants" && (
        <>
          <div className="absolute inset-y-0 left-1/2 w-px bg-paper/20" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-paper/20" />
        </>
      )}
      {visual.map((s) => (
        <motion.div
          key={s.index}
          layout
          initial={false}
          animate={{ left: `${s.box!.x * 100}%`, top: `${s.box!.y * 100}%`, width: `${s.box!.w * 100}%`, height: `${s.box!.h * 100}%` }}
          transition={{ type: "spring", stiffness: 220, damping: 28 }}
          className={clsx(
            "absolute rounded-[3px] border transition-colors",
            focus?.index === s.index ? "border-transparent" : s.kind === "audiovisual" ? "border-av/50 bg-av/8" : "border-visual/45 bg-visual/6",
          )}
        />
      ))}
      <AnimatePresence>
        {focus?.imageId && (
          <motion.img
            key={focus.index}
            src={imageUrls.get(focus.imageId)}
            alt=""
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute object-contain drop-shadow-[0_0_24px_rgb(242_84_107/0.55)]"
            style={{ left: `${focus.box!.x * 100}%`, top: `${focus.box!.y * 100}%`, width: `${focus.box!.w * 100}%`, height: `${focus.box!.h * 100}%` }}
          />
        )}
      </AnimatePresence>
      {visual.length === 0 && stimuli.length > 0 && (
        <p className="absolute inset-x-0 bottom-3 text-center text-[12px] text-mist">Bu planda yalnız işitsel uyaranlar var.</p>
      )}
    </div>
  );
}

export interface StagePlayerHandle {
  seek: (ms: number) => void;
}

/**
 * Deneyi araştırmacıya oynatan önizleme oynatıcısı. Katılımcı yürütücüsüyle aynı motoru kullanır,
 * yalnızca kayıt yapmaz; böylece önizlemede görülen, katılımcının göreceğiyle birebir aynıdır.
 */
export function StagePlayer({
  videoUrl,
  posterUrl,
  videoWidth,
  videoHeight,
  stimuli,
  imageUrls,
  audioUrls,
  audioVolume,
  videoVolume,
  handleRef,
  onTick,
  onActiveChange,
  className,
}: {
  videoUrl: string;
  posterUrl: string | null;
  videoWidth: number;
  videoHeight: number;
  stimuli: ScheduledStimulus[];
  imageUrls: Map<string, string>;
  audioUrls: Map<string, string>;
  audioVolume: number;
  videoVolume: number;
  handleRef?: RefObject<StagePlayerHandle | null>;
  onTick?: (ms: number) => void;
  onActiveChange?: (active: Set<number>) => void;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TrialEngine | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const buffersRef = useRef(new Map<string, AudioBuffer>());
  const activeRef = useRef(new Set<number>());
  const tickRef = useRef(onTick);
  const activeCbRef = useRef(onActiveChange);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [ended, setEnded] = useState(false);
  const rect = useContentRect(boxRef, videoWidth, videoHeight);

  tickRef.current = onTick;
  activeCbRef.current = onActiveChange;

  /** Motoru güncel plan ve ses motoruyla (yeniden) kurar; video konumu korunur. */
  const buildEngine = () => {
    const video = videoRef.current;
    const layer = layerRef.current;
    if (!video || !layer) return;
    engineRef.current?.detach();
    activeRef.current = new Set();
    activeCbRef.current?.(new Set());
    let lastUi = 0;
    const engine = new TrialEngine({
      video,
      layer,
      stimuli,
      imageUrls,
      audio: audioRef.current,
      buffers: buffersRef.current,
      record: false,
      onTick: (ms) => {
        const now = performance.now();
        if (now - lastUi > 50) {
          lastUi = now;
          setTime(ms);
          tickRef.current?.(ms);
        }
      },
      onStimulus: (index, visible) => {
        const next = new Set(activeRef.current);
        if (visible) next.add(index);
        else next.delete(index);
        activeRef.current = next;
        activeCbRef.current?.(next);
      },
      onEnded: () => {
        setPlaying(false);
        setEnded(true);
      },
    });
    engine.attach();
    engine.seek(video.currentTime * 1000);
    engineRef.current = engine;
  };

  useEffect(() => {
    buildEngine();
    return () => {
      engineRef.current?.detach();
      engineRef.current = null;
    };
  }, [stimuli, imageUrls]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = videoVolume;
    if (audioRef.current) audioRef.current.volume = audioVolume;
  }, [videoVolume, audioVolume]);

  useEffect(() => () => audioRef.current?.close(), []);

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      seek: (ms) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = ms / 1000;
        setTime(ms);
        setEnded(false);
      },
    };
  }, [handleRef]);

  /** Ses motoru tarayıcı kuralı gereği ilk kullanıcı tıklamasında kurulur ve sesler çözülür. */
  const ensureAudio = async () => {
    if (audioRef.current) return;
    const engine = new AudioEngine(audioVolume);
    audioRef.current = engine;
    await Promise.all(
      [...audioUrls.entries()].map(async ([id, url]) => {
        try {
          const res = await fetch(url);
          buffersRef.current.set(id, await engine.decode(await res.arrayBuffer()));
        } catch {
          /* önizlemede eksik ses, oynatmayı durdurmaz */
        }
      }),
    );
    // Motor ses motorunu tanısın diye yeniden kurulur.
    buildEngine();
  };

  const toggle = async () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      await ensureAudio();
      await audioRef.current?.resume();
      if (ended) v.currentTime = 0;
      setEnded(false);
      await v.play();
    } else {
      v.pause();
    }
  };

  return (
    <div className={clsx("relative overflow-hidden rounded-[14px] border border-line bg-black", className)}>
      <div ref={boxRef} className="relative w-full" style={{ aspectRatio: `${videoWidth} / ${videoHeight}` }}>
        <video
          ref={videoRef}
          src={videoUrl}
          poster={posterUrl ?? undefined}
          preload="metadata"
          playsInline
          className="absolute inset-0 size-full object-contain"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <div ref={layerRef} className="pointer-events-none absolute" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
        <button type="button" aria-label={playing ? "Duraklat" : "Oynat"} onClick={toggle} className="group absolute inset-0 flex items-center justify-center">
          <AnimatePresence>
            {!playing && (
              <motion.span
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="flex size-16 items-center justify-center rounded-full border border-paper/30 bg-ink-950/60 text-paper backdrop-blur transition-transform group-hover:scale-105"
              >
                {ended ? <RotateCcw className="size-6" /> : <Play className="ml-1 size-6" />}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
      <div className="flex items-center gap-3 border-t border-line bg-ink-950 px-3 py-2 text-[12px] text-mist">
        <button type="button" onClick={toggle} aria-label={playing ? "Duraklat" : "Oynat"} className="grid size-7 place-items-center rounded-md text-paper hover:bg-ink-700">
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <span className="tabular-nums">
          {clock(time, true)} <span className="text-haze">/ {clock(videoRef.current?.duration ? videoRef.current.duration * 1000 : 0)}</span>
        </span>
        <span className="ml-auto text-haze">Önizleme kayıt yapmaz</span>
      </div>
    </div>
  );
}
