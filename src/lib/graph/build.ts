/**
 * Graph builder (System → Graph). Scans the vault and upserts nodes/edges into
 * `graph.sqlite` by REUSING the existing vault parsers read-only. This is a pure
 * derived-cache producer (Critical Constraint #2): markdown stays canonical, the
 * builder never writes the vault, and deleting `graph.sqlite` + rebuilding
 * reproduces the same nodes/edges.
 *
 * Node-inclusion policy (the hard design input — see the plan):
 *   - Exclude ALL dotdirs (`.git`/`.obsidian`/`.claude`/`.codex`/`node_modules`/`.cache`).
 *   - Default global graph = primary vault dirs only; the three nested
 *     `libraries/<sub>` sub-vaults are EXCLUDED unless `graphIncludeLibraries()`
 *     (then modeled as ONE `library_cluster` node each, not their raw leaves).
 *   - Candidates come from the candidate cache API (a dotdir), never the walker.
 *
 * Wikilink performance (the mandatory fix): `resolveWikilink` rebuilds the entire
 * file map on EVERY call. The builder MUST NOT call it per link. Instead it builds
 * ONE file lookup map per full pass (`buildResolverMap`) and resolves each link
 * against that prebuilt map via `resolveLinkWithMap`.
 *
 * Tags (Decision 4): OFF by default. Only `buildTagLayer()` mints `tag:` nodes and
 * `kind="tag"` edges; the default build pass never touches the tag layer.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";
import {
  parseWikilinks,
} from "@/lib/docs/wikilink-resolver";
import {
  matchMeetingsToSlug,
  parseMeetingFrontmatter,
  parsePersonFile,
  parsePeopleIndex,
} from "@/lib/bridge/people-parser";
import { parseProjectIndex } from "@/lib/bridge/project-parser";
import { parseReferenceFile, referencesDir } from "@/lib/library/references";
import { listCandidates } from "@/lib/library/candidate-cache";
import { northStarSignal } from "@/lib/library/kb-index";
import { hashId } from "@/lib/library/utils";
import type { ConnectionSuggestion, ProcessedArtifact } from "@/lib/library/types";
import { graphIncludeLibraries, graphSemanticOverlayEnabled } from "./config";
import {
  deleteDanglingEdges,
  deleteEdgesBySourceFile,
  deleteNodesBySourceFile,
  deleteOrphanPositions,
  getGraphDb,
  recomputeDegrees,
  setMetaMany,
  upsertEdges,
  upsertNodes,
} from "./db";
import type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeType } from "./types";

// ---------------------------------------------------------------------------
// Vault root + included dirs (matches BridgeWatcher resolution exactly)
// ---------------------------------------------------------------------------

/** Resolve the vault root. Order matches `getBridgeWatcher` (bridge-watcher.ts:120). */
export function resolveVaultRoot(): string {
  return (
    process.env.BRIDGE_VAULT_PATH ||
    process.env.HILT_WORKING_FOLDER ||
    path.join(os.homedir(), "work/bridge")
  );
}

/**
 * Primary-vault top-level dirs included in the default global graph. `references`
 * is walked but its `.cache` (candidates) is excluded by the dotdir filter and
 * pulled separately via the candidate cache API. `libraries/` is intentionally
 * NOT here — it is opt-in and modeled as cluster nodes.
 */
export const INCLUDED_DIRS = [
  "projects",
  "people",
  "meetings",
  "references",
  "areas",
  "thoughts",
  "lists/now",
  "docs",
] as const;

/** Dotdirs and known non-knowledge dirs that must never be walked. */
const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".cache",
]);

function isExcludedDirName(name: string): boolean {
  return name.startsWith(".") || EXCLUDED_DIR_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// File scan (one walk per full build; dotdir + library exclusion baked in)
// ---------------------------------------------------------------------------

export interface ScannedFile {
  absPath: string;
  /** Top-level included dir this file belongs to (e.g. "people", "references"). */
  dir: string;
  mtimeMs: number;
}

/** Walk a single included dir, collecting `.md` files (dotdirs/libraries excluded). */
function walkIncludedDir(root: string, dir: string, out: ScannedFile[]): void {
  const start = path.join(root, dir);
  if (!fs.existsSync(start)) return;
  const visit = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (isExcludedDirName(entry.name)) continue;
        visit(path.join(current, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".")) {
        const absPath = path.join(current, entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(absPath).mtimeMs;
        } catch {
          continue;
        }
        out.push({ absPath, dir, mtimeMs });
      }
    }
  };
  visit(start);
}

/** Scan all included dirs once. Returns every `.md` file outside dotdirs/libraries. */
export function scanVault(root: string): ScannedFile[] {
  const out: ScannedFile[] = [];
  for (const dir of INCLUDED_DIRS) walkIncludedDir(root, dir, out);
  return out;
}

// ---------------------------------------------------------------------------
// Prebuilt wikilink resolver (the mandatory perf fix)
// ---------------------------------------------------------------------------

/**
 * A graph-local resolver map built ONCE per full build. Keys mirror the lookup
 * forms `buildFileMap` (wikilink-resolver.ts) uses — filename, filename-without-
 * extension, and vault-relative path (with/without extension) — all lowercased.
 * Resolution against this map replaces per-call `resolveWikilink`, eliminating the
 * O(links × tree) rebuild cost.
 */
export interface ResolverMap {
  byKey: Map<string, string>;
}

/** Build the resolver map from a scanned file list (single pass, first match wins). */
export function buildResolverMap(root: string, files: ScannedFile[]): ResolverMap {
  const byKey = new Map<string, string>();
  const put = (key: string, abs: string) => {
    if (key && !byKey.has(key)) byKey.set(key, abs);
  };
  for (const { absPath } of files) {
    const rel = path.relative(root, absPath).split(path.sep).join("/").toLowerCase();
    const relNoExt = rel.replace(/\.[^/.]+$/, "");
    const base = path.basename(absPath);
    const baseLower = base.toLowerCase();
    const baseNoExt = baseLower.replace(/\.[^/.]+$/, "");
    // Highest priority: full vault-relative path forms, then bare filename forms.
    put(relNoExt, absPath);
    put(rel, absPath);
    put(baseNoExt, absPath);
    put(baseLower, absPath);
  }
  return { byKey };
}

/**
 * Resolve a wikilink target against the prebuilt map. Mirrors `resolveWikilink`'s
 * filename/relative-path/anchor-strip behavior (anchors and the `|display` half are
 * already split out by `parseWikilinks`, but we strip an anchor defensively).
 * Returns the absolute path, or null when unresolved (no placeholder nodes).
 */
export function resolveLinkWithMap(
  target: string,
  currentFilePath: string,
  root: string,
  map: ResolverMap,
): string | null {
  const hashIndex = target.indexOf("#");
  const bare = (hashIndex >= 0 ? target.slice(0, hashIndex) : target).trim();
  if (!bare) return null;
  const lower = bare.toLowerCase();

  // 1. Relative path from the current file (./ or ../).
  if (bare.startsWith("./") || bare.startsWith("../")) {
    const resolved = path.resolve(path.dirname(currentFilePath), bare);
    return tryRelativeForms(resolved, root, map);
  }

  // 2. Implicit relative path containing a slash (subfolder/file).
  if (bare.includes("/") && !bare.startsWith("/")) {
    const resolved = path.resolve(path.dirname(currentFilePath), bare);
    const fromRel = tryRelativeForms(resolved, root, map);
    if (fromRel) return fromRel;
  }

  // 3. Vault-relative / bare filename match.
  const direct =
    map.byKey.get(lower) ||
    map.byKey.get(`${lower}.md`) ||
    map.byKey.get(lower.replace(/\.[^/.]+$/, ""));
  if (direct) return direct;

  // 4. Path-form target — fall back to its final filename segment.
  if (bare.includes("/")) {
    const tail = bare.split("/").pop()?.toLowerCase() || "";
    const fromTail =
      map.byKey.get(tail) ||
      map.byKey.get(`${tail}.md`) ||
      map.byKey.get(tail.replace(/\.[^/.]+$/, ""));
    if (fromTail) return fromTail;
  }

  return null;
}

function tryRelativeForms(resolvedAbs: string, root: string, map: ResolverMap): string | null {
  if (!resolvedAbs.startsWith(root)) return null;
  const rel = path.relative(root, resolvedAbs).split(path.sep).join("/").toLowerCase();
  return (
    map.byKey.get(rel) ||
    map.byKey.get(`${rel}.md`) ||
    map.byKey.get(rel.replace(/\.[^/.]+$/, "")) ||
    null
  );
}

// ---------------------------------------------------------------------------
// Node ID scheme (stable, derived — see the plan's ID table)
// ---------------------------------------------------------------------------

export function noteNodeId(absPath: string): string {
  return `note:${hashId(absPath)}`;
}
export function referenceNodeId(absPath: string): string {
  return `ref:${hashId(absPath)}`;
}
export function candidateNodeId(artifactId: string): string {
  return `cand:${artifactId}`;
}
export function personNodeId(slug: string): string {
  return `person:${slug}`;
}
export function projectNodeId(slug: string): string {
  return `project:${slug}`;
}
export const NORTH_STAR_NODE_ID = "north_star:areas";
export function libraryClusterNodeId(sub: string): string {
  return `libcluster:${sub}`;
}
export function tagNodeId(normalizedTag: string): string {
  return `tag:${normalizedTag}`;
}
/** Semantic-overlay node ids (Phase 2): the semantic.sqlite topic/entity id, namespaced. */
export function topicNodeId(topicId: string): string {
  return `topic:${topicId}`;
}
export function entityNodeId(entityId: string): string {
  return `entity:${entityId}`;
}

/** Deterministic edge id: hash(source|target|kind) — drives upsert/dedupe. */
export function edgeId(source: string, target: string, kind: GraphEdgeKind): string {
  return hashId(`${source}|${target}|${kind}`);
}

// ---------------------------------------------------------------------------
// Per-file classification + extraction
// ---------------------------------------------------------------------------

interface Extracted {
  node: GraphNode;
  edges: GraphEdge[];
  /** Frontmatter tags retained for the on-demand tag layer (never edges here). */
  tags: string[];
}

/** Classify an included file into its node type by its top-level dir + path. */
export function classifyFile(absPath: string, dir: string): GraphNodeType {
  if (dir === "people") return "person";
  if (dir === "references") return "reference";
  if (dir === "projects" && path.basename(absPath) === "index.md") return "project";
  if (dir === "areas" && path.basename(absPath) === "index.md") return "north_star";
  return "note";
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/^#/, "");
}

/** Resolve a connection-suggestion target to a graph node id (or null to drop). */
function resolveConnectionTarget(
  suggestion: ConnectionSuggestion,
  root: string,
  map: ResolverMap,
): string | null {
  const target = (suggestion.target || "").trim();
  if (!target) return null;
  // `areas` connections attach to the singleton North Star hub.
  if (target === "areas" || target === "areas/index" || target.startsWith("areas/")) {
    return NORTH_STAR_NODE_ID;
  }
  // Person kind → person slug node.
  if (suggestion.kind === "person") return personNodeId(target);
  // Project kind / project-slug → project node.
  if (suggestion.kind === "project") return projectNodeId(target);
  // Otherwise resolve as a wikilink-style reference into the vault.
  const abs = resolveLinkWithMap(target, path.join(root, "references", "x.md"), root, map);
  if (abs) return nodeIdForResolvedPath(abs, root);
  // Fall back to a project slug guess (connected_projects are bare slugs).
  return projectNodeId(target);
}

/**
 * Map a resolved absolute path to its node id, honoring the dir-based ID scheme.
 * Exported (ruling R9) so the semantic overlay maps item paths → graph node ids with
 * the same logic the builder uses — never a reimplementation.
 */
export function nodeIdForResolvedPath(absPath: string, root: string): string {
  const rel = path.relative(root, absPath).split(path.sep).join("/");
  if (rel.startsWith("people/")) {
    return personNodeId(path.basename(absPath, ".md"));
  }
  if (rel.startsWith("references/")) {
    return referenceNodeId(absPath);
  }
  if (rel.startsWith("projects/") && path.basename(absPath) === "index.md") {
    return projectNodeId(path.basename(path.dirname(absPath)));
  }
  if (rel === "areas/index.md") return NORTH_STAR_NODE_ID;
  return noteNodeId(absPath);
}

/** Extract the node + outbound edges for a single included file. */
export function extractFile(
  absPath: string,
  dir: string,
  root: string,
  map: ResolverMap,
  meetingFilenames: string[],
): Extracted | null {
  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
  const type = classifyFile(absPath, dir);

  switch (type) {
    case "person":
      return extractPerson(absPath, root, content, map, meetingFilenames);
    case "reference":
      return extractReference(absPath, root, content, map);
    case "project":
      return extractProject(absPath, root, content, map);
    case "north_star":
      return extractNorthStar(absPath, root, content, map);
    default:
      return extractNote(absPath, root, content, map);
  }
}

/** Wikilink edges shared by note/project/north-star docs. */
function wikilinkEdges(absPath: string, sourceId: string, root: string, content: string, map: ResolverMap): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const link of parseWikilinks(content)) {
    const targetAbs = resolveLinkWithMap(link.target, absPath, root, map);
    if (!targetAbs) continue; // unresolved → no placeholder node
    const targetId = nodeIdForResolvedPath(targetAbs, root);
    if (targetId === sourceId) continue; // skip self-links
    const id = edgeId(sourceId, targetId, "wikilink");
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({
      id,
      source: sourceId,
      target: targetId,
      kind: "wikilink",
      weight: 1,
      attrs: { display: link.display },
    });
  }
  return edges;
}

function frontmatterTagList(content: string): string[] {
  // Cheap frontmatter `tags:` reader: comma list or YAML inline array.
  if (!content.startsWith("---")) return [];
  const end = content.indexOf("\n---", 3);
  if (end === -1) return [];
  const fm = content.slice(4, end);
  for (const line of fm.split("\n")) {
    const m = line.match(/^tags\s*:\s*(.*)$/);
    if (!m) continue;
    const raw = m[1].trim().replace(/^\[|\]$/g, "");
    return raw
      .split(",")
      .map((t) => normalizeTag(t.replace(/^["']|["']$/g, "")))
      .filter(Boolean);
  }
  return [];
}

function extractNote(absPath: string, root: string, content: string, map: ResolverMap): Extracted {
  const id = noteNodeId(absPath);
  const h1 = content.match(/^#\s+(.+)$/m);
  const label = h1 ? h1[1].trim() : path.basename(absPath, ".md");
  return {
    node: { id, type: "note", label, refPath: absPath, degree: 0, colorKey: "note", attrs: {} },
    edges: wikilinkEdges(absPath, id, root, content, map),
    tags: frontmatterTagList(content),
  };
}

function extractProject(absPath: string, root: string, content: string, map: ResolverMap): Extracted {
  const slug = path.basename(path.dirname(absPath));
  const id = projectNodeId(slug);
  const parsed = parseProjectIndex(content);
  const label = parsed.title || slug;
  return {
    node: {
      id,
      type: "project",
      label,
      refPath: absPath,
      degree: 0,
      colorKey: parsed.area ? `area:${parsed.area}` : "project",
      attrs: { slug, status: parsed.status, area: parsed.area, tags: parsed.tags },
    },
    edges: wikilinkEdges(absPath, id, root, content, map),
    tags: parsed.tags.map(normalizeTag).filter(Boolean),
  };
}

function extractNorthStar(absPath: string, root: string, content: string, map: ResolverMap): Extracted {
  const signal = northStarSignal(root)[0];
  const label = signal?.label || "North Stars";
  return {
    node: {
      id: NORTH_STAR_NODE_ID,
      type: "north_star",
      label,
      refPath: absPath,
      degree: 0,
      colorKey: "north_star",
      attrs: {},
    },
    edges: wikilinkEdges(absPath, NORTH_STAR_NODE_ID, root, content, map),
    tags: frontmatterTagList(content),
  };
}

function extractPerson(
  absPath: string,
  root: string,
  content: string,
  map: ResolverMap,
  meetingFilenames: string[],
): Extracted {
  const slug = path.basename(absPath, ".md");
  // Skip people/index.md — it's a directory listing, not a person.
  if (slug === "index") {
    return extractNote(absPath, root, content, map);
  }
  const indexDescription = readPeopleIndexDescription(root, slug);
  const person = parsePersonFile(content, slug, indexDescription);
  const id = personNodeId(slug);
  const edges: GraphEdge[] = [];

  // meeting edges: matchMeetingsToSlug → filenames, then parse each meeting's frontmatter.
  const matched = matchMeetingsToSlug(slug, person.name, meetingFilenames, person.aliases);
  const meetingsRoot = path.join(root, "meetings");
  const seen = new Set<string>();
  for (const filename of matched) {
    const meetingAbs = findMeetingPath(meetingsRoot, filename);
    if (!meetingAbs) continue;
    let meetingContent: string;
    try {
      meetingContent = fs.readFileSync(meetingAbs, "utf-8");
    } catch {
      continue;
    }
    const meta = parseMeetingFrontmatter(meetingContent, filename);
    const targetId = noteNodeId(meetingAbs);
    const eid = edgeId(id, targetId, "meeting");
    if (seen.has(eid)) continue;
    seen.add(eid);
    edges.push({
      id: eid,
      source: id,
      target: targetId,
      kind: "meeting",
      weight: 1,
      attrs: {
        date: meta.created,
        title: meta.title,
        hilt_calendar_event_id: meta.hiltCalendarEventId || undefined,
      },
    });
  }

  // Person notes can also carry wikilinks.
  for (const e of wikilinkEdges(absPath, id, root, content, map)) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      edges.push(e);
    }
  }

  return {
    node: {
      id,
      type: "person",
      label: person.name,
      refPath: slug,
      degree: 0,
      colorKey: "person",
      attrs: { slug, type: person.type, aliases: person.aliases },
    },
    edges,
    tags: frontmatterTagList(content),
  };
}

function extractReference(absPath: string, root: string, content: string, map: ResolverMap): Extracted {
  const detail = parseReferenceFile(root, absPath);
  const id = referenceNodeId(absPath);
  // Files under references/ that aren't `type: reference` fall back to notes.
  if (!detail) {
    return extractNote(absPath, root, content, map);
  }
  const fm = detail.raw_frontmatter as ProcessedArtifact | Record<string, unknown>;
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  // connection_suggestions (durably saved refs only). Drop edges with no target.
  const suggestions = Array.isArray((fm as Record<string, unknown>).connection_suggestions)
    ? ((fm as Record<string, unknown>).connection_suggestions as ConnectionSuggestion[])
    : [];
  for (const suggestion of suggestions) {
    const targetId = resolveConnectionTarget(suggestion, root, map);
    if (!targetId || targetId === id) continue;
    const eid = edgeId(id, targetId, "connection");
    if (seen.has(eid)) continue;
    seen.add(eid);
    edges.push({
      id: eid,
      source: id,
      target: targetId,
      kind: "connection",
      weight: 1,
      attrs: {
        relationship: suggestion.relationship,
        label: suggestion.label,
        kind: suggestion.kind,
      },
    });
  }

  // connected_projects: project-slug subset.
  const connectedProjects = Array.isArray((fm as Record<string, unknown>).connected_projects)
    ? ((fm as Record<string, unknown>).connected_projects as unknown[]).map(String)
    : [];
  for (const slug of connectedProjects) {
    const targetId = projectNodeId(slug);
    const eid = edgeId(id, targetId, "connected_project");
    if (seen.has(eid)) continue;
    seen.add(eid);
    edges.push({
      id: eid,
      source: id,
      target: targetId,
      kind: "connected_project",
      weight: 1.5,
      attrs: { slug },
    });
  }

  // References can also carry inline wikilinks.
  for (const e of wikilinkEdges(absPath, id, root, content, map)) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      edges.push(e);
    }
  }

  // Use the comma-splitting frontmatter reader for tags so a `tags: a, b` scalar
  // is split consistently with notes/projects (frontmatterTags keeps it as one).
  const tags = frontmatterTagList(content);
  return {
    node: {
      id,
      type: "reference",
      label: detail.title,
      refPath: absPath,
      degree: 0,
      colorKey: "reference",
      attrs: { url: detail.url, tags },
    },
    edges,
    tags,
  };
}

// ---------------------------------------------------------------------------
// People-index + meeting-file helpers
// ---------------------------------------------------------------------------

function readPeopleIndexDescription(root: string, slug: string): string {
  try {
    const indexPath = path.join(root, "people", "index.md");
    if (!fs.existsSync(indexPath)) return "";
    return parsePeopleIndex(fs.readFileSync(indexPath, "utf-8"))[slug] || "";
  } catch {
    return "";
  }
}

/** Collect meeting filenames (flat + date-subfolder), excluding the transcripts dir. */
export function collectMeetingFilenames(root: string): string[] {
  const meetingsDir = path.join(root, "meetings");
  return collectMeetingFiles(meetingsDir).map((m) => m.filename);
}

interface MeetingFileRef {
  filename: string;
  fullPath: string;
}

function collectMeetingFiles(meetingsDir: string): MeetingFileRef[] {
  if (!fs.existsSync(meetingsDir)) return [];
  const out: MeetingFileRef[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(meetingsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "transcripts") continue;
    const full = path.join(meetingsDir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push({ filename: entry.name, fullPath: full });
    } else if (entry.isDirectory()) {
      try {
        for (const sub of fs.readdirSync(full)) {
          if (sub.endsWith(".md") && !sub.startsWith(".")) {
            out.push({ filename: sub, fullPath: path.join(full, sub) });
          }
        }
      } catch {
        /* skip unreadable subfolder */
      }
    }
  }
  return out;
}

function findMeetingPath(meetingsDir: string, filename: string): string | null {
  for (const m of collectMeetingFiles(meetingsDir)) {
    if (m.filename === filename) return m.fullPath;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candidates (from the cache API — a dotdir, never walked)
// ---------------------------------------------------------------------------

function extractCandidates(root: string): Array<{ node: GraphNode; sourceFile: string | null }> {
  const out: Array<{ node: GraphNode; sourceFile: string | null }> = [];
  let candidates;
  try {
    candidates = listCandidates(root, "candidate");
  } catch {
    return out;
  }
  for (const c of candidates) {
    const absPath = path.join(root, c.path);
    out.push({
      node: {
        id: candidateNodeId(c.id),
        type: "candidate",
        label: c.title,
        refPath: absPath,
        degree: 0,
        colorKey: "candidate",
        attrs: { url: c.url, score: c.score.total },
      },
      sourceFile: absPath,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Library cluster nodes (opt-in)
// ---------------------------------------------------------------------------

function extractLibraryClusters(root: string): Array<{ node: GraphNode; sourceFile: string | null }> {
  const out: Array<{ node: GraphNode; sourceFile: string | null }> = [];
  const librariesDir = path.join(root, "libraries");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(librariesDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const sub = entry.name;
    const subDir = path.join(librariesDir, sub);
    out.push({
      node: {
        id: libraryClusterNodeId(sub),
        type: "library_cluster",
        label: sub,
        refPath: subDir,
        degree: 0,
        colorKey: "library_cluster",
        attrs: { sub },
      },
      sourceFile: subDir,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Full build
// ---------------------------------------------------------------------------

export interface BuildResult {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  /** source_file → mtimeMs map for the incremental runner's mtime diff. */
  mtimes: Map<string, number>;
}

export interface BuildOptions {
  root?: string;
  db?: Database.Database;
  includeLibraries?: boolean;
}

/**
 * Full build: scan included dirs once, build the resolver map once, extract every
 * node + edge, pull candidates from the cache API, optionally add library clusters,
 * then reconcile dangling edges + recompute degree. Wrapped in one transaction.
 */
export function buildFullGraph(opts: BuildOptions = {}): BuildResult {
  const root = opts.root ?? resolveVaultRoot();
  const db = opts.db ?? getGraphDb();
  const includeLibraries = opts.includeLibraries ?? graphIncludeLibraries();

  const files = scanVault(root);
  const map = buildResolverMap(root, files);
  const meetingFilenames = collectMeetingFilenames(root);

  const nodeEntries: Array<{ node: GraphNode; sourceFile: string | null }> = [];
  const edgeEntries: Array<{ edge: GraphEdge; sourceFile: string | null }> = [];
  const mtimes = new Map<string, number>();

  for (const file of files) {
    const extracted = extractFile(file.absPath, file.dir, root, map, meetingFilenames);
    if (!extracted) continue;
    nodeEntries.push({ node: extracted.node, sourceFile: file.absPath });
    for (const edge of extracted.edges) edgeEntries.push({ edge, sourceFile: file.absPath });
    mtimes.set(file.absPath, file.mtimeMs);
  }

  for (const c of extractCandidates(root)) nodeEntries.push(c);
  if (includeLibraries) {
    for (const c of extractLibraryClusters(root)) nodeEntries.push(c);
  }

  db.transaction(() => {
    // Replace the whole index deterministically: clear then re-insert.
    db.exec("DELETE FROM graph_edges; DELETE FROM graph_nodes;");
    upsertNodes(nodeEntries, db);
    upsertEdges(edgeEntries, db);
    deleteDanglingEdges(db);
    recomputeDegrees(db);
    deleteOrphanPositions(db);
    setMetaMany(
      {
        node_count: String(nodeEntries.length),
        edge_count: String(edgeEntries.length),
        built_at: new Date().toISOString(),
        layout_state: "stale",
        total_nodes: String(nodeEntries.length),
        nodes_placed: "0",
        tags_built: "0",
        last_error: "",
      },
      db,
    );
  })();

  // Semantic overlay tail (Phase 2): repaint the whole topic/entity overlay after the
  // vault rows are rebuilt. Flag-gated + lazily required so the semantic layer never loads
  // on the flag-off path or in the default bundle (mirrors tryLoadVec's optional require).
  if (graphSemanticOverlayEnabled()) {
    try {
      const { buildSemanticOverlay } = loadSemanticOverlay();
      buildSemanticOverlay({ db });
    } catch (err) {
      // Monitor-first: an absent/empty semantic.sqlite must never fail the vault build.
      console.warn("[graph] semantic overlay skipped:", err);
    }
  }

  return {
    nodeCount: nodeEntries.length,
    edgeCount: edgeEntries.length,
    fileCount: files.length,
    mtimes,
  };
}

/** Lazily resolve the semantic-overlay producer (flag-on only — keeps it off the default path). */
function loadSemanticOverlay(): typeof import("./semantic-overlay") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./semantic-overlay") as typeof import("./semantic-overlay");
}

// ---------------------------------------------------------------------------
// Incremental hot path
// ---------------------------------------------------------------------------

/** Top-level included dir for an absolute path, or null if outside the included set. */
function dirForPath(root: string, absPath: string): string | null {
  const rel = path.relative(root, absPath).split(path.sep).join("/");
  if (rel.startsWith("..")) return null;
  for (const dir of INCLUDED_DIRS) {
    if (rel === dir || rel.startsWith(`${dir}/`)) return dir;
  }
  return null;
}

/** Re-extract a single file and update its nodes/edges without a full rebuild. */
export function updateGraphForFile(absPath: string, opts: BuildOptions = {}): void {
  const root = opts.root ?? resolveVaultRoot();
  const db = opts.db ?? getGraphDb();
  const dir = dirForPath(root, absPath);
  if (!dir) return;
  if (absPath.split(path.sep).some((seg) => seg.startsWith(".") && seg.length > 1)) return;
  if (!fs.existsSync(absPath)) {
    removeGraphForFile(absPath, opts);
    return;
  }

  // Build a resolver map from the current vault scan (correctness over speed on the
  // single-file path — the full rescan is the perf-sensitive route).
  const files = scanVault(root);
  const map = buildResolverMap(root, files);
  const meetingFilenames = collectMeetingFilenames(root);
  const extracted = extractFile(absPath, dir, root, map, meetingFilenames);
  if (!extracted) return;

  db.transaction(() => {
    deleteEdgesBySourceFile(absPath, db);
    deleteNodesBySourceFile(absPath, db);
    upsertNodes([{ node: extracted.node, sourceFile: absPath }], db);
    upsertEdges(extracted.edges.map((edge) => ({ edge, sourceFile: absPath })), db);
    deleteDanglingEdges(db);
    recomputeDegrees(db);
    deleteOrphanPositions(db);
    markDirty(db, [extracted.node.id, ...neighborIds(db, extracted.node.id)]);
    setMetaMany({ layout_state: "stale" }, db);
  })();
}

/** Remove a deleted file's node + dangling edges; mark surviving neighbors dirty. */
export function removeGraphForFile(absPath: string, opts: BuildOptions = {}): void {
  const db = opts.db ?? getGraphDb();
  db.transaction(() => {
    const neighbors = neighborsBySourceFile(db, absPath);
    deleteEdgesBySourceFile(absPath, db);
    deleteNodesBySourceFile(absPath, db);
    deleteDanglingEdges(db);
    recomputeDegrees(db);
    deleteOrphanPositions(db);
    markDirty(db, neighbors);
    setMetaMany({ layout_state: "stale" }, db);
  })();
}

/**
 * Eventual candidate refresh (plan "Candidates — eventual, not file-watcher-
 * incremental"). Candidates live in a dotdir and churn via Library ingest; no file
 * watcher fires for them, so the runner polls this. Diffs the live
 * `listCandidates(root, "candidate")` set against the candidate nodes currently in
 * the index and applies only the delta: upsert new/changed candidates, remove (by
 * source_file) candidates that are no longer present-as-candidate (promoted,
 * expired, or deleted). Returns the changed candidate node ids for the relax seed
 * set + notify. Candidates carry NO connection edges by design (low-degree leaves),
 * so this never touches edges. Returns an empty list if nothing changed.
 */
export function refreshCandidates(opts: BuildOptions = {}): { changed: string[]; removed: string[] } {
  const root = opts.root ?? resolveVaultRoot();
  const db = opts.db ?? getGraphDb();

  const liveEntries = extractCandidates(root); // node + sourceFile per live candidate
  const liveById = new Map<string, { node: GraphNode; sourceFile: string | null }>();
  for (const entry of liveEntries) liveById.set(entry.node.id, entry);

  // Existing candidate nodes in the index (id → {sourceFile, label, attrs_json}).
  const existing = db
    .prepare("SELECT id, source_file AS sourceFile, label, attrs_json AS attrsJson FROM graph_nodes WHERE type = 'candidate'")
    .all() as Array<{ id: string; sourceFile: string | null; label: string; attrsJson: string | null }>;
  const existingById = new Map(existing.map((r) => [r.id, r]));

  const changed: string[] = [];
  const removed: string[] = [];

  for (const [id, entry] of liveById) {
    const prev = existingById.get(id);
    if (!prev) {
      changed.push(id);
      continue;
    }
    // Detect a material change (title or attrs) so a re-digest re-relaxes the node.
    const nextAttrs = JSON.stringify(entry.node.attrs ?? {});
    if (prev.label !== entry.node.label || (prev.attrsJson ?? "{}") !== nextAttrs) {
      changed.push(id);
    }
  }
  for (const r of existing) {
    if (!liveById.has(r.id)) removed.push(r.id);
  }

  if (changed.length === 0 && removed.length === 0) {
    return { changed: [], removed: [] };
  }

  db.transaction(() => {
    // Remove vanished candidates by their source_file (matches buildFullGraph's
    // sourceFile mapping; candidates have no edges so dangling cleanup is a no-op
    // for them, but we run it defensively after the upserts below).
    for (const id of removed) {
      const prev = existingById.get(id);
      if (prev?.sourceFile) deleteNodesBySourceFile(prev.sourceFile, db);
    }
    // Upsert new/changed candidates.
    const upserts = changed
      .map((id) => liveById.get(id))
      .filter((e): e is { node: GraphNode; sourceFile: string | null } => Boolean(e));
    upsertNodes(upserts, db);
    deleteDanglingEdges(db);
    recomputeDegrees(db);
    deleteOrphanPositions(db);
    markDirty(db, [...changed, ...removed]);
    if (changed.length > 0 || removed.length > 0) setMetaMany({ layout_state: "stale" }, db);
  })();

  return { changed, removed };
}

function neighborIds(db: Database.Database, nodeId: string): string[] {
  const rows = db
    .prepare(
      `SELECT source_id AS a, target_id AS b FROM graph_edges WHERE source_id = ? OR target_id = ?`,
    )
    .all(nodeId, nodeId) as Array<{ a: string; b: string }>;
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.a !== nodeId) ids.add(r.a);
    if (r.b !== nodeId) ids.add(r.b);
  }
  return [...ids];
}

function neighborsBySourceFile(db: Database.Database, sourceFile: string): string[] {
  const nodeRows = db
    .prepare("SELECT id FROM graph_nodes WHERE source_file = ?")
    .all(sourceFile) as Array<{ id: string }>;
  const ids = new Set<string>();
  for (const { id } of nodeRows) {
    for (const n of neighborIds(db, id)) ids.add(n);
  }
  return [...ids];
}

/** Flag node_positions rows dirty for the given node ids (1-hop dirty region). */
function markDirty(db: Database.Database, nodeIds: string[]): void {
  if (nodeIds.length === 0) return;
  const stmt = db.prepare("UPDATE node_positions SET dirty = 1, updated_at = ? WHERE id = ?");
  const now = Date.now();
  for (const id of nodeIds) stmt.run(now, id);
}

// ---------------------------------------------------------------------------
// Tag layer (ON DEMAND only — Decision 4)
// ---------------------------------------------------------------------------

export interface TagLayerOptions {
  root?: string;
  db?: Database.Database;
  /** Lower member bound (inclusive). Singletons are dropped. Default 2. */
  minMembers?: number;
  /** Upper member bound (inclusive). Mega-tags above this are skipped. Default 200. */
  maxMembers?: number;
}

/**
 * Build the tag layer on demand. Mints `tag:<normalizedTag>` nodes and undirected
 * `kind="tag"` edges (canonical (min,max) endpoint ordering) for every member node
 * carrying that tag in its `attrs.tags`. Bounded inclusion: only tags whose member
 * count falls in `[minMembers, maxMembers]` materialize (singletons dropped;
 * mega-tags skipped — they belong in a labeled cluster, not an edge-fanning hub).
 * Clears any prior tag rows first, then sets `tags_built=1`.
 */
export function buildTagLayer(opts: TagLayerOptions = {}): { tagNodeCount: number; tagEdgeCount: number } {
  const db = opts.db ?? getGraphDb();
  const minMembers = opts.minMembers ?? 2;
  const maxMembers = opts.maxMembers ?? 200;

  // Collect tag → member node ids from each node's stored attrs.tags.
  const rows = db
    .prepare("SELECT id, attrs_json FROM graph_nodes WHERE type != 'tag'")
    .all() as Array<{ id: string; attrs_json: string | null }>;
  const tagMembers = new Map<string, string[]>();
  for (const row of rows) {
    let tags: unknown;
    try {
      tags = row.attrs_json ? (JSON.parse(row.attrs_json) as Record<string, unknown>).tags : undefined;
    } catch {
      continue;
    }
    if (!Array.isArray(tags)) continue;
    for (const raw of tags) {
      const tag = normalizeTag(String(raw));
      if (!tag) continue;
      const list = tagMembers.get(tag) ?? [];
      list.push(row.id);
      tagMembers.set(tag, list);
    }
  }

  const nodeEntries: Array<{ node: GraphNode; sourceFile: string | null }> = [];
  const edgeEntries: Array<{ edge: GraphEdge; sourceFile: string | null }> = [];

  for (const [tag, members] of tagMembers) {
    const unique = [...new Set(members)];
    if (unique.length < minMembers || unique.length > maxMembers) continue;
    const tagId = tagNodeId(tag);
    nodeEntries.push({
      node: {
        id: tagId,
        type: "tag",
        label: `#${tag}`,
        refPath: null,
        degree: 0,
        colorKey: "tag",
        attrs: { tag, members: unique.length },
      },
      sourceFile: null,
    });
    for (const memberId of unique) {
      // Undirected: canonical (min,max) endpoint ordering for stable dedupe.
      const [a, b] = tagId < memberId ? [tagId, memberId] : [memberId, tagId];
      edgeEntries.push({
        edge: { id: edgeId(a, b, "tag"), source: a, target: b, kind: "tag", weight: 1, attrs: { tag } },
        sourceFile: null,
      });
    }
  }

  db.transaction(() => {
    db.exec("DELETE FROM graph_edges WHERE kind = 'tag'; DELETE FROM graph_nodes WHERE type = 'tag';");
    upsertNodes(nodeEntries, db);
    upsertEdges(edgeEntries, db);
    recomputeDegrees(db);
    setMetaMany({ tags_built: "1" }, db);
  })();

  return { tagNodeCount: nodeEntries.length, tagEdgeCount: edgeEntries.length };
}

/** Remove the tag layer rows and clear `tags_built` (cheap, non-invalidating). */
export function removeTagLayer(db = getGraphDb()): void {
  db.transaction(() => {
    db.exec("DELETE FROM graph_edges WHERE kind = 'tag'; DELETE FROM graph_nodes WHERE type = 'tag';");
    recomputeDegrees(db);
    setMetaMany({ tags_built: "0" }, db);
  })();
}
