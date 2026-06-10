export type LibraryChannel = "rss" | "youtube" | "twitter" | "email" | "raindrop" | "manual" | "fixture";
export type SourceIntent = "discovery" | "explicit_save";
export type SaveRecommendation = "file" | "review" | "skip";
export type CandidateStatus = "candidate" | "promoted" | "skipped" | "expired";
export type LibraryLifecycleStatus = "candidate" | "saved" | "skipped" | "expired" | "promoted";
export type LibraryMode = "study" | "keep";
export type LibraryModeFilter = LibraryMode | "all";
/**
 * Lifecycle state — orthogonal to disposition (`library_mode`). `active` = normal circulation;
 * `to_archive` = the eval flagged it as probably-not-worth-your-time, a non-destructive review bucket
 * that stays in the main folder; `archived` = manually moved to `.archive/`. The eval only ever suggests
 * `to_archive`; moves to `archived` are always manual. See docs/plans/reference-library-roadmap.md.
 */
// needs_refetch (Library v2, steering round 1): the source CAPTURE failed (paywall/fetch error), so
// the eval's grade describes a stub, not the content — held for re-extraction, never archive-flagged.
export type LibraryLifecycle = "active" | "to_archive" | "needs_refetch" | "archived";
export type PromotionReason = "explicit_signal" | "manual_save" | "for_you_selected" | "briefing_selected" | "auto_threshold";

export interface LibrarySourceAuth {
  required: boolean;
  env?: string | string[];
  scopes?: string[];
  stop_on_missing_credential: boolean;
}

export interface LibraryRetentionPolicy {
  mode: "durable" | "candidate";
  ttl_days?: number;
  candidate_ttl_days: number;
  auto_promote_threshold: number;
}

export interface LibraryBackfillPolicy {
  enabled: boolean;
  cursor?: string;
  limit?: number;
  mode: "none" | "checkpointed" | "full";
}

export interface LibrarySourceFilters {
  include_topics: string[];
  exclude_topics: string[];
  content_types?: string[];
}

export interface LibrarySourceConfig {
  id: string;
  name: string;
  channel: LibraryChannel;
  url: string;
  enabled: boolean;
  cadence: "manual" | "hourly" | "daily" | "weekly";
  intent: SourceIntent;
  library_mode?: LibraryMode;
  signal?: string;
  retention: LibraryRetentionPolicy;
  auth?: LibrarySourceAuth;
  backfill: LibraryBackfillPolicy;
  tags: string[];
  filters: LibrarySourceFilters;
  metadata: Record<string, string | number | boolean>;
  fixtures?: RawArtifact[];
  path: string;
}

export interface RawArtifact {
  url: string;
  title: string;
  author?: string;
  date: string;
  thumbnail?: string;
  content?: string;
  metadata: Record<string, unknown>;
}

export interface SourceCache {
  kind: "article" | "transcript" | "source";
  extractor: "summarize-cli" | "source-metadata" | "raindrop-cache";
  captured_at: string;
  content: string;
  chars: number;
}

export interface FetchArtifactsOptions {
  cursor?: string | null;
  limit?: number | null;
}

export interface ArtifactFetchBatch {
  artifacts: RawArtifact[];
  cursor?: string | null;
  next_cursor?: string | null;
}

export interface ArtifactScore {
  relevance: number;
  novelty: number;
  confidence: number;
  total: number;
}

export interface ConnectionSuggestion {
  target?: string | null;
  label: string;
  relationship: string;
  kind?: "project" | "task" | "area" | "person" | "recent_save";
}

export interface ConnectionJudgment {
  connects: boolean;
  reasoning: string;
  connections: ConnectionSuggestion[];
  reweave_candidates?: Array<{ target: string; why: string }>;
}

export interface ReweaveConnection {
  target: string | null;
  title: string;
  relationship: string;
}

/** The reweave agent's direct attention-worthiness judgment (Library v2 judge layer). Captured at
 *  reweave time — the agent has just read the source AND explored the vault, so it is the best-placed
 *  judge of fit. Calibrates the arithmetic worth score (metric: judge–score agreement). */
export interface AttentionJudgment {
  tier: "high" | "medium" | "low";
  reason: string;
}

export interface ReweaveResult {
  description: string;
  proposed_title: string;
  digest_markdown: string;
  connections_first_party: ReweaveConnection[];
  connections_library: ReweaveConnection[];
  reweave_candidates?: Array<{ target: string; why: string }>;
  attention_judgment?: AttentionJudgment;
}

export interface ProcessedArtifact {
  raw: RawArtifact;
  source: LibrarySourceConfig;
  format: string;
  summary: string;
  key_points: string[];
  digest_markdown?: string;
  description?: string;
  video_duration_seconds?: number;
  youtube_clip?: YouTubeClipReviewAttrs;
  /** A study item that got only the L1 digest (reweave couldn't run) — flagged for re-upgrade. */
  reweave_pending?: boolean;
  assessment: {
    save_recommendation: SaveRecommendation;
    why: string;
    what_changed?: string;
    what_is_suspect?: string;
  };
  score: ArtifactScore;
  tags: string[];
  source_tags: string[];
  source_collection: string | null;
  source_collection_id: string | null;
  source_folder: string | null;
  source_folder_id: string | null;
  library_mode: LibraryMode;
  proposed_destination: string;
  connected_projects: string[];
  connection_suggestions?: ConnectionSuggestion[];
  connection_reasoning?: string;
  reweave_candidates?: Array<{ target: string; why: string }>;
  attention_judgment?: AttentionJudgment;
  reasoning: string;
  extraction_notes: string[];
  digestion?: {
    status: "hot" | "warm";
    extractor: "summarize-cli" | "source-metadata";
    digested_at: string;
    extracted_chars: number;
    cached_source_chars?: number;
    cached_source_extractor?: SourceCache["extractor"];
  };
  source_cache?: SourceCache;
}

export interface ReferenceCandidate {
  id: string;
  path: string;
  title: string;
  url: string;
  format: string;
  author: string | null;
  published: string | null;
  digested: string;
  channel: LibraryChannel;
  source_id: string;
  source_name: string;
  thumbnail: string | null;
  intent: SourceIntent;
  status: CandidateStatus;
  expires: string;
  score: ArtifactScore;
  save_recommendation: SaveRecommendation;
  proposed_destination: string | null;
  connected_projects: string[];
  tags: string[];
  source_tags: string[];
  source_collection: string | null;
  source_collection_id: string | null;
  source_folder: string | null;
  source_folder_id: string | null;
  library_mode: LibraryMode;
  promotion: {
    promoted_to?: string | null;
    promoted_at?: string | null;
    promoted_reason?: PromotionReason | null;
  };
  summary: string;
  key_points: string[];
  cached_source: string | null;
  content: string;
  raw_frontmatter: Record<string, unknown>;
}

export interface LibraryArtifact {
  id: string;
  path: string;
  title: string;
  summary: string | null;
  source_type: string;
  channel: LibraryChannel | null;
  source_id: string | null;
  source_name: string | null;
  tags: string[];
  source_tags: string[];
  source_collection: string | null;
  source_collection_id: string | null;
  source_folder: string | null;
  source_folder_id: string | null;
  library_mode: LibraryMode;
  /** Content format stamped at ingest (video/tweet/newsletter/code/…) — drives the content-type icon. */
  format?: string | null;
  thumbnail: string | null;
  author: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
  relevance_score?: number;
  lifecycle_status: LibraryLifecycleStatus;
  pipeline_version?: string;
  video_duration_seconds?: number;
  save_recommendation?: SaveRecommendation;
  proposed_destination?: string | null;
  expires_at?: string | null;
  is_unread: boolean;
  read_at: string | null;
  /** Dynamic L3 eval attributes for study items. Computed on read, never stamped into this shape. */
  eval_attrs?: LibraryEvalAttrs;
  /** Dynamic YouTube clip review attributes. Computed on read, never stamped by the filter UI. */
  youtube_clip?: YouTubeClipReviewAttrs;
}

/** A single feedback comment on a library item. Stored as a list in frontmatter `feedback`. */
export interface LibraryComment {
  id: string;
  text: string;
  created_at: string;
  updated_at?: string;
  /** When this comment was actioned by /process-library-feedback. Absent = unprocessed. */
  processed_at?: string;
}

/** L3 eval attributes for one study item — computed on demand, never stamped. */
export interface LibraryEvalAttrs {
  worth: number;
  relevance: number;
  substance: number;
  freshness: number;
  lifecycle: LibraryLifecycle;
  why: string;
}

export interface YouTubeClipReviewAttrs {
  content_form: "episode" | "clip" | "short" | "standalone_short" | "unknown";
  confidence: number;
  confidence_label: "high" | "medium" | "low";
  policy_action: "process" | "suppress" | "label_review" | "label_only";
  clip_score: number;
  episode_score: number;
  signals: string[];
}

export interface LibraryArtifactDetail extends LibraryArtifact {
  content: string;
  key_points: string[];
  connections: string[];
  raw_frontmatter: Record<string, unknown>;
  /** Attached by the detail route for the metadata panel; absent for keep items. */
  eval_attrs?: LibraryEvalAttrs;
  /** Feedback comments from Hilt's DATA_DIR store, attached by the detail route. */
  comments?: LibraryComment[];
}

export interface LibrarySearchResult extends LibraryArtifact {
  snippet: string;
  score: number;
  match_type: "keyword" | "semantic" | "both";
}

export interface LibrarySourceSummary {
  id: string;
  name: string;
  channel: LibraryChannel;
  enabled: boolean;
  intent: SourceIntent;
  artifact_count: number;
  candidate_count: number;
  unread_count: number;
  saved_unread_count: number;
  candidate_unread_count: number;
  study_count: number;
  keep_count: number;
  study_unread_count: number;
  keep_unread_count: number;
  review_count: number;
  saved_review_count: number;
  candidate_review_count: number;
  last_fetched: string | null;
  blocked?: string | null;
  facets: LibrarySourceFacetSummary[];
}

export interface LibrarySourceFacetSummary {
  id: string;
  kind: "tag" | "collection" | "folder";
  label: string;
  value: string;
  count: number;
  unread_count: number;
  review_count: number;
}

export interface LibrarySchedulerJobSummary {
  id: string;
  label: string;
  schedule: string;
  loaded: boolean;
  installed: boolean;
  last_exit_code: number | null;
  plist_path: string;
  stdout_path: string;
  stderr_path: string;
  stdout_updated_at: string | null;
  stderr_updated_at: string | null;
  stderr_bytes: number;
  stdout_excerpt: string | null;
  stderr_excerpt: string | null;
  message: string | null;
  status: "ok" | "warning" | "blocked";
}

export interface LibrarySourceHealthSummary extends LibrarySourceSummary {
  status: "ok" | "warning" | "blocked" | "disabled";
  last_checked: string | null;
  last_error: string | null;
}

export interface LibraryDeadLetterSummary {
  total: number;
  recent_24h: number;
  /** Failures whose source has NOT had a successful run since — the still-actionable ones. */
  unresolved: number;
  last_at: string | null;
  by_source: Array<{ source_id: string; count: number }>;
}

export interface LibraryOperationalHealth {
  checked_at: string;
  ok: boolean;
  scheduler: {
    loaded: number;
    expected: number;
    jobs: LibrarySchedulerJobSummary[];
  };
  sources: LibrarySourceHealthSummary[];
  dead_letters: LibraryDeadLetterSummary;
  reweave: LibraryReweaveBacklogSummary;
}

export interface LibraryReweaveBacklogSummary {
  /** Distinct study items awaiting a Claude reweave (pending + version_behind). */
  backlog: number;
  /** Items flagged reweave_pending / missing their connection pass. */
  pending: number;
  /** Items stamped at a non-current pipeline_version (migration backlog). */
  version_behind: number;
  /** Last time the nightly drain job ran (proxy: its log mtime). */
  last_drained_at: string | null;
  /** Last "RATE LIMIT — pausing" seen in the nightly drain log — a proxy for Claude-window pressure. */
  last_throttled_at: string | null;
}

export interface IngestionSourceResult {
  source_id: string;
  source_name: string;
  cursor?: string | null;
  next_cursor?: string | null;
  checked: boolean;
  blocked: boolean;
  blocked_reason?: string;
  fetched: number;
  candidates: number;
  promoted: number;
  saved: number;
  skipped: number;
  duplicates: number;
  errors: string[];
  youtube_clip_review?: YouTubeClipIngestionSummary;
  artifacts: IngestionArtifactResult[];
}

export interface IngestionArtifactResult {
  url: string;
  title: string;
  status: "candidate" | "saved" | "promoted" | "duplicate" | "skipped" | "error";
  path?: string;
  reason?: string;
  youtube_clip_policy?: YouTubeClipReviewAttrs["policy_action"];
  youtube_content_form?: YouTubeClipReviewAttrs["content_form"];
}

export interface YouTubeClipIngestionSummary {
  metadata_checked: number;
  metadata_enriched: number;
  policy_actions: Record<YouTubeClipReviewAttrs["policy_action"], number>;
  content_forms: Record<YouTubeClipReviewAttrs["content_form"], number>;
}

export interface IngestionReport {
  started_at: string;
  finished_at: string;
  dry_run: boolean;
  use_cursor: boolean;
  limit: number | null;
  checked: number;
  candidates: number;
  promoted: number;
  saved: number;
  skipped: number;
  duplicates: number;
  blocked: Array<{ source_id: string; reason: string }>;
  errors: string[];
  sources: IngestionSourceResult[];
}

export interface LibraryAuthEnvCheck {
  name: string;
  present: boolean;
}

export interface LibraryAuthVerificationResult {
  source_id: string;
  source_name: string;
  channel: LibraryChannel;
  status: "ok" | "missing" | "blocked" | "failed" | "skipped";
  required_env: LibraryAuthEnvCheck[];
  scopes: string[];
  live_checked: boolean;
  sample_count: number;
  message: string;
}

export interface LibraryAuthVerificationReport {
  checked_at: string;
  live: boolean;
  ok: boolean;
  sources: LibraryAuthVerificationResult[];
}

export interface RecommendedArtifact extends LibraryArtifact {
  why: string;
  /** L3 eval — worth = relevance × substance × freshness, and its components, for the current context. */
  worth: number;
  relevance: number;
  substance: number;
  freshness: number;
  lifecycle: LibraryLifecycle;
  matched_terms: string[];
}
