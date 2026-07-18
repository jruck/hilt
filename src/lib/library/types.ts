export type LibraryChannel = "rss" | "youtube" | "twitter" | "email" | "raindrop" | "manual" | "fixture";
export type SourceIntent = "discovery" | "explicit_save";
export type SaveRecommendation = "file" | "review" | "skip";
export type CandidateStatus = "candidate" | "promoted" | "skipped" | "expired";
export type LibraryLifecycleStatus = "candidate" | "saved" | "skipped" | "expired" | "promoted";
export type LibraryMode = "study" | "keep";
export type LibraryModeFilter = LibraryMode | "all";

export type LibraryProcessingStateName = "queued" | "active" | "ready" | "blocked";
export type LibraryProcessingStage = "metadata" | "capture" | "transcribe" | "digest" | "reweave";

export interface LibraryProcessingError {
  code: string;
  message: string;
  retryable: boolean;
}

/** Durable, user-visible progress for a reference while its source becomes a finished Library read. */
export interface LibraryProcessingState {
  state: LibraryProcessingStateName;
  stage: LibraryProcessingStage;
  completed_stages: LibraryProcessingStage[];
  started_at: string;
  updated_at: string;
  attempt: number;
  next_retry_at: string | null;
  last_error: LibraryProcessingError | null;
  completed_at?: string | null;
}

export type LibraryArtifactAttentionKind = "processing_blocked" | "capture_exhausted";

/** Derived operational state for artifacts that have exhausted automatic recovery. */
export interface LibraryArtifactAttention {
  kind: LibraryArtifactAttentionKind;
  label: string;
  detail: string | null;
  attempt_count: number | null;
}

export interface LibrarySeriesMetadata {
  id: string;
  title: string;
  url?: string | null;
  index?: number | null;
  total?: number | null;
  parent_path?: string | null;
}
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
  kind: "article" | "transcript" | "source" | "document";
  extractor: "summarize-cli" | "source-metadata" | "raindrop-cache" | "raindrop-pdf" | "pdftotext" | "x-video-subtitles" | "x-video-audio" | "embedded-video-subtitles" | "embedded-video-audio";
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

export interface DigestionProgressEvent {
  stage: LibraryProcessingStage;
  status: "started" | "completed";
  raw: RawArtifact;
  summary?: string;
  description?: string;
  source_cache?: SourceCache;
}

export interface ProcessedArtifact {
  /** Stable across title changes, candidate promotion, and file moves. */
  artifact_uid?: string;
  /** Source-native title retained when the Library-facing title improves. */
  source_title?: string;
  processing?: LibraryProcessingState;
  raw: RawArtifact;
  source: LibrarySourceConfig;
  format: string;
  summary: string;
  key_points: string[];
  digest_markdown?: string;
  description?: string;
  video_duration_seconds?: number;
  youtube_clip?: YouTubeClipReviewAttrs;
  /** Series/playlist/course membership. Children remain first-class items; this links them together. */
  series?: LibrarySeriesMetadata;
  /** A study item that got only the L1 digest (reweave couldn't run) — flagged for re-upgrade. */
  reweave_pending?: boolean;
  /** The capture is a login/auth wall with no real article under it — held for authenticated
   *  (signed-in browser) recovery rather than reweave. See capture-health `loginWallVerdict`. */
  needs_auth_recovery?: boolean;
  /** Other sources that cited the same content — carried through promote/redigest so a merged
   *  entry's citations survive. Populated by the dedupe backfill / ingest guard, not by digestion. */
  cited_from?: Citation[];
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
  /** Positive marker that the reweave/connection pass completed, including clean abstentions. */
  reconnected_at?: string;
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
  artifact_uid?: string;
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
  /** Other sources that cited the same content (this entry is the canonical merge of them). */
  cited_from?: Citation[];
  thumbnail: string | null;
  source_title?: string | null;
  processing?: LibraryProcessingState;
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
  series?: LibrarySeriesMetadata;
  library_mode: LibraryMode;
  promotion: {
    promoted_to?: string | null;
    promoted_at?: string | null;
    promoted_reason?: PromotionReason | null;
  };
  summary: string;
  key_points: string[];
  digest_markdown?: string;
  connection_suggestions?: ConnectionSuggestion[];
  connection_reasoning?: string;
  reconnected_at?: string;
  reweave_candidates?: Array<{ target: string; why: string }>;
  attention_judgment?: AttentionJudgment;
  cached_source: string | null;
  content: string;
  raw_frontmatter: Record<string, unknown>;
}

/**
 * A source that cited the same content as a library entry. An entry keeps its primary `source_id`
 * (canonical) plus zero or more `cited_from` citations — the OTHER places the same article/video/episode
 * was referenced from. See `src/lib/library/citations.ts`.
 */
export interface Citation {
  source_id: string;
  source_name: string;
  url: string;
  channel?: string;
  /** ISO/date this source surfaced the content. */
  at?: string;
  /** Title as it appeared in that source (may differ slightly from the canonical entry's). */
  title?: string;
}

export interface LibraryArtifact {
  id: string;
  /** Vault-relative path to the markdown file. */
  path: string;
  /** Absolute filesystem path — for portable references a local agent can open directly. */
  abs_path: string;
  title: string;
  source_title?: string | null;
  summary: string | null;
  source_type: string;
  channel: LibraryChannel | null;
  source_id: string | null;
  source_name: string | null;
  /** Other sources that cited the same content (this entry is the canonical merge of them). */
  cited_from?: Citation[];
  tags: string[];
  source_tags: string[];
  source_collection: string | null;
  source_collection_id: string | null;
  source_folder: string | null;
  source_folder_id: string | null;
  series?: LibrarySeriesMetadata;
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
  processing?: LibraryProcessingState;
  /** Derived from current processing state + the refetch-attempt ledger; never written to markdown. */
  attention?: LibraryArtifactAttention;
  /** Dynamic L3 eval attributes for study items. Computed on read, never stamped into this shape. */
  eval_attrs?: LibraryEvalAttrs;
  /** Dynamic YouTube clip review attributes. Computed on read, never stamped by the filter UI. */
  youtube_clip?: YouTubeClipReviewAttrs;
  /** Current active For You episode, joined from the derived recommendation projection. */
  recommendation?: RecommendationPresentation;
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
export type LibraryScoringMethod = "explicit_context_hybrid";

export interface LibraryContextEvidence {
  method: LibraryScoringMethod;
  scoring_config_version: string;
  /** Existing readable Connections contribution to the overall relevance term. */
  connection_score: number;
  /** BM25F contribution before explicit-connection and attention adjustments. */
  lexical_score: number;
  matched_signals: Array<{
    kind: "task" | "project" | "area" | "person";
    label: string;
    target: string | null;
    matched_terms: string[];
  }>;
  matched_terms: string[];
  active_connection_targets: Array<{ target: string; label: string }>;
  active_connection_boost: number;
  attention_tier: "high" | "medium" | "low" | null;
  attention_adjustment: number;
  attention_reason?: string;
  context_score: number;
  context_capped: boolean;
}

export interface LibraryEvalAttrs {
  worth: number;
  relevance: number;
  substance: number;
  freshness: number;
  lifecycle: LibraryLifecycle;
  why: string;
  scoring_method?: LibraryScoringMethod;
  scoring_config_version?: string;
  context_evidence?: LibraryContextEvidence;
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
  /** Whether the retained stderr was updated by the latest completed run. */
  stderr_current: boolean;
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
  intake: LibraryIntakeHealthSummary;
  recommendations: LibraryRecommendationHealthSummary;
}

export interface LibraryRecommendationHealthSummary {
  last_success_at: string | null;
  last_batch_id: string | null;
  last_batch_size: number;
  last_run_kind: RecommendationBatchKind | null;
  pending: boolean;
  pending_reasons: string[];
  next_retry_at: string | null;
  last_error: string | null;
}

export interface LibraryIntakeHealthSummary {
  enabled: boolean;
  running: boolean;
  last_polled_at: string | null;
  next_poll_at: string | null;
  foreground: boolean;
  queue_depth: number;
  active: number;
  blocked: number;
  oldest_queued_at: string | null;
  active_item: { artifact_uid: string; title: string; path: string } | null;
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

export interface LibraryIntakeArtifactResult {
  artifact_uid: string;
  url: string;
  title: string;
  lifecycle_status: "saved" | "candidate";
  path: string;
  status: "queued" | "duplicate" | "promoted";
  reason?: string;
}

export interface LibraryIntakeReport {
  started_at: string;
  finished_at: string;
  checked: number;
  queued: number;
  duplicates: number;
  promoted: number;
  blocked: Array<{ source_id: string; reason: string }>;
  errors: string[];
  artifacts: LibraryIntakeArtifactResult[];
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
  recommendation?: RecommendationPresentation;
}

export type RecommendationBatchKind = "morning" | "refresh" | "legacy" | "fixture";

export interface RecommendationTrigger {
  id: string;
  kind: "artifact" | "meeting" | "task" | "project" | "area" | "briefing" | "legacy";
  label: string;
  occurred_at: string;
  fingerprint: string;
}

export interface RecommendationEpisodeScores {
  worth: number;
  relevance: number;
  substance: number;
  freshness: number;
}

export interface RecommendationEpisode {
  id: string;
  batch_id: string;
  artifact_id: string;
  recommended_at: string;
  rank: number;
  why_now: string;
  triggers: RecommendationTrigger[];
  scores: RecommendationEpisodeScores;
  is_resurface: boolean;
  previous_episode_id: string | null;
  previous_recommended_at: string | null;
  scoring_method?: LibraryScoringMethod;
  scoring_config_version?: string;
  editor_model?: string;
  editor_prompt_version?: string;
}

export interface RecommendationBatch {
  version: 1;
  id: string;
  kind: RecommendationBatchKind;
  generated_at: string;
  context_window: { start: string; end: string };
  pool_size: number;
  episodes: RecommendationEpisode[];
  scoring_method?: LibraryScoringMethod;
  scoring_config_version?: string;
  editor_model?: string;
  editor_prompt_version?: string;
}

export interface RecommendationDismissal {
  artifact_id: string;
  episode_id: string;
  dismissed_at: string;
  restored_at: string | null;
  note: string | null;
}

export interface RecommendationPresentation {
  episode_id: string;
  batch_id: string;
  recommended_at: string;
  rank: number;
  why_now: string;
  triggers: RecommendationTrigger[];
  is_resurface: boolean;
  previous_recommended_at: string | null;
  /** Scores frozen at editorial selection time; current card scores stay in eval_attrs/top-level fields. */
  selection_scores?: RecommendationEpisodeScores;
  scoring_method?: LibraryScoringMethod;
  scoring_config_version?: string;
  editor_model?: string;
  editor_prompt_version?: string;
}
