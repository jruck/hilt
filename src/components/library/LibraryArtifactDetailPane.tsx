"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Archive, ArrowLeft, Check, ChevronDown, Clock, Copy, FileText, Layers, Link2, Loader2, MessageCircle, Network, Play, Plus, RotateCcw, Sparkles, ThumbsDown, X, Zap, type LucideIcon } from "lucide-react";
import type { ReviewQueueStatus } from "@/lib/library/review-queue";
import type { ChatSessionSummary } from "@/lib/chat/types";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useScope } from "@/contexts/ScopeContext";
import { isGraphEnabled } from "@/lib/graph/config";
import { buildGraphScope } from "@/components/graph/graph-deeplink";
import { retryLibraryProcessing, useLibraryArtifact, useRecommendationEpisodes } from "@/hooks/useLibrary";
import { attentionJudgmentFromFrontmatter, connectionPassEvidence, connectionPassState, connectionSuggestionsFromFrontmatter } from "@/lib/library/connection-state";
import { stripLegacyReferenceBodyCruft } from "@/lib/library/legacy-cleanup";
import { getYouTubeVideoId } from "@/lib/library/media";
import { parseTimedTranscript } from "@/lib/library/transcript";
import { buildLibraryItemUrl } from "@/lib/library/url";
import { buildReference } from "@/lib/references/build";
import { copyToClipboard } from "@/lib/references/clipboard";
import { TO_ARCHIVE_WORTH } from "@/lib/library/library-eval";
import { LoadingState } from "@/components/ui/LoadingState";
import { CommentPopover } from "@/components/comments/CommentPopover";
import { ThreadView } from "@/components/threads/ThreadView";
import { withBasePath } from "@/lib/base-path";
import { readerRecommendationContext } from "@/lib/library/card-copy";
import { EvalMetricPill, evalMetricTitle, formatEvalScore } from "./EvalMetricPills";
import { LibraryMarkdown } from "./LibraryMarkdown";
import { LibraryLifecycleMenu } from "./LibraryLifecycleMenu";
import { LibrarySeriesPanel } from "./LibrarySeriesPanel";
import { VideoTranscript } from "./VideoTranscript";
import { YouTubeEmbed, type YouTubeSeekRequest } from "./YouTubeEmbed";
import { ProcessingStatus } from "./ProcessingStatus";

export const LIBRARY_META_OPEN_KEY = "hilt.library.metaOpen";

function markdownSection(markdown: string, sectionName: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${sectionName}`.toLowerCase());
  if (start === -1) return "";
  const collected: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    collected.push(lines[i]);
  }
  return collected.join("\n").trim();
}

function removeMarkdownSections(markdown: string, sectionNames: string[]): string {
  const names = new Set(sectionNames.map((name) => name.toLowerCase()));
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      skipping = names.has(heading[1].toLowerCase());
    }
    if (!skipping) kept.push(line);
  }
  return kept.join("\n").replace(/^#\s+.+\n+/, "").trim();
}

function stripDetails(markdown: string): string {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^<details>\s*<summary>[\s\S]*?<\/summary>\s*([\s\S]*?)\s*<\/details>$/i);
  return (match?.[1] || trimmed).trim();
}

function EvalMetadataField({
  icon: Icon,
  label,
  value,
  title,
  warn = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  title?: string;
  warn?: boolean;
}) {
  return (
    <div title={title} className="flex items-baseline justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 text-[var(--text-tertiary)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className={`tabular-nums ${warn ? "text-amber-500" : "text-[var(--text-primary)]"}`}>{value}</span>
    </div>
  );
}

function formatEvalExplanation(text: string): string {
  return text.replace(/\b(worth|relevance|substance|freshness)\s+([01](?:\.\d+)?)/g, (_match, label: string, value: string) => {
    return `${label} ${formatEvalScore(Number(value))}`;
  });
}

function clipPolicyLabel(policy: string): string {
  if (policy === "label_review") return "needs review";
  if (policy === "suppress") return "auto-skip";
  if (policy === "label_only") return "saved clip";
  return "process";
}

function clipSignalSummary(signals: string[]): string {
  return signals.slice(0, 4).map((signal) => signal.replace(/_/g, " ")).join(" · ");
}

function summaryMarkdown(artifact: NonNullable<ReturnType<typeof useLibraryArtifact>["artifact"]>): string {
  const body = removeMarkdownSections(stripLegacyReferenceBodyCruft(artifact.content), ["Media", "Raw Content"]);
  if (body) return body;
  const keyPoints = artifact.key_points.length ? artifact.key_points.map((point) => `- ${point}`).join("\n") : "";
  const connections = artifact.connections.length ? artifact.connections.map((connection) => `- ${connection}`).join("\n") : "";
  return [
    "## Summary",
    artifact.summary || "",
    keyPoints ? `\n## Key Points\n\n${keyPoints}` : "",
    connections ? `\n## Connections\n\n${connections}` : "",
  ].join("\n").trim();
}

function cachedSourceMarkdown(content: string): string {
  return stripDetails(markdownSection(content, "Raw Content"));
}

function frontmatterString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function frontmatterRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function formatTimestamp(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "—";
  return value.slice(0, 16).replace("T", " ");
}

/** Distinct source names this entry was also cited from (`cited_from`) — the other places the same
 *  content showed up. Read from frontmatter so it works regardless of API field serialization. */
function citedFromLabels(data: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of frontmatterRecords(data.cited_from)) {
    const name = typeof item.source_name === "string" && item.source_name.trim()
      ? item.source_name.trim()
      : typeof item.source_id === "string" ? item.source_id : "";
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

function tierClass(tier: string): string {
  if (tier === "high") return "text-emerald-500";
  if (tier === "medium") return "text-sky-500";
  return "text-[var(--text-tertiary)]";
}

function artifactVideoId(artifact: NonNullable<ReturnType<typeof useLibraryArtifact>["artifact"]>): string | null {
  const embeddedMediaUrl = frontmatterString(artifact.raw_frontmatter, ["video_url", "youtube_url", "media_url"]);
  return getYouTubeVideoId(embeddedMediaUrl || artifact.url)
    || getYouTubeVideoId(markdownSection(artifact.content, "Media"))
    || null;
}

const copyText = copyToClipboard;

function MediaPreview({
  artifact,
  seekRequest,
  onTimeChange,
  onWikilinkNavigate,
}: {
  artifact: NonNullable<ReturnType<typeof useLibraryArtifact>["artifact"]>;
  seekRequest?: YouTubeSeekRequest | null;
  onTimeChange?: (seconds: number) => void;
  onWikilinkNavigate?: (target: string) => void | Promise<void>;
}) {
  const mediaMarkdown = markdownSection(artifact.content, "Media");
  if (mediaMarkdown) {
    const mediaVideoId = getYouTubeVideoId(mediaMarkdown);
    if (mediaVideoId) {
      return (
        <YouTubeEmbed
          videoId={mediaVideoId}
          title={artifact.title}
          className="mb-5"
          seekRequest={seekRequest}
          onTimeChange={onTimeChange}
        />
      );
    }
    return (
      <LibraryMarkdown
        markdown={mediaMarkdown}
        className="mb-5"
        youTubeSeekRequest={seekRequest}
        onYouTubeTimeChange={onTimeChange}
        onWikilinkNavigate={onWikilinkNavigate}
      />
    );
  }
  if (artifact.content.includes("<iframe") || artifact.content.includes("youtube.com/embed/")) {
    return null;
  }

  const videoId = artifactVideoId(artifact);
  if (videoId) {
    return (
      <YouTubeEmbed
        videoId={videoId}
        title={artifact.title}
        className="mb-5"
        seekRequest={seekRequest}
        onTimeChange={onTimeChange}
      />
    );
  }
  if (artifact.thumbnail) {
    return (
      <div className="mb-5 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={artifact.thumbnail} alt="" className="max-h-[360px] w-full object-cover" />
      </div>
    );
  }
  return null;
}

export function LibraryArtifactDetailPane({
  id,
  artifactPath,
  recommendationEpisodeId,
  onBack,
  onClose,
  showBack = false,
  showClose = false,
  onChanged,
  onMarkUnread,
  onCandidateDismissed,
  onArchiveReference,
  onReviewStatus,
  className = "",
  controlsClassName = "",
  backClassName = "",
  closeClassName = "",
}: {
  id: string | null;
  artifactPath?: string | null;
  recommendationEpisodeId?: string | null;
  onBack?: () => void;
  onClose?: () => void;
  showBack?: boolean;
  showClose?: boolean;
  onChanged?: () => void;
  onMarkUnread?: (id: string) => void | Promise<void>;
  onCandidateDismissed?: (artifact: NonNullable<ReturnType<typeof useLibraryArtifact>["artifact"]>) => void | Promise<void>;
  onArchiveReference?: (artifact: NonNullable<ReturnType<typeof useLibraryArtifact>["artifact"]>) => void | Promise<void>;
  onReviewStatus?: (id: string, status: ReviewQueueStatus, note?: string) => void | Promise<void>;
  className?: string;
  controlsClassName?: string;
  backClassName?: string;
  closeClassName?: string;
}) {
  const { artifact, isLoading, mutate } = useLibraryArtifact(id, artifactPath);
  const recommendationEpisodes = useRecommendationEpisodes(recommendationEpisodeId ? [recommendationEpisodeId] : []);
  const { navigateTo } = useScope();
  const graphEnabled = isGraphEnabled();
  const [mode, setMode] = useState<"summary" | "cache">("summary");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [videoSeconds, setVideoSeconds] = useState<number | null>(null);
  const [seekRequest, setSeekRequest] = useState<YouTubeSeekRequest | null>(null);
  const [copied, setCopied] = useState<"link" | "path" | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // Chat drawer over this pane. chatId null = first-turn mode (session created on first
  // send); nonce forces a remount so "New chat" always resets an already-fresh panel.
  const [chat, setChat] = useState<{ chatId: string | null; nonce: number } | null>(null);
  const [chatOpening, setChatOpening] = useState(false);
  // Sticky across item switches: persisted so the metadata panel stays open/closed as you move between
  // items until you toggle it. (The pane remounts per item, so the state lives in localStorage.)
  const [metaOpen, setMetaOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(LIBRARY_META_OPEN_KEY) === "1";
  });
  const toggleMeta = useCallback(() => {
    setMetaOpen((value) => {
      const next = !value;
      try { window.localStorage.setItem(LIBRARY_META_OPEN_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  useEffect(() => {
    setReviewOpen(false);
    setLifecycleOpen(false);
    setVideoSeconds(null);
    setSeekRequest(null);
    setCopied(null);
    setRetrying(false);
    setRetryError(null);
    setChat(null);
    setChatOpening(false);
  }, [id]);

  // Reuse-vs-new: the most recent non-archived chat anchored to this artifact wins;
  // the panel's "New chat" header action is the explicit way to start fresh.
  const openChat = useCallback(async (artifactId: string) => {
    if (chatOpening) return;
    setChatOpening(true);
    try {
      const response = await fetch(withBasePath("/api/chat/sessions"), { cache: "no-store" });
      const payload = response.ok
        ? await response.json() as { sessions?: ChatSessionSummary[] }
        : null;
      // GET /api/chat/sessions is sorted updatedAt desc — first match is most recent.
      const existing = (payload?.sessions ?? []).find((session) =>
        session.archivedAt == null
        && session.context.kind === "library"
        && session.context.id === artifactId);
      setChat({ chatId: existing?.id ?? null, nonce: Date.now() });
    } catch {
      setChat({ chatId: null, nonce: Date.now() });
    } finally {
      setChatOpening(false);
    }
  }, [chatOpening]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleVideoTimeChange = useCallback((seconds: number) => {
    setVideoSeconds((previous) => {
      if (previous !== null && Math.abs(previous - seconds) < 0.25) return previous;
      return seconds;
    });
  }, []);

  const handleWikilinkNavigate = useCallback(async (target: string) => {
    if (!artifact) return;
    try {
      const response = await fetch(withBasePath("/api/library/resolve-wikilink"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, currentPath: artifact.path }),
      });
      if (!response.ok) return;
      const resolved = await response.json() as {
        exists?: boolean;
        view?: "library" | "people" | "docs";
        scope?: string;
      };
      if (!resolved.exists || !resolved.view || typeof resolved.scope !== "string") return;
      navigateTo(resolved.view, resolved.scope);
    } catch (error) {
      console.warn("[library] failed to navigate wikilink", error);
    }
  }, [artifact, navigateTo]);

  if (!id) {
    return <div className={`flex flex-1 items-center justify-center text-sm text-[var(--text-tertiary)] ${className}`}>No reference selected</div>;
  }
  if (isLoading || !artifact) {
    return <LoadingState label="Loading reference" className={className} />;
  }

  const sourceMarkdown = cachedSourceMarkdown(artifact.content);
  const hasCachedSource = sourceMarkdown.length > 0 && sourceMarkdown !== "No cached source content available.";
  const videoId = artifactVideoId(artifact);
  const transcriptSegments = videoId ? parseTimedTranscript(sourceMarkdown) : [];
  const hasTimedTranscript = transcriptSegments.length >= 2;
  const isCandidate = artifact.lifecycle_status === "candidate";
  const processingIncomplete = Boolean(artifact.processing && artifact.processing.state !== "ready");
  const processingDeferred = Boolean(
    artifact.processing
      && artifact.processing.state === "ready"
      && artifact.processing.stage === "reweave"
      && !artifact.processing.completed_stages.includes("reweave"),
  );
  const frozenRecommendation = recommendationEpisodeId
    ? recommendationEpisodes.items.find((item) => item.recommendation?.episode_id === recommendationEpisodeId)?.recommendation
    : null;
  const exactRecommendationUnavailable = Boolean(
    recommendationEpisodeId
      && (recommendationEpisodes.error || recommendationEpisodes.missingEpisodeIds.has(recommendationEpisodeId)),
  );
  const recommendation = readerRecommendationContext({
    requestedEpisodeId: recommendationEpisodeId,
    exactRecommendation: frozenRecommendation,
    currentRecommendation: artifact.recommendation,
    exactUnavailable: exactRecommendationUnavailable,
  });
  const handleChanged = async () => {
    await mutate();
    onChanged?.();
  };
  const seekVideo = (seconds: number) => {
    setSeekRequest({ id: Date.now(), seconds });
    setVideoSeconds(seconds);
  };
  const retryProcessing = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await retryLibraryProcessing(artifact.id);
      await mutate();
      onChanged?.();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  };
  const hiltUrl = typeof window === "undefined"
    ? buildLibraryItemUrl(artifact.id, undefined, { recommendationEpisodeId })
    : new URL(buildLibraryItemUrl(artifact.id, undefined, { recommendationEpisodeId }), window.location.origin).toString();
  // abs_path = vaultRoot + "/" + path — recover the root so chat files-touched chips
  // (vault-relative) resolve to absolute Docs paths without threading workingFolder here.
  const vaultRoot = artifact.abs_path.endsWith(artifact.path)
    ? artifact.abs_path.slice(0, artifact.abs_path.length - artifact.path.length).replace(/\/+$/, "")
    : "";

  return (
    <div className={`relative flex min-h-0 min-w-0 flex-1 ${className}`}>
    <article data-testid="library-artifact-detail" data-mobile-scroll-chrome="top-bottom" className="hilt-mobile-scroll-clearance min-w-0 flex-1 overflow-y-auto bg-[var(--content-surface)]">
      <div className="mx-auto max-w-3xl px-4 pb-[calc(var(--library-floating-video-clearance,0px)+1rem)] pt-4 sm:px-6 sm:pb-[calc(var(--library-floating-video-clearance,0px)+1.25rem)] sm:pt-5 lg:px-7 lg:pt-6">
        {(showBack || showClose) && (
          <div className={`mb-4 flex items-center justify-between gap-3 ${controlsClassName}`}>
            {showBack ? (
              <button
                type="button"
                onClick={onBack}
                className={`inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border-default)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] ${backClassName}`}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            ) : (
              <span />
            )}
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                className={`ml-auto inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] ${closeClassName}`}
                aria-label="Close reference"
                title="Close reference"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-tertiary)]">
          <span>
            {artifact.source_name || artifact.channel} · {artifact.created_at?.slice(0, 10)}
            {(() => {
              const also = citedFromLabels(artifact.raw_frontmatter || {});
              return also.length ? (
                <span title="The same content was also cited from these sources"> · also via {also.join(", ")}</span>
              ) : null;
            })()}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMeta}
              aria-expanded={metaOpen}
              title="Show pipeline + eval metadata"
              className="inline-flex items-center gap-2 rounded-md px-1 py-0.5 tabular-nums text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {artifact.pipeline_version && (
                <span><span className="text-[var(--text-tertiary)]">v</span> {artifact.pipeline_version.replace(/^v/i, "")}</span>
              )}
              {artifact.eval_attrs && (
                artifact.eval_attrs.lifecycle === "needs_refetch" ? (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-500" title="Source capture failed — no honest worth score until the real content is fetched.">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    unfetched
                  </span>
                ) : (
                  <EvalMetricPill icon={Zap} value={artifact.eval_attrs.worth} title={evalMetricTitle("worth")} />
                )
              )}
              {!artifact.pipeline_version && !artifact.eval_attrs && <span>metadata</span>}
            </button>
            {!processingIncomplete && (
              <LibraryLifecycleMenu
                artifact={artifact}
                align="right"
                onChanged={handleChanged}
                onMarkUnread={onMarkUnread}
                onDismissCandidate={onCandidateDismissed}
                onArchiveReference={onArchiveReference}
                open={lifecycleOpen}
                onOpenChange={(open) => {
                  setLifecycleOpen(open);
                  if (open) setReviewOpen(false);
                }}
              />
            )}
          </div>
        </div>
        <h1 className="text-xl font-semibold leading-tight text-[var(--text-primary)] sm:text-2xl">{artifact.title}</h1>
        <LibrarySeriesPanel artifact={artifact} />
        {recommendation && (
          <div data-testid="library-recommendation-context" className="mt-4 border-l-2 border-[var(--accent-primary)] bg-[var(--bg-secondary)] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-[var(--text-tertiary)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden />
              <span className="text-[var(--text-primary)]">Recommended for you</span>
              <span>· {recommendation.recommended_at.slice(0, 10)}</span>
              {recommendation.is_resurface && <span>· Recommended again</span>}
            </div>
            <p data-library-recommendation-pitch className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{recommendation.why_now}</p>
          </div>
        )}
        {artifact.processing && (processingIncomplete || processingDeferred) && (
          <div className="mt-4 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
            <ProcessingStatus processing={artifact.processing} standalone />
            {artifact.processing.state === "blocked" && (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--border-default)] pt-3">
                <button
                  type="button"
                  onClick={() => { void retryProcessing(); }}
                  disabled={retrying}
                  className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-60"
                >
                  {retrying ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  Retry
                </button>
                {retryError && <span className="text-xs text-red-500">{retryError}</span>}
              </div>
            )}
          </div>
        )}

        {(() => {
          const meta = artifact.raw_frontmatter || {};
          const ev = artifact.eval_attrs;
          const clip = artifact.youtube_clip;
          const connectionSuggestions = connectionSuggestionsFromFrontmatter(meta);
          const connCount = connectionSuggestions.length;
          const connState = connectionPassState(meta);
          const passEvidence = connectionPassEvidence(meta);
          const attentionJudgment = attentionJudgmentFromFrontmatter(meta);
          const connectionReasoning = typeof meta.connection_reasoning === "string" ? meta.connection_reasoning.trim() : "";
          const reweaveCandidates = frontmatterRecords(meta.reweave_candidates)
            .map((candidate) => ({
              target: typeof candidate.target === "string" ? candidate.target : "",
              why: typeof candidate.why === "string" ? candidate.why : "",
            }))
            .filter((candidate) => candidate.target || candidate.why);
          const reconnectedAt = typeof meta.reconnected_at === "string" ? meta.reconnected_at : "";
          const isHotStudy = artifact.library_mode === "study" && meta.digestion_status === "hot";
          const missingConnectionPass = isHotStudy && connState === "never" && meta.reweave_pending !== true;
          const reweaveState = meta.reweave_pending === true
            ? "pending"
            : connState === "never"
              ? "not recorded"
              : "complete";
          const evalLifecycle = ev?.lifecycle || "";
          const evalNeedsRefetch = evalLifecycle === "needs_refetch";
          const evalLifecycleLabel = evalNeedsRefetch ? "needs refetch" : evalLifecycle === "to_archive" ? "archive?" : evalLifecycle;
          const evalLifecycleWarn = evalNeedsRefetch || evalLifecycle === "to_archive";
          // Substance is model-graded only at reweave; until then `ev.substance` is a STRUCTURAL
          // estimate (format + length). Surface that so "substance graded: no" next to a substance
          // number doesn't read as a contradiction.
          const substanceGraded = typeof meta.substance === "number";
          const fields: Array<[string, string, boolean?]> = [
            ["disposition", artifact.library_mode || "study"],
            ["connections", `${connCount} · ${connState}`, connState === "never"],
            ["connection pass", reweaveState, meta.reweave_pending === true || missingConnectionPass],
            ["attention", attentionJudgment ? attentionJudgment.tier : "—"],
            ["digest", typeof meta.digested_with === "string" ? meta.digested_with : "—"],
            ["version", artifact.pipeline_version || "—"],
            ["reconnected", reconnectedAt ? formatTimestamp(reconnectedAt) : attentionJudgment ? "judge only" : "—", Boolean(attentionJudgment && !reconnectedAt)],
            ["substance graded", substanceGraded ? "yes" : "no"],
            ["reweave pending", meta.reweave_pending === true ? "yes" : "no", meta.reweave_pending === true],
          ];
          return metaOpen ? (
            <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-xs text-[var(--text-secondary)]">
              {ev && (
                <div className="mb-2 grid grid-cols-2 gap-x-6 gap-y-1.5 border-b border-[var(--border-default)] pb-2 sm:grid-cols-3">
                  <EvalMetadataField icon={Zap} label="worth" value={formatEvalScore(ev.worth)} title={evalMetricTitle("worth")} />
                  <EvalMetadataField icon={Network} label="relevance" value={formatEvalScore(ev.relevance)} title={evalMetricTitle("relevance")} />
                  <EvalMetadataField icon={Layers} label="substance" value={substanceGraded ? formatEvalScore(ev.substance) : `${formatEvalScore(ev.substance)} · est.`} title={substanceGraded ? evalMetricTitle("substance") : "Structural estimate from format + length — not yet model-graded. A reweave assigns the model grade."} />
                  <EvalMetadataField icon={Clock} label="freshness" value={formatEvalScore(ev.freshness)} title={evalMetricTitle("freshness")} />
                  <EvalMetadataField icon={evalNeedsRefetch ? AlertTriangle : Archive} label="lifecycle" value={evalLifecycleLabel} warn={evalLifecycleWarn} />
                  <EvalMetadataField icon={Archive} label="archive threshold" value={`< ${formatEvalScore(TO_ARCHIVE_WORTH)}`} title="Worth below this threshold, after analysis, enters archive review." />
                </div>
              )}
              {clip && (
                <div className="mb-2 grid grid-cols-1 gap-y-1.5 border-b border-[var(--border-default)] pb-2 sm:grid-cols-2">
                  <EvalMetadataField icon={Play} label="clip policy" value={clipPolicyLabel(clip.policy_action)} warn={clip.policy_action === "suppress" || clip.policy_action === "label_review"} />
                  <EvalMetadataField icon={Play} label="content form" value={`${clip.content_form} · ${formatEvalScore(clip.confidence)}`} title={`clip score ${formatEvalScore(clip.clip_score)}, episode score ${formatEvalScore(clip.episode_score)}`} />
                  {clip.signals.length > 0 && (
                    <div className="sm:col-span-2">
                      <div className="mb-1 text-[var(--text-tertiary)]">clip evidence</div>
                      <div className="text-[var(--text-secondary)]">{clipSignalSummary(clip.signals)}</div>
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                {fields.map(([key, value, warn]) => (
                  <div key={key} className="flex items-baseline justify-between gap-2">
                    <span className="text-[var(--text-tertiary)]">{key}</span>
                    <span className={`tabular-nums ${warn ? "text-amber-500" : "text-[var(--text-primary)]"}`}>{value}</span>
                  </div>
                ))}
              </div>
              {ev?.why && (
                <div className="mt-2 border-t border-[var(--border-default)] pt-2">
                  <div className="mb-1 text-[var(--text-tertiary)]">eval explanation</div>
                  <div className="text-[var(--text-secondary)]">{formatEvalExplanation(ev.why)}</div>
                </div>
              )}
              <div className="mt-2 border-t border-[var(--border-default)] pt-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[var(--text-tertiary)]">connection pass</span>
                  <span className={`tabular-nums ${missingConnectionPass || meta.reweave_pending === true ? "text-amber-500" : "text-[var(--text-primary)]"}`}>{connState}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {passEvidence.length ? passEvidence.map((signal) => (
                    <span key={signal} className="rounded border border-[var(--border-default)] bg-[var(--content-surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                      {signal}
                    </span>
                  )) : (
                    <span className="text-[var(--text-tertiary)]">no pass markers</span>
                  )}
                </div>
                {attentionJudgment && (
                  <div className="mt-2 rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] px-2 py-1.5">
                    <div className="mb-0.5 flex items-baseline justify-between gap-2">
                      <span className="text-[var(--text-tertiary)]">attention_judgment</span>
                      <span className={`font-medium ${tierClass(attentionJudgment.tier)}`}>{attentionJudgment.tier}</span>
                    </div>
                    {attentionJudgment.reason && <div className="text-[var(--text-secondary)]">{attentionJudgment.reason}</div>}
                  </div>
                )}
                {connectionReasoning && (
                  <div className="mt-2">
                    <div className="mb-0.5 text-[var(--text-tertiary)]">connection reasoning</div>
                    <div className="text-[var(--text-secondary)]">{connectionReasoning}</div>
                  </div>
                )}
                {connectionSuggestions.length > 0 && (
                  <div className="mt-2">
                    <div className="mb-1 text-[var(--text-tertiary)]">connection output</div>
                    <ul className="space-y-1">
                      {connectionSuggestions.slice(0, 5).map((connection, index) => (
                        <li key={`${connection.target || connection.label}-${index}`} className="rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] px-2 py-1">
                          <span className="text-[var(--text-primary)]">{connection.label}</span>
                          {connection.relationship && <span className="text-[var(--text-secondary)]"> — {connection.relationship}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {reweaveCandidates.length > 0 && (
                  <div className="mt-2">
                    <div className="mb-1 text-[var(--text-tertiary)]">reweave candidates</div>
                    <ul className="space-y-1">
                      {reweaveCandidates.slice(0, 3).map((candidate, index) => (
                        <li key={`${candidate.target}-${index}`} className="text-[var(--text-secondary)]">
                          <span className="text-[var(--text-primary)]">{candidate.target || "untitled"}</span>{candidate.why ? ` — ${candidate.why}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {missingConnectionPass && (
                  <div className="mt-2 flex gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Hot study item has no connection-pass marker; the repair queue treats this as missing_connection_pass.</span>
                  </div>
                )}
                {attentionJudgment && !reconnectedAt && (
                  <div className="mt-2 text-[var(--text-tertiary)]">
                    Legacy v2.2 signal: attention_judgment proves the pass ran, but reconnected_at was not stamped.
                  </div>
                )}
              </div>
              <ThreadView target={{ kind: "library", id: artifact.id }} title="Feedback" className="mt-2 border-t border-[var(--border-default)] pt-2" />
            </div>
          ) : null;
        })()}

        <div className="mt-5 flex flex-col gap-3 border-y border-[var(--border-default)] py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="grid grid-cols-3 rounded-lg bg-[var(--bg-tertiary)] p-0.5 sm:inline-flex">
            <button
              onClick={() => setMode("summary")}
              className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${mode === "summary" ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            >
              Summary
            </button>
            <button
              onClick={() => setMode("cache")}
              disabled={!hasCachedSource}
              className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${mode === "cache" ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"}`}
            >
              Cache
            </button>
            {artifact.url ? (
              <a
                href={artifact.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                Source
              </a>
            ) : (
              <span className="inline-flex h-8 cursor-not-allowed items-center justify-center rounded-md px-3 text-xs font-medium text-[var(--text-tertiary)] opacity-40">Source</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CommentPopover
              target={{ kind: "library", id: artifact.id }}
              placeholder="Comment on this reference"
              triggerTitle="Comment on this reference"
            />
            <button
              type="button"
              onClick={() => { void openChat(artifact.id); }}
              disabled={chatOpening}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-60"
              aria-label="Chat about this reference"
              title="Chat about this reference"
            >
              {chatOpening ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={async () => {
                await copyText(hiltUrl);
                setCopied("link");
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              aria-label="Copy Hilt link"
              title={copied === "link" ? "Copied Hilt link" : "Copy Hilt link"}
            >
              {copied === "link" ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={async () => {
                await copyText(buildReference({
                  kind: "library-artifact",
                  absPath: artifact.abs_path,
                  title: artifact.title,
                  url: artifact.url,
                }));
                setCopied("path");
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              aria-label="Copy reference"
              title={copied === "path" ? "Copied reference" : "Copy reference"}
            >
              {copied === "path" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
            {graphEnabled ? (
              <button
                type="button"
                onClick={() => navigateTo("system", buildGraphScope({ focus: artifact.id }))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                aria-label="Show in graph"
                title="Show in graph"
              >
                <Network className="h-4 w-4" />
              </button>
            ) : null}
            {!processingIncomplete && !isCandidate && (
              <>
                {onReviewStatus && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setReviewOpen((value) => !value);
                        setLifecycleOpen(false);
                      }}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                      title="Updated reference review actions"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Updated
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {reviewOpen && (
                      <div className="absolute right-0 z-10 mt-1 w-36 rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] p-1 content-card-shadow">
                        <button
                          onClick={async () => {
                            setReviewOpen(false);
                            await onReviewStatus(artifact.id, "approved");
                          }}
                          className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Approve
                        </button>
                        <button
                          onClick={async () => {
                            setReviewOpen(false);
                            const note = window.prompt("Reason for rejecting (optional):") ?? undefined;
                            await onReviewStatus(artifact.id, "rejected", note || undefined);
                          }}
                          className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div data-testid="library-artifact-detail-content" className="mt-5">
          <MediaPreview artifact={artifact} seekRequest={seekRequest} onTimeChange={handleVideoTimeChange} onWikilinkNavigate={handleWikilinkNavigate} />
          {mode === "summary" ? (
            <LibraryMarkdown markdown={summaryMarkdown(artifact)} onWikilinkNavigate={handleWikilinkNavigate} />
          ) : hasTimedTranscript ? (
            <VideoTranscript segments={transcriptSegments} activeSeconds={videoSeconds} onSeek={seekVideo} />
          ) : hasCachedSource ? (
            <LibraryMarkdown markdown={sourceMarkdown} onWikilinkNavigate={handleWikilinkNavigate} />
          ) : (
            <p className="text-sm text-[var(--text-tertiary)]">No cached source content is available for this item yet.</p>
          )}
        </div>
      </div>
    </article>
    {chat && (
      <div
        data-testid="library-chat-drawer"
        className="absolute inset-y-0 right-0 z-10 flex w-full flex-col border-[var(--border-default)] bg-[var(--content-surface,var(--bg-primary))] content-card-shadow lg:w-[min(30rem,90%)] lg:border-l"
      >
        <ChatPanel
          key={chat.chatId ?? `new-${chat.nonce}`}
          chatId={chat.chatId}
          context={{ kind: "library", id: artifact.id }}
          contextLabel={artifact.title}
          workingFolder={vaultRoot}
          onClose={() => setChat(null)}
          headerActions={
            <button
              type="button"
              onClick={() => setChat({ chatId: null, nonce: Date.now() })}
              title="New chat"
              aria-label="New chat"
              className="inline-flex h-6 w-6 items-center justify-center text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <Plus className="h-4 w-4" />
            </button>
          }
        />
      </div>
    )}
    </div>
  );
}
