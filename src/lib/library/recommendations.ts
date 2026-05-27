import fs from "fs";
import path from "path";
import type { RecommendedArtifact } from "./types";
import { listLibraryArtifactDetails } from "./library";

function readTextIfExists(filePath: string): string {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  } catch {
    return "";
  }
}

function activeContext(vaultPath: string): string {
  const projectsDir = path.join(vaultPath, "projects");
  const projects = fs.existsSync(projectsDir)
    ? fs.readdirSync(projectsDir)
      .slice(0, 80)
      .map((name) => readTextIfExists(path.join(projectsDir, name, "index.md")))
      .join("\n")
    : "";
  const listsDir = path.join(vaultPath, "lists", "now");
  const latest = fs.existsSync(listsDir)
    ? fs.readdirSync(listsDir).filter((name) => name.endsWith(".md")).sort().pop()
    : null;
  const weekly = latest ? readTextIfExists(path.join(listsDir, latest)) : "";
  return `${projects}\n${weekly}`.toLowerCase();
}

function keywordOverlapScore(context: string, text: string): number {
  const words = Array.from(new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) || []));
  if (!words.length) return 0;
  const matches = words.filter((word) => context.includes(word)).length;
  return matches / Math.min(words.length, 80);
}

export function getRecommendations(vaultPath: string, limit = 10): { items: RecommendedArtifact[]; generated_at: string; context_summary: string } {
  const context = activeContext(vaultPath);
  const artifacts = listLibraryArtifactDetails(vaultPath, { limit: 200, includeCandidates: true }).artifacts;
  const items = artifacts
    .filter((artifact) => artifact.lifecycle_status !== "expired" && artifact.lifecycle_status !== "skipped")
    .map((artifact) => {
      const text = [artifact.title, artifact.summary, artifact.tags.join(" "), artifact.content].join("\n");
      const score = keywordOverlapScore(context, text) + (artifact.relevance_score || 0) + (artifact.lifecycle_status === "candidate" ? 0.1 : 0);
      const priority: RecommendedArtifact["priority"] = score >= 0.8 ? "must_read" : score >= 0.45 ? "recommended" : "interesting";
      const why = artifact.lifecycle_status === "candidate"
        ? `Discovery candidate with ${(artifact.relevance_score || 0).toFixed(2)} library score and overlap with current work.`
        : "Saved reference worth folding back into active context.";
      return { ...artifact, relevance_score: score, why, priority };
    })
    .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
    .slice(0, Math.max(1, Math.min(limit, Math.ceil(artifacts.length / 2) || limit)));

  return {
    items,
    generated_at: new Date().toISOString(),
    context_summary: "Ranked against active project notes and the current weekly list.",
  };
}

