import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { toArray } from "./utils";

export interface ParsedMarkdown {
  data: Record<string, unknown>;
  body: string;
  raw: string;
}

export function parseMarkdownFile(filePath: string): ParsedMarkdown {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = matter(raw);
  return { data: parsed.data as Record<string, unknown>, body: parsed.content, raw };
}

export function stringifyMarkdown(data: Record<string, unknown>, body: string): string {
  return matter.stringify(body.trimEnd() + "\n", data).trimEnd() + "\n";
}

export function extractHeading(body: string, fallback: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || fallback;
}

export function extractSection(body: string, sectionName: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${sectionName}`.toLowerCase());
  if (start === -1) return "";
  const collected: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    collected.push(lines[i]);
  }
  return collected.join("\n").trim();
}

export function extractBullets(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

export function extractConnections(body: string): string[] {
  const section = extractSection(body, "Connections") || extractSection(body, "Suggested Connections");
  return extractBullets(section);
}

export function markdownToPlain(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g, (_m, slug, label) => label || slug)
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function frontmatterTags(data: Record<string, unknown>): string[] {
  return Array.from(new Set(toArray(data.tags).map((tag) => tag.trim()).filter(Boolean)));
}

export function relativeVaultPath(vaultPath: string, filePath: string): string {
  return path.relative(vaultPath, filePath).split(path.sep).join("/");
}
