import path from "path";
import { loadEnvConfig } from "@next/env";
import { parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { atomicWriteFile, walkMarkdown } from "../src/lib/library/utils";

loadEnvConfig(process.cwd());

const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const write = process.argv.includes("--write"); // DEFAULT OFF = dry run
const referencesRoot = path.join(vaultPath, "references");

interface TagItem {
  path: string;
  inferred: string | null;
  action: "would_tag" | "tagged" | "already_tagged" | "skipped";
  reason?: string;
}

function hasHeading(body: string, sectionName: string): boolean {
  return body
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase() === `## ${sectionName}`.toLowerCase());
}

/**
 * Best-effort inference of which pipeline version produced this reference, based on frontmatter
 * signals and body shape. This is heuristic — there is no perfect mapping for legacy notes:
 *   - free-form reweave body (has `reconnected_at`, no `## Summary`/`## Key Points`) => "v5"
 *   - Key-Takeaways body (`digested_with: summarize-cli`, has `## Summary` + `## Key Points`) => "v2"
 *   - otherwise => "v1"
 */
function inferPipelineVersion(data: Record<string, unknown>, body: string): string {
  const hasSummary = hasHeading(body, "Summary");
  const hasKeyPoints = hasHeading(body, "Key Points");

  if (data.reconnected_at && !hasSummary && !hasKeyPoints) return "v5";
  if (data.digested_with === "summarize-cli" && hasSummary && hasKeyPoints) return "v2";
  return "v1";
}

function main() {
  const items: TagItem[] = [];
  const tally: Record<string, number> = {};

  for (const filePath of walkMarkdown(referencesRoot)) {
    if (filePath.includes(`${path.sep}.cache${path.sep}`)) continue;
    const relativePath = path.relative(vaultPath, filePath).split(path.sep).join("/");
    try {
      const parsed = parseMarkdownFile(filePath);
      if (parsed.data.type !== "reference") continue;

      // Never overwrite an existing pipeline_version (e.g. stamped by the reweave/redigest paths).
      if (typeof parsed.data.pipeline_version === "string" && parsed.data.pipeline_version.trim()) {
        items.push({ path: relativePath, inferred: parsed.data.pipeline_version, action: "already_tagged" });
        continue;
      }

      const inferred = inferPipelineVersion(parsed.data, parsed.body);
      tally[inferred] = (tally[inferred] || 0) + 1;

      const nextData: Record<string, unknown> = { ...parsed.data, pipeline_version: inferred };
      if (write) {
        atomicWriteFile(filePath, stringifyMarkdown(nextData, parsed.body));
      }
      items.push({
        path: relativePath,
        inferred,
        action: write ? "tagged" : "would_tag",
      });
    } catch (error) {
      items.push({
        path: relativePath,
        inferred: null,
        action: "skipped",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const skipped = items.filter((item) => item.action === "skipped");
  console.error("NOTE: pipeline_version values below are best-effort inference from legacy signals, not authoritative.");
  console.log(JSON.stringify({
    write,
    checked_root: referencesRoot,
    note: "best-effort inference",
    tagged: items.filter((item) => item.action === "would_tag" || item.action === "tagged").length,
    already_tagged: items.filter((item) => item.action === "already_tagged").length,
    skipped: skipped.length,
    inferred_tally: tally,
    items,
  }, null, 2));
  process.exitCode = skipped.length ? 1 : 0;
}

main();
