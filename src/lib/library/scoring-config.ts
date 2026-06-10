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
  /** Active-context signal weights (token + semantic paths). */
  signal_weights: {
    project: number;
    task: number;
    area: number;
    person: number;
    recent_save: number;
    recent_save_manual: number;
  };
  for_you: {
    /** Final picks served. */
    max_items: number;
    /** Stage-1 pool size handed to the editor pass / re-rank rules. */
    pool: number;
    /** Slots (of max_items) reserved for exploration picks. */
    exploration_slots: number;
    /** Max picks from a single source_id (diversity rule). */
    source_cap: number;
    /** Days a negative signal (skip/rescue/negative feedback) suppresses an item from For You. */
    negative_suppress_days: number;
  };
}

export const DEFAULT_SCORING_CONFIG: LibraryScoringConfig = {
  version: "s1",
  to_archive_worth: 0.1,
  relevance: { first_party_coeff: 0.32, other_coeff: 0.08, context_fit_cap: 0.3 },
  signal_weights: { project: 1.25, task: 1.35, area: 1.0, person: 0.35, recent_save: 0.45, recent_save_manual: 0.65 },
  for_you: { max_items: 8, pool: 30, exploration_slots: 1, source_cap: 2, negative_suppress_days: 7 },
};
