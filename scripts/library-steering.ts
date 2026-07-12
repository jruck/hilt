import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadEnvConfig } from "@next/env";
import { listStoredFeedback, recordClusteredFeedback } from "../src/lib/library/library-feedback";
import { getLibraryArtifact } from "../src/lib/library/library";
import { evalAttrsForArtifact } from "../src/lib/library/recommendations";
import { buildKbIndex } from "../src/lib/library/kb-index";
import { detectRateLimitInEnvelope, extractModelText, resolveClaudeBin, runClaude } from "../src/lib/library/connections";
import { hashId, isoNow } from "../src/lib/library/utils";
import { emitLoopArtifact } from "../src/lib/loops/emit";
import { loadRegistry } from "../src/lib/loops/registry";
import type { LoopItem } from "../src/lib/loops/types";
import { libraryBriefingHealthSummary } from "../src/lib/library/briefing-health";

loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);

/**
 * The steering loop (Library v2, Workstream 1): the scheduled run that makes the library report its
 * own learning. Each run:
 *   1. computes the 7-metric scorecard (scripts/library-metrics.ts),
 *   2. clusters any UNPROCESSED feedback into root-cause patterns with fix proposals (one light,
 *      non-agentic Claude call — skipped cleanly when the window is closed or there is no feedback),
 *   3. surfaces the top judge↔formula disagreements (the calibration backlog),
 *   4. writes the MORNING REPORT as the library loop artifact at
 *      meta/loops/references/reports/YYYY-MM-DD.md (single-write — the legacy
 *      meta/library-reports/ copy is history only, kept readable via fallback).
 *
 * It NEVER applies changes: proposals wait for the user's more/less/rollback verdict (the
 * /process-library-feedback protocol stamps processed_at after approved implementation). Scheduled
 * nightly at 05:10 after the reweave drain; also runnable manually:
 *
 *   DATA_DIR=~/.hilt/data npx tsx scripts/library-steering.ts
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const timeoutMs = Number(process.env.LIBRARY_STEERING_TIMEOUT_MS || 180_000);

interface StoredJudgment {
  tier: "high" | "medium" | "low";
  reason: string;
  worth_at_judgment: number;
  tercile_at_judgment: "top" | "middle" | "bottom";
  title: string;
}

const TIER_FOR_TERCILE: Record<string, string> = { top: "high", middle: "medium", bottom: "low" };
const TIER_ORDER = ["low", "medium", "high"];

function readJudgments(): Record<string, StoredJudgment> {
  const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "library-judgments", `${hashId(path.resolve(vaultPath), 16)}.json`);
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return {}; }
}

/** clustered_at stamps, separate from processed_at: "proposed in a report" vs "actioned by the user".
 *  Skipping already-clustered comments keeps the loop from burning a Claude call every night
 *  re-proposing the same feedback (Principle 4), and metric 5's latency reads from these stamps. */
function clusteredStampsPath(): string {
  const dir = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "library-steering");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${hashId(path.resolve(vaultPath), 16)}.json`);
}

function readClusteredStamps(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(clusteredStampsPath(), "utf-8")); } catch { return {}; }
}

function writeClusteredStamps(stamps: Record<string, string>): void {
  fs.writeFileSync(clusteredStampsPath(), `${JSON.stringify(stamps, null, 2)}\n`, "utf-8");
}

async function computeScorecard(): Promise<{ json: Record<string, unknown>; markdown: string } | null> {
  try {
    const tsxBin = fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx";
    const prefix = tsxBin === "npx" ? ["tsx"] : [];
    const { stdout } = await execFileAsync(tsxBin, [...prefix, "scripts/library-metrics.ts", "--markdown", "--vault", vaultPath], {
      env: process.env, maxBuffer: 1024 * 1024 * 4, timeout: 240_000,
    });
    const jsonStart = stdout.indexOf("{");
    return {
      markdown: stdout.slice(0, jsonStart).trim(),
      json: JSON.parse(stdout.slice(jsonStart)) as Record<string, unknown>,
    };
  } catch (error) {
    console.error("[steering] scorecard failed:", error instanceof Error ? error.message.slice(0, 300) : error);
    return null;
  }
}

interface FeedbackCluster {
  root_cause: string;
  items: string[];
  proposal: { type: "logic" | "data" | "unknown"; description: string; blast_radius: string };
}

async function clusterFeedback(unprocessed: Array<{ id: string; text: string; created_at: string }>): Promise<FeedbackCluster[] | "rate_limited" | null> {
  const kbIndex = buildKbIndex(vaultPath, { noWrite: true });
  const itemBlocks = unprocessed.map((comment) => {
    const artifact = getLibraryArtifact(vaultPath, comment.id);
    const evalAttrs = artifact ? evalAttrsForArtifact(vaultPath, artifact) : null;
    return [
      `ITEM ${comment.id}: ${artifact?.title || "(unknown item)"}`,
      `User feedback (${comment.created_at}): ${comment.text}`,
      evalAttrs ? `Current eval: worth=${evalAttrs.worth} relevance=${evalAttrs.relevance} substance=${evalAttrs.substance} lifecycle=${evalAttrs.lifecycle}` : "Current eval: (unavailable)",
      artifact?.summary ? `Summary: ${artifact.summary.slice(0, 500)}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const task = [
    "You are the steering analyst for Justin's reference library eval. Below: an index of his work,",
    "then user feedback comments on library items the eval mis-handled. Cluster the comments by ROOT",
    "CAUSE (not per-item), and for each cluster propose ONE fix, classified:",
    "- type \"logic\": a scoring-constant/threshold/code change (re-scores are free)",
    "- type \"data\": re-grade/re-extract/reweave specific items (costs model calls)",
    "Estimate blast radius honestly (how many items a change touches). Do NOT propose implementing —",
    "these go to Justin for approval. Return ONLY JSON:",
    '{ "clusters": [ { "root_cause": "<one line>", "items": ["<id>"], "proposal": { "type": "logic|data", "description": "<concrete change>", "blast_radius": "<honest estimate>" } } ] }',
    "",
    "=== INDEX OF JUSTIN'S WORK ===",
    kbIndex,
    "",
    "=== FEEDBACK ===",
    itemBlocks,
  ].join("\n");

  const cliArgs = ["-p", task, "--output-format", "json"];
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
  try {
    const text = extractModelText(stdout);
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text) as { clusters?: FeedbackCluster[] };
    return Array.isArray(parsed.clusters) ? parsed.clusters : null;
  } catch {
    return null;
  }
}

function topDisagreements(judgments: Record<string, StoredJudgment>, limit = 5): string[] {
  return Object.entries(judgments)
    .map(([id, j]) => ({ id, j, gap: Math.abs(TIER_ORDER.indexOf(TIER_FOR_TERCILE[j.tercile_at_judgment]) - TIER_ORDER.indexOf(j.tier)) }))
    .filter((d) => d.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, limit)
    .map((d) => `- **${d.j.title.slice(0, 70)}** — formula says ${d.j.tercile_at_judgment} tercile (worth ${d.j.worth_at_judgment}), judge says **${d.j.tier}**: ${d.j.reason || "(no reason)"}`);
}

async function main(): Promise<void> {
  // LOCAL date, not UTC: an evening run after 8pm EDT would otherwise stamp tomorrow's date and the
  // next morning's scheduled run would silently overwrite it.
  const today = new Date().toLocaleDateString("sv-SE");

  const scorecard = await computeScorecard();
  const judgments = readJudgments();
  const disagreements = topDisagreements(judgments);

  const allFeedback = listStoredFeedback(vaultPath);
  const stamps = readClusteredStamps();
  const allUnprocessed = allFeedback.flatMap((entry) => entry.comments.filter((c) => !c.processed_at).map((c) => ({ id: entry.id, comment_id: c.id, text: c.text, created_at: c.created_at })));
  const unprocessed = allUnprocessed.filter((c) => !stamps[c.comment_id]);
  const alreadyProposed = allUnprocessed.length - unprocessed.length;

  let clusters: FeedbackCluster[] | "rate_limited" | null = null;
  if (unprocessed.length) {
    clusters = await clusterFeedback(unprocessed);
    if (clusters && clusters !== "rate_limited") {
      const now = isoNow();
      for (const comment of unprocessed) stamps[comment.comment_id] = now;
      writeClusteredStamps(stamps);
      // Thread receipt (v3 unit C3): each clustered thread gets a visible agent reply +
      // "clustered" resolution; processed_at stays owned by /process-library-feedback.
      // Best-effort — a receipt failure must never fail the steering run.
      try {
        const byArtifact = new Map<string, string[]>();
        for (const comment of unprocessed) {
          byArtifact.set(comment.id, [...(byArtifact.get(comment.id) || []), comment.comment_id]);
        }
        recordClusteredFeedback(vaultPath, Array.from(byArtifact, ([id, commentIds]) => ({ id, commentIds })), today);
      } catch (error) {
        console.error("[steering] clustered-thread receipt failed:", error instanceof Error ? error.message.slice(0, 200) : error);
      }
    }
  }

  const lines: string[] = [
    `# Library Morning Report — ${today}`,
    "",
    "_Written by the steering loop (scripts/library-steering.ts). Nothing below was auto-applied;_",
    "_every proposal waits for your verdict: **more of this / less of this / roll it back**._",
    "",
    "## Scorecard",
    "",
    scorecard?.markdown || "_(scorecard unavailable this run)_",
    "",
    "## Feedback awaiting your approval",
    "",
  ];

  if (!allUnprocessed.length) {
    lines.push("No unprocessed feedback. Leave comments on any library item and they'll be analyzed here.");
  } else if (!unprocessed.length) {
    lines.push(`${alreadyProposed} comment(s) already clustered in a prior report — awaiting your verdict (run /process-library-feedback or approve in conversation).`);
  } else if (clusters === "rate_limited") {
    lines.push(`${unprocessed.length} unprocessed comment(s); the Claude window was closed this run — they'll be clustered next run.`);
  } else if (!clusters) {
    lines.push(`${unprocessed.length} unprocessed comment(s); clustering failed this run — they'll be retried next run.`);
  } else {
    for (const cluster of clusters) {
      lines.push(`### ${cluster.root_cause}`);
      lines.push(`- Items: ${cluster.items.join(", ")}`);
      lines.push(`- Proposed fix (**${cluster.proposal.type}**): ${cluster.proposal.description}`);
      lines.push(`- Blast radius: ${cluster.proposal.blast_radius}`);
      lines.push("");
    }
    lines.push("_Approve by telling Claude (e.g. \"apply proposal 1\") or run /process-library-feedback._");
  }

  lines.push("", "## Judge ↔ formula disagreements (calibration backlog)", "");
  if (disagreements.length) lines.push(...disagreements);
  else lines.push(Object.keys(judgments).length ? "None — judge and formula agree on everything judged so far." : "No judgments stored yet (run scripts/library-judge-sample.ts).");

  lines.push(
    "",
    "## Changes applied this run",
    "",
    "None — the loop only proposes. Approved changes land with a `meta/library-scoring.json` version bump and a `docs/eval-labels.md` ledger entry.",
    "",
  );

  // Remote surface: render the latest report to ~/.hilt/reports/morning/ so it's always viewable at
  // https://<machine>.<tailnet>.ts.net/api/reports/morning (GET /api/reports/:name). The vault copy
  // is now the loop artifact (YAML frontmatter report-html.ts would render literally), so render
  // from a plain markdown scratch copy. Best-effort — a render failure must never fail the steering
  // run itself.
  try {
    const renderSrc = path.join(os.tmpdir(), `hilt-morning-report-${today}.md`);
    fs.writeFileSync(renderSrc, `${lines.join("\n")}\n`, "utf-8");
    const tsxBin = fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx";
    const prefix = tsxBin === "npx" ? ["tsx"] : [];
    await execFileAsync(tsxBin, [...prefix, "scripts/report-html.ts", "--md", renderSrc, "--out", path.join(process.env.HOME || "~", ".hilt", "reports", "morning", "index.html"), "--title", "Library Morning Report"], { env: process.env, timeout: 60_000 });
  } catch (error) {
    console.error("[steering] report render failed:", error instanceof Error ? error.message.slice(0, 200) : error);
  }

  // ── The morning report's ONE vault write: the contract-shaped loop artifact (scope §3.2) ─────
  // The library is loop #1. Its content dimension = the report sections above; escalations =
  // proposal items awaiting Justin's verdict (steering's clusters, now with STABLE minted ids —
  // fixing R-lib "proposals have no structured store"); health = the scorecard the run previously
  // discarded. Writes through the WRITE GUARD: while the registry says phase:shadow this lands in
  // the sandbox ($DATA_DIR/loops-shadow); phase:live puts it at meta/loops/references/reports/.
  // Best-effort: conformance failure must never fail steering (the HTML remote surface above still
  // rendered), but with the legacy meta/library-reports/ write retired a failure here means no
  // vault copy this run — watch stderr.
  let loopArtifactPath: string | null = null;
  try {
    const registry = loadRegistry(vaultPath);
    const loop = registry.loops.find((l) => l.id === "library");
    if (loop && loop.enabled) {
      const items: LoopItem[] = [];
      if (clusters && clusters !== "rate_limited") {
        clusters.forEach((cluster, i) => {
          items.push({
            id: `lib-prop-${today}-${i + 1}`,
            loop: loop.id,
            kind: "proposal",
            title: cluster.root_cause,
            detail: `Proposed fix (${cluster.proposal.type}): ${cluster.proposal.description}\nBlast radius: ${cluster.proposal.blast_radius}`,
            citations: cluster.items.map((id) => {
              const artifact = getLibraryArtifact(vaultPath, id);
              return { source: artifact?.path || `library:${id}` };
            }),
            escalated: { reason: "steering proposal awaiting your verdict" },
            confidence: 0.7,
            allowed_verdicts: ["approve", "dismiss", "revise"],
          });
        });
      }
      disagreements.forEach((line, i) => {
        items.push({
          id: `lib-disagree-${today}-${i + 1}`,
          loop: loop.id,
          kind: "insight",
          title: line.replace(/^- /, "").slice(0, 140),
          citations: [{ source: "meta/loops/references/reports (judge↔formula calibration backlog)" }],
        });
      });
      const sc = (scorecard?.json || {}) as Record<string, any>;
      const proposalIds = items.filter((i) => i.kind === "proposal").map((i) => i.id);
      loopArtifactPath = emitLoopArtifact({
        vaultPath,
        loop,
        date: today,
        runAt: isoNow(),
        items,
        health: {
          ok: Boolean(scorecard),
          coverage: scorecard ? 1 : 0,
          quality_notes: scorecard
            ? `scorecard: ${JSON.stringify(sc).slice(0, 400)}`
            : "scorecard computation failed this run",
          notes: clusters === "rate_limited"
            ? `${unprocessed.length} comment(s) pending clustering — Claude window closed`
            : `${unprocessed.length} newly clustered, ${alreadyProposed} previously proposed awaiting verdict`,
          proposal_ids: proposalIds,
          briefing_summary: libraryBriefingHealthSummary({ scorecard: scorecard?.json || null, proposalCount: proposalIds.length }),
        },
        contentBody: lines.join("\n"),
      });
    }
  } catch (error) {
    console.error("[steering] loop-artifact emission failed:", error instanceof Error ? error.message.slice(0, 300) : error);
  }

  console.log(JSON.stringify({
    loop_artifact: loopArtifactPath,
    scorecard: scorecard?.json || null,
    unprocessed_feedback: unprocessed.length,
    clusters: clusters === "rate_limited" ? "rate_limited" : clusters?.length ?? 0,
    disagreements: disagreements.length,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
