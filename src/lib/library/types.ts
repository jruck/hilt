export type LibraryChannel = "rss" | "youtube" | "twitter" | "email" | "raindrop" | "manual" | "fixture";
export type SourceIntent = "discovery" | "explicit_save";
export type SaveRecommendation = "file" | "review" | "skip";
export type CandidateStatus = "candidate" | "promoted" | "skipped" | "expired";
export type LibraryLifecycleStatus = "candidate" | "saved" | "skipped" | "expired" | "promoted";
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

export interface ProcessedArtifact {
  raw: RawArtifact;
  source: LibrarySourceConfig;
  format: string;
  summary: string;
  key_points: string[];
  assessment: {
    save_recommendation: SaveRecommendation;
    why: string;
    what_changed?: string;
    what_is_suspect?: string;
  };
  score: ArtifactScore;
  tags: string[];
  proposed_destination: string;
  connected_projects: string[];
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
  thumbnail: string | null;
  author: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
  relevance_score?: number;
  lifecycle_status: LibraryLifecycleStatus;
  save_recommendation?: SaveRecommendation;
  proposed_destination?: string | null;
  expires_at?: string | null;
}

export interface LibraryArtifactDetail extends LibraryArtifact {
  content: string;
  key_points: string[];
  connections: string[];
  raw_frontmatter: Record<string, unknown>;
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
  last_fetched: string | null;
  blocked?: string | null;
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
  artifacts: IngestionArtifactResult[];
}

export interface IngestionArtifactResult {
  url: string;
  title: string;
  status: "candidate" | "saved" | "promoted" | "duplicate" | "skipped" | "error";
  path?: string;
  reason?: string;
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
  priority: "must_read" | "recommended" | "interesting";
  matched_terms: string[];
}
