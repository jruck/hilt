import type { SourceIntent } from "./types";

export type YouTubeContentForm = "episode" | "clip" | "short" | "standalone_short" | "unknown";
export type YouTubeClipPolicyAction = "process" | "suppress" | "label_review" | "label_only";

export interface YouTubeClipDetectionInput {
  title: string;
  description?: string | null;
  channelTitle?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
  sourceIntent?: SourceIntent | null;
  sourceSignal?: string | null;
  tags?: string[];
  durationSeconds?: number | null;
}

export interface YouTubeClipDetection {
  content_form: YouTubeContentForm;
  confidence: number;
  confidence_label: "high" | "medium" | "low";
  policy_action: YouTubeClipPolicyAction;
  clip_score: number;
  episode_score: number;
  signals: string[];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function confidenceLabel(confidence: number): YouTubeClipDetection["confidence_label"] {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

function includesWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

function isExplicitUserSignal(input: YouTubeClipDetectionInput): boolean {
  const sourceId = input.sourceId || "";
  const signal = input.sourceSignal || "";
  return input.sourceIntent === "explicit_save"
    || sourceId === "youtube-bookmarks"
    || sourceId === "youtube-liked-videos"
    || /bookmark|like|watch_later/i.test(signal);
}

export function parseYouTubeDurationSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const seconds = (Number(match[1] || 0) * 86400)
    + (Number(match[2] || 0) * 3600)
    + (Number(match[3] || 0) * 60)
    + Number(match[4] || 0);
  return Number.isFinite(seconds) ? seconds : null;
}

export function detectYouTubeContentForm(input: YouTubeClipDetectionInput): YouTubeClipDetection {
  const title = input.title || "";
  const description = input.description || "";
  const tags = input.tags || [];
  const duration = typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds)
    ? input.durationSeconds
    : null;
  const searchable = `${title}\n${description}\n${tags.join(" ")}`;
  const channelText = `${input.channelTitle || ""} ${input.sourceName || ""} ${input.sourceId || ""}`;
  const explicitSignal = isExplicitUserSignal(input);
  const veryShortDiscoveryUpload = !explicitSignal
    && input.sourceIntent === "discovery"
    && duration !== null
    && duration <= 120;
  const signals: string[] = [];
  let clipScore = 0;
  let episodeScore = 0;

  if (includesWord(channelText, "clip") || includesWord(channelText, "clips")) {
    clipScore += 0.55;
    signals.push("channel_mentions_clips");
  }
  if (/#shorts?\b/i.test(searchable) || /youtube\.com\/shorts\//i.test(searchable)) {
    clipScore += 0.55;
    signals.push("shorts_marker");
  }
  if (/\b(?:full episode|watch the full|full interview|full conversation|full podcast)\b/i.test(description)) {
    clipScore += 0.45;
    signals.push("description_links_full_episode");
  }
  if (duration !== null && duration <= 90) {
    clipScore += 0.3;
    signals.push("duration_under_90s");
  } else if (duration !== null && duration <= 240) {
    clipScore += 0.2;
    signals.push("duration_under_4m");
  } else if (duration !== null && duration <= 600) {
    clipScore += 0.1;
    signals.push("duration_under_10m");
  }
  if (duration !== null && duration <= 120 && /\b(?:on|from)\s+(?:the\s+)?[\w\s'’-]+podcast\b/i.test(description)) {
    clipScore += 0.3;
    signals.push("short_podcast_excerpt_description");
  }
  if (/^[“"].+[”"]/.test(title) || /\s[-|]\s[A-Z][A-Za-z .'-]+$/.test(title)) {
    clipScore += 0.08;
    signals.push("excerpt_style_title");
  }
  if (veryShortDiscoveryUpload) {
    signals.push("very_short_discovery_upload");
  }

  if (duration !== null && duration >= 1200) {
    episodeScore += 0.65;
    signals.push("duration_over_20m");
  } else if (duration !== null && duration >= 600) {
    episodeScore += 0.25;
    signals.push("duration_over_10m");
  }
  if (/\b(?:full episode|episode\s*#?\d+|full interview|full conversation|podcast)\b/i.test(title)) {
    episodeScore += 0.25;
    signals.push("episode_style_title");
  }
  if (/\b\d{1,2}:\d{2}:\d{2}\b/.test(description) || /\b00:\d{2}:\d{2}\b/.test(description)) {
    episodeScore += 0.2;
    signals.push("description_has_chapters");
  }

  clipScore = clampScore(clipScore);
  episodeScore = clampScore(episodeScore);

  let contentForm: YouTubeContentForm = "unknown";
  let confidence = 0.35;
  if (signals.includes("shorts_marker") && duration !== null && duration <= 120) {
    contentForm = "short";
    confidence = Math.max(0.8, clipScore);
  } else if (clipScore >= 0.7 && episodeScore < 0.7) {
    contentForm = "clip";
    confidence = clipScore;
  } else if (clipScore >= 0.55 && duration !== null && duration < 600) {
    contentForm = "clip";
    confidence = clipScore;
  } else if (episodeScore >= 0.65) {
    contentForm = "episode";
    confidence = episodeScore;
  } else if (duration !== null && duration <= 600) {
    contentForm = "standalone_short";
    confidence = Math.max(veryShortDiscoveryUpload ? 0.6 : 0.45, clipScore);
  }

  let policyAction: YouTubeClipPolicyAction = "process";
  if (contentForm === "clip" || contentForm === "short") {
    if (explicitSignal) policyAction = "label_only";
    else policyAction = confidence >= 0.75 ? "suppress" : "label_review";
  } else if (contentForm === "standalone_short" && confidence >= 0.6) {
    policyAction = explicitSignal ? "label_only" : "label_review";
  }

  return {
    content_form: contentForm,
    confidence: clampScore(confidence),
    confidence_label: confidenceLabel(confidence),
    policy_action: policyAction,
    clip_score: clipScore,
    episode_score: episodeScore,
    signals,
  };
}
