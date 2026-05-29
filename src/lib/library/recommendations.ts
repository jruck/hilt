import fs from "fs";
import path from "path";
import type { ConnectionSuggestion, LibraryArtifactDetail, RecommendedArtifact } from "./types";
import { listLibraryArtifactDetails } from "./library";
import { markdownToPlain } from "./markdown";

interface ContextSignal {
  kind: "project" | "task" | "area" | "person" | "recent_save";
  label: string;
  text: string;
  weight: number;
}

const STOPWORDS = new Set([
  "about", "active", "after", "again", "also", "and", "because", "been", "before", "being", "between", "could", "from",
  "have", "into", "just", "like", "more", "most", "only", "over", "should", "some", "that", "their", "them",
  "there", "these", "this", "through", "with", "would", "your", "reference", "library", "candidate", "saved",
  "article", "author", "bookmark", "bookmarks", "cached", "captured", "channel", "connections", "content", "created",
  "description", "false", "format", "frontmatter", "https", "http", "media", "null", "points", "published", "raindrop",
  "raw", "source", "source-id", "source-name", "status", "summary", "tags", "title", "true", "type", "updated", "url",
  "meeting", "meetings", "next", "notes", "team", "work",
]);

const FOR_YOU_MAX_ITEMS = 8;

function readTextIfExists(filePath: string): string {
  try {
    return fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf-8").replace(/^---\s*[\s\S]*?\s*---\s*/m, "")
      : "";
  } catch {
    return "";
  }
}

function readFolderIndexSignals(vaultPath: string, folder: string, kind: ContextSignal["kind"], weight: number, limit: number): ContextSignal[] {
  const dir = path.join(vaultPath, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => {
      const text = entry.isDirectory()
        ? readTextIfExists(path.join(dir, entry.name, "index.md"))
        : entry.isFile() && entry.name.endsWith(".md")
          ? readTextIfExists(path.join(dir, entry.name))
          : "";
      return text ? { kind, label: entry.name.replace(/\.md$/, ""), text, weight } : null;
    })
    .filter((signal): signal is ContextSignal => Boolean(signal));
}

function currentTaskSignals(vaultPath: string): ContextSignal[] {
  const listsDir = path.join(vaultPath, "lists", "now");
  const latest = fs.existsSync(listsDir)
    ? fs.readdirSync(listsDir).filter((name) => name.endsWith(".md")).sort().pop()
    : null;
  const weekly = latest ? readTextIfExists(path.join(listsDir, latest)) : "";
  if (!weekly) return [];
  const uncheckedTasks = weekly
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+\[\s*]\s+/.test(line))
    .join("\n");
  return [{ kind: "task", label: latest || "current week", text: uncheckedTasks || weekly, weight: 1.35 }];
}

function recentSaveSignals(artifacts: LibraryArtifactDetail[]): ContextSignal[] {
  return artifacts
    .filter((artifact) => artifact.lifecycle_status === "saved")
    .slice(0, 20)
    .map((artifact) => ({
      kind: "recent_save" as const,
      label: artifact.title,
      text: [artifact.title, artifact.summary, artifact.tags.join(" ")].filter(Boolean).join("\n"),
      weight: artifact.source_id === "manual" ? 0.65 : 0.45,
    }));
}

function activeContextSignals(vaultPath: string, artifacts: LibraryArtifactDetail[]): ContextSignal[] {
  const areaText = readTextIfExists(path.join(vaultPath, "areas", "index.md"));
  return [
    ...readFolderIndexSignals(vaultPath, "projects", "project", 1.25, 80),
    ...currentTaskSignals(vaultPath),
    ...(areaText ? [{ kind: "area" as const, label: "North Stars", text: areaText, weight: 1.0 }] : []),
    ...readFolderIndexSignals(vaultPath, "people", "person", 0.35, 80),
    ...recentSaveSignals(artifacts),
  ];
}

function tokenize(text: string): string[] {
  return Array.from(new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) || [])
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word))));
}

function scoreAgainstSignals(artifact: LibraryArtifactDetail, signals: ContextSignal[]): { score: number; matches: Array<{ label: string; kind: ContextSignal["kind"]; terms: string[]; score: number }> } {
  const artifactText = markdownToPlain([artifact.title, artifact.summary, artifact.tags.join(" "), artifact.content].join("\n"));
  const artifactTokens = new Set(tokenize(artifactText));
  if (!artifactTokens.size) return { score: 0, matches: [] };

  const matches = signals.map((signal) => {
    const signalTokens = tokenize(signal.text);
    const terms = signalTokens.filter((token) => artifactTokens.has(token)).slice(0, 6);
    const minimumTerms = signal.kind === "project" || signal.kind === "task" ? 2 : 3;
    const score = terms.length >= minimumTerms
      ? Math.min(0.45, terms.length / Math.max(14, Math.min(signalTokens.length, 120))) * signal.weight
      : 0;
    return { label: signal.label, kind: signal.kind, terms, score };
  }).filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    score: Number(matches.reduce((sum, match) => sum + match.score, 0).toFixed(3)),
    matches,
  };
}

function connectionSuggestionsForArtifact(artifact: LibraryArtifactDetail): ConnectionSuggestion[] {
  return Array.isArray(artifact.raw_frontmatter.connection_suggestions)
    ? artifact.raw_frontmatter.connection_suggestions.filter((item): item is ConnectionSuggestion => Boolean(item && typeof item === "object" && typeof (item as ConnectionSuggestion).label === "string"))
    : [];
}

function recencyBonus(date: string): number {
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return 0;
  const ageDays = (Date.now() - time) / (24 * 60 * 60 * 1000);
  if (ageDays <= 7) return 0.12;
  if (ageDays <= 30) return 0.07;
  if (ageDays <= 90) return 0.03;
  return 0;
}

function whyForArtifact(artifact: LibraryArtifactDetail, matches: ReturnType<typeof scoreAgainstSignals>["matches"], score: number): string {
  const parts: string[] = [];
  const suggestions = connectionSuggestionsForArtifact(artifact);
  const topSuggestion = suggestions[0];
  if (topSuggestion) {
    parts.push(`Suggested tie-in to ${topSuggestion.label}: ${topSuggestion.reason}`);
  }
  const topContext = matches.find((match) => match.kind !== "recent_save");
  const recentSave = matches.find((match) => match.kind === "recent_save");
  if (topContext) {
    parts.push(`Matches ${topContext.kind.replace("_", " ")} context on ${topContext.terms.slice(0, 3).join(", ")}.`);
  }
  if (recentSave) {
    parts.push(`Echoes recent saves around ${recentSave.terms.slice(0, 3).join(", ")}.`);
  }
  if (artifact.lifecycle_status === "candidate") {
    parts.push(`Candidate review item with ${(artifact.relevance_score || 0).toFixed(2)} source score.`);
  } else {
    parts.push("Saved reference worth recapping into active context.");
  }
  if (!matches.length && score >= 0.45) {
    parts.unshift("High source score even without a strong current-context match.");
  }
  return parts.slice(0, 3).join(" ");
}

export function getRecommendations(vaultPath: string, limit = 10): { items: RecommendedArtifact[]; generated_at: string; context_summary: string } {
  const artifacts = listLibraryArtifactDetails(vaultPath, { limit: 200, includeCandidates: true }).artifacts;
  const signals = activeContextSignals(vaultPath, artifacts);
  const effectiveLimit = Math.max(1, Math.min(limit, FOR_YOU_MAX_ITEMS));
  const items = artifacts
    .filter((artifact) => artifact.lifecycle_status !== "expired" && artifact.lifecycle_status !== "skipped")
    .map((artifact) => {
      const contextScore = scoreAgainstSignals(artifact, signals);
      const suggestedConnectionScore = Math.min(0.3, connectionSuggestionsForArtifact(artifact).reduce((sum, suggestion) => sum + suggestion.score, 0) * 0.6);
      const sourceScore = Math.min(0.35, (artifact.relevance_score || 0) * 0.35);
      const candidateBonus = artifact.lifecycle_status === "candidate" ? 0.12 : 0;
      const savedRecapBonus = artifact.lifecycle_status === "saved" ? 0.06 : 0;
      const score = Number((contextScore.score + suggestedConnectionScore + sourceScore + candidateBonus + savedRecapBonus + recencyBonus(artifact.created_at)).toFixed(3));
      const priority: RecommendedArtifact["priority"] = score >= 0.7 ? "must_read" : score >= 0.38 ? "recommended" : "interesting";
      const matchedTerms = Array.from(new Set(contextScore.matches.flatMap((match) => match.terms))).slice(0, 8);
      return {
        ...artifact,
        relevance_score: score,
        why: whyForArtifact(artifact, contextScore.matches, score),
        priority,
        matched_terms: matchedTerms,
      };
    })
    .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
    .slice(0, effectiveLimit);

  return {
    items,
    generated_at: new Date().toISOString(),
    context_summary: "Ranked against active projects, current weekly tasks, North Stars, people notes, and recent saved references.",
  };
}
