import path from "path";
import { CANDIDATE_CACHE_DIR } from "./candidate-cache";
import { parseMarkdownFile, relativeVaultPath } from "./markdown";
import { walkMarkdown } from "./utils";

export interface ReweavePendingTarget {
  path: string;
  relative_path: string;
  type: "reference" | "reference-candidate";
  title: string;
  library_mode: "study";
  queued_at: string | null;
  reason: "reweave_pending" | "missing_connection_pass";
}

export interface FindReweavePendingOptions {
  includeCandidates?: boolean;
  limit?: number;
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

function pendingTarget(vaultPath: string, filePath: string): ReweavePendingTarget | null {
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
  const reason = data.reweave_pending === true
    ? "reweave_pending"
    : data.digestion_status === "hot" && !hasConnectionPass(data)
      ? "missing_connection_pass"
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
  const targets: ReweavePendingTarget[] = [];
  for (const filePath of walkMarkdown(path.join(vaultPath, "references"))) {
    const target = pendingTarget(vaultPath, filePath);
    if (target) targets.push(target);
  }
  if (options.includeCandidates !== false) {
    for (const filePath of walkMarkdown(path.join(vaultPath, CANDIDATE_CACHE_DIR), { includeHidden: true })) {
      const target = pendingTarget(vaultPath, filePath);
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
