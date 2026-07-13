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
 *  2. DURABLY ENQUEUES the meeting in canonical SQLite. Repeated settled observations are
 *     idempotent; the old JSON `fired_at` field is telemetry only and can never suppress recovery.
 *  3. WAKES the ws-server extraction coordinator. Renewable leases, verification, retries, and
 *     the nightly runner all operate on that same queue.
 *
 * Gate: HILT_MEETING_TRIGGER (default ON whenever the granola daemon is enabled; "0" disables).
 */
import * as fs from "fs";
import * as path from "path";
import { atomicWriteFile } from "../library/utils";
import { defaultSandboxDir } from "../loops/emit";
import { openMeetingLedgerRuntime } from "../loops/meeting-ledger-runtime";
import { loadRegistry, loopHome } from "../loops/registry";
import {
  getGranolaDataDir,
  getGranolaVaultPath,
  getMeetingTriggerSettleMs,
  getMeetingTriggerSettlePolls,
} from "./config";
import { enqueueMeetingExtractionJobs } from "./extraction-coordinator";

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
  /** Compatibility telemetry: first time this settled meeting was submitted to durable intake. */
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
// Pure: settle detection + processed guard (unit-tested directly)
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

/** A settled meeting keeps submitting idempotently until canonical processing succeeds. */
export function shouldEnqueue(
  entry: TriggerMeetingState,
  settled: boolean,
  processedMeetings: ReadonlySet<string>,
): boolean {
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
 * registry phase shadow → the loop home. The runtime then resolves the shared SQLite processed
 * set after cutover or the legacy JSON set before cutover.
 * Returns null when the registry itself can't be resolved (fire nothing this cycle — never risk
 * double-processing on a broken registry); a missing/empty processed file is just "none yet".
 */
export function readProcessedMeetings(vaultPath: string): Set<string> | null {
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
    const ledger = openMeetingLedgerRuntime({ vaultPath, legacyHome: home });
    try {
      return new Set(Object.keys(ledger.processedMeetings()));
    } finally {
      ledger.close();
    }
  } catch (error) {
    // A missing/corrupt canonical database must suppress the trigger. Treating it as an empty
    // processed set could re-run every settled meeting and duplicate external side effects.
    console.error("[MeetingTrigger] processed meeting store unavailable — skipping fire this cycle:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The post-sync observer (registered by daemon.ts)
// ---------------------------------------------------------------------------

/**
 * Fold one sync cycle's observations into settle state and idempotently enqueue every settled,
 * unprocessed meeting. Fully self-contained failure domain: never throws.
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
    const toQueue: Array<{ meetingPath: string; source: "trigger"; queuedAt: string; granolaId: string; settledAt: string }> = [];
    for (const obs of recent) {
      const { next, settled } = observeMeeting(state.meetings[obs.granolaId], obs, nowIso, cfg);
      state.meetings[obs.granolaId] = next;
      if (!settled) continue;
      if (processed === undefined) processed = readProcessedMeetings(getGranolaVaultPath());
      if (processed === null) continue; // registry unreadable — retry next poll
      if (shouldEnqueue(next, settled, processed)) {
        // Compatibility telemetry only. Durable SQLite state, not this field, decides retries.
        next.fired_at ??= nowIso;
        next.fired_reason = "settled";
        toQueue.push({
          meetingPath: next.meeting_path,
          source: "trigger",
          queuedAt: nowIso,
          granolaId: obs.granolaId,
          settledAt: next.stable_since,
        });
      } else {
        next.fired_at ??= nowIso;
        next.fired_reason = "already-processed";
      }
    }
    writeTriggerState(pruneTriggerState(state, nowIso));
    if (toQueue.length > 0) {
      const enqueued = enqueueMeetingExtractionJobs(toQueue);
      if (enqueued > 0) {
        console.log(`[MeetingTrigger] settled → queued ${enqueued} meeting(s): ${toQueue.map((job) => job.meetingPath).join(", ")}`);
      }
    }
  } catch (error) {
    console.error("[MeetingTrigger] observe failed:", error);
  }
}
