/**
 * Capture health — the single predicate for "did we actually get this item's content?" Used by the
 * eval gate (needs_refetch lifecycle), the metrics scorecard, the refetch drain, and the reweave
 * drain (never weave a stub). PURE module (client-safe).
 *
 * Positive failure signals (absence of evidence is NOT failure — legacy items stay gradable):
 *   1. The explicit empty-cache marker in the body.
 *   2. A metadata-fallback digest with a sub-threshold source (the "t.co stub" case, found on
 *      2026-06-10's the-untrainable: an X post whose entire text is one shortlink to a login-walled
 *      X Article — the fetch "succeeded" with 127 chars of nothing and was wrongly graded hot).
 *      Real tweet captures carry text + author + links and clear the threshold comfortably.
 *   3. An X video URL whose cached source is not an X-video transcript. The tweet wrapper is not the
 *      content; the video audio/captions are. Terminal unavailable states (silent/no-audio video or
 *      unavailable/suspended source) are explicit non-failures so they don't churn forever.
 */

export const NO_SOURCE_MARKER = "No cached source content available";

/** Minimum PROSE words for a source-metadata capture to count as real content. The distinction is
 *  prose-vs-link, not length: a stub is dominated by a URL + "Author/Published/Links" with no words
 *  (the-untrainable: one t.co link to a walled X Article), while a genuinely short tweet carries
 *  real words ("really solid, pasted it here if you want to try it"). Length alone misfires on both
 *  ends — short real tweets read as stubs, padded link-lists read as content. */
const METADATA_STUB_MIN_PROSE_WORDS = 6;

export interface CaptureHealthInput {
  /** The rendered body (carries the Raw Content section). */
  body?: string | null;
  /** Frontmatter fields, as parsed. */
  frontmatter?: Record<string, unknown> | null;
}

/** Real-word count after stripping URLs, ISO timestamps, and the X metadata scaffolding. Counts only
 *  ALPHABETIC words (≥3 letters) so date/number fragments (2026, 000Z, 10T00) and handles can't pass
 *  a bare-link stub off as prose. */
function proseWordCount(text: string): number {
  const stripped = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, " ")
    .replace(/\b(Author|Published|Links|Link|Source|via)\s*:/gi, " ");
  return (stripped.match(/\b[A-Za-z]{3,}\b/g) || []).length;
}

/** The cached source text from the Raw Content `<details>` block (what was actually captured). */
function rawContentText(body: string): string {
  const match = body.match(/^##\s+Raw Content\s*$/mi);
  if (!match || match.index === undefined) return "";
  const afterHeading = body.slice(match.index + match[0].length);
  const nextHeading = afterHeading.search(/\n##\s+/);
  const section = nextHeading >= 0 ? afterHeading.slice(0, nextHeading) : afterHeading;
  return section
    .replace(/<\/?details>|<summary>[\s\S]*?<\/summary>/gi, "")
    .replace(/```[\s\S]*?```/g, " ")
    .trim();
}

function isXVideoFrontmatter(fm: Record<string, unknown>): boolean {
  const videoUrl = typeof fm.video_url === "string" ? fm.video_url : "";
  return /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/\s]+\/status\/\d+\/video(?:\/\d+)?(?:[?#].*)?$/i.test(videoUrl);
}

export function captureFailed(input: CaptureHealthInput): boolean {
  const body = input.body || "";
  if (body.includes(NO_SOURCE_MARKER)) return true;
  const fm = input.frontmatter || {};
  if (isXVideoFrontmatter(fm)) {
    const extractor = typeof fm.cached_source_extractor === "string" ? fm.cached_source_extractor : "";
    const transcriptStatus = typeof fm.x_video_transcript_status === "string" ? fm.x_video_transcript_status : "";
    if (transcriptStatus === "unavailable_no_audio" || transcriptStatus === "unavailable_source") return false;
    if (extractor !== "x-video-subtitles" && extractor !== "x-video-audio") return true;
  }
  // Only metadata-fallback captures are suspect; a real summarize/source-cache extract is trusted.
  if (fm.digested_with === "source-metadata") {
    return proseWordCount(rawContentText(body)) < METADATA_STUB_MIN_PROSE_WORDS;
  }
  return false;
}
