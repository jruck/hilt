/**
 * Chunking — turn vault files into the items + embedding-unit chunks the backfill
 * embeds. Text-only v1 (locked decision): we embed the title + markdown body (and,
 * for saved references, the summary/notes that already live in the body).
 *
 * Scope is enforced by reusing the graph's `scanVault` (graph/build.ts): it walks
 * only INCLUDED_DIRS (which includes `references/` = saved Library refs) and skips
 * dotdirs + `.cache` + the `libraries/` sub-vault. Library CANDIDATES (under the
 * dotdir-excluded `references/.cache`) are pulled separately via the candidate-cache
 * API (`collectCandidateItems`) so the library eval gets a real semantic fit for the
 * review queue too — mirroring how the graph pulls its candidate nodes.
 *
 * item_id IS the graph node id (ruling R1), computed with the same dir-based scheme
 * as graph/build's (private) nodeIdForResolvedPath, via its exported id helpers — so
 * a semantic item and its graph node line up without duplication.
 */

import * as crypto from "crypto";
import * as path from "path";
import {
  NORTH_STAR_NODE_ID,
  candidateNodeId,
  classifyFile,
  noteNodeId,
  personNodeId,
  projectNodeId,
  referenceNodeId,
  resolveVaultRoot,
  scanVault,
  type ScannedFile,
} from "@/lib/graph/build";
import { listCandidates } from "@/lib/library/candidate-cache";
import { extractHeading, parseMarkdownFile } from "@/lib/library/markdown";
import { boundedInt } from "./config";

/** Max chars per chunk (~1k tokens). Short items stay a single chunk. */
export function chunkMaxChars(): number {
  return boundedInt(process.env.SEMANTIC_CHUNK_MAX_CHARS, 4000, 500, 20000);
}

export interface ItemChunk {
  id: string; // item_id + ':' + ordinal
  ordinal: number;
  text: string;
}

export interface ItemChunks {
  itemId: string;
  scope: "vault" | "library";
  kind: string;
  sourcePath: string;
  sourceFile: string;
  title: string | null;
  url: string | null;
  contentHash: string;
  chunks: ItemChunk[];
}

/** item_id (= graph node id) for a scanned file, mirroring graph/build's scheme. */
export function itemIdForFile(file: ScannedFile): string {
  const t = classifyFile(file.absPath, file.dir);
  if (t === "person") return personNodeId(path.basename(file.absPath, ".md"));
  if (t === "reference") return referenceNodeId(file.absPath);
  if (t === "project") return projectNodeId(path.basename(path.dirname(file.absPath)));
  if (t === "north_star") return NORTH_STAR_NODE_ID;
  return noteNodeId(file.absPath);
}

function kindForFile(file: ScannedFile): string {
  if (file.dir === "meetings") return "meeting";
  return classifyFile(file.absPath, file.dir);
}

/** Split into sentences, collapsing all whitespace to single spaces (reconstructable). */
export function splitSentences(text: string): string[] {
  const norm = text.replace(/\s+/g, " ").trim();
  if (!norm) return [];
  return norm.split(/(?<=[.!?])\s+/).filter(Boolean);
}

/** Normalized form used for hashing + chunk reconstruction (sentences joined by space). */
export function normalizeForChunking(text: string): string {
  return splitSentences(text).join(" ");
}

/**
 * Partition text into chunks ≤ maxChars at sentence boundaries. Short text → one
 * chunk. `chunks.join(" ")` reconstructs `normalizeForChunking(text)` (a lone
 * sentence longer than maxChars is hard-split as a defensive fallback).
 */
export function chunkText(text: string, maxChars = chunkMaxChars()): string[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > maxChars) {
      if (cur) { out.push(cur); cur = ""; }
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars));
      continue;
    }
    if (cur && cur.length + 1 + s.length > maxChars) {
      out.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Build the item + its chunks from one scanned file. Returns null if there's no text. */
export function buildItemChunks(file: ScannedFile): ItemChunks | null {
  let parsed;
  try {
    parsed = parseMarkdownFile(file.absPath);
  } catch {
    return null;
  }
  const fm = parsed.data ?? {};
  const itemId = itemIdForFile(file);
  const base = path.basename(file.absPath, ".md");
  const title = (typeof fm.title === "string" && fm.title.trim()) || extractHeading(parsed.body, base);
  const url = typeof fm.url === "string" ? fm.url : null;
  // Embed text = title + body (title carries strong topical signal, esp. for refs).
  const assembled = `${title}\n\n${parsed.body}`;
  const normalized = normalizeForChunking(assembled);
  if (!normalized) return null;
  const chunkTexts = chunkText(assembled);
  return {
    itemId,
    scope: file.dir === "references" ? "library" : "vault",
    kind: kindForFile(file),
    sourcePath: file.absPath,
    sourceFile: file.absPath,
    title,
    url,
    contentHash: crypto.createHash("sha256").update(normalized).digest("hex"),
    chunks: chunkTexts.map((text, ordinal) => ({ id: `${itemId}:${ordinal}`, ordinal, text })),
  };
}

/**
 * Library candidates as items. They live under `references/.cache` (dotdir-excluded from
 * `scanVault`), so they're pulled through the candidate-cache API instead — the same source
 * the graph's candidate nodes use, and the same id scheme (`cand:<artifactId>`, R1). Only
 * `status: candidate` files are collected; promoted/expired/skipped ones drop out, and the
 * runner's reconcile backstop then treats the vanished item as a removal.
 */
export function collectCandidateItems(root = resolveVaultRoot()): ItemChunks[] {
  let candidates: ReturnType<typeof listCandidates>;
  try {
    candidates = listCandidates(root, "candidate");
  } catch {
    return [];
  }
  const out: ItemChunks[] = [];
  for (const c of candidates) {
    const item = candidateItemChunks(c, root);
    if (item) out.push(item);
  }
  return out;
}

/** Build the item + chunks for ONE parsed candidate (shared by the bulk collect + the runner). */
export function candidateItemChunks(c: ReturnType<typeof listCandidates>[number], root: string): ItemChunks | null {
  const absPath = path.join(root, c.path);
  const assembled = `${c.title}\n\n${c.content}`;
  const normalized = normalizeForChunking(assembled);
  if (!normalized) return null;
  const itemId = candidateNodeId(c.id);
  return {
    itemId,
    scope: "library",
    kind: "candidate",
    sourcePath: absPath,
    sourceFile: absPath,
    title: c.title,
    url: c.url || null,
    contentHash: crypto.createHash("sha256").update(normalized).digest("hex"),
    chunks: chunkText(assembled).map((text, ordinal) => ({ id: `${itemId}:${ordinal}`, ordinal, text })),
  };
}

/** Scan the vault (locked scope) and build items + chunks for every file, plus candidates. */
export function collectItems(root = resolveVaultRoot()): ItemChunks[] {
  const out: ItemChunks[] = [];
  for (const file of scanVault(root)) {
    const item = buildItemChunks(file);
    if (item) out.push(item);
  }
  out.push(...collectCandidateItems(root));
  return out;
}
