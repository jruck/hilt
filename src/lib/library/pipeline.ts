/**
 * This module + the prompt files it re-exports ARE the versioned summarization skill.
 *
 * VERSIONING — integers vs decimals:
 *   - An INTEGER version (v1, v2, …) is a protocol PUBLISHED at scale — rolled out across the whole
 *     library via a full backfill. It is the "of record" baseline most items carry.
 *   - A DECIMAL version (v1.1, v1.2, …) is a TEST/ITERATION generation — reviewed on a small batch
 *     in the Updated lane, not yet rolled out. Bump the decimal each iteration.
 *   - PROMOTION: when a decimal is blessed and backfilled across the library, it becomes the next
 *     INTEGER (e.g. v1.3 → v2), the new baseline.
 *
 * GENERATION CYCLE — on ANY change to the digest/connection/reweave logic:
 *   1. Edit the prompt(s)/logic here.
 *   2. Bump PIPELINE_VERSION (decimal for a test, integer for a publish).
 *   3. Add an entry to docs/PIPELINE-VERSIONS.md (the durable history).
 *   4. Write docs/review-notes/<version>.md — a brief "what to review / why" note.
 *   5. Cut the batch with scripts/library-reweave.ts --review-batch <label> (it stamps the version
 *      AND carries the note into the review queue, so it renders atop the Updated lane).
 *
 * Never keep runnable copies of old versions — git history is the archive.
 */

export const PIPELINE_VERSION = "v2.5";

/**
 * Versions that count as "current" for reweave purposes. An item stamped with any of these is NOT
 * re-reweaved when the live PIPELINE_VERSION bumps a decimal — the digest protocol is identical; the
 * onion (v2.1) only added the candidate path, v2.2 only added the attention_judgment field, v2.3
 * gates downstream work on capture health while adding X Article source acquisition, v2.4 makes the
 * same reweave contract use Claude's native structured output, and v2.5 adds a gated embedded-video
 * transcript capture path. None changes the published digest voice, so older items are not
 * version-behind. The published saved baseline of record is "v2". Shared by the backfill orchestrator
 * AND the health backlog metric so the two can never drift.
 */
export const CURRENT_PIPELINE_VERSIONS: ReadonlySet<string> = new Set([PIPELINE_VERSION, "v2.4", "v2.3", "v2.2", "v2.1", "v2"]);

// The L1 digest prompt is no longer owned here. capture-voice.ts is the single source of the shared
// voice core (CAPTURE_VOICE) and the body-only DIGEST_PROMPT that wraps it; both layers compose it.
export { DIGEST_PROMPT } from "./capture-voice";
export { REWEAVE_PROMPT } from "./reweave-prompt";
export { CONNECTION_PROMPT } from "./connection-prompt";
