import fs from "fs";
import path from "path";
import type { ConnectionSuggestion } from "./types";
import { extractHeading } from "./markdown";

/**
 * Vault folder-reading helpers, moved out of the old token-overlap scorer. They assemble
 * the raw signal used to build a compact index of Justin's active work for the LLM judge.
 */
export interface ContextSignal {
  kind: NonNullable<ConnectionSuggestion["kind"]>;
  label: string;
  target?: string;
  text: string;
  weight: number;
}

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

export function readFolderSignals(
  vaultPath: string,
  folder: string,
  kind: ContextSignal["kind"],
  weight: number,
  limit: number,
): ContextSignal[] {
  const dir = path.join(vaultPath, folder);
  if (!fs.existsSync(dir)) return [];
  const signals: ContextSignal[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)) {
    if (entry.name === "index.md") continue;
    const target = entry.isDirectory() ? entry.name : entry.name.replace(/\.md$/, "");
    const text = entry.isDirectory()
      ? readTextIfExists(path.join(dir, entry.name, "index.md"))
      : entry.isFile() && entry.name.endsWith(".md")
        ? readTextIfExists(path.join(dir, entry.name))
        : "";
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

export function currentTaskSignals(vaultPath: string): ContextSignal[] {
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

export function northStarSignal(vaultPath: string): ContextSignal[] {
  const text = readTextIfExists(path.join(vaultPath, "areas", "index.md"));
  return text ? [{ kind: "area", label: "North Stars", target: "areas", text, weight: 0.85 }] : [];
}

function firstMeaningfulLine(text: string): string {
  // Operate on raw lines so a heading line stays distinct from its description
  // (markdownToPlain flattens headings + body into a single line).
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    // Skip the title heading and section sub-headings; we want a description, not the name again.
    if (/^#/.test(trimmed)) continue;
    const line = cleanInline(trimmed.replace(/^\s*(?:[-*]|\d+\.)\s+/, "")).trim();
    if (line) return line;
  }
  return "";
}

function oneLine(text: string, limit = 160): string {
  const line = firstMeaningfulLine(text);
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
}

function cleanInline(line: string): string {
  return line
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g, (_m, slug, label) => label || slug)
    .replace(/\s+/g, " ")
    .trim();
}

function northStarLines(vaultPath: string): string {
  const text = northStarSignal(vaultPath)[0]?.text || "";
  if (!text) return "";
  // Operate on raw markdown lines so bullet structure survives (markdownToPlain flattens it).
  const lines = text
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*]|\d+\.)\s+/.test(line))
    .map((line) => cleanInline(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "")))
    .filter(Boolean)
    .slice(0, 12);
  return lines.map((line) => `- ${line}`).join("\n");
}

function projectLines(vaultPath: string): string {
  return readFolderSignals(vaultPath, "projects", "project", 1.3, 120)
    .map((signal) => {
      const summary = oneLine(signal.text, 140);
      return summary ? `- ${signal.label} (${signal.target}) — ${summary}` : `- ${signal.label} (${signal.target})`;
    })
    .join("\n");
}

function libraryProjectLines(vaultPath: string, limit = 120): string {
  const librariesDir = path.join(vaultPath, "libraries");
  if (!fs.existsSync(librariesDir)) return "";
  const lines: string[] = [];
  for (const libraryEntry of fs.readdirSync(librariesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const projectsDir = path.join(librariesDir, libraryEntry.name, "projects");
    if (!fs.existsSync(projectsDir)) continue;
    for (const projectEntry of fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (lines.length >= limit) break;
      const filePath = projectEntry.isDirectory()
        ? path.join(projectsDir, projectEntry.name, "index.md")
        : projectEntry.isFile() && projectEntry.name.endsWith(".md")
          ? path.join(projectsDir, projectEntry.name)
          : "";
      if (!filePath) continue;
      const text = readTextIfExists(filePath);
      if (!text) continue;
      const targetName = projectEntry.isDirectory() ? projectEntry.name : projectEntry.name.replace(/\.md$/, "");
      const target = ["libraries", libraryEntry.name, "projects", targetName].join("/");
      const label = titleForMarkdown(text, targetName);
      const summary = oneLine(text, 140);
      lines.push(summary
        ? `- ${label} (${target}) — ${summary}`
        : `- ${label} (${target})`);
    }
    if (lines.length >= limit) break;
  }
  return lines.join("\n");
}

function areaLines(vaultPath: string): string {
  return readFolderSignals(vaultPath, "areas", "area", 0.85, 60)
    .map((signal) => {
      const summary = oneLine(signal.text, 140);
      return summary ? `- ${signal.label} (${signal.target}) — ${summary}` : `- ${signal.label} (${signal.target})`;
    })
    .join("\n");
}

function peopleLines(vaultPath: string): string {
  return readFolderSignals(vaultPath, "people", "person", 0.45, 120)
    .filter((signal) => signal.label)
    .map((signal) => {
      const role = oneLine(signal.text, 120);
      return role ? `- ${signal.label} (${signal.target}) — ${role}` : `- ${signal.label} (${signal.target})`;
    })
    .join("\n");
}

function recentReferenceTitles(vaultPath: string, limit = 20): string {
  const dir = path.join(vaultPath, "references");
  if (!fs.existsSync(dir)) return "";
  let files: { name: string; mtime: number }[];
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
      .map((entry) => {
        let mtime = 0;
        try {
          mtime = fs.statSync(path.join(dir, entry.name)).mtimeMs;
        } catch {
          mtime = 0;
        }
        return { name: entry.name, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
  } catch {
    return "";
  }
  const titles: string[] = [];
  for (const file of files) {
    const text = readTextIfExists(path.join(dir, file.name));
    const title = titleForMarkdown(text, file.name.replace(/\.md$/, ""));
    if (title) titles.push(`- ${title}`);
  }
  return titles.join("\n");
}

const CACHE_RELATIVE_PATH = path.join("references", ".cache", "kb-index.md");

export interface BuildKbIndexOptions {
  /** When true, never write the cache file (dry-run safe). */
  noWrite?: boolean;
  /** Cap the number of recent reference titles skimmed into the index. */
  recentReferenceLimit?: number;
}

/**
 * Assemble a compact (~1-2K token) index of Justin's active work for the LLM connection judge:
 * NORTH STARS, PROJECTS, AREAS, PEOPLE, and a skim of recent reference titles. Optionally caches
 * to references/.cache/kb-index.md, but always returns the string. With { noWrite: true } the
 * vault is never touched on disk.
 */
export function buildKbIndex(vaultPath: string, options: BuildKbIndexOptions = {}): string {
  if (!vaultPath || !fs.existsSync(vaultPath)) return "";

  const sections: string[] = [];
  const northStars = northStarLines(vaultPath);
  const projects = projectLines(vaultPath);
  const libraryProjects = libraryProjectLines(vaultPath);
  const areas = areaLines(vaultPath);
  const people = peopleLines(vaultPath);
  const references = recentReferenceTitles(vaultPath, options.recentReferenceLimit ?? 20);

  if (northStars) sections.push(`## NORTH STARS\n${northStars}`);
  if (projects) sections.push(`## PROJECTS\n${projects}`);
  if (libraryProjects) sections.push(`## LIBRARY PROJECTS\n${libraryProjects}`);
  if (areas) sections.push(`## AREAS\n${areas}`);
  if (people) sections.push(`## PEOPLE\n${people}`);
  if (references) sections.push(`## RECENT REFERENCES (titles)\n${references}`);

  const index = sections.join("\n\n").trim();

  if (index && !options.noWrite) {
    try {
      const cachePath = path.join(vaultPath, CACHE_RELATIVE_PATH);
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, `${index}\n`, "utf-8");
    } catch {
      // Caching is best-effort; never fail index assembly because the cache could not be written.
    }
  }

  return index;
}
