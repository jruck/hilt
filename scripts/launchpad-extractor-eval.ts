import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { execFile } from "child_process";
import { promisify } from "util";
import { detectRateLimitInEnvelope, extractModelText, resolveClaudeBin, runClaude } from "../src/lib/library/connections";
import { readLedger } from "../src/lib/loops/meeting-ledger";

loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);

/**
 * Extractor eval vs. the frozen gold set (Phase 5 gate; quality bars: implementation plan §4 —
 * precision ≥0.85 vs core∪gray, recall ≥0.75 vs core, catch-phrase recall ≥0.95).
 *
 * Two stages, resumable:
 *  1. EXTRACT: run the real extractor sequentially over all gold meetings into a fresh eval
 *     ledger home ($DATA_DIR/launchpad/extractor-eval/) — sequential so identity resolution is
 *     exercised across recurring meetings.
 *  2. JUDGE: per meeting, one claude call matches extracted entries ↔ gold commitments
 *     (semantic, not string match), emitting pairs + unmatched lists. Results cached per meeting;
 *     re-runs skip judged meetings.
 *  Then compute the metrics + the identity audit (suspected duplicate open entries).
 *
 *   npx tsx scripts/launchpad-extractor-eval.ts [--stage extract|judge|report|all]
 */
const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const stage = argValue("--stage") || "all";
const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || "/Users/jruck/work/bridge";
const evalDir = path.join(process.env.DATA_DIR || "data", "launchpad", process.env.EVAL_HOME_NAME || "extractor-eval");
const goldPath = path.join(vaultPath, "meta/loops/meetings/state/gold-set.json");
const extractionModel = process.env.LOOP_MEETING_MODEL || process.env.LIBRARY_CONNECTIONS_MODEL || "claude-cli-default";
const judgeModel = process.env.LOOP_MEETING_JUDGE_MODEL || "claude-opus-4-8";
const extractorVariant = "two-stage-observation-identity";

interface GoldCommitment { action: string; owner: string; quote: string; confidence: number; source: string; in_next_steps: boolean; due?: string }
interface GoldMeeting { meeting_path: string; commitments: GoldCommitment[] }

function goldMeetings(): GoldMeeting[] {
  const gold = JSON.parse(fs.readFileSync(goldPath, "utf-8"));
  return gold.meetings.map((m: any) => ({
    meeting_path: m.meeting_path.replace(`${vaultPath}/`, ""),
    commitments: m.commitments,
  }));
}

async function stageExtract(): Promise<void> {
  const meetings = goldMeetings().map((m) => m.meeting_path);
  fs.mkdirSync(evalDir, { recursive: true });
  const listPath = path.join(evalDir, "meetings.json");
  fs.writeFileSync(listPath, JSON.stringify(meetings, null, 1), "utf-8");
  // One sequential run over ALL gold meetings — the extractor handles the queue + ledger.
  const { stdout } = await execFileAsync(
    fs.existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "npx",
    [...(fs.existsSync("node_modules/.bin/tsx") ? [] : ["tsx"]), "scripts/loop-meeting-actions.ts",
      "--ledger-home", evalDir, "--meetings-file", listPath, "--max-meetings", String(meetings.length),
      "--date", new Date().toLocaleDateString("en-CA")],
    { env: process.env, maxBuffer: 1024 * 1024 * 32, timeout: 3 * 60 * 60 * 1000 },
  );
  fs.writeFileSync(path.join(evalDir, "extract-run.json"), stdout, "utf-8");
  console.error("[eval] extract stage complete");
}

const JUDGE_SYSTEM = `You judge an extraction eval. Given GOLD commitments (ground truth) and
EXTRACTED entries for the SAME meeting, match them semantically: a match = same underlying
committed work (wording may differ; owner should agree or be compatible with "unclear").
Return ONLY JSON:
{ "matches": [ { "gold_index": 0, "extracted_id": "ma-..." } ],
  "unmatched_gold": [0-based indices], "unmatched_extracted": ["ids"],
  "notes": "<one line on any judgment calls>" }`;

async function stageJudge(): Promise<void> {
  const gold = goldMeetings();
  const ledger = readLedger(evalDir);
  const judgedDir = path.join(evalDir, "judged");
  fs.mkdirSync(judgedDir, { recursive: true });

  for (const gm of gold) {
    const key = gm.meeting_path.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80);
    const outPath = path.join(judgedDir, `${key}.json`);
    if (fs.existsSync(outPath)) continue; // resumable

    const extracted = Object.values(ledger.entries).filter((e) => e.opened_from === gm.meeting_path);
    const task = [
      `MEETING: ${gm.meeting_path}`,
      "",
      "=== GOLD (ground truth) ===",
      ...gm.commitments.map((c, i) => `${i}. [conf ${c.confidence}] (${c.owner}) ${c.action} — "${c.quote.slice(0, 120)}"`),
      "",
      "=== EXTRACTED ===",
      ...(extracted.length ? extracted.map((e) => `${e.id}. (${e.owner}, conf ${e.confidence}) ${e.action} — "${e.citations[0]?.anchor?.slice(0, 120) || ""}"`) : ["(none extracted)"]),
    ].join("\n");

    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "hilt-judge-"));
    const promptPath = path.join(dir, "system.txt");
    fs.writeFileSync(promptPath, JUDGE_SYSTEM, "utf-8");
    try {
      const stdout = await runClaude(resolveClaudeBin(), ["-p", task, "--append-system-prompt-file", promptPath, "--output-format", "json", "--model", judgeModel], 180_000, vaultPath);
      if (detectRateLimitInEnvelope(stdout).limited) { console.error("[eval] rate-limited; resume later"); return; }
      const text = extractModelText(stdout);
      const m = text.match(/\{[\s\S]*\}/);
      fs.writeFileSync(outPath, JSON.stringify({ meeting: gm.meeting_path, ...JSON.parse(m ? m[0] : text) }, null, 1), "utf-8");
      console.error(`[eval] judged ${gm.meeting_path}`);
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      if (detectRateLimitInEnvelope(e?.stdout || "").limited || /rate.?limit|usage limit/i.test(e?.stderr || "")) { console.error("[eval] rate-limited; resume later"); return; }
      console.error(`[eval] judge failed for ${gm.meeting_path}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  console.error("[eval] judge stage complete");
}

function stageReport(): void {
  const gold = goldMeetings();
  const ledger = readLedger(evalDir);
  const judgedDir = path.join(evalDir, "judged");
  let tp = 0, fp = 0, coreTotal = 0, coreMatched = 0;
  const missed: string[] = [];
  const spurious: string[] = [];
  let judgedCount = 0;

  for (const gm of gold) {
    const key = gm.meeting_path.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80);
    const outPath = path.join(judgedDir, `${key}.json`);
    if (!fs.existsSync(outPath)) continue;
    judgedCount += 1;
    const j = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    const matchedGold = new Set<number>((j.matches || []).map((m: any) => m.gold_index));
    const matchedExtracted = new Set<string>((j.matches || []).map((m: any) => m.extracted_id));
    const extracted = Object.values(ledger.entries).filter((e) => e.opened_from === gm.meeting_path);

    gm.commitments.forEach((c, i) => {
      if (c.confidence >= 0.7) {
        coreTotal += 1;
        if (matchedGold.has(i)) coreMatched += 1;
        else missed.push(`${gm.meeting_path} :: ${c.action.slice(0, 90)}`);
      }
    });
    for (const e of extracted) {
      const matchesGold = matchedExtracted.has(e.id);
      if (matchesGold) tp += 1;
      else { fp += 1; spurious.push(`${e.id} :: ${e.action.slice(0, 90)}`); }
    }
  }

  // Identity audit: suspected duplicates among open entries (very similar actions).
  const open = Object.values(ledger.entries);
  const suspects: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3);
  for (let i = 0; i < open.length; i++) {
    for (let k = i + 1; k < open.length; k++) {
      const a = new Set(norm(open[i].action));
      const b = norm(open[k].action);
      const overlap = b.filter((w) => a.has(w)).length / Math.max(1, Math.min(a.size, b.length));
      if (overlap > 0.75) suspects.push(`${open[i].id} ~ ${open[k].id}`);
    }
  }
  const sightings = open.reduce((n, e) => n + e.sightings.length, 0);

  const report = {
    models: { extraction: extractionModel, judge: judgeModel },
    extractor_variant: extractorVariant,
    judged_meetings: judgedCount,
    precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null,
    recall_core: coreTotal ? +(coreMatched / coreTotal).toFixed(3) : null,
    bars: { precision_target: 0.85, recall_target: 0.75 },
    tp, fp, core_total: coreTotal, core_matched: coreMatched,
    identity: { sightings_recorded: sightings, suspected_duplicate_pairs: suspects.length, suspects: suspects.slice(0, 20) },
    missed_core: missed.slice(0, 30),
    spurious: spurious.slice(0, 30),
  };
  fs.writeFileSync(path.join(evalDir, "report.json"), `${JSON.stringify(report, null, 1)}\n`, "utf-8");
  console.log(JSON.stringify(report, null, 2));
}

async function main(): Promise<void> {
  if (stage === "extract" || stage === "all") await stageExtract();
  if (stage === "judge" || stage === "all") await stageJudge();
  if (stage === "report" || stage === "all") stageReport();
}

main().catch((error) => { console.error(error); process.exit(1); });
