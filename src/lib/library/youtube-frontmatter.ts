import type { ProcessedArtifact, YouTubeClipReviewAttrs } from "./types";

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.map(String).map((item) => item.trim()).filter(Boolean);
  return strings.length ? Array.from(new Set(strings)).slice(0, 25) : undefined;
}

export function persistedYouTubeClip(value: unknown): YouTubeClipReviewAttrs | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.content_form !== "episode"
    && record.content_form !== "clip"
    && record.content_form !== "short"
    && record.content_form !== "standalone_short"
    && record.content_form !== "unknown"
  ) return undefined;
  if (
    record.policy_action !== "process"
    && record.policy_action !== "suppress"
    && record.policy_action !== "label_review"
    && record.policy_action !== "label_only"
  ) return undefined;
  if (
    record.confidence_label !== "low"
    && record.confidence_label !== "medium"
    && record.confidence_label !== "high"
  ) return undefined;
  return {
    content_form: record.content_form,
    confidence: numberField(record.confidence) ?? 0,
    confidence_label: record.confidence_label,
    policy_action: record.policy_action,
    clip_score: numberField(record.clip_score) ?? 0,
    episode_score: numberField(record.episode_score) ?? 0,
    signals: stringArrayField(record.signals) || [],
  };
}

export function youtubeFrontmatter(processed: ProcessedArtifact): Record<string, unknown> {
  const metadata = processed.raw.metadata || {};
  return {
    youtube_video_id: stringField(metadata.video_id) || stringField(metadata.youtube_video_id),
    youtube_playlist_id: stringField(metadata.playlist_id) || stringField(metadata.youtube_playlist_id),
    youtube_playlist_title: stringField(metadata.playlist_title) || stringField(metadata.youtube_playlist_title),
    youtube_playlist_url: stringField(metadata.playlist_url) || stringField(metadata.youtube_playlist_url),
    youtube_playlist_index: numberField(metadata.playlist_index) || numberField(metadata.youtube_playlist_index),
    youtube_playlist_total: numberField(metadata.playlist_total) || numberField(metadata.youtube_playlist_total),
    youtube_metadata_at: stringField(metadata.youtube_metadata_at),
    youtube_title: stringField(metadata.youtube_title),
    youtube_channel_id: stringField(metadata.youtube_channel_id),
    youtube_channel_title: stringField(metadata.youtube_channel_title),
    youtube_published_at: stringField(metadata.youtube_published_at),
    youtube_duration_iso: stringField(metadata.youtube_duration_iso),
    youtube_duration_seconds: numberField(metadata.youtube_duration_seconds),
    youtube_tags: stringArrayField(metadata.youtube_tags),
    youtube_privacy_status: stringField(metadata.youtube_privacy_status),
    youtube_description_preview: stringField(metadata.youtube_description_preview),
    youtube_description_has_shorts_marker: booleanField(metadata.youtube_description_has_shorts_marker),
    youtube_description_links_full_episode: booleanField(metadata.youtube_description_links_full_episode),
    youtube_clip: processed.youtube_clip || persistedYouTubeClip(metadata.youtube_clip),
  };
}
