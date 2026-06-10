import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { toArray } from "./utils";

export interface ParsedMarkdown {
  data: Record<string, unknown>;
  body: string;
  raw: string;
}

// mtime-keyed parse cache (Library v2, Phase E-lite): every library list request used to re-read and
// re-YAML-parse all ~1,100 vault files (~450-700ms/request — the dominant cost). Keyed by mtime+size
// so any write invalidates; `body`/`raw` are immutable strings (safe to share); `data` is cloned on
// EVERY return so callers can never mutate the cached copy. Bounded: cleared wholesale past the cap
// (a full re-parse costs one slow request, not correctness). The full SQLite read index remains
// specced for ~5k+ items (docs/plans/library-v2.md, Workstream 5).
const parseCache = new Map<string, { mtimeMs: number; size: number; data: Record<string, unknown>; body: string; raw: string }>();
const PARSE_CACHE_MAX_ENTRIES = 8192;

export function parseMarkdownFile(filePath: string): ParsedMarkdown {
  const stat = fs.statSync(filePath);
  const cached = parseCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return { data: structuredClone(cached.data), body: cached.body, raw: cached.raw };
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = matter(raw);
  // Clone at store time too: gray-matter keeps its own content-keyed cache and hands the SAME .data
  // object to repeat parses, so storing it un-cloned would alias our cache to gray-matter's.
  const data = structuredClone(parsed.data as Record<string, unknown>);
  if (parseCache.size >= PARSE_CACHE_MAX_ENTRIES) parseCache.clear();
  parseCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, data, body: parsed.content, raw });
  return { data: structuredClone(data), body: parsed.content, raw };
}

export function stringifyMarkdown(data: Record<string, unknown>, body: string): string {
  return matter.stringify(body.trimEnd() + "\n", data).trimEnd() + "\n";
}

export function extractHeading(body: string, fallback: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || fallback;
}

export function extractSection(body: string, sectionName: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${sectionName}`.toLowerCase());
  if (start === -1) return "";
  const collected: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    collected.push(lines[i]);
  }
  return collected.join("\n").trim();
}

export function extractBullets(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

export function extractConnections(body: string): string[] {
  const section = extractSection(body, "Connections") || extractSection(body, "Suggested Connections");
  return extractBullets(section);
}

export function markdownToPlain(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g, (_m, slug, label) => label || slug)
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function frontmatterTags(data: Record<string, unknown>): string[] {
  return Array.from(new Set(toArray(data.tags).map((tag) => tag.trim()).filter(Boolean)));
}

export function relativeVaultPath(vaultPath: string, filePath: string): string {
  return path.relative(vaultPath, filePath).split(path.sep).join("/");
}
