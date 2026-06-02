import path from "path";
import { spawnSync } from "child_process";
import { loadEnvConfig } from "@next/env";
import { buildBookCaptureImportPlan, writeBookCaptureImport } from "../src/lib/library/book-capture";
import { relativeVaultPath } from "../src/lib/library/markdown";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);

function hasFlag(name: string): boolean {
  return args.includes(name);
}

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

function usage(): never {
  console.error(`Usage:
  npm run library:book:import -- --input /path/to/book-capture/output.md [--raw-text-json /path/to/raw_text.json] [--title "Book"] [--author "Author"] [--url URL] [--thumbnail URL] [--category Topic] [--write] [--force] [--skip-reweave]

By default this is a dry run. Add --write to create references/books/<book>/index.md, copy topic markdown, cache the full capture under references/.cache/book-captures/, and run the Bridge-aware reweave/connection pass. Use --skip-reweave only when intentionally importing without connection enrichment.`);
  process.exit(1);
}

function tsxBin(): string {
  const bin = process.platform === "win32" ? "tsx.cmd" : "tsx";
  return path.join(process.cwd(), "node_modules", ".bin", bin);
}

function runPostImportReweave(vaultPath: string, referencePath: string): unknown {
  const relPath = relativeVaultPath(vaultPath, referencePath);
  const result = spawnSync(tsxBin(), [
    "scripts/library-reweave.ts",
    "--vault",
    vaultPath,
    "--path",
    relPath,
    "--write",
    "--review-batch",
    "book-capture-import",
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf-8",
    maxBuffer: 1024 * 1024 * 16,
  });

  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(`Book reference was written, but post-import reweave failed for ${relPath}: ${result.stdout || result.stderr}`);
  }

  let parsed: { results?: Array<{ status?: string }> };
  try {
    parsed = JSON.parse(result.stdout) as { results?: Array<{ status?: string }> };
  } catch {
    throw new Error(`Book reference was written, but post-import reweave returned non-JSON output for ${relPath}.`);
  }

  const status = parsed.results?.[0]?.status;
  if (status !== "updated") {
    throw new Error(`Book reference was written, but post-import reweave did not update ${relPath}; status was ${status || "missing"}.`);
  }

  return parsed;
}

async function main() {
  const inputPath = argValue("--input") || args.find((arg) => !arg.startsWith("--"));
  if (!inputPath) usage();

  const vaultPath = path.resolve(process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd());
  const plan = buildBookCaptureImportPlan({
    vaultPath,
    inputPath,
    rawTextJsonPath: argValue("--raw-text-json") || undefined,
    title: argValue("--title") || undefined,
    author: argValue("--author") || undefined,
    url: argValue("--url") || undefined,
    thumbnail: argValue("--thumbnail") || undefined,
    category: argValue("--category") || undefined,
  });

  const write = hasFlag("--write");
  const skipReweave = hasFlag("--skip-reweave");
  if (write) writeBookCaptureImport(plan, { force: hasFlag("--force") });
  const reweave = write && !skipReweave
    ? runPostImportReweave(vaultPath, plan.referencePath)
    : null;

  const report = {
    dry_run: !write,
    title: plan.title,
    author: plan.author,
    url: plan.url,
    source_files: plan.sourceFiles.length,
    reference_path: relativeVaultPath(vaultPath, plan.referencePath),
    topics_dir: relativeVaultPath(vaultPath, plan.topicsDir),
    cache_path: relativeVaultPath(vaultPath, plan.cachePath),
    would_overwrite: plan.wouldOverwrite,
    wrote: write,
    reweave: write ? (skipReweave ? { skipped: true } : reweave) : null,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
