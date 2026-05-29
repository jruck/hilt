import fs from "fs";
import path from "path";
import type { ConnectionSuggestion } from "./types";
import { extractHeading, markdownToPlain } from "./markdown";

interface ContextSignal {
  kind: ConnectionSuggestion["kind"];
  label: string;
  target?: string;
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

function readTextIfExists(filePath: string): string {
  try {
    return fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf-8").replace(/^---\s*[\s\S]*?\s*---\s*/m, "")
      : "";
  } catch {
    return "";
  }
}

function titleForMarkdown(text: string, fallback: string): string {
  return extractHeading(text, fallback)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readFolderSignals(vaultPath: string, folder: string, kind: ContextSignal["kind"], weight: number, limit: number): ContextSignal[] {
  const dir = path.join(vaultPath, folder);
  if (!fs.existsSync(dir)) return [];
  const signals: ContextSignal[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)) {
    const target = entry.isDirectory() ? entry.name : entry.name.replace(/\.md$/, "");
    const text = entry.isDirectory()
      ? readTextIfExists(path.join(dir, entry.name, "index.md"))
      : entry.isFile() && entry.name.endsWith(".md")
        ? readTextIfExists(path.join(dir, entry.name))
        : "";
    if (!text) continue;
    signals.push({
      kind,
      label: titleForMarkdown(text, target),
      target,
      text,
      weight,
    });
  }
  return signals;
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
  return [{
    kind: "task",
    label: latest || "current tasks",
    text: uncheckedTasks || weekly,
    weight: 1.1,
  }];
}

function areaSignal(vaultPath: string): ContextSignal[] {
  const text = readTextIfExists(path.join(vaultPath, "areas", "index.md"));
  return text ? [{ kind: "area", label: "North Stars", target: "areas", text, weight: 0.85 }] : [];
}

function tokenize(text: string): string[] {
  return Array.from(new Set((markdownToPlain(text).toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) || [])
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word))));
}

function activeSignals(vaultPath: string): ContextSignal[] {
  return [
    ...readFolderSignals(vaultPath, "projects", "project", 1.3, 120),
    ...currentTaskSignals(vaultPath),
    ...areaSignal(vaultPath),
    ...readFolderSignals(vaultPath, "people", "person", 0.45, 120),
  ];
}

function reasonFor(signal: ContextSignal, terms: string[]): string {
  const visibleTerms = terms.slice(0, 3).join(", ");
  if (signal.kind === "project") return `Shares active project language around ${visibleTerms}.`;
  if (signal.kind === "task") return `Relates to current task context around ${visibleTerms}.`;
  if (signal.kind === "person") return `May be useful for people context around ${visibleTerms}.`;
  return `Matches operating context around ${visibleTerms}.`;
}

export function suggestArtifactConnections(
  vaultPath: string | null | undefined,
  artifactText: string,
  limit = 5,
): ConnectionSuggestion[] {
  if (!vaultPath || !fs.existsSync(vaultPath)) return [];
  const artifactTokens = new Set(tokenize(artifactText));
  if (!artifactTokens.size) return [];

  const suggestions: ConnectionSuggestion[] = [];
  for (const signal of activeSignals(vaultPath)) {
    const signalTokens = tokenize(signal.text);
    const terms = signalTokens.filter((token) => artifactTokens.has(token)).slice(0, 8);
    const minimumTerms = signal.kind === "task" ? 2 : 3;
    const score = terms.length >= minimumTerms
      ? Math.min(1, (terms.length / Math.max(8, Math.min(signalTokens.length, 120))) * signal.weight)
      : 0;
    if (!score) continue;
    const suggestion: ConnectionSuggestion = {
      kind: signal.kind,
      label: signal.label,
      reason: reasonFor(signal, terms),
      terms,
      score: Number(score.toFixed(3)),
    };
    if (signal.target) suggestion.target = signal.target;
    suggestions.push(suggestion);
  }
  return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
}
