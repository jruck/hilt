import path from "path";
import type { Citation, ConnectionSuggestion } from "./types";
import { parseMarkdownFile, stringifyMarkdown } from "./markdown";
import { atomicWriteFile, walkMarkdown } from "./utils";
import { getYouTubeVideoId } from "./media";

export type { Citation, ConnectionSuggestion } from "./types";

/**
 * A library entry is the *content* (an article/video/episode); the sources it was cited from are
 * separate. When the same important content arrives from more than one source — e.g. a podcast episode
 * that comes in both via its YouTube channel feed AND the newsletter that announces it — there should
 * be ONE entry with several `cited_from` citations, not N duplicate entries. This module supplies the
 * content-match + merge primitives used by the dedupe backfill and the ingest guard.
 *
 * `Citation` and `ConnectionSuggestion` live in ./types (re-exported above for convenience).
 */

/**
 * Normalize a title for cross-source content matching: lowercase, collapse separator punctuation
 * (| - – — :) and any non-alphanumerics to single spaces. Two captures of the same episode from
 * different sources share a normalized title even when one trails "| Lenny's Podcast".
 */
export function normalizeContentTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/[|\-–—:]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Pull a YouTube embed URL out of a `## Media` iframe so videos match even when the entry's `url`
 *  is a `superhuman://` thread (the newsletter half carries the embed, not a watch URL field). */
function embeddedYouTubeId(body: string | undefined): string | null {
  if (!body) return null;
  const src = body.match(/<iframe[^>]+src="([^"]+)"/i)?.[1];
  return getYouTubeVideoId(src) || null;
}

/**
 * Content-match keys for an item. Prefer the YouTube video id (strongest, exact); fall back to a
 * normalized title (used for the newsletter↔YouTube case, where the announcement carries no watch URL).
 */
export function contentMatchKeys(opts: { url?: string | null; body?: string; title?: string }): {
  videoId: string | null;
  titleKey: string | null;
} {
  const videoId = getYouTubeVideoId(opts.url) || embeddedYouTubeId(opts.body);
  const t = normalizeContentTitle(opts.title || "");
  return { videoId, titleKey: t.length >= 15 ? t : null };
}

/**
 * Canonical-preference rank: primary CONTENT (a YouTube video / direct article) outranks an
 * ANNOUNCEMENT (a newsletter that merely links to it). Higher wins when choosing which half stays the
 * entry. Tuned for the observed pattern (youtube-* feeds vs. the superhuman-news newsletter).
 */
export function sourceRank(sourceId: string | null | undefined, channel?: string | null): number {
  const id = sourceId || "";
  if (/^youtube/i.test(id) || channel === "youtube") return 2;
  if (id === "superhuman-news" || id === "newsletters" || channel === "email") return 0;
  return 1;
}

/** Dedupe a citation list by (source_id, url); later entries don't clobber earlier ones. */
export function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of citations) {
    if (!c || !c.source_id) continue;
    const key = `${c.source_id}::${c.url || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Union two connection-suggestion lists by `target` (first occurrence wins its label/relationship);
 *  target-less suggestions are de-duped by `label`. */
export function unionConnections(a: ConnectionSuggestion[], b: ConnectionSuggestion[]): ConnectionSuggestion[] {
  const seen = new Set<string>();
  const out: ConnectionSuggestion[] = [];
  for (const c of [...a, ...b]) {
    if (!c) continue;
    const key = c.target ? `t:${c.target}` : c.label ? `l:${c.label}` : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function readConnectionSuggestions(data: Record<string, unknown>): ConnectionSuggestion[] {
  const raw = data.connection_suggestions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ConnectionSuggestion | null => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const label = typeof r.label === "string" ? r.label : "";
      const target = typeof r.target === "string" ? r.target : undefined;
      if (!label && !target) return null;
      return {
        target,
        label,
        relationship: typeof r.relationship === "string" ? r.relationship : "",
      };
    })
    .filter((c): c is ConnectionSuggestion => c !== null);
}

/** Render the body `## Connections` lines from suggestions, mirroring references.ts `connectionLines`. */
function renderConnectionLines(suggestions: ConnectionSuggestion[]): string {
  return suggestions
    .map((s) => `- ${s.target ? `[[${s.target}|${s.label}]]` : s.label} - ${s.relationship}`)
    .join("\n");
}

/** Replace (or insert) the body `## Connections` section with rendered lines for `suggestions`. */
function replaceConnectionsSection(body: string, suggestions: ConnectionSuggestion[]): string {
  const lines = renderConnectionLines(suggestions);
  const block = lines ? `## Connections\n\n${lines}\n` : "";
  const startRe = /(?:^|\n)## Connections[ \t]*\n/;
  const m = body.match(startRe);
  if (m && typeof m.index === "number") {
    const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
    const rest = body.slice(start + m[0].length - (m[0].startsWith("\n") ? 1 : 0));
    const nextHeading = rest.search(/(?:^|\n)## /);
    const after = nextHeading >= 0 ? rest.slice(nextHeading).replace(/^\n/, "") : "";
    const head = body.slice(0, start);
    return `${head}${block ? `${block}\n` : ""}${after}`.replace(/\n{3,}/g, "\n\n");
  }
  if (!block) return body;
  // Insert before ## Raw Content (or ## Source Notes), else append.
  const anchor = body.search(/(?:^|\n)## (?:Raw Content|Source Notes)/);
  if (anchor >= 0) {
    const at = anchor + (body[anchor] === "\n" ? 1 : 0);
    return `${body.slice(0, at)}${block}\n${body.slice(at)}`.replace(/\n{3,}/g, "\n\n");
  }
  return `${body.trimEnd()}\n\n${block}`;
}

/**
 * Fold `citation` (and optionally its connections) into the canonical entry file IN PLACE: append to
 * `cited_from`, union `connection_suggestions` + rebuild the body `## Connections` section, and clear
 * `reweave_pending` only if it was already resolved. Idempotent on (source_id,url). Returns false when
 * nothing changed (already cited).
 */
export function appendCitationToFile(
  filePath: string,
  citation: Citation,
  extraConnections: ConnectionSuggestion[] = [],
): boolean {
  const { data, body } = parseMarkdownFile(filePath);
  const existing: Citation[] = Array.isArray(data.cited_from) ? (data.cited_from as Citation[]) : [];
  const merged = dedupeCitations([...existing, citation]);
  const citationAdded = merged.length !== existing.length;

  let nextBody = body;
  let connectionsChanged = false;
  if (extraConnections.length) {
    const current = readConnectionSuggestions(data);
    const unioned = unionConnections(current, extraConnections);
    if (unioned.length !== current.length) {
      data.connection_suggestions = unioned;
      nextBody = replaceConnectionsSection(body, unioned);
      connectionsChanged = true;
    }
  }
  if (!citationAdded && !connectionsChanged) return false;

  data.cited_from = merged;
  atomicWriteFile(filePath, stringifyMarkdown(data, nextBody));
  return true;
}

export interface ContentDuplicate {
  path: string;             // absolute path of the matched canonical-candidate entry
  rel: string;              // vault-relative
  saved: boolean;           // a durable saved reference (vs. a candidate-cache entry)
  source_id: string;
  source_name: string;
  url: string;
  channel: string | null;
  at?: string;
  title: string;
  connections: ConnectionSuggestion[];
  reconnected: boolean;
}

/**
 * Scan saved references + candidates for an entry that is the SAME CONTENT as `item` (by YouTube video
 * id, else exact normalized title within `dayWindow` days), excluding `excludePath` and any item from
 * the same `source_id` (same source ⇒ not a cross-source citation — that's the URL-dedup's job).
 * Returns the best match (most-reweaved, then highest source rank) or null.
 */
export function findContentDuplicate(
  vaultPath: string,
  item: { url?: string | null; body?: string; title?: string; sourceId?: string; date?: string },
  opts: { excludePath?: string; dayWindow?: number } = {},
): ContentDuplicate | null {
  const keys = contentMatchKeys(item);
  if (!keys.videoId && !keys.titleKey) return null;
  const dayWindow = opts.dayWindow ?? 4;
  const itemDate = item.date ? Date.parse(item.date) : NaN;
  const matches: ContentDuplicate[] = [];

  for (const root of ["references", "references/.cache/library-candidates"]) {
    const dir = path.join(vaultPath, root);
    let files: string[];
    try { files = walkMarkdown(dir, { includeHidden: root.includes(".cache") }); } catch { continue; }
    for (const fp of files) {
      if (opts.excludePath && path.resolve(fp) === path.resolve(opts.excludePath)) continue;
      let parsed: ReturnType<typeof parseMarkdownFile>;
      try { parsed = parseMarkdownFile(fp); } catch { continue; }
      const d = parsed.data;
      const otherSource = typeof d.source_id === "string" ? d.source_id : "";
      if (item.sourceId && otherSource && otherSource === item.sourceId) continue;
      const otherKeys = contentMatchKeys({ url: typeof d.url === "string" ? d.url : "", body: parsed.body, title: String(d.title || "") });
      let isMatch = false;
      if (keys.videoId && otherKeys.videoId && keys.videoId === otherKeys.videoId) {
        isMatch = true;
      } else if (keys.titleKey && otherKeys.titleKey && keys.titleKey === otherKeys.titleKey) {
        // Title-only match needs a close date (long, specific titles make this safe).
        const otherDate = Date.parse(String(d.published || d.captured || d.digested || d.digested_at || ""));
        if (!Number.isFinite(itemDate) || !Number.isFinite(otherDate)) isMatch = true;
        else isMatch = Math.abs(itemDate - otherDate) <= dayWindow * 86_400_000;
      }
      if (!isMatch) continue;
      matches.push({
        path: fp,
        rel: path.relative(vaultPath, fp),
        saved: !fp.includes(`${path.sep}.cache${path.sep}`),
        source_id: otherSource,
        source_name: typeof d.source_name === "string" ? d.source_name : otherSource,
        url: typeof d.url === "string" ? d.url : "",
        channel: typeof d.channel === "string" ? d.channel : null,
        at: String(d.captured || d.digested || d.published || "") || undefined,
        title: String(d.title || ""),
        connections: readConnectionSuggestions(d),
        reconnected: Boolean(d.reconnected_at),
      });
    }
  }
  if (!matches.length) return null;
  matches.sort((a, b) =>
    (Number(b.reconnected) - Number(a.reconnected)) ||
    (sourceRank(b.source_id, b.channel) - sourceRank(a.source_id, a.channel)),
  );
  return matches[0];
}

/** Build a Citation from an item's identity fields. */
export function citationFrom(item: {
  source_id?: string | null;
  source_name?: string | null;
  url?: string | null;
  channel?: string | null;
  at?: string | null;
  title?: string | null;
}): Citation {
  return {
    source_id: item.source_id || "unknown",
    source_name: item.source_name || item.source_id || "Unknown source",
    url: item.url || "",
    channel: item.channel || undefined,
    at: item.at || undefined,
    title: item.title || undefined,
  };
}

/** Read connection suggestions from a parsed file's frontmatter (exported for the dedupe backfill). */
export function connectionSuggestionsOf(data: Record<string, unknown>): ConnectionSuggestion[] {
  return readConnectionSuggestions(data);
}

/** Read the `cited_from` citation list from a parsed file's frontmatter (for the parse layer). */
export function readCitations(data: Record<string, unknown>): Citation[] {
  const raw = data.cited_from;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): Citation | null => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      if (typeof r.source_id !== "string") return null;
      return {
        source_id: r.source_id,
        source_name: typeof r.source_name === "string" ? r.source_name : r.source_id,
        url: typeof r.url === "string" ? r.url : "",
        channel: typeof r.channel === "string" ? r.channel : undefined,
        at: typeof r.at === "string" ? r.at : undefined,
        title: typeof r.title === "string" ? r.title : undefined,
      };
    })
    .filter((c): c is Citation => c !== null);
}
