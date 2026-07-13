import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  isRecentMeetingPath,
  meetingDateFromPath,
  observeMeeting,
  pruneTriggerState,
  readProcessedMeetings,
  readTriggerState,
  SerialMeetingRunner,
  shouldFire,
  writeTriggerState,
  type MeetingObservation,
  type SettleConfig,
  type TriggerMeetingState,
  type TriggerState,
} from "./extraction-trigger";
import { MeetingLedgerStore, meetingLedgerDbPath, writeMeetingLedgerStorageMarker } from "../loops/meeting-ledger-store";

const CFG: SettleConfig = { settlePolls: 3, minStableMs: 120_000 };

function obs(overrides: Partial<MeetingObservation> = {}): MeetingObservation {
  return {
    granolaId: "g-1",
    meetingPath: "meetings/2026-07-07/Standup-2026-07-07 @ 10.00.md",
    enhancedNotesPresent: true,
    transcriptMeasure: 40,
    ...overrides,
  };
}

function at(minutes: number): string {
  return new Date(Date.UTC(2026, 6, 7, 10, minutes, 0)).toISOString();
}

describe("observeMeeting (settle detection)", () => {
  it("does not settle on the first observation", () => {
    const { next, settled } = observeMeeting(undefined, obs(), at(0), CFG);
    assert.equal(settled, false);
    assert.equal(next.stable_polls, 1);
    assert.equal(next.stable_since, at(0));
  });

  it("settles after N no-growth polls spanning the quiet window", () => {
    let state: TriggerMeetingState | undefined;
    let settled = false;
    for (const [i, minute] of [0, 1, 2].entries()) {
      ({ next: state, settled } = observeMeeting(state, obs(), at(minute), CFG));
      if (i < 2) assert.equal(settled, false, `poll ${i + 1} must not settle`);
    }
    assert.equal(settled, true);
    assert.equal(state!.stable_polls, 3);
  });

  it("transcript growth resets the stability counter and clock", () => {
    let { next: state } = observeMeeting(undefined, obs({ transcriptMeasure: 40 }), at(0), CFG);
    ({ next: state } = observeMeeting(state, obs({ transcriptMeasure: 40 }), at(1), CFG));
    const grown = observeMeeting(state, obs({ transcriptMeasure: 55 }), at(2), CFG);
    assert.equal(grown.settled, false);
    assert.equal(grown.next.stable_polls, 1);
    assert.equal(grown.next.stable_since, at(2));
  });

  it("enough polls but not enough quiet time does not settle (5s fast-poll lull guard)", () => {
    // Three observations 5 seconds apart: stable_polls reaches 3 but only 10s have elapsed.
    const t = (s: number) => new Date(Date.UTC(2026, 6, 7, 10, 0, s)).toISOString();
    let state: TriggerMeetingState | undefined;
    let settled = true;
    for (const s of [0, 5, 10]) ({ next: state, settled } = observeMeeting(state, obs(), t(s), CFG));
    assert.equal(state!.stable_polls, 3);
    assert.equal(settled, false);
  });

  it("never settles without enhanced notes, then settles once they land", () => {
    let state: TriggerMeetingState | undefined;
    let settled = true;
    for (const minute of [0, 1, 2, 3]) {
      ({ next: state, settled } = observeMeeting(state, obs({ enhancedNotesPresent: false }), at(minute), CFG));
    }
    assert.equal(settled, false);
    // Stability accrued while waiting — the enhanced note landing is the final gate.
    const done = observeMeeting(state, obs({ enhancedNotesPresent: true }), at(4), CFG);
    assert.equal(done.settled, true);
  });

  it("note-only meeting (no transcript ever) settles on a DOUBLED quiet window", () => {
    let state: TriggerMeetingState | undefined;
    let settled = true;
    // Inside the doubled window (2 × minStableMs = 4 min): not settled yet.
    for (const minute of [0, 1, 2, 3]) {
      ({ next: state, settled } = observeMeeting(state, obs({ transcriptMeasure: 0 }), at(minute), CFG));
    }
    assert.equal(settled, false);
    // At/after 4 minutes of stable absence with enhanced notes present: fires.
    ({ next: state, settled } = observeMeeting(state, obs({ transcriptMeasure: 0 }), at(4), CFG));
    assert.equal(settled, true);
  });

  it("preserves fired_at across observations", () => {
    const fired: TriggerMeetingState = {
      meeting_path: obs().meetingPath,
      transcript_measure: 40,
      stable_polls: 5,
      stable_since: at(0),
      last_observed_at: at(5),
      fired_at: at(5),
      fired_reason: "settled",
    };
    const { next } = observeMeeting(fired, obs(), at(6), CFG);
    assert.equal(next.fired_at, at(5));
    assert.equal(next.fired_reason, "settled");
  });
});

describe("shouldFire (once-guard + processed-check)", () => {
  const entry = (overrides: Partial<TriggerMeetingState> = {}): TriggerMeetingState => ({
    meeting_path: "meetings/2026-07-07/Standup.md",
    transcript_measure: 40,
    stable_polls: 3,
    stable_since: at(0),
    last_observed_at: at(3),
    ...overrides,
  });

  it("fires a settled, un-fired, un-processed meeting", () => {
    assert.equal(shouldFire(entry(), true, new Set()), true);
  });

  it("never fires twice (fired_at persists)", () => {
    assert.equal(shouldFire(entry({ fired_at: at(3) }), true, new Set()), false);
  });

  it("never fires when not settled", () => {
    assert.equal(shouldFire(entry(), false, new Set()), false);
  });

  it("never fires a meeting the nightly already processed", () => {
    assert.equal(shouldFire(entry(), true, new Set(["meetings/2026-07-07/Standup.md"])), false);
  });
});

describe("recency + path parsing", () => {
  it("extracts the meeting date from a vault-relative path", () => {
    assert.equal(meetingDateFromPath("meetings/2026-07-07/Foo, bar 🎉-2026-07-07 @ 10.00.md"), "2026-07-07");
    assert.equal(meetingDateFromPath("meetings/transcripts/2026-07-07/x.md"), null);
    assert.equal(meetingDateFromPath("notes/other.md"), null);
  });

  it("admits today and yesterday; rejects old backfill meetings", () => {
    assert.equal(isRecentMeetingPath("meetings/2026-07-07/a.md", "2026-07-07", 2), true);
    assert.equal(isRecentMeetingPath("meetings/2026-07-06/a.md", "2026-07-07", 2), true);
    assert.equal(isRecentMeetingPath("meetings/2026-07-01/a.md", "2026-07-07", 2), false);
    assert.equal(isRecentMeetingPath("meetings/2020-01-01/a.md", "2026-07-07", 2), false);
  });
});

describe("trigger state persistence", () => {
  it("round-trips through the state file and tolerates a corrupt file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-trigger-test-"));
    try {
      const file = path.join(dir, "loops", "meeting-trigger-state.json");
      const state: TriggerState = {
        version: 1,
        meetings: {
          "g-1": {
            meeting_path: "meetings/2026-07-07/a.md",
            transcript_measure: 12,
            stable_polls: 2,
            stable_since: at(0),
            last_observed_at: at(1),
            fired_at: at(1),
            fired_reason: "settled",
          },
        },
      };
      writeTriggerState(state, file);
      assert.deepEqual(readTriggerState(file), state);
      fs.writeFileSync(file, "{not json", "utf-8");
      assert.deepEqual(readTriggerState(file), { version: 1, meetings: {} });
      assert.deepEqual(readTriggerState(path.join(dir, "missing.json")), { version: 1, meetings: {} });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes entries not observed within the max age", () => {
    const state: TriggerState = {
      version: 1,
      meetings: {
        fresh: { meeting_path: "meetings/2026-07-07/a.md", transcript_measure: 1, stable_polls: 1, stable_since: at(0), last_observed_at: at(0) },
        stale: { meeting_path: "meetings/2026-06-01/b.md", transcript_measure: 1, stable_polls: 1, stable_since: "2026-06-01T10:00:00.000Z", last_observed_at: "2026-06-01T10:00:00.000Z" },
        corrupt: { meeting_path: "meetings/2026-07-07/c.md", transcript_measure: 1, stable_polls: 1, stable_since: at(0), last_observed_at: "not-a-date" },
      },
    };
    const pruned = pruneTriggerState(state, at(5), 14);
    assert.deepEqual(Object.keys(pruned.meetings), ["fresh"]);
  });
});

describe("SerialMeetingRunner (queue serialization)", () => {
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  it("runs one batch at a time; a second enqueue waits behind the active run", async () => {
    const events: string[] = [];
    const releases: Array<() => void> = [];
    const runner = new SerialMeetingRunner(async (batch) => {
      events.push(`start:${batch.join("+")}`);
      await new Promise<void>((resolve) => releases.push(resolve));
      events.push(`end:${batch.join("+")}`);
    });

    runner.enqueue(["a"]);
    await tick();
    runner.enqueue(["b", "c"]);
    await tick();
    // Only the first batch has started; b+c are queued behind it.
    assert.deepEqual(events, ["start:a"]);
    assert.equal(runner.isActive(), true);

    releases[0]();
    await tick();
    assert.deepEqual(events, ["start:a", "end:a", "start:b+c"]);

    releases[1]();
    await runner.idle();
    assert.deepEqual(events, ["start:a", "end:a", "start:b+c", "end:b+c"]);
    assert.equal(runner.isActive(), false);
  });

  it("dedupes a meeting enqueued twice while waiting", async () => {
    const batches: string[][] = [];
    const releases: Array<() => void> = [];
    const runner = new SerialMeetingRunner(async (batch) => {
      batches.push(batch);
      await new Promise<void>((resolve) => releases.push(resolve));
    });
    runner.enqueue(["a"]);
    await tick();
    runner.enqueue(["b"]);
    runner.enqueue(["b", "c"]);
    releases[0]();
    await tick();
    releases[1]();
    await runner.idle();
    assert.deepEqual(batches, [["a"], ["b", "c"]]);
  });

  it("a failing run never wedges the queue or throws", async () => {
    const ran: string[][] = [];
    let first = true;
    const runner = new SerialMeetingRunner(async (batch) => {
      ran.push(batch);
      if (first) {
        first = false;
        throw new Error("boom");
      }
    });
    runner.enqueue(["a"]);
    await runner.idle();
    runner.enqueue(["b"]);
    await runner.idle();
    assert.deepEqual(ran, [["a"], ["b"]]);
    assert.equal(runner.isActive(), false);
  });
});

describe("shared SQLite processed set", () => {
  it("lets the post-meeting trigger see meetings committed by the nightly repository", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-trigger-ledger-"));
    const priorData = process.env.DATA_DIR;
    process.env.DATA_DIR = path.join(root, "data");
    const vault = path.join(root, "vault");
    fs.mkdirSync(path.join(vault, "meta", "loops"), { recursive: true });
    fs.writeFileSync(path.join(vault, "meta", "loops", "registry.yml"), [
      "loops:", "  - id: meeting-actions", "    domain: meetings", "    cadence: daily", "    enabled: true", "    phase: shadow", "",
    ].join("\n"));
    const store = new MeetingLedgerStore(meetingLedgerDbPath(vault));
    store.markProcessed("meetings/2026-07-12/Shared.md", "2026-07-12T12:00:00.000Z");
    store.close();
    writeMeetingLedgerStorageMarker(vault, { version: 1, mode: "sqlite", migrated_at: "2026-07-12T12:00:00.000Z", legacy_home: null });
    assert.deepEqual([...readProcessedMeetings(vault)!], ["meetings/2026-07-12/Shared.md"]);
    if (priorData === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = priorData;
    fs.rmSync(root, { recursive: true, force: true });
  });
});
