/**
 * Substance backfill (eval plan, step 3). Grades each library item's SUBSTANCE — how much worthwhile,
 * dense, non-obvious material the source carries — 0..1, via Hilt's Claude-pinned `summarize` CLI over the
 * digest we already have (no Claude reweave, no re-extraction). Version-stamped; the model grade
 * overrides the structural proxy the eval falls back to.
 *
 * GRANULARITY GATE: run `--sample N` first (no writes) and inspect the printed distribution. Do NOT
 * `--write` a backfill that saturates (everything ≈ 1.0). Tune SUBSTANCE_PROMPT until scores spread.
 *
 *   npx tsx scripts/library-grade-substance.ts --sample 24      # validate distribution, no writes
 *   npx tsx scripts/library-grade-substance.ts --write          # full backfill
 *   flags: --limit N  --concurrency N  --regrade (re-grade already-graded items)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { assertLibrarySummarizeInvocation, validateLibrarySummarizeModel, withPinnedLibrarySummarizeModel } from "../src/lib/library/summarize-policy";
import { atomicWriteFile, walkMarkdown } from "../src/lib/library/utils";

const execFileAsync = promisify(execFile);
loadEnvConfig(process.cwd());

const SUBSTANCE_VERSION = "s1";
const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const args = process.argv.slice(2);
const write = args.includes("--write");
const regrade = args.includes("--regrade");
const argNum = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  const v = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
};
const sampleN = args.includes("--sample") ? argNum("--sample", 24) : 0;
const limit = argNum("--limit", Infinity);
const concurrency = argNum("--concurrency", 4);

const SUBSTANCE_PROMPT = [
  "You grade how SUBSTANTIVE a source is for a busy AI-native builder/founder.",
  "Given the digest of a source below, rate 0.00-1.00 how much worthwhile, dense, non-obvious material",
  "the ORIGINAL source carries. A sharp, idea-dense piece scores HIGH even if short. A long but padded,",
  "shallow, listicle, or promotional piece scores LOW. A thin tweet/link with little content scores LOW.",
  "Judge depth and density of ideas, NOT length, NOT topic, NOT how relevant it is to anyone.",
  "Use the full range and be discriminating — most things are middling (0.3-0.6); reserve >0.8 for the",
  "genuinely meaty and <0.2 for the genuinely thin.",
  'Respond with ONLY compact JSON: {"substance": <number 0-1>, "reason": "<max 12 words>"}',
].join(" ");

function extractJson(text: string): { substance: number; reason: string } | null {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const s = Number(o.substance);
    if (!Number.isFinite(s)) return null;
    return { substance: Math.max(0, Math.min(1, s)), reason: typeof o.reason === "string" ? o.reason.slice(0, 80) : "" };
  } catch {
    return null;
  }
}

async function gradeOne(title: string, format: string, body: string): Promise<{ substance: number; reason: string } | null> {
  const bin = process.env.SUMMARIZE_BIN || "summarize";
  validateLibrarySummarizeModel();
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hilt-substance-"));
  const filePath = path.join(dir, "digest.md");
  try {
    await fs.promises.writeFile(filePath, `# ${title}\n\nformat: ${format}\n\n${body.slice(0, 16000)}`, "utf-8");
    const summarizeArgs = withPinnedLibrarySummarizeModel([filePath, "--plain", "--no-color", "--force-summary", "--length", "short", "--timeout", "2m", "--prompt", SUBSTANCE_PROMPT]);
    assertLibrarySummarizeInvocation(summarizeArgs);
    const { stdout } = await execFileAsync(bin, summarizeArgs, { timeout: 150000, maxBuffer: 1024 * 1024 * 4 });
    return extractJson(stdout || "");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") throw new Error(`summarize CLI not found (${bin})`);
    return null; // treat a grading failure as "no grade" — the eval falls back to the structural proxy
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function candidateFiles(): string[] {
  const refs = path.join(vaultPath, "references");
  const cands = path.join(refs, ".cache", "library-candidates");
  return [
    ...walkMarkdown(refs).filter((f) => !f.includes(`${path.sep}.archive${path.sep}`)),
    ...walkMarkdown(cands, { includeHidden: true }),
  ];
}

async function main() {
  const all = candidateFiles().filter((f) => {
    const d = parseMarkdownFile(f).data;
    if (d.type !== "reference" && d.type !== "reference-candidate") return false;
    if (d.library_mode === "keep") return false; // substance scoring is for study items
    if (!regrade && typeof d.substance === "number" && d.substance_version === SUBSTANCE_VERSION) return false;
    return true;
  });
  const targets = (sampleN ? all.slice(0, sampleN) : all).slice(0, limit);
  console.log(`${sampleN ? "SAMPLE" : write ? "BACKFILL (write)" : "DRY RUN"}: ${targets.length} of ${all.length} ungraded study items · concurrency ${concurrency}`);

  const scores: number[] = [];
  let done = 0, failed = 0;
  const queue = [...targets];
  async function worker() {
    while (queue.length) {
      const file = queue.shift()!;
      const parsed = parseMarkdownFile(file);
      const title = typeof parsed.data.title === "string" ? parsed.data.title : path.basename(file, ".md");
      const format = typeof parsed.data.format === "string" ? parsed.data.format : "";
      const grade = await gradeOne(title, format, parsed.body);
      done++;
      if (!grade) { failed++; if (done % 10 === 0) console.log(`  …${done}/${targets.length}`); continue; }
      scores.push(grade.substance);
      if (write && !sampleN) {
        const next = { ...parsed.data, substance: grade.substance, substance_reason: grade.reason || undefined, substance_version: SUBSTANCE_VERSION, substance_graded_at: new Date().toISOString() };
        atomicWriteFile(file, stringifyMarkdown(next, parsed.body));
      }
      if (sampleN) console.log(`  ${grade.substance.toFixed(2)}  ${title.slice(0, 54)}  — ${grade.reason}`);
      if (done % 25 === 0) console.log(`  …${done}/${targets.length} graded`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

  // Granularity report
  const b: Record<string, number> = { "0-.2": 0, ".2-.4": 0, ".4-.6": 0, ".6-.8": 0, ".8-1": 0 };
  for (const s of scores) b[s < 0.2 ? "0-.2" : s < 0.4 ? ".2-.4" : s < 0.6 ? ".4-.6" : s < 0.8 ? ".6-.8" : ".8-1"]++;
  const mean = scores.length ? scores.reduce((a, c) => a + c, 0) / scores.length : 0;
  const top = scores.filter((s) => s >= 0.9).length;
  console.log(`\ngraded=${scores.length} failed=${failed} mean=${mean.toFixed(2)}`);
  console.log("distribution:", b);
  console.log(`saturation check: ${((top / Math.max(1, scores.length)) * 100).toFixed(0)}% at ≥0.9 (want well under 50%)`);
  if (sampleN) console.log("\nGRANULARITY GATE: if the distribution spreads and saturation is low, re-run with --write.");
}

main().catch((e) => { console.error(e); process.exit(1); });
