import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { resolveClaudeBin, runClaude, extractModelText, detectRateLimitInEnvelope } from "@/lib/library/connections";
import { atomicWriteFile } from "@/lib/library/utils";
import { resolveBriefingTarget, type BriefingMode, type BriefingTarget } from "./target-file";
import { buildBriefingPrompt } from "./prompt";
import { validateBriefing, type ValidationResult } from "./validator";
import { commitBriefing } from "./vault-commit";

const execFileAsync = promisify(execFile);

export interface GenerateOptions {
  vaultPath: string;
  hiltRepoPath: string;
  mode: BriefingMode;
  /** Base date (YYYY-MM-DD); defaults to today (local). */
  date?: string;
  /** Write somewhere other than the canonical vault path (shadow/scratch). Disables commit. */
  outputOverride?: string | null;
  /** Commit+push the result (ignored when outputOverride is set). Default true. */
  commit?: boolean;
  model?: string;
  /** Launchpad/backtest: sets BRIEFING_AS_OF=1 so the gatherer suppresses live-only sources
   *  (reminders, session/area mtimes, source-state) and bounds everything to `date`. */
  asOf?: boolean;
  /** Briefings v2 reader: sets BRIEFING_LOOPS=1 so the gatherer includes loop artifacts (the
   *  shadow-v2 variant during the Phase 8 shadow period; flips live at cutover). */
  loops?: boolean;
  /** When set, the raw gathered data is also written here (the grading trace). */
  gatherDumpPath?: string;
}

export type GenerateResult =
  | { status: "rate_limited" }
  | {
      status: "invalid";
      target: BriefingTarget;
      validation: ValidationResult;
      draftPath: string;
    }
  | {
      status: "ok";
      target: BriefingTarget;
      validation: ValidationResult;
      committed: boolean;
      pushed: boolean;
      note?: string;
    };

const GATHER_REL = "meta/skills/briefing/scripts/gather.sh";
const SKILL_REL = "meta/skills/briefing/SKILL.md";

type BriefingRunRecordStatus = "ok" | "invalid" | "rate_limited";

interface BriefingRunRecord {
  date: string;
  mode: BriefingMode;
  run_at: string;
  status: BriefingRunRecordStatus;
  failures: string[];
  draft_path?: string;
  committed?: boolean;
  pushed?: boolean;
}

function writeRunRecord(
  opts: GenerateOptions,
  target: BriefingTarget,
  record: Omit<BriefingRunRecord, "date" | "mode" | "run_at">,
): void {
  if (opts.outputOverride) return;
  const filePath = path.join(process.env.DATA_DIR || "data", "briefing-runs", `${target.targetDate}.json`);
  atomicWriteFile(filePath, `${JSON.stringify({
    date: target.targetDate,
    mode: target.mode,
    run_at: new Date().toISOString(),
    ...record,
  }, null, 2)}\n`);
}

/** Run the vault gatherer for the mode/date, returning its `# GATHERED DATA …` stdout. */
async function runGather(opts: GenerateOptions, baseDate: string): Promise<string> {
  const gatherScript = path.join(opts.vaultPath, GATHER_REL);
  // The gatherer shells out to `tsx …/briefing-goal-context.ts`; tsx isn't on the global PATH, so
  // prepend Hilt's node_modules/.bin (parity-verification finding) — else the North Stars block
  // silently degrades to the fallback.
  const PATH = `${path.join(opts.hiltRepoPath, "node_modules", ".bin")}:${process.env.PATH || ""}`;
  const { stdout } = await execFileAsync("bash", [gatherScript], {
    cwd: opts.vaultPath,
    env: {
      ...process.env, PATH,
      BRIEFING_MODE: opts.mode, BRIEFING_DATE: baseDate, BRIEFING_HILT_REPO_PATH: opts.hiltRepoPath,
      ...(opts.asOf ? { BRIEFING_AS_OF: "1" } : {}),
      ...(opts.loops ? { BRIEFING_LOOPS: "1" } : {}),
    },
    timeout: 120_000,
    maxBuffer: 1024 * 1024 * 32,
  });
  if (opts.gatherDumpPath) {
    fs.mkdirSync(path.dirname(opts.gatherDumpPath), { recursive: true });
    fs.writeFileSync(opts.gatherDumpPath, stdout, "utf-8");
  }
  return stdout;
}

function stripFences(text: string): string {
  const t = text.trim();
  const fenced = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return (fenced ? fenced[1] : t).trim();
}

export async function generateBriefing(opts: GenerateOptions): Promise<GenerateResult> {
  const baseDate = opts.date || new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local tz
  const target = resolveBriefingTarget(opts.vaultPath, opts.mode, baseDate, opts.outputOverride);

  const gathered = await runGather(opts, baseDate);
  const skill = fs.readFileSync(path.join(opts.vaultPath, SKILL_REL), "utf-8");
  const prompt = buildBriefingPrompt(opts.mode, skill, gathered);

  // The briefing model gets NO tools — the gather is inlined in the prompt and the HARNESS
  // writes the file (validation-gated). Without this, the model can act on the SKILL's
  // Hermes-era file instructions: on 2026-07-02 a shadow regeneration WROTE THE LIVE VAULT
  // BRIEFING directly and returned only commentary (caught same night; vault restored).
  const args = ["-p", prompt, "--output-format", "json", "--tools", ""];
  const model = opts.model || process.env.LIBRARY_CONNECTIONS_MODEL;
  if (model) args.push("--model", model);

  let stdout: string;
  try {
    stdout = await runClaude(resolveClaudeBin(), args, 420_000, opts.vaultPath);
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    if (detectRateLimitInEnvelope(e?.stdout || "").limited || /usage limit|rate.?limit/i.test(e?.stderr || "")) {
      writeRunRecord(opts, target, {
        status: "rate_limited",
        failures: ["Claude rate limit while generating briefing"],
      });
      return { status: "rate_limited" };
    }
    throw new Error(`claude briefing call failed: ${(e?.message || String(error)).slice(0, 300)}`);
  }
  if (detectRateLimitInEnvelope(stdout).limited) {
    writeRunRecord(opts, target, {
      status: "rate_limited",
      failures: ["Claude rate limit while generating briefing"],
    });
    return { status: "rate_limited" };
  }

  const markdown = stripFences(extractModelText(stdout));
  const validation = validateBriefing(markdown, opts.mode);

  if (!validation.pass) {
    // Don't publish a structurally-broken briefing; write a draft alongside for inspection.
    const draftPath = `${target.absPath}.invalid-draft`;
    fs.mkdirSync(path.dirname(draftPath), { recursive: true });
    fs.writeFileSync(draftPath, markdown, "utf-8");
    writeRunRecord(opts, target, {
      status: "invalid",
      failures: validation.failures,
      draft_path: draftPath,
    });
    return { status: "invalid", target, validation, draftPath };
  }

  fs.mkdirSync(path.dirname(target.absPath), { recursive: true });
  fs.writeFileSync(target.absPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf-8");
  // A successful write supersedes any earlier failed attempt from the same morning — clean up the
  // stale .invalid-draft sibling so rejected drafts don't accumulate in the synced vault.
  fs.rmSync(`${target.absPath}.invalid-draft`, { force: true });

  const shouldCommit = (opts.commit ?? true) && !opts.outputOverride;
  if (!shouldCommit) {
    writeRunRecord(opts, target, {
      status: "ok",
      failures: [],
      committed: false,
      pushed: false,
    });
    return { status: "ok", target, validation, committed: false, pushed: false };
  }

  const c = await commitBriefing(opts.vaultPath, target.relPath, `Briefing — ${target.targetDate} (${opts.mode})`);
  writeRunRecord(opts, target, {
    status: "ok",
    failures: [],
    committed: c.committed,
    pushed: c.pushed,
  });
  return { status: "ok", target, validation, committed: c.committed, pushed: c.pushed, note: c.note };
}
