import fs from "fs";
import path from "path";
import type { LibraryArtifact, LibraryArtifactDetail, LibraryLifecycleStatus, LibrarySourceSummary, ReferenceCandidate } from "./types";
import { listCandidates } from "./candidate-cache";
import { listSavedReferences, MANUAL_SOURCE_ID, MANUAL_SOURCE_NAME } from "./references";
import { applyLibraryReadState, readLibraryReadState } from "./read-state";
import { loadSources, readSourceState } from "./source-config";
import { compareDatesDesc, dateTimestamp, ensureDir, hashId } from "./utils";
import { relativeVaultPath } from "./markdown";

export interface LibraryListOptions {
  source?: string | null;
  channel?: string | null;
  tag?: string | null;
  status?: LibraryLifecycleStatus | "all" | null;
  q?: string | null;
  after?: string | null;
  before?: string | null;
  offset?: number;
  limit?: number;
  includeCandidates?: boolean;
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
    if (after && dateTimestamp(artifact.created_at) < after) return false;
    if (before && dateTimestamp(artifact.created_at) > before) return false;
    if (options.q && !matchesText(artifact, options.q)) return false;
    return true;
  });
}

export function listLibraryArtifactDetails(vaultPath: string, options: LibraryListOptions = {}): { artifacts: LibraryArtifactDetail[]; total: number; unread_total: number } {
  const saved = listSavedReferences(vaultPath);
  const candidates = options.includeCandidates === false
    ? []
    : listCandidates(vaultPath).map((candidate) => candidateToArtifact(vaultPath, candidate));
  const all = [...saved, ...candidates].sort((a, b) => compareDatesDesc(a.created_at, b.created_at));
  const state = readLibraryReadState(vaultPath);
  const filtered = applyLibraryReadState(filterArtifacts(all, options), state);
  const offset = options.offset || 0;
  const limit = options.limit || 50;
  return {
    artifacts: filtered.slice(offset, offset + limit),
    total: filtered.length,
    unread_total: filtered.filter((artifact) => artifact.is_unread).length,
  };
}

export function getLibraryArtifact(vaultPath: string, id: string): LibraryArtifactDetail | null {
  const all = listLibraryArtifactDetails(vaultPath, { limit: 10000, includeCandidates: true }).artifacts;
  return all.find((artifact) => artifact.id === id) || null;
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
