import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { candidateCacheDir } from "../src/lib/library/candidate-cache";
import { extractBullets, extractConnections, extractHeading, extractSection, parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { addDays, atomicWriteFile, canonicalUrl, dateOnly, hashId, slugify, walkMarkdown } from "../src/lib/library/utils";

loadEnvConfig(process.cwd());

const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const args = process.argv.slice(2);
const write = args.includes("--write");

function candidatePathFor(data: Record<string, unknown>, body: string): string {
  const title = String(data.title || extractHeading(body, "Untitled YouTube video"));
  const date = dateOnly(String(data.published || data.captured || new Date().toISOString()));
  const url = String(data.url || "");
  const id = hashId(`youtube-liked-videos:${canonicalUrl(url)}`, 10);
  return path.join(candidateCacheDir(vaultPath), `${date}-${slugify(title)}-${id}.md`);
}

function convertedBody(data: Record<string, unknown>, body: string): string {
  const title = String(data.title || extractHeading(body, "Untitled YouTube video"));
  const summary = String(data.description || extractSection(body, "Summary") || "").trim() || "Review this YouTube liked video before deciding whether it belongs in the durable library.";
  const keyPoints = extractBullets(extractSection(body, "Key Points"));
  const connections = extractConnections(body);
  const rawContent = extractSection(body, "Raw Content");
  const sourceNotes = extractSection(body, "Source Notes");

  const keyPointText = keyPoints.length ? keyPoints.map((point) => `- ${point}`).join("\n") : "- ";
  const connectionText = connections.length ? connections.map((item) => `- ${item}`).join("\n") : "- ";
  const rawSection = rawContent ? `\n\n## Raw Content\n\n${rawContent}` : "";
  const notesSection = sourceNotes ? `\n\n## Source Notes\n\n${sourceNotes}` : "";

  return `# ${title}

## Summary

${summary}

## Key Points

${keyPointText}

## Assessment

- Recommendation: review
- Why: YouTube liked videos are candidate signals, not durable-save signals.
- What changed: Converted from a saved reference into candidate review state.
- What is suspect: Likes may include casual/funny videos that do not belong in the durable library.

## Suggested Connections

${connectionText}${rawSection}${notesSection}
`;
}

function convertedFrontmatter(data: Record<string, unknown>, body: string): Record<string, unknown> {
  const now = new Date().toISOString();
  const existingScore = typeof data.score === "object" && data.score !== null ? data.score : undefined;
  const connections = extractConnections(body)
    .map((item) => item.replace(/^\[\[|\]\]$/g, "").trim())
    .filter(Boolean);
  const converted: Record<string, unknown> = {
    ...data,
    type: "reference-candidate",
    title: data.title || extractHeading(body, "Untitled YouTube video"),
    digested: dateOnly(String(data.digested_at || data.captured || now)),
    channel: "youtube",
    source_id: "youtube-liked-videos",
    source_name: "YouTube liked videos",
    intent: "discovery",
    status: "candidate",
    expires: addDays(now, 30),
    score: existingScore || {
      relevance: 0.5,
      novelty: 0.5,
      confidence: 0.5,
      total: 0.5,
    },
    save_recommendation: "review",
    proposed_destination: typeof data.proposed_destination === "string" ? data.proposed_destination : "references/",
    connected_projects: Array.isArray(data.connected_projects) ? data.connected_projects : connections,
    promotion: {
      promoted_to: null,
      promoted_at: null,
      promoted_reason: null,
    },
    converted_from: "reference",
    converted_at: now,
    converted_reason: "youtube_likes_are_candidate_review_signals",
  };
  delete converted.captured;
  delete converted.relevance_signals;
  return Object.fromEntries(Object.entries(converted).filter(([, value]) => value !== undefined));
}

function isYoutubeLikedReference(filePath: string): boolean {
  if (filePath.includes(`${path.sep}.cache${path.sep}`)) return false;
  const { data } = parseMarkdownFile(filePath);
  return data.type === "reference" && data.source_id === "youtube-liked-videos";
}

async function main() {
  const referencesRoot = path.join(vaultPath, "references");
  const files = walkMarkdown(referencesRoot)
    .filter(isYoutubeLikedReference);
  const results = [];

  for (const filePath of files) {
    const { data, body } = parseMarkdownFile(filePath);
    const targetPath = candidatePathFor(data, body);
    const relSource = path.relative(vaultPath, filePath).split(path.sep).join("/");
    const relTarget = path.relative(vaultPath, targetPath).split(path.sep).join("/");
    const markdown = stringifyMarkdown(convertedFrontmatter(data, body), convertedBody(data, body));

    if (write) {
      atomicWriteFile(targetPath, markdown);
      fs.rmSync(filePath);
    }

    results.push({
      status: write ? "converted" : "dry_run",
      source_path: relSource,
      target_path: relTarget,
      title: String(data.title || extractHeading(body, path.basename(filePath, ".md"))),
      url: String(data.url || ""),
    });
  }

  console.log(JSON.stringify({ write, checked: files.length, converted: write ? results.length : 0, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
