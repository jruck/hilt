import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { digestArtifact } from "../src/lib/library/digestion";
import { extractBullets, extractSection, parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { buildMediaMarkdown, cachedSourceContent, getYouTubeVideoId, stripDetailsWrapper } from "../src/lib/library/media";
import { loadSources } from "../src/lib/library/source-config";
import { dateOnly } from "../src/lib/library/utils";
import type { LibrarySourceConfig, ProcessedArtifact, RawArtifact } from "../src/lib/library/types";

loadEnvConfig(process.cwd());

const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const args = process.argv.slice(2);
const write = args.includes("--write");
const writeHotOnly = args.includes("--write-hot-only");

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

const summarizeTimeout = argValue("--summarize-timeout");
if (summarizeTimeout) process.env.LIBRARY_SUMMARIZE_TIMEOUT = summarizeTimeout;

function stripDetails(text: string): string {
  return text
    .replace(/<\/?details>/g, "")
    .replace(/<summary>[\s\S]*?<\/summary>/g, "")
    .trim();
}

function existingRawContent(body: string): string {
  const raw = stripDetails(extractSection(body, "Raw Content"));
  if (/^#\s+.+$/m.test(raw) && raw.includes("## Summary") && raw.includes("## Key Points")) return "";
  if (/^#\s+.+$/m.test(raw) && raw.length < 250) return "";
  return raw;
}

function markdownList(items: string[], fallback = "- "): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

function sourceNotes(processed: ProcessedArtifact): string {
  return processed.extraction_notes.length
    ? `\n\n## Source Notes\n\n${markdownList(processed.extraction_notes)}`
    : "";
}

function referenceBody(processed: ProcessedArtifact): string {
  const media = buildMediaMarkdown(processed.raw);
  return `# ${processed.raw.title}

${media ? `${media}\n` : ""}## Summary

${processed.summary}

## Key Points

${markdownList(processed.key_points)}

## Connections

${markdownList(processed.connected_projects.map((item) => `[[${item}]]`))}

## Raw Content

<details>
<summary>Full source cache</summary>

${stripDetailsWrapper(cachedSourceContent(processed)) || "No cached source content available."}

</details>${sourceNotes(processed)}
`;
}

function candidateBody(processed: ProcessedArtifact): string {
  const media = buildMediaMarkdown(processed.raw);
  return `# ${processed.raw.title}

${media ? `${media}\n` : ""}## Summary

${processed.summary}

## Key Points

${markdownList(processed.key_points)}

## Assessment

- Recommendation: ${processed.assessment.save_recommendation}
- Why: ${processed.assessment.why}
- What changed: ${processed.assessment.what_changed || ""}
- What is suspect: ${processed.assessment.what_is_suspect || ""}

## Suggested Connections

${markdownList(processed.connected_projects.map((item) => `[[${item}]]`))}

## Raw Content

<details>
<summary>Full source cache</summary>

${stripDetailsWrapper(cachedSourceContent(processed)) || "No cached source content available."}

</details>${sourceNotes(processed)}
`;
}

function addMediaSection(body: string, media: string): string {
  if (!media.trim() || extractSection(body, "Media").trim() || body.includes("youtube.com/embed/") || body.includes("<iframe")) return body;
  const withoutLeadingBlank = body.replace(/^(#\s+.+\n+)/, `$1\n${media.trim()}\n\n`);
  return withoutLeadingBlank === body ? `${media.trim()}\n\n${body}` : withoutLeadingBlank;
}

function mergeFrontmatter(existing: Record<string, unknown>, processed: ProcessedArtifact): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...existing,
    description: processed.summary.slice(0, 180),
    format: processed.format,
    author: processed.raw.author || existing.author,
    published: processed.raw.date ? dateOnly(processed.raw.date) : existing.published,
    thumbnail: processed.raw.thumbnail || existing.thumbnail,
    tags: processed.tags,
    digestion_status: processed.digestion?.status,
    digested_with: processed.digestion?.extractor,
    digested_at: processed.digestion?.digested_at,
    extracted_chars: processed.digestion?.extracted_chars,
    cached_source_chars: processed.digestion?.cached_source_chars,
    cached_source_extractor: processed.digestion?.cached_source_extractor,
    redigested_at: new Date().toISOString(),
  };
  if (existing.type === "reference-candidate") {
    merged.score = processed.score;
    merged.save_recommendation = processed.assessment.save_recommendation;
    merged.proposed_destination = processed.proposed_destination;
    merged.connected_projects = processed.connected_projects;
  }
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged;
}

function sourceFor(sourceId: string, sources: LibrarySourceConfig[]): LibrarySourceConfig | null {
  const source = sources.find((item) => item.id === sourceId);
  if (source) return source;
  if (sourceId === "manual") {
    return {
      id: "manual",
      name: "Manual intake",
      channel: "manual",
      url: "manual://reference-intake",
      enabled: true,
      cadence: "manual",
      intent: "explicit_save",
      retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
      backfill: { enabled: false, mode: "none" },
      tags: ["manual"],
      filters: { include_topics: [], exclude_topics: [] },
      metadata: {},
      path: "",
    };
  }
  return null;
}

function thumbnailFromData(data: Record<string, unknown>): string | undefined {
  if (typeof data.thumbnail === "string") return data.thumbnail;
  const videoId = getYouTubeVideoId(typeof data.url === "string" ? data.url : "");
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined;
}

function queueItems(): Array<{ path: string }> {
  const queuePath = argValue("--queue");
  if (!queuePath) throw new Error("Pass --queue <quality-audit-queue.json>.");
  const parsed = JSON.parse(fs.readFileSync(queuePath, "utf-8")) as { items?: Array<{ path: string }> };
  return parsed.items || [];
}

async function main() {
  const limit = Number(argValue("--limit") || 10);
  const sourceFilter = argValue("--source");
  const sources = loadSources(vaultPath);
  const selected = queueItems()
    .filter((item) => !sourceFilter || parseMarkdownFile(path.join(vaultPath, item.path)).data.source_id === sourceFilter)
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
  const results = [];

  for (const item of selected) {
    const filePath = path.join(vaultPath, item.path);
    const parsed = parseMarkdownFile(filePath);
    const sourceId = typeof parsed.data.source_id === "string" ? parsed.data.source_id : "manual";
    const source = sourceFor(sourceId, sources);
    if (!source) {
      results.push({ path: item.path, status: "skipped", reason: `missing source config ${sourceId}` });
      continue;
    }

    const rawContent = existingRawContent(parsed.body);
    const existingSummary = String(extractSection(parsed.body, "Summary") || parsed.data.description || "").trim();
    const existingKeyPoints = extractBullets(extractSection(parsed.body, "Key Points"));
    const raw: RawArtifact = {
      url: String(parsed.data.url || ""),
      title: String(parsed.data.title || parsed.body.match(/^#\s+(.+)$/m)?.[1] || path.basename(filePath, ".md")),
      author: typeof parsed.data.author === "string" ? parsed.data.author : undefined,
      date: String(parsed.data.published || parsed.data.captured || parsed.data.digested || new Date().toISOString()),
      thumbnail: thumbnailFromData(parsed.data),
      content: rawContent,
      metadata: {
        existing_key_points: extractBullets(extractSection(parsed.body, "Key Points")),
      },
    };

    const existingHasMedia = Boolean(extractSection(parsed.body, "Media").trim() || parsed.body.includes("youtube.com/embed/") || parsed.body.includes("<iframe"));
    const fastMediaRepair = Boolean(
      write &&
      writeHotOnly &&
      getYouTubeVideoId(raw.url) &&
      !existingHasMedia &&
      existingSummary.length >= 100 &&
      existingKeyPoints.length >= 2
    );
    if (fastMediaRepair) {
      const media = buildMediaMarkdown(raw);
      fs.writeFileSync(filePath, stringifyMarkdown({
        ...parsed.data,
        thumbnail: thumbnailFromData(parsed.data),
        media_repaired_at: new Date().toISOString(),
      }, addMediaSection(parsed.body, media)), "utf-8");
      results.push({
        path: item.path,
        status: "updated",
        source_id: source.id,
        repair: "media_embed",
        digestion_status: parsed.data.digestion_status || null,
        digested_with: parsed.data.digested_with || null,
        summary_chars: existingSummary.length,
        key_points: existingKeyPoints.length,
        cached_source_chars: Number(parsed.data.cached_source_chars || 0),
        has_media: true,
        notes: ["Added deterministic YouTube media embed without re-running summarization."],
      });
      continue;
    }

    const processed = await digestArtifact(raw, source, { useSummarize: true });
    const hasRepairableYouTubeMedia = Boolean(getYouTubeVideoId(raw.url) && buildMediaMarkdown(processed.raw).trim());
    const mediaRepair = hasRepairableYouTubeMedia && !existingHasMedia && processed.summary.length >= 100 && processed.key_points.length >= 2;
    const qualitySkipped = write && writeHotOnly && processed.digestion?.status !== "hot" && !mediaRepair;
    if (write && !qualitySkipped) {
      const body = parsed.data.type === "reference-candidate" ? candidateBody(processed) : referenceBody(processed);
      fs.writeFileSync(filePath, stringifyMarkdown(mergeFrontmatter(parsed.data, processed), body), "utf-8");
    }
    results.push({
      path: item.path,
      status: qualitySkipped ? "skipped_quality" : write ? "updated" : "dry_run",
      source_id: source.id,
      digestion_status: processed.digestion?.status,
      digested_with: processed.digestion?.extractor,
      summary_chars: processed.summary.length,
      key_points: processed.key_points.length,
      cached_source_chars: processed.digestion?.cached_source_chars || 0,
      has_media: Boolean(processed.raw.thumbnail || processed.raw.url.includes("youtube.com/watch") || processed.raw.url.includes("youtu.be/")),
      notes: processed.extraction_notes,
    });
  }

  console.log(JSON.stringify({ write, write_hot_only: writeHotOnly, checked: selected.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
