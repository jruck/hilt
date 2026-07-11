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
 *   4. A thin page whose primary embedded video was detected but not transcribed. Once the fallback
 *      declares the video required, page chrome/taglines cannot masquerade as the source.
 */

export const NO_SOURCE_MARKER = "No cached source content available";

/** Minimum PROSE words for a source-metadata capture to count as real content. The distinction is
 *  prose-vs-link, not length: a stub is dominated by a URL + "Author/Published/Links" with no words
 *  (the-untrainable: one t.co link to a walled X Article), while a genuinely short tweet carries
 *  real words ("really solid, pasted it here if you want to try it"). Length alone misfires on both
 *  ends — short real tweets read as stubs, padded link-lists read as content. */
const METADATA_STUB_MIN_PROSE_WORDS = 6;

export function sourceMetadataCaptureHasEnoughProse(text: string): boolean {
  return proseWordCount(text) >= METADATA_STUB_MIN_PROSE_WORDS;
}

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

/** Login/auth-wall chrome markers — text that means "you must sign in," not article prose. Exported so
 *  the authenticated-recovery scripts detect the same walls (one source of truth, no drift). */
export const LOGIN_WALL_PATTERNS: RegExp[] = [
  /\bsign in to (?:view|see|read|access|continue)\b/i,
  /\bcontinue to join or sign in\b/i,
  /\bcreate (?:your free account|an account or sign in)\b/i,
  /\b(?:join now|join to view|join linkedin|new to linkedin\??)\b/i,
  /\bagree & join\b/i,
  /\bto view or add a comment,? sign in\b/i,
  /\blog ?in to (?:view|see|read|continue)\b/i,
];

/** Min ALPHABETIC prose words (after stripping wall lines) for a login-walled capture to still count
 *  as carrying the real article underneath — the common Raindrop case (a logged-in full-DOM snapshot
 *  whose article sits below the sign-in chrome). Below this, the capture is just the wall and needs an
 *  authenticated re-fetch. Env-tunable. */
const REAL_CONTENT_MIN_PROSE_WORDS = Number(process.env.LIBRARY_LOGIN_WALL_MIN_PROSE_WORDS) || 50;

export interface LoginWallVerdict {
  /** Wall markers lead the text (page opens with the gate) or repeat — the capture is auth-gated. */
  isWall: boolean;
  /** Enough prose survives after stripping the wall lines that a real article is present underneath. */
  hasRealContent: boolean;
}

/**
 * Decide whether captured text is gated by a login/auth wall, and whether a real article sits under it.
 * The common Raindrop LinkedIn capture is `{ isWall: true, hasRealContent: true }` (chrome leads, full
 * article below) → clean + summarize + weave normally; a bare wall is `{ isWall: true, hasRealContent:
 * false }` → route to authenticated recovery. PURE; client-safe.
 */
export function loginWallVerdict(text: string): LoginWallVerdict {
  const input = (text || "").trim();
  if (!input) return { isWall: false, hasRealContent: false };
  const head = input.slice(0, 800);
  const headMatch = LOGIN_WALL_PATTERNS.some((re) => re.test(head));
  const totalMatches = LOGIN_WALL_PATTERNS.filter((re) => re.test(input)).length;
  const isWall = headMatch || totalMatches >= 2;
  if (!isWall) return { isWall: false, hasRealContent: proseWordCount(input) >= REAL_CONTENT_MIN_PROSE_WORDS };
  // Strip the wall phrases inline (line-independent — a cache may collapse to one block) and measure the
  // prose that remains. A real article leaves hundreds of words; a bare sign-in gate leaves almost none.
  const stripped = LOGIN_WALL_PATTERNS.reduce((acc, re) => acc.replace(new RegExp(re.source, "gi"), " "), input);
  return { isWall, hasRealContent: proseWordCount(stripped) >= REAL_CONTENT_MIN_PROSE_WORDS };
}

/**
 * Is this "text" actually undecodable binary (a PDF/image/font read as text)? A backstop so binary
 * bytes can never land as — or survive as — a cached source, regardless of source or content-type.
 * Measures the share of U+FFFD replacement chars + control bytes (excluding tab/newline/CR) in a head
 * sample. PURE; client-safe. (The Loop-Engineering-IEEE.pdf failure: a PDF dumped as text, ~43% lost.)
 */
export function looksLikeBinaryGarbage(text: string): boolean {
  if (!text) return false;
  const sample = text.slice(0, 4000);
  let bad = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const c = sample.charCodeAt(i);
    if (c === 0xfffd || c < 0x09 || (c > 0x0d && c < 0x20)) bad += 1;
  }
  return sample.length >= 200 && bad / sample.length > 0.1;
}

export function captureFailed(input: CaptureHealthInput): boolean {
  const body = input.body || "";
  if (body.includes(NO_SOURCE_MARKER)) return true;
  const fm = input.frontmatter || {};
  // A capture digestion flagged as login/auth-walled (no real article under the chrome) must be
  // re-fetched with an authenticated browser, not rewoven — same routing as the t.co stub below.
  if (fm.needs_auth_recovery === true) return true;
  // Belt-and-suspenders for legacy items stamped before that flag existed: a Raw Content section that
  // is dominated by sign-in chrome with no real prose under it is a failed capture. Items that lead
  // with chrome BUT carry the real article (the common Raindrop case) clear this and stay gradable.
  const rawContent = rawContentText(body);
  if (rawContent) {
    // A binary dump (PDF/image read as text) is a failed capture — re-extract, never grade as content.
    if (looksLikeBinaryGarbage(rawContent)) return true;
    const verdict = loginWallVerdict(rawContent);
    if (verdict.isWall && !verdict.hasRealContent) return true;
  }
  if (isXVideoFrontmatter(fm)) {
    const extractor = typeof fm.cached_source_extractor === "string" ? fm.cached_source_extractor : "";
    const transcriptStatus = typeof fm.x_video_transcript_status === "string" ? fm.x_video_transcript_status : "";
    if (transcriptStatus === "unavailable_no_audio" || transcriptStatus === "unavailable_source") return false;
    if (extractor !== "x-video-subtitles" && extractor !== "x-video-audio") return true;
  }
  if (fm.embedded_video_required === true) {
    const extractor = typeof fm.cached_source_extractor === "string" ? fm.cached_source_extractor : "";
    const transcriptStatus = typeof fm.embedded_video_transcript_status === "string" ? fm.embedded_video_transcript_status : "";
    if (transcriptStatus !== "captured") return true;
    if (extractor !== "embedded-video-subtitles" && extractor !== "embedded-video-audio") return true;
  }
  // Only metadata-fallback captures are suspect; a real summarize/source-cache extract is trusted.
  if (fm.digested_with === "source-metadata") {
    return !sourceMetadataCaptureHasEnoughProse(rawContentText(body));
  }
  return false;
}
