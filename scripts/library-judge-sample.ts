import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { evaluateLibrary, getRecommendations } from "../src/lib/library/recommendations";
import { buildKbIndex } from "../src/lib/library/kb-index";
import { detectRateLimitInEnvelope, extractModelText, resolveClaudeBin, runClaude } from "../src/lib/library/connections";
import { hashId } from "../src/lib/library/utils";
import type { RecommendedArtifact } from "../src/lib/library/types";

/** evaluateLibrary spreads LibraryArtifactDetail into its results; the declared type doesn't carry the
 *  detail fields, but the runtime objects do. */
type ScoredItem = RecommendedArtifact & { content?: string };

loadEnvConfig(process.cwd());

/**
 * Judge-layer bootstrap (Library v2, metrics 1–2): sample study items stratified across worth
 * terciles, ask Claude for a DIRECT attention-worthiness verdict on each (high/medium/low + reason,
 * judging from the existing digest — no vault exploration, one light call per item), and store the
 * judgments in DATA_DIR. Computes judge–score agreement and For You precision@8 at the end.
 *
 *   DATA_DIR=~/.hilt/data npx tsx scripts/library-judge-sample.ts --sample 24
 *   ... --force        # re-judge items that already have a stored judgment
 *   ... --dry-run      # show the sample, no calls
 *
 * Sequential and rate-limit-aware (stops cleanly on a real usage limit; partial results are saved).
 * The current For You picks are always included so precision@8 is computable.
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const sampleSize = Math.max(6, Number(argValue("--sample") || 24));
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const timeoutMs = Number(process.env.LIBRARY_JUDGE_TIMEOUT_MS || 120_000);

if (!Number.isFinite(sampleSize) || !Number.isFinite(timeoutMs)) {
  console.error("Invalid --sample / LIBRARY_JUDGE_TIMEOUT_MS — pass numbers.");
  process.exit(64);
}

const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();

export interface StoredJudgment {
  tier: "high" | "medium" | "low";
  reason: string;
  judged_at: string;
  worth_at_judgment: number;
  tercile_at_judgment: "top" | "middle" | "bottom";
  title: string;
  source: "sample-pass" | "reweave";
}

function judgmentsPath(): string {
  const dir = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "library-judgments");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${hashId(path.resolve(vaultPath), 16)}.json`);
}

function readJudgments(): Record<string, StoredJudgment> {
  try { return JSON.parse(fs.readFileSync(judgmentsPath(), "utf-8")); } catch { return {}; }
}

function tercileOf(worth: number, bounds: { top: number; middle: number }): "top" | "middle" | "bottom" {
  if (worth >= bounds.top) return "top";
  if (worth >= bounds.middle) return "middle";
  return "bottom";
}

const TIER_FOR_TERCILE: Record<string, string> = { top: "high", middle: "medium", bottom: "low" };

function buildJudgeTask(kbIndex: string, item: ScoredItem): string {
  const digest = (item.content || item.summary || "").slice(0, 6_000);
  return [
    "You are judging ONE reference in Justin's knowledge library. Below is an INDEX of his active work,",
    "then the reference's digest. Judge directly from this material — do NOT use any tools.",
    "",
    "QUESTION: how much does this source deserve Justin's limited attention right now?",
    "- \"high\" = he should genuinely read/act on it soon — it materially bears on active work or sharpens how he builds/thinks.",
    "- \"medium\" = worth having in the library, no urgency.",
    "- \"low\" = fine to keep, but he need never look at it again. Most saves are honestly low — be willing to say so.",
    "Judge the SOURCE's value to HIS practice, not the digest's quality.",
    "",
    "Return ONLY this JSON: { \"tier\": \"high|medium|low\", \"reason\": \"<one plain line, specific to Justin's work>\" }",
    "",
    "=== INDEX OF JUSTIN'S WORK ===",
    kbIndex,
    "",
    "=== REFERENCE ===",
    `Title: ${item.title}`,
    `Digest:\n${digest}`,
  ].join("\n");
}

async function judgeOne(kbIndex: string, item: ScoredItem): Promise<{ tier: StoredJudgment["tier"]; reason: string } | "rate_limited" | null> {
  const cliArgs = ["-p", buildJudgeTask(kbIndex, item), "--output-format", "json"];
  const model = process.env.LIBRARY_CONNECTIONS_MODEL;
  if (model) cliArgs.push("--model", model);
  let stdout: string;
  try {
    stdout = await runClaude(resolveClaudeBin(), cliArgs, timeoutMs);
  } catch (error) {
    const e = error as { stderr?: string; stdout?: string };
    if (detectRateLimitInEnvelope(e?.stdout || "").limited || /usage limit|rate.?limit/i.test(e?.stderr || "")) return "rate_limited";
    return null;
  }
  if (detectRateLimitInEnvelope(stdout).limited) return "rate_limited";
  const text = extractModelText(stdout);
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text) as { tier?: unknown; reason?: unknown };
    const tier = parsed.tier === "high" || parsed.tier === "medium" || parsed.tier === "low" ? parsed.tier : null;
    if (!tier) return null;
    return { tier, reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "" };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const evaluated: ScoredItem[] = evaluateLibrary(vaultPath).sort((a, b) => (b.worth || 0) - (a.worth || 0));
  if (!evaluated.length) { console.error("No study items to judge."); return; }

  const worths = evaluated.map((item) => item.worth || 0);
  const bounds = {
    top: worths[Math.floor(worths.length / 3)] ?? 0,
    middle: worths[Math.floor((worths.length * 2) / 3)] ?? 0,
  };
  // Judge what the funnel actually SERVES (editor picks + rules + exploration), not the raw
  // worth-sorted head — precision@8 must describe the user-visible feed.
  const picks: ScoredItem[] = getRecommendations(vaultPath, 8).items;
  const byTercile: Record<string, ScoredItem[]> = { top: [], middle: [], bottom: [] };
  for (const item of evaluated) byTercile[tercileOf(item.worth || 0, bounds)].push(item);

  // Stratified sample: even spread within each tercile (not just its head), plus the For You picks.
  const perTercile = Math.max(2, Math.floor(sampleSize / 3));
  const sampled = new Map<string, ScoredItem>();
  for (const pick of picks) sampled.set(pick.id, pick);
  for (const tercile of ["top", "middle", "bottom"] as const) {
    const pool = byTercile[tercile];
    const step = Math.max(1, Math.floor(pool.length / perTercile));
    for (let i = 0; i < pool.length && [...sampled.values()].filter((s) => tercileOf(s.worth || 0, bounds) === tercile).length < perTercile; i += step) {
      sampled.set(pool[i].id, pool[i]);
    }
  }

  const existing = readJudgments();
  const worklist = [...sampled.values()].filter((item) => force || !existing[item.id]);
  console.error(`[judge] study items: ${evaluated.length} · sample: ${sampled.size} (per-tercile ${perTercile} + ${picks.length} picks) · to judge: ${worklist.length} (${sampled.size - worklist.length} cached)`);
  if (dryRun) {
    worklist.forEach((item) => console.error(`  - [${tercileOf(item.worth || 0, bounds)}] worth=${item.worth} ${item.title.slice(0, 70)}`));
    return;
  }

  const kbIndex = buildKbIndex(vaultPath, { noWrite: true });
  let judged = 0;
  let failed = 0;
  for (const item of worklist) {
    const verdict = await judgeOne(kbIndex, item);
    if (verdict === "rate_limited") {
      console.error("[judge] RATE LIMITED — stopping cleanly; partial results saved.");
      break;
    }
    if (!verdict) { failed += 1; continue; }
    existing[item.id] = {
      tier: verdict.tier,
      reason: verdict.reason,
      judged_at: new Date().toISOString(),
      worth_at_judgment: item.worth || 0,
      tercile_at_judgment: tercileOf(item.worth || 0, bounds),
      title: item.title,
      source: "sample-pass",
    };
    judged += 1;
    fs.writeFileSync(judgmentsPath(), `${JSON.stringify(existing, null, 2)}\n`, "utf-8");
    console.error(`[judge] ${judged}/${worklist.length} ${verdict.tier.toUpperCase().padEnd(6)} (worth ${item.worth}) ${item.title.slice(0, 60)}`);
  }

  // Agreement + precision over EVERYTHING stored (cached + new).
  const stored = Object.entries(existing);
  const exact = stored.filter(([, j]) => TIER_FOR_TERCILE[j.tercile_at_judgment] === j.tier).length;
  const adjacent = stored.filter(([, j]) => {
    const order = ["low", "medium", "high"];
    const expected = TIER_FOR_TERCILE[j.tercile_at_judgment];
    return Math.abs(order.indexOf(expected) - order.indexOf(j.tier)) <= 1;
  }).length;
  const pickJudgments = picks.map((pick) => existing[pick.id]).filter(Boolean);
  const precision = pickJudgments.filter((j) => j.tier !== "low").length;

  console.log(JSON.stringify({
    judged_now: judged,
    failed_now: failed,
    total_stored: stored.length,
    judge_score_agreement_exact: stored.length ? Number((exact / stored.length).toFixed(3)) : null,
    judge_score_agreement_adjacent: stored.length ? Number((adjacent / stored.length).toFixed(3)) : null,
    for_you_precision_at_8: pickJudgments.length ? `${precision}/${pickJudgments.length}` : "no picks judged",
    judgments_path: judgmentsPath(),
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
