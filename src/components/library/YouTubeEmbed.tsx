"use client";

import { Check, Gauge, Maximize2, Move, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLIFrameElement, options: {
        events?: {
          onReady?: (event: { target: YouTubePlayer }) => void;
          onStateChange?: (event: { target: YouTubePlayer; data: number }) => void;
          onPlaybackRateChange?: (event: { target: YouTubePlayer; data: number }) => void;
        };
      }) => YouTubePlayer;
      PlayerState?: { ENDED: number; PAUSED: number; PLAYING: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YouTubePlayer {
  destroy: () => void;
  getAvailablePlaybackRates?: () => number[];
  getCurrentTime?: () => number;
  playVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate?: (rate: number) => void;
}

export interface YouTubeSeekRequest {
  id: number;
  seconds: number;
}

let youtubeApiPromise: Promise<void> | null = null;
const DEFAULT_FLOATING_WIDTH = 380;
const MIN_FLOATING_WIDTH = 240;
const MAX_FLOATING_WIDTH = 560;
const FLOATING_MARGIN = 16;

interface FloatingPosition {
  x: number;
  y: number;
}

interface FloatingGesture {
  kind: "drag" | "resize";
  startX: number;
  startY: number;
  startPosition: FloatingPosition;
  startWidth: number;
}

function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}

function youtubeEmbedSrc(videoId: string): string {
  const params = new URLSearchParams({ enablejsapi: "1", rel: "0", modestbranding: "1" });
  if (typeof window !== "undefined") params.set("origin", window.location.origin);
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function sendYouTubeCommand(iframe: HTMLIFrameElement | null, func: string, args: unknown[] = []): void {
  try {
    iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube.com");
  } catch {
    // Cross-origin embeds can refuse commands during startup.
  }
}

function setPreferredRate(player: YouTubePlayer | null, iframe: HTMLIFrameElement | null, preferredRate: number): void {
  try {
    const available = player?.getAvailablePlaybackRates?.() || [];
    const rate = available.includes(preferredRate)
      ? preferredRate
      : available.filter((value) => value <= preferredRate).sort((a, b) => b - a)[0] || preferredRate;
    player?.setPlaybackRate?.(rate);
    sendYouTubeCommand(iframe, "setPlaybackRate", [rate]);
  } catch {
    // Some embeds delay playback-rate availability until playback begins.
    sendYouTubeCommand(iframe, "setPlaybackRate", [preferredRate]);
  }
}

function floatingHeight(width: number): number {
  return width * 9 / 16;
}

function clampFloatingWidth(width: number): number {
  if (typeof window === "undefined") return width;
  return Math.min(Math.max(width, MIN_FLOATING_WIDTH), Math.min(MAX_FLOATING_WIDTH, window.innerWidth - FLOATING_MARGIN * 2));
}

function defaultFloatingPosition(width: number): FloatingPosition {
  if (typeof window === "undefined") return { x: FLOATING_MARGIN, y: FLOATING_MARGIN };
  return {
    x: window.innerWidth - width - FLOATING_MARGIN,
    y: window.innerHeight - floatingHeight(width) - FLOATING_MARGIN,
  };
}

function clampFloatingPosition(position: FloatingPosition, width: number): FloatingPosition {
  if (typeof window === "undefined") return position;
  const height = floatingHeight(width);
  return {
    x: Math.min(Math.max(position.x, FLOATING_MARGIN), Math.max(FLOATING_MARGIN, window.innerWidth - width - FLOATING_MARGIN)),
    y: Math.min(Math.max(position.y, FLOATING_MARGIN), Math.max(FLOATING_MARGIN, window.innerHeight - height - FLOATING_MARGIN)),
  };
}

/** Per-video playback-speed control — sits just below the player. YouTube's IFrame API only honors
 *  its own supported rates (0.25–2 in steps), so we offer exactly what the player reports. */
function VideoSpeedControl({
  currentRate,
  availableRates,
  onChange,
}: {
  currentRate: number;
  availableRates: number[];
  onChange: (rate: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const rates = (availableRates.length ? availableRates : [0.25, 0.5, 1, 1.5, 2]).slice().sort((a, b) => a - b);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Playback speed"
        title="Playback speed"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
      >
        <Gauge className="h-3.5 w-3.5" />
        {currentRate}×
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-1.5 min-w-[96px] overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] py-1 shadow-lg">
          {rates.map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => {
                onChange(rate);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-xs transition-colors hover:bg-[var(--bg-secondary)] ${rate === currentRate ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
            >
              <span>{rate}×</span>
              {rate === currentRate && <Check className="h-3 w-3 text-[var(--interactive-default)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function YouTubeEmbedComponent({
  videoId,
  title,
  defaultPlaybackRate = 2,
  seekRequest,
  onTimeChange,
  className = "",
}: {
  videoId: string;
  title: string;
  defaultPlaybackRate?: number;
  seekRequest?: YouTubeSeekRequest | null;
  onTimeChange?: (seconds: number) => void;
  className?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [floating, setFloating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [floatingSuppressed, setFloatingSuppressed] = useState(false);
  const [floatingWidth, setFloatingWidth] = useState(DEFAULT_FLOATING_WIDTH);
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition | null>(null);
  const [floatingGesture, setFloatingGesture] = useState<"drag" | "resize" | null>(null);
  const seenInlineRef = useRef(false);
  const handledSeekRef = useRef<number | null>(null);
  const floatingGestureRef = useRef<FloatingGesture | null>(null);
  const src = useMemo(() => youtubeEmbedSrc(videoId), [videoId]);

  // The user-chosen rate for THIS video, this session. Seeded to the default (2×); once the user
  // changes it — via the control below OR YouTube's own menu — that choice sticks across pause,
  // replay, and transcript seeks (the bug was re-applying the default on every play/seek). Resets to
  // the default only when the video itself changes (new src).
  const [currentRate, setCurrentRate] = useState(defaultPlaybackRate);
  const [availableRates, setAvailableRates] = useState<number[]>([]);
  const rateRef = useRef(defaultPlaybackRate);
  useEffect(() => {
    rateRef.current = currentRate;
  }, [currentRate]);

  const changeRate = (rate: number) => {
    rateRef.current = rate;
    setCurrentRate(rate);
    setPreferredRate(playerRef.current, iframeRef.current, rate);
  };

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setPlaying(false);
    setFloating(false);
    setFloatingSuppressed(false);
    // New video → back to the default speed for a fresh start.
    rateRef.current = defaultPlaybackRate;
    setCurrentRate(defaultPlaybackRate);
    setAvailableRates([]);
    void loadYouTubeApi().then(() => {
      if (cancelled || !iframeRef.current || !window.YT?.Player) return;
      playerRef.current?.destroy();
      playerRef.current = new window.YT.Player(iframeRef.current, {
        events: {
          onReady: (event) => {
            setPreferredRate(event.target, iframeRef.current, rateRef.current);
            setAvailableRates(event.target.getAvailablePlaybackRates?.() || []);
            setReady(true);
          },
          onStateChange: (event) => {
            const isPlaying = Boolean(window.YT?.PlayerState && event.data === window.YT.PlayerState.PLAYING);
            setPlaying(isPlaying);
            if (isPlaying) {
              // Re-assert the user's CURRENT rate (not the default) so play never clobbers their choice.
              setPreferredRate(event.target, iframeRef.current, rateRef.current);
            } else {
              setFloating(false);
            }
          },
          // Track changes made via YouTube's own speed menu so our control + memory stay in sync.
          onPlaybackRateChange: (event) => {
            if (typeof event.data === "number" && Number.isFinite(event.data)) {
              rateRef.current = event.data;
              setCurrentRate(event.data);
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      setFloating(false);
    };
  }, [defaultPlaybackRate, src]);

  useEffect(() => {
    if (!ready || !seekRequest || handledSeekRef.current === seekRequest.id) return;
    handledSeekRef.current = seekRequest.id;
    try {
      playerRef.current?.seekTo?.(seekRequest.seconds, true);
      sendYouTubeCommand(iframeRef.current, "seekTo", [seekRequest.seconds, true]);
      // A transcript click is a seek, not a reset — keep the user's current speed.
      setPreferredRate(playerRef.current, iframeRef.current, rateRef.current);
      playerRef.current?.playVideo?.();
      sendYouTubeCommand(iframeRef.current, "playVideo");
    } catch {
      // Keep the transcript click harmless if YouTube refuses the command.
    }
  }, [defaultPlaybackRate, ready, seekRequest]);

  useEffect(() => {
    if (!floating) {
      document.documentElement.style.removeProperty("--library-floating-video-clearance");
      return;
    }
    document.documentElement.style.setProperty("--library-floating-video-clearance", `${Math.ceil(floatingHeight(floatingWidth) + 40)}px`);
    return () => {
      document.documentElement.style.removeProperty("--library-floating-video-clearance");
    };
  }, [floating, floatingWidth]);

  useEffect(() => {
    if (!floating) return;
    const width = clampFloatingWidth(floatingWidth);
    if (width !== floatingWidth) setFloatingWidth(width);
    setFloatingPosition((previous) => clampFloatingPosition(previous || defaultFloatingPosition(width), width));
  }, [floating, floatingWidth]);

  useEffect(() => {
    if (!ready || !onTimeChange) return;
    const handleMessage = (event: MessageEvent) => {
      let hostname = "";
      try {
        hostname = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (hostname !== "youtube.com" && !hostname.endsWith(".youtube.com")) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        const time = data?.info?.currentTime;
        if (typeof time === "number" && Number.isFinite(time)) onTimeChange(time);
      } catch {
        // YouTube also sends non-JSON messages in some browsers.
      }
    };
    window.addEventListener("message", handleMessage);
    const interval = window.setInterval(() => {
      const time = playerRef.current?.getCurrentTime?.();
      if (typeof time === "number" && Number.isFinite(time)) onTimeChange(time);
      sendYouTubeCommand(iframeRef.current, "getCurrentTime");
    }, 500);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.clearInterval(interval);
    };
  }, [onTimeChange, ready]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof window === "undefined") return;
    let frame = 0;

    const updateFloating = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const visible = rect.bottom > 0 && rect.top < window.innerHeight;
      if (visible) {
        seenInlineRef.current = true;
        setFloatingSuppressed(false);
        setFloating(false);
      } else if (playing && !floatingSuppressed && seenInlineRef.current && rect.bottom <= 0) {
        setFloating(true);
      } else if (!playing || floatingSuppressed) {
        setFloating(false);
      }
    };

    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateFloating);
    };

    updateFloating();
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [floatingSuppressed, playing]);

  useEffect(() => {
    if (!floatingGesture) return;

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const gesture = floatingGestureRef.current;
      if (!gesture) return;
      if (gesture.kind === "drag") {
        const next = {
          x: gesture.startPosition.x + event.clientX - gesture.startX,
          y: gesture.startPosition.y + event.clientY - gesture.startY,
        };
        setFloatingPosition(clampFloatingPosition(next, floatingWidth));
      } else {
        const deltaX = event.clientX - gesture.startX;
        const deltaY = (event.clientY - gesture.startY) * 16 / 9;
        const nextWidth = clampFloatingWidth(gesture.startWidth + Math.max(deltaX, deltaY));
        setFloatingWidth(nextWidth);
        setFloatingPosition(clampFloatingPosition(gesture.startPosition, nextWidth));
      }
    };

    const handlePointerUp = () => {
      floatingGestureRef.current = null;
      setFloatingGesture(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [floatingGesture, floatingWidth]);

  const startFloatingGesture = (kind: "drag" | "resize") => (event: PointerEvent<HTMLButtonElement>) => {
    if (!floating) return;
    event.preventDefault();
    event.stopPropagation();
    const width = clampFloatingWidth(floatingWidth);
    floatingGestureRef.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: floatingPosition || defaultFloatingPosition(width),
      startWidth: width,
    };
    setFloatingGesture(kind);
  };

  const dismissFloating = () => {
    setFloatingSuppressed(true);
    setFloating(false);
  };

  const frameClass = floating
    ? "group/library-floating fixed z-50 aspect-video overflow-hidden rounded-lg border border-[var(--border-default)] bg-black content-card-shadow"
    : "absolute inset-0 overflow-hidden rounded-lg bg-black";
  const frameStyle = floating
    ? {
      left: `${floatingPosition?.x ?? defaultFloatingPosition(clampFloatingWidth(floatingWidth)).x}px`,
      top: `${floatingPosition?.y ?? defaultFloatingPosition(clampFloatingWidth(floatingWidth)).y}px`,
      width: `${clampFloatingWidth(floatingWidth)}px`,
    }
    : undefined;

  return (
    <div className={className}>
      <div ref={containerRef} className="relative mx-auto aspect-video w-full overflow-visible rounded-lg border border-[var(--border-default)] bg-black">
        <div className={frameClass} style={frameStyle}>
        {floating && (
          <>
            <div className="absolute left-2 right-2 top-2 z-10 flex items-center justify-between gap-2 opacity-0 transition-opacity group-hover/library-floating:opacity-100 group-focus-within/library-floating:opacity-100">
              <button
                type="button"
                onPointerDown={startFloatingGesture("drag")}
                className="inline-flex h-8 min-w-8 cursor-move items-center justify-center rounded-md bg-black/65 text-white shadow-sm backdrop-blur hover:bg-black/80"
                aria-label="Move floating video"
                title="Move floating video"
              >
                <Move className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={dismissFloating}
                className="inline-flex h-8 min-w-8 items-center justify-center rounded-md bg-black/65 text-white shadow-sm backdrop-blur hover:bg-black/80"
                aria-label="Return video inline"
                title="Return video inline"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onPointerDown={startFloatingGesture("resize")}
              className="absolute bottom-2 right-2 z-10 inline-flex h-8 min-w-8 cursor-nwse-resize items-center justify-center rounded-md bg-black/65 text-white opacity-0 shadow-sm backdrop-blur transition-opacity hover:bg-black/80 group-hover/library-floating:opacity-100 group-focus-within/library-floating:opacity-100"
              aria-label="Resize floating video"
              title="Resize floating video"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </>
        )}
        <iframe
          ref={iframeRef}
          src={src}
          title={title}
          className="h-full w-full"
          loading="lazy"
          onLoad={() => {
            setReady(true);
            window.setTimeout(() => setPreferredRate(playerRef.current, iframeRef.current, rateRef.current), 250);
          }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-end">
        <VideoSpeedControl currentRate={currentRate} availableRates={availableRates} onChange={changeRate} />
      </div>
    </div>
  );
}

export const YouTubeEmbed = memo(YouTubeEmbedComponent);
YouTubeEmbed.displayName = "YouTubeEmbed";
