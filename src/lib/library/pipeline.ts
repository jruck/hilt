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

export const PIPELINE_VERSION = "v1.3";

export const DIGEST_PROMPT = [
  "Write a 2-4 sentence narrative summary of this source for a personal reference library.",
  "Then a blank line.",
  "Then a line that is EXACTLY \"Key takeaways:\" on its own.",
  "Then 3-6 distinct markdown bullets, where each bullet is a standalone insight that does NOT restate the narrative summary.",
  "Ignore newsletter/site chrome, navigation, invisible tracking text, subscription/forwarding/unsubscribe boilerplate, and email metadata.",
  "Extract the actual argument, claims, examples, and implications.",
].join(" ");

export { REWEAVE_PROMPT } from "./reweave-prompt";
export { CONNECTION_PROMPT } from "./connection-prompt";
