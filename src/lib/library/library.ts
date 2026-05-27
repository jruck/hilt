import fs from "fs";
import path from "path";
import type { LibraryArtifact, LibraryArtifactDetail, LibraryLifecycleStatus, LibrarySourceSummary, ReferenceCandidate } from "./types";
import { listCandidates } from "./candidate-cache";
import { listSavedReferences } from "./references";
import { loadSources, readSourceState } from "./source-config";
import { hashId } from "./utils";

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

function candidateToArtifact(candidate: ReferenceCandidate): LibraryArtifactDetail {
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
    thumbnail: null,
    author: candidate.author,
    url: candidate.url,
    created_at: candidate.digested,
    updated_at: candidate.digested,
    relevance_score: candidate.score.total,
    lifecycle_status: candidate.status,
    save_recommendation: candidate.save_recommendation,
    proposed_destination: candidate.proposed_destination,
    expires_at: candidate.expires,
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
  return artifacts.filter((artifact) => {
    if (options.source && artifact.source_id !== options.source) return false;
    if (options.channel && artifact.channel !== options.channel) return false;
    if (options.tag && !artifact.tags.includes(options.tag)) return false;
    if (options.status && options.status !== "all" && artifact.lifecycle_status !== options.status) return false;
    if (options.after && artifact.created_at < options.after) return false;
    if (options.before && artifact.created_at > options.before) return false;
    if (options.q && !matchesText(artifact, options.q)) return false;
    return true;
  });
}

export function listLibraryArtifactDetails(vaultPath: string, options: LibraryListOptions = {}): { artifacts: LibraryArtifactDetail[]; total: number } {
  const saved = listSavedReferences(vaultPath);
  const candidates = options.includeCandidates === false
    ? []
    : listCandidates(vaultPath).map(candidateToArtifact);
  const all = [...saved, ...candidates].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const filtered = filterArtifacts(all, options);
  const offset = options.offset || 0;
  const limit = options.limit || 50;
  return {
    artifacts: filtered.slice(offset, offset + limit),
    total: filtered.length,
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

export function listLibrarySources(vaultPath: string): LibrarySourceSummary[] {
  const sources = loadSources(vaultPath);
  const state = readSourceState(vaultPath);
  const all = listLibraryArtifactDetails(vaultPath, { limit: 10000, includeCandidates: true }).artifacts;
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    channel: source.channel,
    enabled: source.enabled,
    intent: source.intent,
    artifact_count: all.filter((artifact) => artifact.source_id === source.id && artifact.lifecycle_status === "saved").length,
    candidate_count: all.filter((artifact) => artifact.source_id === source.id && artifact.lifecycle_status === "candidate").length,
    last_fetched: state[source.id]?.last_success_at || null,
    blocked: state[source.id]?.blocked_reason || null,
  }));
}

export function contentHashForFile(filePath: string): string {
  return hashId(fs.readFileSync(filePath, "utf-8"), 20);
}

export function artifactFilePath(vaultPath: string, artifact: LibraryArtifact): string {
  return path.join(vaultPath, artifact.path);
}

