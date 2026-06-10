/**
 * Capture health — the single predicate for "did we actually get this item's content?" Used by the
 * eval gate (needs_refetch lifecycle), the metrics scorecard, the refetch drain, and the reweave
 * drain (never weave a stub). PURE module (client-safe).
 *
 * Two positive failure signals (absence of evidence is NOT failure — legacy items stay gradable):
 *   1. The explicit empty-cache marker in the body.
 *   2. A metadata-fallback digest with a sub-threshold source (the "t.co stub" case, found on
 *      2026-06-10's the-untrainable: an X post whose entire text is one shortlink to a login-walled
 *      X Article — the fetch "succeeded" with 127 chars of nothing and was wrongly graded hot).
 *      Real tweet captures carry text + author + links and clear the threshold comfortably.
 */

export const NO_SOURCE_MARKER = "No cached source content available";

/** Below this, a source-metadata capture is a stub, not content. Tuned above the bare-link case
 *  (~127 chars: one t.co URL + author + date) and below real short posts. */
const METADATA_STUB_MAX_CHARS = 150;

export interface CaptureHealthInput {
  /** The rendered body (carries the Raw Content section). */
  body?: string | null;
  /** Frontmatter fields, as parsed. */
  frontmatter?: Record<string, unknown> | null;
}

export function captureFailed(input: CaptureHealthInput): boolean {
  if ((input.body || "").includes(NO_SOURCE_MARKER)) return true;
  const fm = input.frontmatter || {};
  if (fm.digested_with === "source-metadata") {
    const extracted = typeof fm.extracted_chars === "number" ? fm.extracted_chars : 0;
    const cached = typeof fm.cached_source_chars === "number" ? fm.cached_source_chars : 0;
    if (Math.max(extracted, cached) < METADATA_STUB_MAX_CHARS) return true;
  }
  return false;
}
