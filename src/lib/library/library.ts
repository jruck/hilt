import fs from "fs";
import path from "path";
import type { CandidateStatus, LibraryArtifact, LibraryArtifactDetail, LibraryLifecycleStatus, LibrarySourceSummary, ReferenceCandidate } from "./types";
import { CANDIDATE_CACHE_DIR, candidateCacheDir, findCandidateById, listCandidates, parseCandidateFile } from "./candidate-cache";
import { findSavedReferenceById, listSavedReferences, MANUAL_SOURCE_ID, MANUAL_SOURCE_NAME, parseReferenceFile, referencesDir } from "./references";
import { applyLibraryReadState, isLibraryArtifactUnread, readLibraryReadState } from "./read-state";
import { loadSources, readSourceState } from "./source-config";
import { compareDatesDesc, dateTimestamp, ensureDir, hashId, walkMarkdown } from "./utils";
import { relativeVaultPath } from "./markdown";

export interface LibraryListOptions {
  source?: string | null;
  channel?: string | null;
  tag?: string | null;
  status?: LibraryLifecycleStatus | "all" | null;
  unread?: boolean;
  q?: string | null;
  after?: string | null;
  before?: string | null;
  offset?: number;
  limit?: number;
  includeCandidates?: boolean;
}

const candidateStatuses = new Set<LibraryLifecycleStatus>(["candidate", "skipped", "expired", "promoted"]);
const preciseRecencyFrontmatterKeys = [
  "captured_at",
  "saved_at",
  "digested_at",
  "created_at",
  "fetched_at",
] as const;

function preciseTimestamp(value: unknown): number {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    if (!Number.isFinite(timestamp)) return 0;
    const iso = value.toISOString();
    return /T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso) && !iso.endsWith("T00:00:00.000Z") ? timestamp : 0;
  }
  if (typeof value !== "string") return 0;
  const text = value.trim();
  if (!/[Tt]|\d{1,2}:\d{2}/.test(text)) return 0;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function artifactPreciseRecencyTimestamp(artifact: LibraryArtifactDetail): number {
  for (const key of preciseRecencyFrontmatterKeys) {
    const timestamp = preciseTimestamp(artifact.raw_frontmatter[key]);
    if (timestamp) return timestamp;
  }
  return dateTimestamp(artifact.updated_at) || dateTimestamp(artifact.created_at);
}

function compareArtifactsByRecent(a: LibraryArtifactDetail, b: LibraryArtifactDetail): number {
  const bySourceDate = compareDatesDesc(a.created_at, b.created_at);
  if (bySourceDate !== 0) return bySourceDate;

  const byPreciseRecency = artifactPreciseRecencyTimestamp(b) - artifactPreciseRecencyTimestamp(a);
  if (byPreciseRecency !== 0) return byPreciseRecency;

  return a.path.localeCompare(b.path);
}

function candidateToArtifact(vaultPath: string, candidate: ReferenceCandidate): LibraryArtifactDetail {
  const filePath = path.join(vaultPath, candidate.path);
  const updatedAt = fs.existsSync(filePath)
    ? fs.statSync(filePath).mtime.toISOString()
    : candidate.digested;
  return {
    id: candidate.id,
    path: candidate.path,
    title: candidate.title,
    summary: candidate.summary || null,
    source_type: "reference-candidate",
    channel: candidate.channel,
    source_id: candidate.source_id,
    source_name: candidate.source_name,
    tags: [],
    thumbnail: candidate.thumbnail,
    author: candidate.author,
    url: candidate.url,
    created_at: candidate.published || candidate.digested,
    updated_at: updatedAt,
    relevance_score: candidate.score.total,
    lifecycle_status: candidate.status,
    save_recommendation: candidate.save_recommendation,
    proposed_destination: candidate.proposed_destination,
    expires_at: candidate.expires,
    is_unread: false,
    read_at: null,
    content: candidate.content,
    key_points: candidate.key_points,
    connections: candidate.connected_projects,
    raw_frontmatter: candidate.raw_frontmatter,
  };
}

function matchesText(artifact: LibraryArtifactDetail, q: string): boolean {
  const haystack = [
    artifact.title,
    artifact.summary,
    artifact.url,
    artifact.source_name,
    artifact.tags.join(" "),
    artifact.content,
  ].join(" ").toLowerCase();
  return haystack.includes(q.toLowerCase());
}

function filterArtifacts(artifacts: LibraryArtifactDetail[], options: LibraryListOptions): LibraryArtifactDetail[] {
  const after = dateTimestamp(options.after);
  const before = dateTimestamp(options.before);
  return artifacts.filter((artifact) => {
    if (options.source && artifact.source_id !== options.source) return false;
    if (options.channel && artifact.channel !== options.channel) return false;
    if (options.tag && !artifact.tags.includes(options.tag)) return false;
    if (options.status && options.status !== "all" && artifact.lifecycle_status !== options.status) return false;
    if (options.unread && !artifact.is_unread) return false;
    if (after && dateTimestamp(artifact.created_at) < after) return false;
    if (before && dateTimestamp(artifact.created_at) > before) return false;
    if (options.q && !matchesText(artifact, options.q)) return false;
    return true;
  });
}

export function listLibraryArtifactDetails(vaultPath: string, options: LibraryListOptions = {}): { artifacts: LibraryArtifactDetail[]; total: number; unread_total: number } {
  const saved = listSavedReferences(vaultPath);
  const requestedCandidateStatus = options.status && options.status !== "all" && candidateStatuses.has(options.status)
    ? options.status as CandidateStatus
    : null;
  const candidates = options.includeCandidates === false
    || options.status === "saved"
    ? []
    : listCandidates(vaultPath, requestedCandidateStatus || undefined)
      .filter((candidate) => requestedCandidateStatus || candidate.status === "candidate")
      .map((candidate) => candidateToArtifact(vaultPath, candidate));
  const all = [...saved, ...candidates].sort(compareArtifactsByRecent);
  const state = readLibraryReadState(vaultPath);
  const readAware = applyLibraryReadState(all, state);
  const filtered = filterArtifacts(readAware, options);
  const offset = options.offset || 0;
  const limit = options.limit || 50;
  return {
    artifacts: filtered.slice(offset, offset + limit),
    total: filtered.length,
    unread_total: filtered.filter((artifact) => artifact.is_unread).length,
  };
}

export function hasUnreadLibraryArtifacts(vaultPath: string): boolean {
  const state = readLibraryReadState(vaultPath);

  for (const filePath of walkMarkdown(referencesDir(vaultPath))) {
    if (filePath.includes(`${path.sep}.cache${path.sep}`)) continue;
    const artifact = parseReferenceFile(vaultPath, filePath);
    if (artifact && isLibraryArtifactUnread(artifact, state)) return true;
  }

  for (const filePath of walkMarkdown(candidateCacheDir(vaultPath), { includeHidden: true })) {
    let candidate: ReferenceCandidate | null = null;
    try {
      candidate = parseCandidateFile(vaultPath, filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[library] skipping malformed candidate for unread check: ${filePath}: ${message}`);
      continue;
    }
    if (!candidate || candidate.status !== "candidate") continue;
    const artifact = candidateToArtifact(vaultPath, candidate);
    if (isLibraryArtifactUnread(artifact, state)) return true;
  }

  return false;
}

export function getLibraryArtifact(vaultPath: string, id: string): LibraryArtifactDetail | null {
  const saved = findSavedReferenceById(vaultPath, id);
  const artifact = saved || (() => {
    const candidate = findCandidateById(vaultPath, id);
    return candidate ? candidateToArtifact(vaultPath, candidate) : null;
  })();
  if (!artifact) return null;
  return applyLibraryReadState([artifact], readLibraryReadState(vaultPath))[0] || null;
}

function resolveArtifactPath(vaultPath: string, artifactPath: string): { relPath: string; filePath: string } | null {
  const relPath = artifactPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relPath.endsWith(".md")) return null;
  if (relPath.split("/").some((part) => part === "..")) return null;
  const vaultRoot = path.resolve(vaultPath);
  const filePath = path.resolve(vaultRoot, relPath);
  if (filePath !== vaultRoot && !filePath.startsWith(`${vaultRoot}${path.sep}`)) return null;
  if (!fs.existsSync(filePath)) return null;
  return { relPath, filePath };
}

export function getLibraryArtifactByPath(vaultPath: string, id: string, artifactPath: string): LibraryArtifactDetail | null {
  const resolved = resolveArtifactPath(vaultPath, artifactPath);
  if (!resolved) return null;
  if (hashId(resolved.relPath) !== id) return null;

  const candidatePrefix = `${CANDIDATE_CACHE_DIR.split(path.sep).join("/")}/`;
  const artifact = resolved.relPath.startsWith(candidatePrefix)
    ? (() => {
      const candidate = parseCandidateFile(vaultPath, resolved.filePath);
      return candidate ? candidateToArtifact(vaultPath, candidate) : null;
    })()
    : parseReferenceFile(vaultPath, resolved.filePath);
  if (!artifact) return null;
  return applyLibraryReadState([artifact], readLibraryReadState(vaultPath))[0] || null;
}

export function summarizeArtifact(artifact: LibraryArtifactDetail): LibraryArtifact {
  const { content: _content, key_points: _keyPoints, connections: _connections, raw_frontmatter: _frontmatter, ...summary } = artifact;
  return summary;
}

export function listLibrarySources(vaultPath: string, options: Omit<LibraryListOptions, "source" | "offset" | "limit" | "includeCandidates"> = {}): LibrarySourceSummary[] {
  const sources = loadSources(vaultPath);
  const state = readSourceState(vaultPath);
  const all = listLibraryArtifactDetails(vaultPath, {
    ...options,
    limit: 10000,
    includeCandidates: true,
  }).artifacts;
  const summaries = sources.map((source) => ({
    id: source.id,
    name: source.name,
    channel: source.channel,
    enabled: source.enabled,
    intent: source.intent,
    artifact_count: all.filter((artifact) => artifact.source_id === source.id && artifact.lifecycle_status === "saved").length,
    candidate_count: all.filter((artifact) => artifact.source_id === source.id && artifact.lifecycle_status === "candidate").length,
    unread_count: all.filter((artifact) => artifact.source_id === source.id && artifact.is_unread).length,
    saved_unread_count: all.filter((artifact) => artifact.source_id === source.id && artifact.lifecycle_status === "saved" && artifact.is_unread).length,
    candidate_unread_count: all.filter((artifact) => artifact.source_id === source.id && artifact.lifecycle_status === "candidate" && artifact.is_unread).length,
    last_fetched: state[source.id]?.last_success_at || null,
    blocked: state[source.id]?.blocked_reason || null,
  }));
  if (!summaries.some((source) => source.id === MANUAL_SOURCE_ID)) {
    const artifactCount = all.filter((artifact) => artifact.source_id === MANUAL_SOURCE_ID && artifact.lifecycle_status === "saved").length;
    const candidateCount = all.filter((artifact) => artifact.source_id === MANUAL_SOURCE_ID && artifact.lifecycle_status === "candidate").length;
    if (artifactCount || candidateCount) {
      summaries.unshift({
        id: MANUAL_SOURCE_ID,
        name: MANUAL_SOURCE_NAME,
        channel: "manual",
        enabled: true,
        intent: "explicit_save",
        artifact_count: artifactCount,
        candidate_count: candidateCount,
        unread_count: all.filter((artifact) => artifact.source_id === MANUAL_SOURCE_ID && artifact.is_unread).length,
        saved_unread_count: all.filter((artifact) => artifact.source_id === MANUAL_SOURCE_ID && artifact.lifecycle_status === "saved" && artifact.is_unread).length,
        candidate_unread_count: all.filter((artifact) => artifact.source_id === MANUAL_SOURCE_ID && artifact.lifecycle_status === "candidate" && artifact.is_unread).length,
        last_fetched: null,
        blocked: null,
      });
    }
  }
  return summaries;
}

export function contentHashForFile(filePath: string): string {
  return hashId(fs.readFileSync(filePath, "utf-8"), 20);
}

export function artifactFilePath(vaultPath: string, artifact: LibraryArtifact): string {
  return path.join(vaultPath, artifact.path);
}

function uniqueArchivePath(archiveDir: string, fileName: string): string {
  let target = path.join(archiveDir, fileName);
  const parsed = path.parse(fileName);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(archiveDir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return target;
}

export function archiveLibraryArtifact(vaultPath: string, id: string): { archived_to: string } {
  const artifact = getLibraryArtifact(vaultPath, id);
  if (!artifact) throw new Error("Artifact not found");
  if (artifact.lifecycle_status !== "saved") throw new Error("Only saved references can be archived");

  const filePath = artifactFilePath(vaultPath, artifact);
  if (!fs.existsSync(filePath)) throw new Error("Reference file not found");
  const archiveDir = path.join(path.dirname(filePath), ".archive");
  ensureDir(archiveDir);
  const targetPath = uniqueArchivePath(archiveDir, path.basename(filePath));
  fs.renameSync(filePath, targetPath);
  return { archived_to: relativeVaultPath(vaultPath, targetPath) };
}
