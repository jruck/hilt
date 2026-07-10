import fs from "node:fs";
import path from "node:path";
import { findCandidateByUrl } from "./candidate-cache";
import { appendCitationToFile, citationFrom, findContentDuplicate, sourceRank, type ContentDuplicate } from "./citations";
import { getLibraryArtifact } from "./library";
import {
  beginLibraryIntakeBatch,
  endLibraryIntakeBatch,
  enqueueLibraryArtifact,
  type EnqueueArtifactResult,
} from "./processing";
import { drainLibraryProcessingQueue } from "./processing-worker";
import { processArtifact, type ProcessArtifactResult } from "./processor";
import { promoteCandidateImmediately } from "./promotion";
import type { LibrarySourceConfig, RawArtifact } from "./types";
import { dateOnly } from "./utils";

export interface ProcessArtifactBatchOptions {
  useSummarize?: boolean;
  dryRun?: boolean;
  reweaveTimeoutMs?: number;
}

interface QueuePlan {
  index: number;
  raw: RawArtifact;
  contentDup: ContentDuplicate | null;
}

function incomingCitation(raw: RawArtifact, source: LibrarySourceConfig) {
  return citationFrom({
    source_id: source.id,
    source_name: source.name,
    url: raw.url,
    channel: source.channel,
    at: dateOnly(raw.date || new Date()),
    title: raw.title,
  });
}

export async function processArtifactBatch(
  vaultPath: string,
  artifacts: RawArtifact[],
  source: LibrarySourceConfig,
  options: ProcessArtifactBatchOptions = {},
): Promise<ProcessArtifactResult[]> {
  if (options.dryRun) {
    const results: ProcessArtifactResult[] = [];
    for (const raw of artifacts) results.push(await processArtifact(vaultPath, raw, source, options));
    return results;
  }

  const results = new Array<ProcessArtifactResult>(artifacts.length);
  const plans: QueuePlan[] = [];
  for (const [index, raw] of artifacts.entries()) {
    const contentDup = source.intent === "explicit_save"
      ? null
      : findContentDuplicate(vaultPath, { url: raw.url, title: raw.title, sourceId: source.id, date: raw.date || undefined });
    if (contentDup && sourceRank(source.id, source.channel) <= sourceRank(contentDup.source_id, contentDup.channel)) {
      appendCitationToFile(contentDup.path, incomingCitation(raw, source));
      results[index] = { status: "duplicate", path: contentDup.path, reason: "content_cited_into_existing" };
      continue;
    }
    plans.push({ index, raw, contentDup });
  }

  const queued = new Map<number, EnqueueArtifactResult>();
  if (plans.length) beginLibraryIntakeBatch(vaultPath);
  try {
    for (const plan of plans) {
      const candidate = source.intent === "explicit_save" ? findCandidateByUrl(vaultPath, plan.raw.url) : null;
      if (candidate && candidate.status !== "promoted") {
        const promotedPath = promoteCandidateImmediately(vaultPath, candidate, source, plan.raw);
        results[plan.index] = { status: "promoted", path: promotedPath, reason: "explicit_save_promoted_candidate" };
        continue;
      }
      const intake = enqueueLibraryArtifact(vaultPath, plan.raw, source, options);
      queued.set(plan.index, intake);
      if (intake.status === "duplicate") {
        results[plan.index] = {
          status: "duplicate",
          path: path.join(vaultPath, intake.path),
          reason: intake.reason,
        };
      }
    }
  } finally {
    if (plans.length) endLibraryIntakeBatch(vaultPath);
  }

  const drained = await drainLibraryProcessingQueue(vaultPath);
  const drainedById = new Map(drained.map((result) => [result.artifact_uid, result]));
  for (const plan of plans) {
    if (results[plan.index]) continue;
    const intake = queued.get(plan.index);
    if (!intake) continue;
    const processed = drainedById.get(intake.artifact_uid);
    const status = processed?.ingestion_status || (intake.lifecycle_status === "saved" ? "saved" : "candidate");
    const finalPath = path.join(vaultPath, processed?.path || intake.path);
    const detail = getLibraryArtifact(vaultPath, intake.artifact_uid);
    results[plan.index] = {
      status,
      path: finalPath,
      reason: processed?.status === "ready" ? `queued_${status}` : processed?.status || intake.reason,
      youtube_clip: detail?.youtube_clip,
    };

    if (plan.contentDup && processed?.status === "ready" && fs.existsSync(finalPath)) {
      appendCitationToFile(finalPath, citationFrom({
        source_id: plan.contentDup.source_id,
        source_name: plan.contentDup.source_name,
        url: plan.contentDup.url,
        channel: plan.contentDup.channel || undefined,
        at: plan.contentDup.at,
        title: plan.contentDup.title,
      }), plan.contentDup.connections);
      if (!plan.contentDup.saved) fs.rmSync(plan.contentDup.path, { force: true });
      results[plan.index].reason = `${results[plan.index].reason}_superseded_${plan.contentDup.source_id}`;
    }
  }

  return results;
}
