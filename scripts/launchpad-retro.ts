import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { generateBriefing } from "../src/lib/briefing/generate";

loadEnvConfig(process.cwd());

/**
 * Launchpad retro runner (Briefings v2, Phase 4 — scope §10): generate AS-OF briefings for
 * historical dates into the sandbox, alongside the raw gather trace each was built from, so the
 * grading pass can judge output against exactly the inputs the model saw.
 *
 * Everything lands under $DATA_DIR/launchpad/<date>/:
 *   gather.txt    — the as-of gathered data (the grading trace)
 *   briefing.md   — the generated briefing (validated; invalid drafts land as briefing.md.invalid-draft)
 *   result.json   — the structured GenerateResult
 *
 *   npx tsx scripts/launchpad-retro.ts --dates 2026-05-12,2026-05-19,...   # explicit list
 *   npx tsx scripts/launchpad-retro.ts --weekly-back 8                     # one Tuesday per week, 8 weeks
 *
 * NEVER touches the vault: outputOverride forces the no-commit path by construction.
 */
const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || "/Users/jruck/work/bridge";
const hiltRepoPath = process.cwd();
const launchpadDir = path.join(process.env.DATA_DIR || "data", "launchpad");

function weeklyDates(back: number): string[] {
  // One representative WEEKDAY per week (Tuesdays: mid-week signal, avoids Monday memo-freshness
  // special case and Friday thinness), most recent complete week first.
  const dates: string[] = [];
  const now = new Date();
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() + 5) % 7)); // this week's Tuesday (day 2)
  for (let i = 0; i < back; i++) {
    d.setDate(d.getDate() - 7);
    dates.push(d.toLocaleDateString("en-CA"));
  }
  return dates.reverse();
}

async function main(): Promise<void> {
  const dates = argValue("--dates")?.split(",").map((s) => s.trim()).filter(Boolean)
    || weeklyDates(Number(argValue("--weekly-back") || 8));

  const results: Array<{ date: string; status: string; bytes?: number; failures?: string[] }> = [];
  for (const date of dates) {
    const dayDir = path.join(launchpadDir, date);
    fs.mkdirSync(dayDir, { recursive: true });
    const result = await generateBriefing({
      vaultPath,
      hiltRepoPath,
      mode: "daily",
      date,
      outputOverride: path.join(dayDir, "briefing.md"),
      asOf: true,
      gatherDumpPath: path.join(dayDir, "gather.txt"),
    });
    fs.writeFileSync(path.join(dayDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf-8");
    results.push({
      date,
      status: result.status,
      ...(result.status !== "rate_limited" ? { bytes: result.validation.bytes, failures: result.validation.failures } : {}),
    });
    console.error(`[retro] ${date}: ${result.status}${result.status !== "rate_limited" ? ` (${result.validation.bytes}B)` : ""}`);
    if (result.status === "rate_limited") break; // stop the sweep; resume later
  }
  console.log(JSON.stringify({ launchpad: launchpadDir, results }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
