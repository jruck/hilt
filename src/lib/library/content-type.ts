/**
 * Content-type resolution — the single source of truth for "what IS this item" (Library icon
 * system, master reference in CHANGELOG "content-type icons"). Icons key on CONTENT TYPE, not
 * capture channel: a video saved via Raindrop is still a video. PURE module (no node imports) so
 * client components can share it.
 *
 * Rules:
 *   1. The stamped `format` is the primary signal.
 *   2. URL/duration evidence only UPGRADES generic formats (link/bookmark/document/empty) — it
 *      never downgrades a specific one (a tweet containing a video is still a post).
 *   3. The Editor's Memo always wins (it's the library's own voice).
 */

export type LibraryContentType =
  | "memo"
  | "video"
  | "code"
  | "post"
  | "newsletter"
  | "book"
  | "podcast"
  | "slides"
  | "image"
  | "article"
  | "page";

export const CONTENT_TYPE_LABELS: Record<LibraryContentType, string> = {
  memo: "Editor's memo",
  video: "Video",
  code: "Code / repo",
  post: "Post / thread",
  newsletter: "Newsletter",
  book: "Book / guide",
  podcast: "Podcast",
  slides: "Slides",
  image: "Image",
  article: "Article",
  page: "Page",
};

const VIDEO_FORMATS = new Set(["video", "video-workshop-transcript"]);
const POST_FORMATS = new Set(["tweet", "tweet-thread", "x-article"]);
const BOOK_FORMATS = new Set(["book", "long-form-guide"]);
const GENERIC_FORMATS = new Set(["", "link", "bookmark", "document"]);

export const VIDEO_URL_RE = /(youtube\.com\/(watch|embed|shorts)|youtu\.be\/|vimeo\.com\/\d|loom\.com\/(share|embed))/i;
export const CODE_URL_RE = /(github\.com|gist\.github\.com|gitlab\.com|bitbucket\.org)/i;
const POST_URL_RE = /^https?:\/\/(www\.)?(x|twitter)\.com\//i;

export interface ContentTypeSignals {
  format?: string | null;
  url?: string | null;
  source_id?: string | null;
  video_duration_seconds?: number | null;
}

export function contentTypeForArtifact(input: ContentTypeSignals): LibraryContentType {
  if (input.source_id === "library-memo") return "memo";
  const format = (input.format || "").toLowerCase();
  if (VIDEO_FORMATS.has(format)) return "video";
  if (format === "code") return "code";
  if (POST_FORMATS.has(format)) return "post";
  if (format === "newsletter") return "newsletter";
  if (BOOK_FORMATS.has(format)) return "book";
  if (format === "podcast-notes") return "podcast";
  if (format === "slide-deck") return "slides";
  if (format === "image") return "image";
  if (format === "article") return "article";
  if (format === "memo") return "memo";
  if (GENERIC_FORMATS.has(format)) {
    const url = input.url || "";
    if (typeof input.video_duration_seconds === "number" || VIDEO_URL_RE.test(url)) return "video";
    if (CODE_URL_RE.test(url)) return "code";
    if (POST_URL_RE.test(url)) return "post";
  }
  return "page";
}
