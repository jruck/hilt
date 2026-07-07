/**
 * Post-meeting extraction trigger (v3 unit B1).
 *
 * When a meeting ends and its artifacts settle, run the meeting-actions loop for THAT meeting
 * within minutes instead of waiting for the 19:30 nightly. The granola daemon registers
 * `observeGranolaSyncForExtraction` as the post-sync observer (see daemon.ts); each incremental
 * sync cycle then reports every recent meeting doc it saw, and this module:
 *
 *  1. SETTLE-DETECTS per granola_id: a meeting is ready when its vault note has enhanced-notes
 *     content AND its transcript has stopped growing — no growth across N consecutive sync polls
 *     (default 3) spanning at least a minimum quiet window (default 120s). Enhanced-notes-first,
 *     quality over speed (settled decision, v3 scope Phase 2): Granola generates the enhanced
 *     note after the meeting ends, so it is the strongest "meeting is over" signal; the stable
 *     window guards against declaring a mid-meeting lull "settled" during the 5s fast poll.
 *  2. ONCE-GUARDS: a granola_id fires at most once, persisted to
 *     $DATA_DIR/loops/meeting-trigger-state.json so ws-server restarts don't re-fire. Meetings
 *     already in the loop's own processed-meetings.json (the nightly's read-tracking) never fire.
 *  3. SERIALIZES runs: one `scripts/loop-meeting-actions.ts --meetings-file <tmp>` child at a
 *     time (the ledger is single-writer). A meeting settling while a run is active queues behind
 *     it. Deliberately NO --proposals-dir / --ledger-home flags — the loop resolves its ledger
 *     home from the registry phase and its proposal sink from registry `proposal_sink`, exactly
 *     like the nightly. Run failures are logged, never thrown; the 19:30 nightly stays as the
 *     safety net for anything this trigger misses.
 *
 * Gate: HILT_MEETING_TRIGGER (default ON whenever the granola daemon is enabled; "0" disables).
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { atomicWriteFile } from "../library/utils";
import { defaultSandboxDir } from "../loops/emit";
import { loadRegistry, loopHome } from "../loops/registry";
import {
  getGranolaDataDir,
  getGranolaVaultPath,
  getMeetingTriggerRunTimeoutMs,
  getMeetingTriggerSettleMs,
  getMeetingTriggerSettlePolls,
} from "./config";

/** One meeting doc as seen by a single sync cycle (built in sync.ts, doc in hand). */
export interface MeetingObservation {
  granolaId: string;
  /** Vault-relative note path (meetings/YYYY-MM-DD/<file>.md) — the loop's meeting key. */
  meetingPath: string;
  /** Granola's AI panel content is non-empty (the "meeting is over" quality signal). */
  enhancedNotesPresent: boolean;
  /** Transcript growth measure this poll: entry count (0 = no transcript yet). */
  transcriptMeasure: number;
}

export interface TriggerMeetingState {
  meeting_path: string;
  transcript_measure: number;
  /** Consecutive observations (incl. this one) at the current measure. */
  stable_polls: number;
  /** ISO time of the first observation at the current measure. */
  stable_since: string;
  last_observed_at: string;
  /** Once set, this meeting never fires again (survives restarts). */
  fired_at?: string;
  fired_reason?: "settled" | "already-processed";
}

export interface TriggerState {
  version: 1;
  meetings: Record<string, TriggerMeetingState>;
}

export interface SettleConfig {
  /** N consecutive no-growth polls required. */
  settlePolls: number;
  /** Minimum wall-clock ms the transcript must have been stable. */
  minStableMs: number;
}

/** Only meetings this fresh are trigger candidates — older unprocessed ones are the nightly's job. */
export const RECENT_MEETING_DAYS = 2;
const STATE_MAX_AGE_DAYS = 14;

// ---------------------------------------------------------------------------
// Pure: settle detection + once-guard (unit-tested directly)
// ---------------------------------------------------------------------------

/** Fold one observation into the per-meeting settle state. Pure. */
export function observeMeeting(
  prev: TriggerMeetingState | undefined,
  obs: MeetingObservation,
  nowIso: string,
  cfg: SettleConfig,
): { next: TriggerMeetingState; settled: boolean } {
  const changed = !prev || obs.transcriptMeasure !== prev.transcript_measure;
  const next: TriggerMeetingState = {
    ...(prev ?? {}),
    meeting_path: obs.meetingPath,
    transcript_measure: obs.transcriptMeasure,
    stable_polls: changed || !prev ? 1 : prev.stable_polls + 1,
    stable_since: changed || !prev ? nowIso : prev.stable_since,
    last_observed_at: nowIso,
  };
  const stableMs = Date.parse(nowIso) - Date.parse(next.stable_since);
  // Note-only meetings (audio off, imported notes — transcript_measure stays 0) still fire,
  // on a DOUBLED quiet window: enhanced notes are the quality bar (scope: enhanced-notes
  // first), and stable transcript ABSENCE is as settled as a stable transcript (adversarial
  // review — the old `> 0` conjunct silently excluded them from the trigger forever).
  const requiredStableMs = obs.transcriptMeasure > 0 ? cfg.minStableMs : cfg.minStableMs * 2;
  const settled =
    obs.enhancedNotesPresent &&
    next.stable_polls >= cfg.settlePolls &&
    Number.isFinite(stableMs) &&
    stableMs >= requiredStableMs;
  return { next, settled };
}

/** Once-guard + nightly's processed-check. Pure. */
export function shouldFire(
  entry: TriggerMeetingState,
  settled: boolean,
  processedMeetings: ReadonlySet<string>,
): boolean {
  if (entry.fired_at) return false;
  if (!settled) return false;
  return !processedMeetings.has(entry.meeting_path);
}

export function meetingDateFromPath(meetingPath: string): string | null {
  const m = meetingPath.match(/^meetings\/(\d{4}-\d{2}-\d{2})\//);
  return m ? m[1] : null;
}

export function isRecentMeetingPath(meetingPath: string, today: string, recentDays: number): boolean {
  const date = meetingDateFromPath(meetingPath);
  if (!date) return false;
  const ageDays = (Date.parse(today) - Date.parse(date)) / 86_400_000;
  return Number.isFinite(ageDays) && ageDays >= -1 && ageDays <= recentDays;
}

/** Drop entries not observed within maxAgeDays (keeps the state file bounded). Pure. */
export function pruneTriggerState(state: TriggerState, nowIso: string, maxAgeDays = STATE_MAX_AGE_DAYS): TriggerState {
  const cutoff = Date.parse(nowIso) - maxAgeDays * 86_400_000;
  const meetings: Record<string, TriggerMeetingState> = {};
  for (const [id, entry] of Object.entries(state.meetings)) {
    const seen = Date.parse(entry.last_observed_at);
    if (Number.isFinite(seen) && seen >= cutoff) meetings[id] = entry;
  }
  return { version: 1, meetings };
}

// ---------------------------------------------------------------------------
// Serialized runner (queue; ledger single-writer)
// ---------------------------------------------------------------------------

/**
 * Runs batches strictly one at a time. Meetings enqueued while a run is active are collected
 * (deduped) and run as the next batch after the active run finishes. A batch failure is logged
 * and never propagates (the daemon must survive any run outcome).
 */
export class SerialMeetingRunner {
  private pending = new Set<string>();
  private draining: Promise<void> | null = null;

  constructor(private readonly runBatch: (meetingPaths: string[]) => Promise<void>) {}

  enqueue(meetingPaths: string[]): void {
    for (const p of meetingPaths) this.pending.add(p);
    if (this.pending.size > 0 && !this.draining) this.draining = this.drain();
  }

  isActive(): boolean {
    return this.draining !== null;
  }

  /** Resolves once everything queued so far has run (tests / graceful shutdown). */
  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending.size > 0) {
        const batch = [...this.pending];
        this.pending.clear();
        try {
          await this.runBatch(batch);
        } catch (error) {
          console.error("[MeetingTrigger] extraction run failed:", error);
        }
      }
    } finally {
      this.draining = null;
    }
  }
}

// ---------------------------------------------------------------------------
// State IO ($DATA_DIR/loops/meeting-trigger-state.json)
// ---------------------------------------------------------------------------

export function triggerStatePath(): string {
  return path.join(getGranolaDataDir(), "loops", "meeting-trigger-state.json");
}

export function readTriggerState(filePath = triggerStatePath()): TriggerState {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as TriggerState;
    if (parsed && typeof parsed === "object" && parsed.meetings && typeof parsed.meetings === "object") {
      return { version: 1, meetings: parsed.meetings };
    }
  } catch {
    // missing or corrupt → fresh state (worst case a meeting re-fires once; the loop's
    // ledger identity resolution + task_id stamps keep that idempotent-ish)
  }
  return { version: 1, meetings: {} };
}

export function writeTriggerState(state: TriggerState, filePath = triggerStatePath()): void {
  atomicWriteFile(filePath, `${JSON.stringify(state, null, 1)}\n`);
}

/**
 * The nightly loop's read-tracking, resolved EXACTLY like scripts/loop-meeting-actions.ts does:
 * registry phase shadow → $DATA_DIR/loops-shadow/meta/loops/<domain>/state/processed-meetings.json.
 * Returns null when the registry itself can't be resolved (fire nothing this cycle — never risk
 * double-processing on a broken registry); a missing/empty processed file is just "none yet".
 */
function readProcessedMeetings(vaultPath: string): Set<string> | null {
  let home: string;
  try {
    const registry = loadRegistry(vaultPath);
    const loop = registry.loops.find((l) => l.id === "meeting-actions");
    if (!loop) return null;
    home = loop.phase === "live" ? loopHome(vaultPath, loop) : loopHome(defaultSandboxDir(), loop);
  } catch (error) {
    console.error("[MeetingTrigger] registry resolution failed — skipping fire this cycle:", error);
    return null;
  }
  try {
    const raw = fs.readFileSync(path.join(home, "state", "processed-meetings.json"), "utf-8");
    const parsed = JSON.parse(raw) as { processed?: Record<string, string> };
    return new Set(Object.keys(parsed.processed ?? {}));
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Child-process batch runner
// ---------------------------------------------------------------------------

function resolveRunnerCwd(): string | null {
  const candidates = [process.env.HILT_REPO_ROOT, process.cwd()].filter((d): d is string => Boolean(d));
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "scripts", "loop-meeting-actions.ts"))) return dir;
  }
  return null;
}

function lastLines(text: string, n: number): string {
  const lines = text.trimEnd().split("\n");
  return lines.slice(-n).join("\n");
}

export async function runMeetingActionsBatch(meetingPaths: string[]): Promise<void> {
  const cwd = resolveRunnerCwd();
  if (!cwd) {
    console.error(
      `[MeetingTrigger] cannot locate scripts/loop-meeting-actions.ts from cwd=${process.cwd()} ` +
      `(set HILT_REPO_ROOT); skipping run for: ${meetingPaths.join(", ")}`,
    );
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-meeting-trigger-"));
  const meetingsFile = path.join(tmpDir, "meetings.json");
  fs.writeFileSync(meetingsFile, `${JSON.stringify(meetingPaths)}\n`, "utf-8");
  const startedAt = Date.now();
  try {
    const result = await new Promise<{ code: number | null; tail: string; timedOut: boolean }>((resolve) => {
      // No --proposals-dir / --ledger-home: registry precedence applies (same sinks as nightly).
      // detached: the npx wrapper spawns tsx which spawns node — a plain child.kill() only hits
      // the wrapper, leaving the real worker running AND holding the stdio pipes open, which
      // wedged the serial queue forever (adversarial finding, 2026-07-07). detached gives the
      // tree its own process group so the timeout can kill ALL of it.
      const child = spawn("npx", ["tsx", "scripts/loop-meeting-actions.ts", "--meetings-file", meetingsFile], {
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      let tail = "";
      let timedOut = false;
      let done = false;
      const finish = (code: number | null, extra?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // Resolve on exit/error, not `close`: an orphan inheriting the pipes would hold
        // `close` open indefinitely. Destroy our ends so nothing dangles.
        child.stdout?.destroy();
        child.stderr?.destroy();
        resolve({ code, tail: extra ? `${tail}\n${extra}` : tail, timedOut });
      };
      const capture = (chunk: Buffer) => {
        tail = `${tail}${chunk.toString("utf-8")}`.slice(-4_000);
      };
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL"); // whole process group
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, getMeetingTriggerRunTimeoutMs());
      child.on("error", (error) => finish(null, `spawn error: ${error.message}`));
      child.on("exit", (code) => finish(code));
    });
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    const summary =
      `[MeetingTrigger] loop-meeting-actions ${result.timedOut ? "TIMED OUT" : `exited ${result.code}`} ` +
      `after ${seconds}s for ${meetingPaths.length} meeting(s): ${meetingPaths.join(", ")}`;
    if (result.code === 0 && !result.timedOut) console.log(`${summary}\n${lastLines(result.tail, 8)}`);
    else console.error(`${summary}\n${lastLines(result.tail, 20)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

let runnerSingleton: SerialMeetingRunner | null = null;
function getRunner(): SerialMeetingRunner {
  if (!runnerSingleton) runnerSingleton = new SerialMeetingRunner(runMeetingActionsBatch);
  return runnerSingleton;
}

// ---------------------------------------------------------------------------
// The post-sync observer (registered by daemon.ts)
// ---------------------------------------------------------------------------

/**
 * Fold one sync cycle's observations into the settle state; fire settled, un-fired, un-processed
 * meetings through the serialized runner. Fully self-contained failure domain: never throws.
 */
export function observeGranolaSyncForExtraction(observations: MeetingObservation[]): void {
  try {
    if (observations.length === 0) return;
    const nowIso = new Date().toISOString();
    const today = new Date().toLocaleDateString("en-CA");
    const cfg: SettleConfig = {
      settlePolls: getMeetingTriggerSettlePolls(),
      minStableMs: getMeetingTriggerSettleMs(),
    };
    const recent = observations.filter((o) => isRecentMeetingPath(o.meetingPath, today, RECENT_MEETING_DAYS));
    if (recent.length === 0) return;

    const state = readTriggerState();
    let processed: Set<string> | null | undefined; // lazy — registry read only when something settles
    const toFire: string[] = [];
    for (const obs of recent) {
      const { next, settled } = observeMeeting(state.meetings[obs.granolaId], obs, nowIso, cfg);
      state.meetings[obs.granolaId] = next;
      if (!settled || next.fired_at) continue;
      if (processed === undefined) processed = readProcessedMeetings(getGranolaVaultPath());
      if (processed === null) continue; // registry unreadable — retry next poll
      if (shouldFire(next, settled, processed)) {
        // Stamp BEFORE spawning: at-most-once even if the run crashes (nightly is the net).
        next.fired_at = nowIso;
        next.fired_reason = "settled";
        toFire.push(next.meeting_path);
      } else {
        // Settled but already processed by the nightly — stop tracking it.
        next.fired_at = nowIso;
        next.fired_reason = "already-processed";
      }
    }
    writeTriggerState(pruneTriggerState(state, nowIso));
    if (toFire.length > 0) {
      console.log(`[MeetingTrigger] settled → extracting ${toFire.length} meeting(s): ${toFire.join(", ")}`);
      getRunner().enqueue(toFire);
    }
  } catch (error) {
    console.error("[MeetingTrigger] observe failed:", error);
  }
}
