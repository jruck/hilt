import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { evaluateLibrary, getRecommendations } from "../src/lib/library/recommendations";
import { CURRENT_PIPELINE_VERSIONS } from "../src/lib/library/pipeline";
import { readLibraryEvents } from "../src/lib/library/events";
import { listStoredFeedback } from "../src/lib/library/library-feedback";
import { hashId } from "../src/lib/library/utils";
import { captureFailed } from "../src/lib/library/capture-health";

loadEnvConfig(process.cwd());

/**
 * The Library v2 minimum-viable scorecard (docs/plans/library-v2.md): computes all seven metrics from
 * live data and prints JSON (+ a markdown table with --markdown). Cheap — no model calls; the judge
 * numbers read the stored judgments from scripts/library-judge-sample.ts / reweave stamps.
 *
 *   DATA_DIR=~/.hilt/data npx tsx scripts/library-metrics.ts --markdown
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const asMarkdown = args.includes("--markdown");
const baseUrl = process.env.HILT_BASE_URL || "http://localhost:3000";

const TIER_FOR_TERCILE: Record<string, string> = { top: "high", middle: "medium", bottom: "low" };

interface StoredJudgment {
  tier: "high" | "medium" | "low";
  tercile_at_judgment: "top" | "middle" | "bottom";
}

function readJudgments(): Record<string, StoredJudgment> {
  const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "library-judgments", `${hashId(path.resolve(vaultPath), 16)}.json`);
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return {}; }
}

async function timeRequest(url: string): Promise<number | null> {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    await response.text();
    return Date.now() - started;
  } catch {
    return null;
  }
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main(): Promise<void> {
  // --- Metric 1 + 2: judge agreement and For You precision ---
  const judgments = Object.entries(readJudgments());
  const exact = judgments.filter(([, j]) => TIER_FOR_TERCILE[j.tercile_at_judgment] === j.tier).length;
  const agreement = judgments.length ? Number((exact / judgments.length).toFixed(3)) : null;

  type ScoredItem = ReturnType<typeof evaluateLibrary>[number] & { content?: string; raw_frontmatter?: Record<string, unknown> };
  const evaluated: ScoredItem[] = evaluateLibrary(vaultPath).sort((a, b) => (b.worth || 0) - (a.worth || 0));
  // Metric 2 judges the feed the user actually SEES (the served funnel output), not a hypothetical
  // worth-sorted list. Dual counting: not-low (the target rule) and high-only (the stricter read).
  const served = getRecommendations(vaultPath, 8).items;
  const judgedPicks = served.map((pick) => readJudgments()[pick.id]).filter(Boolean);
  const precision = judgedPicks.length
    ? `${judgedPicks.filter((j) => j.tier !== "low").length}/${judgedPicks.length} not-low · ${judgedPicks.filter((j) => j.tier === "high").length}/${judgedPicks.length} high (${served.length - judgedPicks.length} unjudged)`
    : null;

  // --- Metric 3 + 4: rescue rate and open rate (event log) ---
  const events = readLibraryEvents(vaultPath);
  const rescued = events.filter((e) => e.type === "rescued").length;
  // Only archives that CONFIRM a to_archive flag count toward the trust metric — a plain manual
  // archive of an unflagged item says nothing about the eval's judgment.
  const archiveConfirmed = events.filter((e) => e.type === "archived_confirmed" && e.meta?.to_archive_flagged === true).length;
  const rescueRate = rescued + archiveConfirmed > 0 ? Number((rescued / (rescued + archiveConfirmed)).toFixed(3)) : null;

  const servedForYou = new Set(events.filter((e) => e.type === "served" && e.surface === "for_you").map((e) => e.artifact_id));
  const servedFeed = new Set(events.filter((e) => e.type === "served" && e.surface === "feed").map((e) => e.artifact_id));
  const opened = new Set(events.filter((e) => e.type === "opened" || e.type === "read").map((e) => e.artifact_id));
  const openRate = (served: Set<string>): number | null => served.size
    ? Number(([...served].filter((id) => opened.has(id)).length / served.size).toFixed(3))
    : null;

  // --- Metric 5: feedback latency / unprocessed ---
  const comments = listStoredFeedback(vaultPath).flatMap((entry) => entry.comments);
  const unprocessed = comments.filter((c) => !c.processed_at);
  const oldestUnprocessedDays = unprocessed.length
    ? Number(((Date.now() - Math.min(...unprocessed.map((c) => Date.parse(c.created_at)))) / 86_400_000).toFixed(1))
    : 0;
  // Latency = comment -> clustered-into-a-proposal (the loop's job); processed_at is the USER's
  // approval and measures them, not the system.
  const stampsFile = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "library-steering", `${hashId(path.resolve(vaultPath), 16)}.json`);
  let clusteredStamps: Record<string, string> = {};
  try { clusteredStamps = JSON.parse(fs.readFileSync(stampsFile, "utf-8")); } catch { /* none yet */ }
  const latencies = comments
    .map((c) => (c.processed_at || clusteredStamps[c.id] ? (Date.parse(clusteredStamps[c.id] || c.processed_at!) - Date.parse(c.created_at)) / 3_600_000 : null))
    .filter((h): h is number => h !== null && Number.isFinite(h) && h >= 0);
  const medianProcessHours = latencies.length ? Number(percentile(latencies, 50)?.toFixed(1)) : null;

  // --- Metric 6: weave completeness (study items: current version + healthy capture) ---
  const study = evaluated;
  // UNION of failure modes (an item can be both degraded and source-less — never double-count),
  // plus the spec's version-currency clause.
  let degraded = 0;
  let noSource = 0;
  let versionBehind = 0;
  const incomplete = study.filter((item) => {
    const fm = (item.raw_frontmatter || {}) as Record<string, unknown>;
    const isDegraded = fm.digestion_status === "warm" || fm.digestion_status === "blocked";
    const isNoSource = !item.content || captureFailed({ body: item.content, frontmatter: fm });
    const isBehind = typeof fm.pipeline_version === "string" && !CURRENT_PIPELINE_VERSIONS.has(fm.pipeline_version);
    if (isDegraded) degraded += 1;
    if (isNoSource) noSource += 1;
    if (isBehind) versionBehind += 1;
    return isDegraded || isNoSource || isBehind;
  }).length;
  const completeness = study.length ? Number((1 - incomplete / study.length).toFixed(3)) : null;

  // --- Metric 7: latency ---
  const listTimes: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const t = await timeRequest(`${baseUrl}/api/library?limit=50`);
    if (t !== null) listTimes.push(t);
  }
  const recTime = await timeRequest(`${baseUrl}/api/library/recommendations?limit=8&no_log=1`);

  const scorecard = {
    computed_at: new Date().toISOString(),
    m1_judge_score_agreement: agreement,
    m1_judgments_stored: judgments.length,
    m2_for_you_precision_at_8: precision,
    m3_rescue_rate: rescueRate,
    m3_rescue_events: { rescued, archived_confirmed: archiveConfirmed },
    m4_open_rate_for_you: openRate(servedForYou),
    m4_open_rate_feed_baseline: openRate(servedFeed),
    m4_served: { for_you: servedForYou.size, feed: servedFeed.size },
    m5_feedback_unprocessed: unprocessed.length,
    m5_oldest_unprocessed_days: oldestUnprocessedDays,
    m5_median_process_hours: medianProcessHours,
    m6_weave_completeness: completeness,
    m6_detail: { study_items: study.length, incomplete, degraded_digest: degraded, no_source: noSource, version_behind: versionBehind },
    m7_list_p50_ms: percentile(listTimes, 50),
    m7_list_p95_ms: percentile(listTimes, 95),
    m7_recommendations_ms: recTime,
  };

  if (asMarkdown) {
    const rows = [
      ["1", "Judge–score agreement", agreement === null ? "—" : `${Math.round(agreement * 100)}% (n=${judgments.length})`, "≥80%"],
      ["2", "For You precision@8", precision ?? "—", "≥6/8"],
      ["3", "Rescue rate", rescueRate === null ? "— (no review events)" : `${Math.round(rescueRate * 100)}%`, "<10%"],
      ["4", "For You open rate", scorecard.m4_open_rate_for_you === null ? `— (served ${servedForYou.size})` : String(scorecard.m4_open_rate_for_you), "baseline → 2× feed"],
      ["5", "Feedback unprocessed / oldest", `${unprocessed.length} / ${oldestUnprocessedDays}d`, "0 / <1d"],
      ["6", "Weave completeness", completeness === null ? "—" : `${Math.round(completeness * 100)}%`, ">97%"],
      ["7", "p50 list latency", scorecard.m7_list_p50_ms === null ? "— (server down)" : `${scorecard.m7_list_p50_ms}ms`, "<50ms"],
    ];
    console.log(`| # | Metric | Current | Target |\n|---|--------|---------|--------|\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`);
  }
  console.log(JSON.stringify(scorecard, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
