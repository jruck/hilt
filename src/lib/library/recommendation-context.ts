import fs from "node:fs";
import path from "node:path";
import { extractHeading, markdownToPlain } from "./markdown";
import type { LibraryArtifactDetail, RecommendationTrigger } from "./types";
import { hashId, walkMarkdown } from "./utils";

export interface RecommendationContextEvidence extends RecommendationTrigger {
  text: string;
}

function cleanText(raw: string, max = 900): string {
  return markdownToPlain(raw)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function evidenceFromFile(
  vaultPath: string,
  filePath: string,
  kind: Exclude<RecommendationTrigger["kind"], "artifact" | "legacy">,
): RecommendationContextEvidence | null {
  try {
    const stat = fs.statSync(filePath);
    const raw = fs.readFileSync(filePath, "utf-8");
    const relative = path.relative(vaultPath, filePath).split(path.sep).join("/");
    const text = cleanText(raw);
    if (!text) return null;
    const label = extractHeading(raw, path.basename(filePath, ".md"));
    return {
      id: `${kind}:${relative}`,
      kind,
      label,
      occurred_at: stat.mtime.toISOString(),
      fingerprint: hashId(`${kind}:${relative}:${text}`, 20),
      text,
    };
  } catch {
    return null;
  }
}

function recentFiles(root: string, cutoff: number, limit: number): string[] {
  return walkMarkdown(root, { includeHidden: false })
    .map((filePath) => {
      try {
        return { filePath, mtime: fs.statSync(filePath).mtimeMs };
      } catch {
        return { filePath, mtime: 0 };
      }
    })
    .filter((entry) => entry.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((entry) => entry.filePath);
}

export function buildRecommendationContext(
  vaultPath: string,
  artifacts: LibraryArtifactDetail[],
  options: { now?: Date; contextHours?: number; newDays?: number } = {},
): RecommendationContextEvidence[] {
  const now = options.now || new Date();
  const contextHours = options.contextHours || 72;
  const newDays = options.newDays || 7;
  const contextCutoff = now.getTime() - contextHours * 3_600_000;
  const newCutoff = now.getTime() - newDays * 86_400_000;
  const evidence: RecommendationContextEvidence[] = [];

  for (const filePath of recentFiles(path.join(vaultPath, "meetings"), contextCutoff, 24)) {
    const item = evidenceFromFile(vaultPath, filePath, "meeting");
    if (item && !filePath.includes(`${path.sep}transcripts${path.sep}`)) evidence.push(item);
  }
  for (const filePath of recentFiles(path.join(vaultPath, "tasks"), contextCutoff, 30)) {
    const item = evidenceFromFile(vaultPath, filePath, "task");
    if (item) evidence.push(item);
  }
  for (const folder of ["projects", "areas"] as const) {
    for (const filePath of recentFiles(path.join(vaultPath, folder), contextCutoff, 20)) {
      const item = evidenceFromFile(vaultPath, filePath, folder === "projects" ? "project" : "area");
      if (item) evidence.push(item);
    }
  }
  for (const filePath of recentFiles(path.join(vaultPath, "briefings"), contextCutoff, 4)) {
    const item = evidenceFromFile(vaultPath, filePath, "briefing");
    if (item) evidence.push(item);
  }

  for (const artifact of artifacts) {
    const created = Date.parse(artifact.created_at);
    if (!Number.isFinite(created) || created < newCutoff) continue;
    const text = cleanText([artifact.title, artifact.summary, artifact.content].filter(Boolean).join("\n"), 650);
    evidence.push({
      id: `artifact:${artifact.id}`,
      kind: "artifact",
      label: artifact.title,
      occurred_at: artifact.created_at,
      fingerprint: hashId(`artifact:${artifact.id}:${text}`, 20),
      text,
    });
  }

  return evidence
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

export function recommendationContextPrompt(evidence: RecommendationContextEvidence[]): string {
  return evidence.map((item) => [
    `TRIGGER ${item.id}`,
    `Kind: ${item.kind}`,
    `When: ${item.occurred_at}`,
    `Label: ${item.label}`,
    `Evidence: ${item.text}`,
  ].join("\n")).join("\n\n");
}
