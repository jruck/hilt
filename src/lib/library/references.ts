import fs from "fs";
import path from "path";
import type { LibraryArtifact, LibraryArtifactDetail, ProcessedArtifact, PromotionReason } from "./types";
import { atomicWriteFile, canonicalUrl, dateOnly, ensureDir, hashId, slugify, toArray, walkMarkdown } from "./utils";
import { extractBullets, extractConnections, extractHeading, extractSection, frontmatterTags, parseMarkdownFile, relativeVaultPath, stringifyMarkdown } from "./markdown";

const REFERENCES_DIR = "references";

export function referencesDir(vaultPath: string): string {
  return path.join(vaultPath, REFERENCES_DIR);
}

export function parseReferenceFile(vaultPath: string, filePath: string): LibraryArtifactDetail | null {
  let parsed: ReturnType<typeof parseMarkdownFile>;
  try {
    parsed = parseMarkdownFile(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[library] skipping malformed reference frontmatter: ${filePath}: ${message}`);
    return null;
  }
  const { data, body } = parsed;
  if (data.type !== "reference") return null;
  const stat = fs.statSync(filePath);
  const relPath = relativeVaultPath(vaultPath, filePath);
  const fallbackTitle = path.basename(filePath, ".md");
  const title = String(data.title || extractHeading(body, fallbackTitle));
  const summary = String(data.description || extractSection(body, "Summary") || "").trim() || null;
  const url = typeof data.url === "string"
    ? data.url
    : typeof data.source === "string" && /^https?:\/\//.test(data.source)
      ? data.source
      : null;
  const channel = typeof data.channel === "string" ? data.channel : null;
  const sourceId = typeof data.source_id === "string" ? data.source_id : null;
  const created = String(data.captured || data.published || dateOnly(stat.birthtime));
  const updated = stat.mtime.toISOString();
  const keyPoints = extractBullets(extractSection(body, "Key Points"));

  return {
    id: hashId(relPath),
    path: relPath,
    title,
    summary,
    source_type: "reference",
    channel: channel as LibraryArtifactDetail["channel"],
    source_id: sourceId,
    source_name: typeof data.source_name === "string" ? data.source_name : null,
    tags: frontmatterTags(data),
    thumbnail: typeof data.thumbnail === "string" ? data.thumbnail : null,
    author: typeof data.author === "string" ? data.author : null,
    url,
    created_at: created,
    updated_at: updated,
    lifecycle_status: "saved",
    content: body.trim(),
    key_points: keyPoints,
    connections: extractConnections(body),
    raw_frontmatter: data,
  };
}

export function listSavedReferences(vaultPath: string): LibraryArtifactDetail[] {
  return walkMarkdown(referencesDir(vaultPath))
    .filter((filePath) => !filePath.includes(`${path.sep}.cache${path.sep}`))
    .map((filePath) => parseReferenceFile(vaultPath, filePath))
    .filter((artifact): artifact is LibraryArtifactDetail => Boolean(artifact))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function findSavedReferenceByUrl(vaultPath: string, url: string): LibraryArtifact | null {
  const canonical = canonicalUrl(url);
  return listSavedReferences(vaultPath).find((artifact) => artifact.url && canonicalUrl(artifact.url) === canonical) || null;
}

function destinationDir(vaultPath: string, proposedDestination: string | null | undefined): string {
  const normalized = proposedDestination?.replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized && (normalized === "references" || normalized.startsWith("references/"))) {
    return path.join(vaultPath, normalized);
  }
  return referencesDir(vaultPath);
}

function uniqueReferencePath(dir: string, title: string, date: string): string {
  ensureDir(dir);
  const base = `${date}-${slugify(title)}`;
  let candidate = path.join(dir, `${base}.md`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${index}.md`);
    index += 1;
  }
  return candidate;
}

export function buildDurableReferenceMarkdown(processed: ProcessedArtifact, reason?: PromotionReason): string {
  const { raw, source } = processed;
  const captured = dateOnly();
  const frontmatter: Record<string, unknown> = {
    type: "reference",
    description: processed.summary.slice(0, 180),
    url: raw.url,
    format: processed.format,
    author: raw.author || undefined,
    published: raw.date ? dateOnly(raw.date) : undefined,
    captured,
    channel: source.channel,
    source_id: source.id,
    source_name: source.name,
    thumbnail: raw.thumbnail || undefined,
    tags: processed.tags,
    relevance_signals: source.intent === "explicit_save" ? [{
      type: source.signal || "explicit_save",
      channel: source.channel,
      at: captured,
    }] : reason ? [{
      type: reason,
      channel: source.channel,
      at: captured,
    }] : undefined,
  };

  for (const key of Object.keys(frontmatter)) {
    if (frontmatter[key] === undefined) delete frontmatter[key];
  }

  const keyPoints = processed.key_points.length
    ? processed.key_points.map((point) => `- ${point}`).join("\n")
    : "- ";
  const connections = processed.connected_projects.length
    ? processed.connected_projects.map((item) => `- [[${item}]]`).join("\n")
    : "- ";
  const rawContent = raw.content?.trim() || "";
  const notes = processed.extraction_notes.length
    ? `\n\n## Source Notes\n\n${processed.extraction_notes.map((note) => `- ${note}`).join("\n")}`
    : "";

  const body = `# ${raw.title}

## Summary

${processed.summary}

## Key Points

${keyPoints}

## Connections

${connections}

## Raw Content

<details>
<summary>Full text (click to expand)</summary>

${rawContent}

</details>${notes}
`;

  return stringifyMarkdown(frontmatter, body);
}

export function writeDurableReference(vaultPath: string, processed: ProcessedArtifact, reason?: PromotionReason): string {
  const duplicate = findSavedReferenceByUrl(vaultPath, processed.raw.url);
  if (duplicate) return path.join(vaultPath, duplicate.path);
  const dir = destinationDir(vaultPath, processed.proposed_destination);
  const filePath = uniqueReferencePath(dir, processed.raw.title, dateOnly(processed.raw.date || new Date()));
  atomicWriteFile(filePath, buildDurableReferenceMarkdown(processed, reason));
  return filePath;
}

export function artifactSummary(artifact: LibraryArtifactDetail): LibraryArtifact {
  const { content: _content, key_points: _keyPoints, connections: _connections, raw_frontmatter: _frontmatter, ...summary } = artifact;
  return summary;
}
