"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArrowLeft, Check, ChevronDown, CircleDashed, CircleDot, Clock, Copy, FileText, Layers, Link2, MoreHorizontal, Network, Play, ThumbsDown, X, Zap, type LucideIcon } from "lucide-react";
import type { ReviewQueueStatus } from "@/lib/library/review-queue";
import { useScope } from "@/contexts/ScopeContext";
import { isGraphEnabled } from "@/lib/graph/config";
import { buildGraphScope } from "@/components/graph/graph-deeplink";
import { archiveArtifact, promoteCandidate, skipCandidate, useLibraryArtifact } from "@/hooks/useLibrary";
import { stripLegacyReferenceBodyCruft } from "@/lib/library/legacy-cleanup";
import { getYouTubeVideoId } from "@/lib/library/media";
import { parseTimedTranscript } from "@/lib/library/transcript";
import { buildLibraryItemUrl } from "@/lib/library/url";
import { TO_ARCHIVE_WORTH } from "@/lib/library/library-eval";
import { LoadingState } from "@/components/ui/LoadingState";
import { EvalMetricPill, evalMetricTitle, formatEvalScore } from "./EvalMetricPills";
import { LibraryMarkdown } from "./LibraryMarkdown";
import { VideoTranscript } from "./VideoTranscript";
import { YouTubeEmbed, type YouTubeSeekRequest } from "./YouTubeEmbed";

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

function artifactVideoId(artifact: NonNullable<ReturnType<typeof useLibraryArtifact>["artifact"]>): string | null {
  const embeddedMediaUrl = frontmatterString(artifact.raw_frontmatter, ["video_url", "youtube_url", "media_url"]);
  return getYouTubeVideoId(embeddedMediaUrl || artifact.url)
    || getYouTubeVideoId(markdownSection(artifact.content, "Media"))
    || null;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

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
  const { navigateTo } = useScope();
  const graphEnabled = isGraphEnabled();
  const [mode, setMode] = useState<"summary" | "cache">("summary");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [videoSeconds, setVideoSeconds] = useState<number | null>(null);
  const [seekRequest, setSeekRequest] = useState<YouTubeSeekRequest | null>(null);
  const [copied, setCopied] = useState<"link" | "path" | null>(null);
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
  const [newComment, setNewComment] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  useEffect(() => { setNewComment(""); setEditingId(null); }, [artifact?.id]);
  useEffect(() => { setFeedbackText(""); setFeedbackSaved(false); }, [artifact?.id]);
  const postComment = useCallback(async () => {
    const text = newComment.trim();
    if (!id || !text) return;
    setCommentBusy(true);
    try {
      await fetch(`/api/library/${id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      setNewComment("");
      await mutate();
      onChanged?.();
    } finally { setCommentBusy(false); }
  }, [id, newComment, mutate, onChanged]);
  const saveCommentEdit = useCallback(async () => {
    if (!id || !editingId) return;
    setCommentBusy(true);
    try {
      await fetch(`/api/library/${id}/feedback`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentId: editingId, text: editingText }) });
      setEditingId(null);
      await mutate();
    } finally { setCommentBusy(false); }
  }, [id, editingId, editingText, mutate]);
  const deleteComment = useCallback(async (commentId: string) => {
    if (!id) return;
    setCommentBusy(true);
    try {
      await fetch(`/api/library/${id}/feedback`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentId }) });
      await mutate();
      onChanged?.();
    } finally { setCommentBusy(false); }
  }, [id, mutate, onChanged]);
  const saveFeedback = useCallback(async () => {
    const text = feedbackText.trim();
    if (!id || !text) return;
    setFeedbackSaving(true);
    try {
      await fetch(`/api/library/${id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      setFeedbackText("");
      setFeedbackSaved(true);
      await mutate();
      onChanged?.();
    } finally {
      setFeedbackSaving(false);
    }
  }, [id, feedbackText, mutate, onChanged]);

  useEffect(() => {
    setActionsOpen(false);
    setReviewOpen(false);
    setVideoSeconds(null);
    setSeekRequest(null);
    setCopied(null);
  }, [id]);

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
      const response = await fetch("/api/library/resolve-wikilink", {
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
  const handleChanged = async () => {
    await mutate();
    onChanged?.();
  };
  const seekVideo = (seconds: number) => {
    setSeekRequest({ id: Date.now(), seconds });
    setVideoSeconds(seconds);
  };
  const hiltUrl = typeof window === "undefined"
    ? buildLibraryItemUrl(artifact.id)
    : new URL(buildLibraryItemUrl(artifact.id), window.location.origin).toString();

  return (
    <article data-testid="library-artifact-detail" data-mobile-scroll-chrome="top-bottom" className={`hilt-mobile-scroll-clearance min-w-0 flex-1 overflow-y-auto bg-[var(--content-surface)] ${className}`}>
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
          <span>{artifact.source_name || artifact.channel} · {artifact.created_at?.slice(0, 10)}</span>
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
                <EvalMetricPill icon={Zap} value={artifact.eval_attrs.worth} title={evalMetricTitle("worth")} />
              )}
              {!artifact.pipeline_version && !artifact.eval_attrs && <span>metadata</span>}
            </button>
            {isCandidate ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setReviewOpen((value) => !value);
                    setActionsOpen(false);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300"
                  title="Candidate review actions"
                >
                  <CircleDashed className="h-3.5 w-3.5" />
                  Candidate
                  <ChevronDown className="h-3 w-3" />
                </button>
                {reviewOpen && (
                  <div className="absolute right-0 z-10 mt-1 w-36 rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] p-1 content-card-shadow">
                    <button
                      onClick={async () => {
                        setReviewOpen(false);
                        await promoteCandidate(artifact.id);
                        await handleChanged();
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Save
                    </button>
                    <button
                      onClick={async () => {
                        setReviewOpen(false);
                        if (onCandidateDismissed) await onCandidateDismissed(artifact);
                        else {
                          await skipCandidate(artifact.id);
                          await handleChanged();
                        }
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                      title="Dismiss this candidate from review; it remains in the temporary candidate cache until cleanup"
                    >
                      <X className="h-3.5 w-3.5" />
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-1 py-0.5 text-[var(--text-secondary)]">
                <Check className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
          </div>
        </div>
        <h1 className="text-xl font-semibold leading-tight text-[var(--text-primary)] sm:text-2xl">{artifact.title}</h1>

        {(() => {
          const meta = artifact.raw_frontmatter || {};
          const ev = artifact.eval_attrs;
          const clip = artifact.youtube_clip;
          const connCount = Array.isArray(meta.connection_suggestions) ? meta.connection_suggestions.length : 0;
          const connState = connCount > 0 ? "has" : typeof meta.reconnected_at === "string" ? "abstained" : "never";
          const fields: Array<[string, string, boolean?]> = [
            ["disposition", artifact.library_mode || "study"],
            ["connections", `${connCount} · ${connState}`, connState === "never"],
            ["digest", typeof meta.digested_with === "string" ? meta.digested_with : "—"],
            ["version", artifact.pipeline_version || "—"],
            ["substance graded", typeof meta.substance === "number" ? "yes" : "no"],
            ["reweave pending", meta.reweave_pending === true ? "yes" : "no", meta.reweave_pending === true],
          ];
          return metaOpen ? (
            <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-xs text-[var(--text-secondary)]">
              {ev && (
                <div className="mb-2 grid grid-cols-2 gap-x-6 gap-y-1.5 border-b border-[var(--border-default)] pb-2 sm:grid-cols-3">
                  <EvalMetadataField icon={Zap} label="worth" value={formatEvalScore(ev.worth)} title={evalMetricTitle("worth")} />
                  <EvalMetadataField icon={Network} label="relevance" value={formatEvalScore(ev.relevance)} title={evalMetricTitle("relevance")} />
                  <EvalMetadataField icon={Layers} label="substance" value={formatEvalScore(ev.substance)} title={evalMetricTitle("substance")} />
                  <EvalMetadataField icon={Clock} label="freshness" value={formatEvalScore(ev.freshness)} title={evalMetricTitle("freshness")} />
                  <EvalMetadataField icon={Archive} label="lifecycle" value={ev.lifecycle === "to_archive" ? "archive?" : ev.lifecycle} warn={ev.lifecycle === "to_archive"} />
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
                <div className="mb-1 text-[var(--text-tertiary)]">Feedback</div>
                {(artifact.comments || []).length > 0 && (
                  <ul className="mb-2 space-y-1.5">
                    {(artifact.comments || []).map((comment) => (
                      <li key={comment.id} className="rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] px-2 py-1.5">
                        {editingId === comment.id ? (
                          <div>
                            <textarea
                              value={editingText}
                              onChange={(event) => setEditingText(event.target.value)}
                              rows={3}
                              className="w-full resize-y rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
                            />
                            <div className="mt-1 flex justify-end gap-3 text-[11px]">
                              <button type="button" onClick={() => setEditingId(null)} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">cancel</button>
                              <button type="button" onClick={saveCommentEdit} disabled={commentBusy} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">save</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <span className="whitespace-pre-wrap text-[var(--text-primary)]">{comment.text}</span>
                              <span className="flex shrink-0 items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                                {comment.processed_at && <span className="text-emerald-500">✓</span>}
                                <button type="button" onClick={() => { setEditingId(comment.id); setEditingText(comment.text); }} className="hover:text-[var(--text-secondary)]">edit</button>
                                <button type="button" onClick={() => deleteComment(comment.id)} className="hover:text-red-500">delete</button>
                              </span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{(comment.updated_at || comment.created_at).slice(0, 16).replace("T", " ")}{comment.processed_at ? " · actioned" : ""}</div>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <textarea
                  value={newComment}
                  onChange={(event) => setNewComment(event.target.value)}
                  placeholder="Add a comment… (wrong tier, shouldn't archive, bad digest…). Then ask me to “process library feedback”."
                  rows={2}
                  className="w-full resize-y rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--text-tertiary)]"
                />
                <div className="mt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={postComment}
                    disabled={commentBusy || !newComment.trim()}
                    className="rounded-md border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--content-surface)] disabled:opacity-50"
                  >
                    {commentBusy ? "Posting…" : "Post"}
                  </button>
                </div>
              </div>
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
                await copyText(artifact.path);
                setCopied("path");
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              aria-label="Copy markdown path"
              title={copied === "path" ? "Copied markdown path" : "Copy markdown path"}
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
            {!isCandidate && (
              <>
                {onReviewStatus && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setReviewOpen((value) => !value);
                        setActionsOpen(false);
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
                <div className="relative">
                  <button
                    onClick={() => {
                      setActionsOpen((value) => !value);
                      setReviewOpen(false);
                    }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                    title="More saved-reference actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {actionsOpen && (
                    <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] p-1 content-card-shadow">
                    {onMarkUnread && !artifact.is_unread && (
                      <button
                        onClick={async () => {
                          setActionsOpen(false);
                          await onMarkUnread(artifact.id);
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                      >
                        <CircleDot className="h-3.5 w-3.5" />
                        Mark as unread
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        if (!window.confirm("Archive this saved reference? It will move out of the active Library.")) return;
                        setActionsOpen(false);
                        if (onArchiveReference) {
                          await onArchiveReference(artifact);
                          return;
                        }
                        await archiveArtifact(artifact.id);
                        onChanged?.();
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <Archive className="h-3.5 w-3.5" />
                      Archive reference
                    </button>
                  </div>
                )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-5">
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
  );
}
