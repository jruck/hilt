"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimedTranscriptSegment } from "@/lib/library/transcript";

function activeSegmentIndex(segments: TimedTranscriptSegment[], activeSeconds: number | null): number {
  if (activeSeconds === null || !segments.length) return -1;
  let active = -1;
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index].start_seconds <= activeSeconds + 0.25) active = index;
    else break;
  }
  return active;
}

export function VideoTranscript({
  segments,
  activeSeconds,
  onSeek,
}: {
  segments: TimedTranscriptSegment[];
  activeSeconds: number | null;
  onSeek: (seconds: number) => void;
}) {
  const activeIndex = useMemo(() => activeSegmentIndex(segments, activeSeconds), [activeSeconds, segments]);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const [followingLive, setFollowingLive] = useState(false);

  const jumpToLive = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const enableLiveFollow = () => {
    setFollowingLive(true);
    window.requestAnimationFrame(jumpToLive);
  };

  useEffect(() => {
    setFollowingLive(false);
  }, [segments]);

  useEffect(() => {
    if (!followingLive) return;
    jumpToLive();
  }, [activeIndex, followingLive, jumpToLive]);

  useEffect(() => {
    if (!followingLive) return;
    const stopFollowing = () => setFollowingLive(false);
    const stopFollowingForKeys = (event: KeyboardEvent) => {
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) stopFollowing();
    };
    window.addEventListener("wheel", stopFollowing, { capture: true, passive: true });
    window.addEventListener("touchmove", stopFollowing, { capture: true, passive: true });
    window.addEventListener("keydown", stopFollowingForKeys, { capture: true });
    return () => {
      window.removeEventListener("wheel", stopFollowing, { capture: true });
      window.removeEventListener("touchmove", stopFollowing, { capture: true });
      window.removeEventListener("keydown", stopFollowingForKeys, { capture: true });
    };
  }, [followingLive]);

  return (
    <div className="not-prose space-y-3">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] pb-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Transcript</h2>
          <p className="text-xs text-[var(--text-tertiary)]">{segments.length} timestamped lines · click a line to seek the video</p>
        </div>
        <button
          type="button"
          onClick={enableLiveFollow}
          disabled={activeIndex === -1}
          aria-pressed={followingLive}
          className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
            followingLive
              ? "border-blue-500/30 bg-blue-500/10 text-blue-500"
              : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          }`}
          title={followingLive ? "Following the current transcript line" : "Jump to the current transcript line and follow playback"}
        >
          {followingLive && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
          {followingLive ? "Live" : "Jump to Live"}
        </button>
      </div>
      <div className="divide-y divide-[var(--border-default)] overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)]">
        {segments.map((segment, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={`${segment.start_seconds}-${index}`}
              ref={active ? activeRef : undefined}
              type="button"
              aria-current={active ? "true" : undefined}
              aria-label={`Seek to ${segment.timestamp}: ${segment.text}`}
              onClick={() => onSeek(segment.start_seconds)}
              className={`grid w-full grid-cols-[4.25rem_minmax(0,1fr)] gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-secondary)] ${
                active ? "bg-blue-500/10" : ""
              }`}
            >
              <span className={`pt-0.5 font-mono text-[11px] ${active ? "text-blue-500" : "text-[var(--text-tertiary)]"}`}>
                {segment.timestamp}
              </span>
              <span className={`text-sm leading-6 ${active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                {segment.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
