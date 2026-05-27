import fs from "fs";
import path from "path";
import type { CandidateStatus, ReferenceCandidate, ProcessedArtifact, PromotionReason } from "./types";
import { addDays, atomicWriteFile, canonicalUrl, dateOnly, ensureDir, hashId, isoNow, slugify, walkMarkdown } from "./utils";
import { extractBullets, extractSection, parseMarkdownFile, relativeVaultPath, stringifyMarkdown } from "./markdown";

export const CANDIDATE_CACHE_DIR = path.join("references", ".cache", "library-candidates");

export function candidateCacheDir(vaultPath: string): string {
  return path.join(vaultPath, CANDIDATE_CACHE_DIR);
}

export function parseCandidateFile(vaultPath: string, filePath: string): ReferenceCandidate | null {
  const { data, body } = parseMarkdownFile(filePath);
  if (data.type !== "reference-candidate") return null;
  const title = String(data.title || path.basename(filePath, ".md"));
  const score = typeof data.score === "object" && data.score !== null ? data.score as Record<string, unknown> : {};
  const promotion = typeof data.promotion === "object" && data.promotion !== null ? data.promotion as Record<string, unknown> : {};
  const keyPoints = extractBullets(extractSection(body, "Key Points"));
  return {
    id: hashId(relativeVaultPath(vaultPath, filePath)),
    path: relativeVaultPath(vaultPath, filePath),
    title,
    url: String(data.url || ""),
    format: String(data.format || "article"),
    author: typeof data.author === "string" ? data.author : null,
    published: typeof data.published === "string" ? data.published : null,
    digested: String(data.digested || dateOnly()),
    channel: String(data.channel || "manual") as ReferenceCandidate["channel"],
    source_id: String(data.source_id || ""),
    source_name: String(data.source_name || ""),
    intent: String(data.intent || "discovery") as ReferenceCandidate["intent"],
    status: String(data.status || "candidate") as CandidateStatus,
    expires: String(data.expires || addDays(new Date(), 30)),
    score: {
      relevance: Number(score.relevance || 0),
      novelty: Number(score.novelty || 0),
      confidence: Number(score.confidence || 0),
      total: Number(score.total || 0),
    },
    save_recommendation: String(data.save_recommendation || "review") as ReferenceCandidate["save_recommendation"],
    proposed_destination: typeof data.proposed_destination === "string" ? data.proposed_destination : null,
    connected_projects: Array.isArray(data.connected_projects) ? data.connected_projects.map(String) : [],
    promotion: {
      promoted_to: typeof promotion.promoted_to === "string" ? promotion.promoted_to : null,
      promoted_at: typeof promotion.promoted_at === "string" ? promotion.promoted_at : null,
      promoted_reason: typeof promotion.promoted_reason === "string" ? promotion.promoted_reason as PromotionReason : null,
    },
    summary: extractSection(body, "Summary"),
    key_points: keyPoints,
    content: body.trim(),
    raw_frontmatter: data,
  };
}

export function listCandidates(vaultPath: string, status?: CandidateStatus): ReferenceCandidate[] {
  return walkMarkdown(candidateCacheDir(vaultPath), { includeHidden: true })
    .map((filePath) => parseCandidateFile(vaultPath, filePath))
    .filter((candidate): candidate is ReferenceCandidate => Boolean(candidate))
    .filter((candidate) => !status || candidate.status === status)
    .sort((a, b) => b.digested.localeCompare(a.digested));
}

export function findCandidateByUrl(vaultPath: string, url: string): ReferenceCandidate | null {
  const canonical = canonicalUrl(url);
  return listCandidates(vaultPath).find((candidate) => canonicalUrl(candidate.url) === canonical) || null;
}

function candidateFilePath(vaultPath: string, processed: ProcessedArtifact): string {
  const date = dateOnly(processed.raw.date || new Date());
  const id = hashId(`${processed.source.id}:${canonicalUrl(processed.raw.url)}`, 10);
  return path.join(candidateCacheDir(vaultPath), `${date}-${slugify(processed.raw.title)}-${id}.md`);
}

export function buildCandidateMarkdown(processed: ProcessedArtifact): string {
  const now = dateOnly();
  const frontmatter: Record<string, unknown> = {
    type: "reference-candidate",
    url: processed.raw.url,
    format: processed.format,
    title: processed.raw.title,
    author: processed.raw.author || undefined,
    published: processed.raw.date ? dateOnly(processed.raw.date) : undefined,
    digested: now,
    channel: processed.source.channel,
    source_id: processed.source.id,
    source_name: processed.source.name,
    intent: processed.source.intent,
    status: "candidate",
    expires: addDays(now, processed.source.retention.candidate_ttl_days),
    score: processed.score,
    save_recommendation: processed.assessment.save_recommendation,
    proposed_destination: processed.proposed_destination,
    connected_projects: processed.connected_projects,
    promotion: {
      promoted_to: null,
      promoted_at: null,
      promoted_reason: null,
    },
  };

  for (const key of Object.keys(frontmatter)) {
    if (frontmatter[key] === undefined) delete frontmatter[key];
  }

  const body = `# ${processed.raw.title}

## Summary

${processed.summary}

## Key Points

${processed.key_points.length ? processed.key_points.map((point) => `- ${point}`).join("\n") : "- "}

## Assessment

- Recommendation: ${processed.assessment.save_recommendation}
- Why: ${processed.assessment.why}
- What changed: ${processed.assessment.what_changed || ""}
- What is suspect: ${processed.assessment.what_is_suspect || ""}

## Suggested Connections

${processed.connected_projects.length ? processed.connected_projects.map((item) => `- [[${item}]]`).join("\n") : "- "}
`;

  return stringifyMarkdown(frontmatter, body);
}

export function writeCandidate(vaultPath: string, processed: ProcessedArtifact): string {
  const existing = findCandidateByUrl(vaultPath, processed.raw.url);
  if (existing) return path.join(vaultPath, existing.path);
  const filePath = candidateFilePath(vaultPath, processed);
  atomicWriteFile(filePath, buildCandidateMarkdown(processed));
  return filePath;
}

export function updateCandidate(vaultPath: string, candidate: ReferenceCandidate, updates: Record<string, unknown>): ReferenceCandidate {
  const filePath = path.join(vaultPath, candidate.path);
  const { data, body } = parseMarkdownFile(filePath);
  atomicWriteFile(filePath, stringifyMarkdown({ ...data, ...updates }, body));
  const updated = parseCandidateFile(vaultPath, filePath);
  if (!updated) throw new Error(`Failed to update candidate ${candidate.path}`);
  return updated;
}

export function expireCandidates(vaultPath: string, now = dateOnly()): ReferenceCandidate[] {
  const expired: ReferenceCandidate[] = [];
  for (const candidate of listCandidates(vaultPath, "candidate")) {
    if (candidate.expires < now) {
      expired.push(updateCandidate(vaultPath, candidate, { status: "expired", expired_at: isoNow() }));
    }
  }
  return expired;
}

export function ensureCandidateCache(vaultPath: string): void {
  ensureDir(candidateCacheDir(vaultPath));
}
