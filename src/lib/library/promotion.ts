import fs from "fs";
import path from "path";
import type { PromotionReason, ReferenceCandidate } from "./types";
import { updateCandidate } from "./candidate-cache";
import { writeDurableReference } from "./references";
import { atomicWriteFile, dateOnly, ensureDir, isoNow, slugify } from "./utils";
import { digestArtifact } from "./digestion";
import type { LibrarySourceConfig, RawArtifact } from "./types";
import { parseMarkdownFile, relativeVaultPath, stringifyMarkdown } from "./markdown";
import { libraryProcessingQueuePath, readProcessingQueueRecord, writeProcessingQueueRecord } from "./processing";

function sourceFromCandidate(candidate: ReferenceCandidate): LibrarySourceConfig {
  return {
    id: candidate.source_id,
    name: candidate.source_name,
    channel: candidate.channel,
    url: candidate.url,
    enabled: true,
    cadence: "manual",
    intent: "explicit_save",
    signal: "manual_save",
    retention: { mode: "durable", ttl_days: 30, candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: false, mode: "none" },
    tags: [],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };
}

function fastPromotionPath(vaultPath: string, candidate: ReferenceCandidate): string {
  const proposed = candidate.proposed_destination?.replace(/^\/+|\/+$/g, "");
  const relativeDir = proposed && (proposed === "references" || proposed.startsWith("references/"))
    ? proposed
    : candidate.channel === "youtube" || candidate.channel === "twitter"
      ? "references/process"
      : "references";
  const dir = path.join(vaultPath, relativeDir);
  ensureDir(dir);
  const base = `${dateOnly(candidate.published || candidate.digested)}-${slugify(candidate.title)}`;
  let filePath = path.join(dir, `${base}.md`);
  let suffix = 2;
  while (fs.existsSync(filePath)) {
    filePath = path.join(dir, `${base}-${suffix}.md`);
    suffix += 1;
  }
  return filePath;
}

/** Promote without redigesting. This is used when a later explicit save matches an existing
 * candidate, including candidates that are still processing. The markdown body and reweave output
 * remain intact, while an active queue follows the stable UID to its new durable path. */
export function promoteCandidateImmediately(
  vaultPath: string,
  candidate: ReferenceCandidate,
  explicitSource: LibrarySourceConfig,
  raw?: RawArtifact,
): string {
  const sourcePath = path.join(vaultPath, candidate.path);
  const parsed = parseMarkdownFile(sourcePath);
  const uid = candidate.artifact_uid || candidate.id;
  const capturedAt = isoNow();
  const relevanceSignals = Array.isArray(parsed.data.relevance_signals) ? parsed.data.relevance_signals : [];
  const nextData: Record<string, unknown> = {
    ...parsed.data,
    type: "reference",
    artifact_uid: uid,
    source_title: parsed.data.source_title || candidate.source_title || candidate.title,
    captured: dateOnly(capturedAt),
    captured_at: capturedAt,
    relevance_signals: [
      ...relevanceSignals,
      { type: explicitSource.signal || "explicit_save", channel: explicitSource.channel, at: dateOnly(capturedAt) },
    ],
  };
  for (const key of ["status", "expires", "score", "save_recommendation", "proposed_destination", "promotion", "digested"]) {
    delete nextData[key];
  }

  const destination = fastPromotionPath(vaultPath, candidate);
  atomicWriteFile(destination, stringifyMarkdown(nextData, parsed.body));
  atomicWriteFile(sourcePath, stringifyMarkdown({
    ...parsed.data,
    artifact_uid: uid,
    status: "promoted",
    promotion: {
      promoted_to: relativeVaultPath(vaultPath, destination),
      promoted_at: capturedAt,
      promoted_reason: "explicit_signal",
    },
  }, parsed.body));

  const queuePath = libraryProcessingQueuePath(vaultPath, uid);
  const queue = readProcessingQueueRecord(queuePath);
  if (queue) {
    writeProcessingQueueRecord({
      ...queue,
      target_path: relativeVaultPath(vaultPath, destination),
      lifecycle_status: "saved",
      raw: raw ? { ...queue.raw, ...raw, metadata: { ...queue.raw.metadata, ...raw.metadata } } : queue.raw,
      source: {
        ...queue.source,
        intent: "explicit_save",
        signal: explicitSource.signal || queue.source.signal || "explicit_save",
        retention: { ...queue.source.retention, mode: "durable" },
      },
      updated_at: capturedAt,
    });
  }
  return destination;
}

export async function promoteCandidate(vaultPath: string, candidate: ReferenceCandidate, reason: PromotionReason): Promise<string> {
  const raw: RawArtifact = {
    url: candidate.url,
    title: candidate.title,
    author: candidate.author || undefined,
    date: candidate.published || candidate.digested,
    thumbnail: candidate.thumbnail || undefined,
    content: candidate.cached_source || candidate.content,
    metadata: {
      ...candidate.raw_frontmatter,
      format: candidate.format,
      proposed_destination: candidate.proposed_destination || "references",
      semantic_tags: candidate.tags,
      source_tags: candidate.source_tags,
      source_collection: candidate.source_collection || undefined,
      source_collection_id: candidate.source_collection_id || undefined,
      source_folder: candidate.source_folder || undefined,
      source_folder_id: candidate.source_folder_id || undefined,
      series_id: candidate.series?.id,
      series_title: candidate.series?.title,
      series_url: candidate.series?.url || undefined,
      series_index: candidate.series?.index || undefined,
      series_total: candidate.series?.total || undefined,
      series_parent: candidate.series?.parent_path || undefined,
      library_mode: candidate.library_mode,
    },
  };
  const processed = await digestArtifact(raw, sourceFromCandidate(candidate), { useSummarize: false, vaultPath });
  processed.artifact_uid = candidate.artifact_uid || candidate.id;
  processed.source_title = candidate.source_title || candidate.title;
  processed.summary = candidate.summary || processed.summary;
  processed.key_points = candidate.key_points.length ? candidate.key_points : processed.key_points;
  if (candidate.digest_markdown?.trim()) {
    processed.digest_markdown = candidate.digest_markdown.trim();
    processed.description = candidate.summary || processed.description;
  }
  processed.score = candidate.score;
  processed.proposed_destination = candidate.proposed_destination || "references";
  processed.connected_projects = candidate.connected_projects;
  if (candidate.connection_suggestions?.length) processed.connection_suggestions = candidate.connection_suggestions;
  if (candidate.connection_reasoning) processed.connection_reasoning = candidate.connection_reasoning;
  if (candidate.reconnected_at) {
    processed.reconnected_at = candidate.reconnected_at;
    processed.reweave_pending = undefined;
  }
  if (candidate.reweave_candidates?.length) processed.reweave_candidates = candidate.reweave_candidates;
  if (candidate.attention_judgment) processed.attention_judgment = candidate.attention_judgment;
  processed.tags = candidate.tags;
  processed.source_tags = candidate.source_tags;
  processed.source_collection = candidate.source_collection;
  processed.source_collection_id = candidate.source_collection_id;
  processed.source_folder = candidate.source_folder;
  processed.source_folder_id = candidate.source_folder_id;
  processed.series = candidate.series;
  processed.library_mode = candidate.library_mode;
  processed.cited_from = candidate.cited_from;  // carry merged citations across promotion
  const durablePath = writeDurableReference(vaultPath, processed, reason);
  updateCandidate(vaultPath, candidate, {
    status: "promoted",
    promotion: {
      promoted_to: path.relative(vaultPath, durablePath).split(path.sep).join("/"),
      promoted_at: isoNow(),
      promoted_reason: reason,
    },
  });
  return durablePath;
}
