import path from "path";
import { CANDIDATE_CACHE_DIR } from "./candidate-cache";
import { parseMarkdownFile, relativeVaultPath } from "./markdown";
import { CURRENT_PIPELINE_VERSIONS } from "./pipeline";
import { walkMarkdown } from "./utils";

export interface ReweavePendingTarget {
  path: string;
  relative_path: string;
  type: "reference" | "reference-candidate";
  title: string;
  library_mode: "study";
  queued_at: string | null;
  reason: "reweave_pending" | "missing_connection_pass" | "version_behind";
}

export interface FindReweavePendingOptions {
  includeCandidates?: boolean;
  limit?: number;
  /** Also queue study items stamped at a non-current pipeline_version (the migration backlog). Opt-in,
   *  so the default targeting (deferred/missing reweaves only) stays unchanged. */
  includeVersionBehind?: boolean;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function queuedAt(data: Record<string, unknown>): string | null {
  return asString(data.digested_at)
    || asString(data.captured_at)
    || asString(data.saved_at)
    || asString(data.captured)
    || asString(data.published);
}

function hasConnectionPass(data: Record<string, unknown>): boolean {
  return Boolean(
    asString(data.reconnected_at)
      || (Array.isArray(data.connection_suggestions) && data.connection_suggestions.length > 0)
      || asString(data.connection_reasoning),
  );
}

function isCurrentVersion(data: Record<string, unknown>): boolean {
  return typeof data.pipeline_version === "string" && CURRENT_PIPELINE_VERSIONS.has(data.pipeline_version);
}

function pendingTarget(vaultPath: string, filePath: string, includeVersionBehind: boolean): ReweavePendingTarget | null {
  let parsed: ReturnType<typeof parseMarkdownFile>;
  try {
    parsed = parseMarkdownFile(filePath);
  } catch {
    return null;
  }
  const { data, body } = parsed;
  const type = data.type === "reference" || data.type === "reference-candidate" ? data.type : null;
  if (!type) return null;
  if (data.library_mode === "keep") return null;
  if (type === "reference-candidate" && String(data.status || "candidate") !== "candidate") return null;
  const reason: ReweavePendingTarget["reason"] | null = data.reweave_pending === true
    ? "reweave_pending"
    : data.digestion_status === "hot" && !hasConnectionPass(data)
      ? "missing_connection_pass"
      : includeVersionBehind && !isCurrentVersion(data)
        ? "version_behind"
        : null;
  if (!reason) return null;

  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    path: filePath,
    relative_path: relativeVaultPath(vaultPath, filePath),
    type,
    title: asString(data.title) || heading || path.basename(filePath, ".md"),
    library_mode: "study",
    queued_at: queuedAt(data),
    reason,
  };
}

export function findReweavePendingTargets(
  vaultPath: string,
  options: FindReweavePendingOptions = {},
): ReweavePendingTarget[] {
  const includeVersionBehind = options.includeVersionBehind === true;
  const targets: ReweavePendingTarget[] = [];
  for (const filePath of walkMarkdown(path.join(vaultPath, "references"))) {
    const target = pendingTarget(vaultPath, filePath, includeVersionBehind);
    if (target) targets.push(target);
  }
  if (options.includeCandidates !== false) {
    for (const filePath of walkMarkdown(path.join(vaultPath, CANDIDATE_CACHE_DIR), { includeHidden: true })) {
      const target = pendingTarget(vaultPath, filePath, includeVersionBehind);
      if (target) targets.push(target);
    }
  }

  const sorted = targets.sort((a, b) => {
    const byDate = String(a.queued_at || "").localeCompare(String(b.queued_at || ""));
    return byDate || a.relative_path.localeCompare(b.relative_path);
  });
  const limit = Number(options.limit || 0);
  return Number.isFinite(limit) && limit > 0 ? sorted.slice(0, limit) : sorted;
}

export interface ReweaveBacklog {
  /** Study items flagged reweave_pending or missing their connection pass (L1-only fallbacks). */
  pending: number;
  /** Study items stamped at a non-current pipeline_version — the migration/model-change backlog. */
  version_behind: number;
  /** Distinct items awaiting a (Claude) reweave. */
  total: number;
}

/**
 * How much expensive reweave work is queued — the signal the health panel surfaces so an invisible
 * backlog (and the window pressure it creates) becomes a number you can watch. Counts only STUDY items
 * (keep items are digest-only and never hit the Claude window).
 */
export function countReweaveBacklog(vaultPath: string): ReweaveBacklog {
  // Count exactly what the nightly drain targets (includeVersionBehind) so the panel number and the
  // job's worklist can never disagree.
  const targets = findReweavePendingTargets(vaultPath, { includeVersionBehind: true });
  const version_behind = targets.filter((target) => target.reason === "version_behind").length;
  return { pending: targets.length - version_behind, version_behind, total: targets.length };
}
