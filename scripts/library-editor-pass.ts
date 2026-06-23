import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { buildForYouPool, editorPicksPath, type EditorPick } from "../src/lib/library/recommendations";
import { buildKbIndex } from "../src/lib/library/kb-index";
import { detectRateLimitInEnvelope, extractModelText, resolveClaudeBin, runClaude } from "../src/lib/library/connections";

loadEnvConfig(process.cwd());

/**
 * The For You editor pass (Library v2, Workstream 4, stage 2): the LLM as heavy ranker. Once a day
 * (the 07:25 launchd job) it reads the cheap worth-ranked pool and makes the final picks WITH STATED
 * REASONS — the strings the UI shows, so no pick is ever unexplained. One light non-agentic call;
 * the picks cache is what /api/library/recommendations serves (replacing the old job that computed a
 * ranking into a log nothing read). Rate-limit-aware: on a closed window it exits 0 without touching
 * the cache — serving falls back to yesterday's picks (≤30h) or the deterministic funnel.
 *
 *   DATA_DIR=~/.hilt/data npx tsx scripts/library-editor-pass.ts
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const timeoutMs = Number(process.env.LIBRARY_EDITOR_TIMEOUT_MS || 180_000);
if (!Number.isFinite(timeoutMs)) { console.error("Invalid LIBRARY_EDITOR_TIMEOUT_MS."); process.exit(64); }

async function main(): Promise<void> {
  const { pool, config } = buildForYouPool(vaultPath);
  if (!pool.length) { console.log(JSON.stringify({ skipped: "empty pool" })); return; }
  const pickCount = Math.max(1, config.for_you.max_items - config.for_you.exploration_slots);

  const itemBlocks = pool.map((item) => [
    `ID: ${item.id}`,
    `Title: ${item.title}`,
    `Worth: ${item.worth} (${item.why})`,
    `Source: ${item.source_name || item.source_id}`,
    item.summary ? `Summary: ${item.summary.slice(0, 350)}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");

  const task = [
    "You are the EDITOR for Justin's reference library feed. Below: an index of his active work, then",
    `the ${pool.length} candidates the cheap ranking surfaced. Pick the ${pickCount} most worth his`,
    "limited attention RIGHT NOW, ordered best-first. Rules:",
    "- Judge value to HIS practice (the index), not general interest.",
    "- HARD RULE: at most 2 picks per source — extras are dropped at serve time and waste a slot.",
    "- Prefer topical and source diversity over five takes on one story.",
    "- The worth score is advisory — overrule it freely; that is your job.",
    "- Each pick carries a one-line reason written TO Justin, specific to his work (names a project or",
    "  strand) — never generic praise. The reason is shown in his UI.",
    "Return ONLY JSON: { \"picks\": [ { \"id\": \"<id>\", \"reason\": \"<one line>\" } ] }",
    "",
    "=== INDEX OF JUSTIN'S WORK ===",
    buildKbIndex(vaultPath, { noWrite: true }),
    "",
    "=== CANDIDATES ===",
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
    if (detectRateLimitInEnvelope(e?.stdout || "").limited || /usage limit|rate.?limit/i.test(e?.stderr || "")) {
      console.log(JSON.stringify({ skipped: "rate_limited" }));
      return;
    }
    // A transient API failure (e.g. a 401 from an OAuth refresh race — seen 2026-06-10 07:25, and the
    // launchd Keychain-access 401 on 2026-06-20) is BENIGN here: serving falls back to yesterday's
    // cache (≤30h) then the deterministic funnel. Exit clean with a compact note instead of dumping
    // the whole prompt to stderr and ambering the health panel for a designed-for miss. The 401
    // envelope arrives is_error:true with the code in the result string ("API Error: 401 …"), often
    // WITHOUT an api_error_status field — match both shapes so this path can't fall through to throw.
    const out = e?.stdout || "";
    const statusMatch = out.match(/"api_error_status":(\d+)/) || out.match(/API Error:\s*(\d+)/);
    if (statusMatch || /"is_error":\s*true/.test(out)) {
      console.log(JSON.stringify({ skipped: "api_error", status: statusMatch ? Number(statusMatch[1]) : null }));
      return;
    }
    throw error;
  }
  if (detectRateLimitInEnvelope(stdout).limited) { console.log(JSON.stringify({ skipped: "rate_limited" })); return; }
  // Exit-0 envelopes can also carry is_error (the CLI succeeded at running, the API call failed).
  try {
    const parsedEnvelope = JSON.parse(stdout.trim()) as { is_error?: boolean; api_error_status?: number };
    if (parsedEnvelope?.is_error === true) {
      console.log(JSON.stringify({ skipped: "api_error", status: parsedEnvelope.api_error_status ?? null }));
      return;
    }
  } catch { /* not an envelope — let the pick parser decide */ }

  const text = extractModelText(stdout);
  let picks: EditorPick[];
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text) as { picks?: Array<{ id?: unknown; reason?: unknown }> };
    const poolIds = new Set(pool.map((item) => item.id));
    picks = (parsed.picks || [])
      .filter((pick): pick is { id: string; reason?: string } => typeof pick.id === "string" && poolIds.has(pick.id))
      .map((pick) => ({ id: pick.id, reason: typeof pick.reason === "string" ? pick.reason.trim() : "" }))
      .slice(0, pickCount);
  } catch {
    console.error("Editor pass returned unparseable output; cache left untouched.");
    process.exit(1);
  }
  if (!picks.length) { console.error("Editor pass picked nothing valid; cache left untouched."); process.exit(1); }

  const cachePath = editorPicksPath(vaultPath);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, `${JSON.stringify({ generated_at: new Date().toISOString(), picks }, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify({ picks: picks.length, pool: pool.length, cache: cachePath }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
