import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { cleanupLegacyReferenceBody } from "../src/lib/library/legacy-cleanup";
import { parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { atomicWriteFile, walkMarkdown } from "../src/lib/library/utils";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const write = args.includes("--write");
const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || "/Users/jruck/work/bridge";

function argValue(name: string, fallback: string | null = null): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

function argValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function selectedPaths(): string[] {
  const explicitPaths = argValues("--path");
  if (explicitPaths.length) {
    return explicitPaths.map((item) => path.isAbsolute(item) ? item : path.join(vaultPath, item));
  }
  const limit = Number(argValue("--limit", "0"));
  const files = walkMarkdown(path.join(vaultPath, "references"))
    .filter((filePath) => !filePath.includes(`${path.sep}.cache${path.sep}`));
  return Number.isFinite(limit) && limit > 0 ? files.slice(0, limit) : files;
}

function comparableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(comparableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, comparableValue(item)]),
    );
  }
  return value;
}

function frontmatterChanged(previous: Record<string, unknown>, next: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (JSON.stringify(comparableValue(previous[key])) !== JSON.stringify(comparableValue(next[key]))) return true;
  }
  return false;
}

function reportPath(filePath: string): string {
  return path.relative(vaultPath, filePath).split(path.sep).join("/");
}

function repairFile(filePath: string) {
  const parsed = parseMarkdownFile(filePath);
  if (parsed.data.type !== "reference") {
    return { path: reportPath(filePath), status: "skipped", reason: "not a reference" };
  }

  const cleanup = cleanupLegacyReferenceBody(parsed.data, parsed.body);
  const changed = cleanup.body !== parsed.body || frontmatterChanged(parsed.data, cleanup.data);
  if (write && changed) atomicWriteFile(filePath, stringifyMarkdown(cleanup.data, cleanup.body));

  return {
    path: reportPath(filePath),
    status: changed ? (write ? "updated" : "dry_run") : "unchanged",
    removed_navigation: cleanup.removedNavigation,
    removed_metadata_keys: cleanup.removedMetadataKeys,
    added_frontmatter_keys: cleanup.addedFrontmatterKeys,
    moved_leading_media: cleanup.movedLeadingMedia,
  };
}

function main() {
  const files = selectedPaths();
  const results = files.map(repairFile);
  const changed = results.filter((item) => item.status === "dry_run" || item.status === "updated");
  console.log(JSON.stringify({ write, checked: results.length, changed: changed.length, results }, null, 2));
}

main();
