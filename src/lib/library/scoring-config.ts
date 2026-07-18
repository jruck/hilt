/**
 * Versioned scoring configuration (Library v2, Workstream 1): the eval/ranking constants extracted
 * from code into data, so the steering loop can propose changes that are applied — and rolled back —
 * without a code deploy. This module is PURE (types + defaults only) so client components can import
 * eval constants; the fs-touching loader lives in scoring-config-loader.ts (server-only). The live
 * config is stored in the VAULT at `meta/library-scoring.json`; every change should carry a version
 * bump + a `docs/eval-labels.md` ledger entry (steering-loop protocol).
 */

export interface LibraryScoringConfig {
  /** Scoring-config version (s1, s1.1, …) — decimal = trial, integer = blessed. Mirrors pipeline versioning. */
  version: string;
  /** Worth below this, on an analyzed item, flags `to_archive`. */
  to_archive_worth: number;
  relevance: {
    /** Coefficient on √(first-party connection count). */
    first_party_coeff: number;
    /** Coefficient per non-first-party connection. */
    other_coeff: number;
    /** Cap on the contextFit contribution inside the relevance term. */
    context_fit_cap: number;
  };
  /** Active-context signal weights used by the deterministic hybrid scorer. */
  signal_weights: {
    project: number;
    task: number;
    area: number;
    person: number;
  };
  /** Versioned explicit-context hybrid constants. */
  hybrid: {
    title_weight: number;
    summary_tags_weight: number;
    body_weight: number;
    k1: number;
    b: number;
    max_document_frequency: number;
    task_project_min_terms: number;
    other_min_terms: number;
    second_match_weight: number;
    normalization_percentile: number;
    active_connection_boost: number;
    attention_high_adjustment: number;
    attention_medium_adjustment: number;
    attention_low_adjustment: number;
  };
  for_you: {
    /** Maximum episodes an editorial batch may contain. */
    batch_max: number;
    /** Stage-1 pool size handed to the editor after recency/context candidate generation. */
    pool: number;
    /** Fresh ready-study window included without needing a contextual trigger. */
    new_window_days: number;
    /** Recent work/conversation evidence window used for older-item resurfacing. */
    context_window_hours: number;
    exposure_cooldown_days: number;
    read_cooldown_days: number;
    dismissal_cooldown_days: number;
    /** Days a negative signal (skip/rescue/negative feedback) suppresses an item from For You. */
    negative_suppress_days: number;
  };
}

export const DEFAULT_SCORING_CONFIG: LibraryScoringConfig = {
  version: "s3",
  to_archive_worth: 0.1,
  relevance: { first_party_coeff: 0.32, other_coeff: 0.08, context_fit_cap: 0.3 },
  signal_weights: { project: 1.25, task: 1.35, area: 1.0, person: 0.35 },
  hybrid: {
    title_weight: 3,
    summary_tags_weight: 2,
    body_weight: 1,
    k1: 1.2,
    b: 0.75,
    max_document_frequency: 0.15,
    task_project_min_terms: 2,
    other_min_terms: 3,
    second_match_weight: 0.35,
    normalization_percentile: 0.95,
    active_connection_boost: 0.1,
    attention_high_adjustment: 0.05,
    attention_medium_adjustment: 0.02,
    attention_low_adjustment: -0.05,
  },
  for_you: {
    batch_max: 12,
    pool: 80,
    new_window_days: 7,
    context_window_hours: 72,
    exposure_cooldown_days: 7,
    read_cooldown_days: 14,
    dismissal_cooldown_days: 30,
    negative_suppress_days: 7,
  },
};
