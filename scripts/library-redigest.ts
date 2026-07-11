import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { digestArtifact } from "../src/lib/library/digestion";
import { extractBullets, extractSection, parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { buildMediaMarkdown, cachedSourceContent, getYouTubeVideoId, stripDetailsWrapper } from "../src/lib/library/media";
import { PIPELINE_VERSION } from "../src/lib/library/pipeline";
import { loadSources } from "../src/lib/library/source-config";
import { dateOnly } from "../src/lib/library/utils";
import type { LibrarySourceConfig, ProcessedArtifact, RawArtifact } from "../src/lib/library/types";

loadEnvConfig(process.cwd());

const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const args = process.argv.slice(2);
const write = args.includes("--write");
const writeHotOnly = args.includes("--write-hot-only");
const refetch = args.includes("--refetch");

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

function argValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
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
  if (/^No cached source content available\.?$/i.test(raw)) return "";
  return raw;
}

function resolvedSourceUrlFromNotes(body: string): string | undefined {
  const url = body.match(/Resolved linked URL from source metadata:\s*(https?:\/\/\S+)/)?.[1];
  if (!url) return undefined;
  // Older repair code accidentally derived this synthetic URL from any X iframe. It is not a real
  // source expansion, so do not feed it back into the next redigest as a linked video.
  if (/^https?:\/\/(?:www\.)?x\.com\/i\/status\/\d+\/video\/\d+/i.test(url)) return undefined;
  return url;
}

function xEmbedVideoUrlFromBody(body: string): string | undefined {
  const bodyWithoutSourceNotes = body.replace(/\n## Source Notes[\s\S]*$/i, "");
  const url = bodyWithoutSourceNotes.match(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/\s)]+\/status\/\d+\/video\/\d+/i)?.[0];
  if (!url) return undefined;
  if (/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/status\/\d+\/video\/\d+/i.test(url)) return undefined;
  return url;
}

function markdownList(items: string[], fallback = "- "): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

function connectionLines(processed: ProcessedArtifact): string {
  if (processed.connection_suggestions?.length) {
    return processed.connection_suggestions.map((suggestion) => {
      const target = suggestion.target ? `[[${suggestion.target}]]` : suggestion.label;
      return `- ${target} — ${suggestion.relationship}`;
    }).join("\n");
  }
  if (processed.connected_projects.length) {
    return processed.connected_projects.map((item) => `- [[${item}]]`).join("\n");
  }
  // No connections: render an empty section body; connection_reasoning lives in frontmatter.
  return "";
}

function sourceNotes(processed: ProcessedArtifact): string {
  return processed.extraction_notes.length
    ? `\n\n## Source Notes\n\n${markdownList(processed.extraction_notes)}`
    : "";
}

function referenceBody(processed: ProcessedArtifact): string {
  const media = buildMediaMarkdown(processed.raw);
  const digestBlock = processed.digest_markdown
    ? processed.digest_markdown.trim()
    : `## Summary

${processed.summary}

## Key Points

${markdownList(processed.key_points)}`;
  const connections = connectionLines(processed);
  const connectionsBlock = connections.trim() ? `\n\n## Connections\n\n${connections}` : "";
  return `# ${processed.raw.title}

${media ? `${media}\n` : ""}${digestBlock}${connectionsBlock}

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

${connectionLines(processed)}

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
    pipeline_version: PIPELINE_VERSION,
    description: (processed.description || processed.summary).slice(0, processed.digest_markdown ? 300 : 180),
    format: processed.format,
    author: processed.raw.author || existing.author,
    published: processed.raw.date ? dateOnly(processed.raw.date) : existing.published,
    thumbnail: processed.raw.thumbnail || existing.thumbnail,
    tags: processed.tags,
    source_tags: processed.source_tags.length ? processed.source_tags : existing.source_tags,
    source_collection: processed.source_collection || existing.source_collection,
    source_collection_id: processed.source_collection_id || existing.source_collection_id,
    source_folder: processed.source_folder || existing.source_folder,
    source_folder_id: processed.source_folder_id || existing.source_folder_id,
    library_mode: processed.library_mode,
    digestion_status: processed.digestion?.status,
    digested_with: processed.digestion?.extractor,
    digested_at: processed.digestion?.digested_at,
    extracted_chars: processed.digestion?.extracted_chars,
    cached_source_chars: processed.digestion?.cached_source_chars,
    cached_source_extractor: processed.digestion?.cached_source_extractor,
    video_url: typeof processed.raw.metadata.video_url === "string" ? processed.raw.metadata.video_url : existing.video_url,
    video_duration_seconds: processed.video_duration_seconds || existing.video_duration_seconds,
    x_video_transcript_status: typeof processed.raw.metadata.x_video_transcript_status === "string" ? processed.raw.metadata.x_video_transcript_status : existing.x_video_transcript_status,
    x_video_transcript_method: typeof processed.raw.metadata.x_video_transcript_method === "string" ? processed.raw.metadata.x_video_transcript_method : existing.x_video_transcript_method,
    embedded_video_page_url: typeof processed.raw.metadata.embedded_video_page_url === "string" ? processed.raw.metadata.embedded_video_page_url : existing.embedded_video_page_url,
    embedded_video_provider: typeof processed.raw.metadata.embedded_video_provider === "string" ? processed.raw.metadata.embedded_video_provider : existing.embedded_video_provider,
    embedded_video_source: typeof processed.raw.metadata.embedded_video_source === "string" ? processed.raw.metadata.embedded_video_source : existing.embedded_video_source,
    embedded_video_title: typeof processed.raw.metadata.embedded_video_title === "string" ? processed.raw.metadata.embedded_video_title : existing.embedded_video_title,
    embedded_video_required: processed.raw.metadata.embedded_video_required === true ? true : existing.embedded_video_required,
    embedded_video_transcript_status: typeof processed.raw.metadata.embedded_video_transcript_status === "string" ? processed.raw.metadata.embedded_video_transcript_status : existing.embedded_video_transcript_status,
    embedded_video_transcript_method: typeof processed.raw.metadata.embedded_video_transcript_method === "string" ? processed.raw.metadata.embedded_video_transcript_method : existing.embedded_video_transcript_method,
    redigested_at: new Date().toISOString(),
    source_recovered_from: typeof processed.raw.metadata.source_recovered_from === "string" ? processed.raw.metadata.source_recovered_from : existing.source_recovered_from,
    reweave_pending: processed.reweave_pending ? true : processed.reconnected_at ? undefined : existing.reweave_pending,
    // Clear on a successful redigest: if the (re-acquired) content is no longer login-wall-only, the
    // item is recovered and should drop the flag; only re-stamp when it's still chrome-only.
    needs_auth_recovery: processed.needs_auth_recovery ? true : undefined,
  };
  if (processed.reconnected_at) {
    merged.connected_projects = processed.connected_projects.length ? processed.connected_projects : undefined;
    merged.connection_suggestions = processed.connection_suggestions?.length ? processed.connection_suggestions : undefined;
    merged.connection_reasoning = processed.connection_reasoning || undefined;
    merged.reconnected_at = processed.reconnected_at;
    merged.reweave_candidates = processed.reweave_candidates?.length ? processed.reweave_candidates : undefined;
    merged.attention_judgment = processed.attention_judgment || undefined;
  }
  if (
    processed.raw.metadata.embedded_video_transcript_status === "captured"
    && existing.processing && typeof existing.processing === "object" && !Array.isArray(existing.processing)
  ) {
    const current = existing.processing as Record<string, unknown>;
    const completed = Array.isArray(current.completed_stages) ? current.completed_stages.map(String) : [];
    const reweaveCompleted = Boolean(processed.reconnected_at);
    merged.processing = {
      ...current,
      state: "ready",
      stage: reweaveCompleted ? "reweave" : "digest",
      completed_stages: Array.from(new Set([
        ...completed.filter((stage) => stage !== "reweave" || reweaveCompleted),
        "transcribe",
        "digest",
        ...(reweaveCompleted ? ["reweave"] : []),
      ])),
      updated_at: processed.reconnected_at || new Date().toISOString(),
      completed_at: processed.reconnected_at || new Date().toISOString(),
      next_retry_at: null,
      last_error: null,
    };
  }
  if (existing.type === "reference-candidate") {
    merged.score = processed.score;
    merged.save_recommendation = processed.assessment.save_recommendation;
    merged.proposed_destination = processed.proposed_destination;
    if (!processed.reconnected_at) {
      merged.connected_projects = processed.connected_projects;
      merged.connection_suggestions = processed.connection_suggestions?.length
        ? processed.connection_suggestions
        : existing.connection_suggestions;
      merged.connection_reasoning = processed.connection_reasoning || existing.connection_reasoning;
      merged.reweave_candidates = processed.reweave_candidates?.length
        ? processed.reweave_candidates
        : existing.reweave_candidates;
    }
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
  const directPaths = argValues("--path").map((item) => ({
    path: path.isAbsolute(item) ? path.relative(vaultPath, item) : item,
  }));
  if (directPaths.length) return directPaths;
  const queuePath = argValue("--queue");
  if (!queuePath) throw new Error("Pass --queue <quality-audit-queue.json> or one or more --path <reference.md>.");
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

    const rawTitle = String(parsed.data.title || parsed.body.match(/^#\s+(.+)$/m)?.[1] || path.basename(filePath, ".md"));
    const rawContent = existingRawContent(parsed.body);
    const existingSummary = String(extractSection(parsed.body, "Summary") || parsed.data.description || "").trim();
    const existingKeyPoints = extractBullets(extractSection(parsed.body, "Key Points"));
    const resolvedSourceUrl = resolvedSourceUrlFromNotes(parsed.body);
    const xEmbedVideoUrl = typeof parsed.data.video_url === "string"
      ? parsed.data.video_url
      : xEmbedVideoUrlFromBody(parsed.body);
    const raw: RawArtifact = {
      url: String(parsed.data.url || ""),
      title: rawTitle,
      author: typeof parsed.data.author === "string" ? parsed.data.author : undefined,
      // No invented dates: a refetch/redigest must never clobber `published` with TODAY when the
      // file carries no date (mergeFrontmatter keeps existing.published on an empty raw.date).
      date: String(parsed.data.published || parsed.data.captured || parsed.data.created || parsed.data.digested || ""),
      thumbnail: thumbnailFromData(parsed.data),
      content: rawContent,
      metadata: {
        expanded_url: resolvedSourceUrl || xEmbedVideoUrl,
        video_url: xEmbedVideoUrl,
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

    const processed = await digestArtifact(raw, source, { useSummarize: true, vaultPath, preferCachedSource: !refetch });
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
      has_media: Boolean(buildMediaMarkdown(processed.raw).trim()),
      notes: processed.extraction_notes,
    });
  }

  console.log(JSON.stringify({ write, write_hot_only: writeHotOnly, checked: selected.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
