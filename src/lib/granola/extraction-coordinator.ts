import os from "node:os";
import { verifyMeetingExtractionCompletion, type MeetingExtractionCompletion } from "../loops/meeting-extraction-completion";
import {
  emitMeetingLedgerChanged,
  openCanonicalMeetingLedgerStore,
  type MeetingExtractionJob,
  type MeetingExtractionJobSource,
  type MeetingLedgerStore,
} from "../loops/meeting-ledger-store";
import {
  getGranolaVaultPath,
  getMeetingExtractionLeaseMs,
  getMeetingExtractionLeaseRenewMs,
  getMeetingExtractionMaxAttempts,
  getMeetingExtractionReconcileMs,
  getMeetingExtractionRetryBaseMs,
  getMeetingExtractionRetryMaxMs,
} from "./config";
import { runMeetingActionsBatch, type MeetingActionsBatchResult } from "./meeting-actions-runner";

interface CoordinatorOptions {
  vaultPath: string;
  openStore?: () => MeetingLedgerStore;
  runBatch?: (meetingPaths: string[], options: { leaseOwner: string; skipProcessed: boolean }) => Promise<MeetingActionsBatchResult>;
  verify?: (store: MeetingLedgerStore, vaultPath: string, meeting: string) => MeetingExtractionCompletion;
  now?: () => Date;
  leaseMs?: number;
  leaseRenewMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  maxAttempts?: number;
  reconcileMs?: number;
  owner?: string;
}

/** One non-resident orchestrator inside ws-server. SQLite owns the queue; this class owns only
 * wakeups. Killing this process loses no work because claims expire and the next instance first
 * verifies canonical output before it considers rerunning a meeting. */
export class MeetingExtractionCoordinator {
  private readonly vaultPath: string;
  private readonly openStore: () => MeetingLedgerStore;
  private readonly runBatch: NonNullable<CoordinatorOptions["runBatch"]>;
  private readonly verify: NonNullable<CoordinatorOptions["verify"]>;
  private readonly now: () => Date;
  private readonly leaseMs: number;
  private readonly leaseRenewMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly maxAttempts: number;
  private readonly reconcileMs: number;
  private readonly owner: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = true;
  private wakeRequested = false;

  constructor(options: CoordinatorOptions) {
    this.vaultPath = options.vaultPath;
    this.openStore = options.openStore ?? (() => openCanonicalMeetingLedgerStore(options.vaultPath));
    this.runBatch = options.runBatch ?? runMeetingActionsBatch;
    this.verify = options.verify ?? verifyMeetingExtractionCompletion;
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? getMeetingExtractionLeaseMs();
    this.leaseRenewMs = options.leaseRenewMs ?? getMeetingExtractionLeaseRenewMs();
    this.retryBaseMs = options.retryBaseMs ?? getMeetingExtractionRetryBaseMs();
    this.retryMaxMs = options.retryMaxMs ?? getMeetingExtractionRetryMaxMs();
    this.maxAttempts = options.maxAttempts ?? getMeetingExtractionMaxAttempts();
    this.reconcileMs = options.reconcileMs ?? getMeetingExtractionReconcileMs();
    this.owner = options.owner ?? `ws:${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  wake(): void {
    if (this.stopped) return;
    if (this.inFlight) {
      this.wakeRequested = true;
      return;
    }
    this.schedule(0);
  }

  async drainNow(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.drainOnce().finally(() => {
      this.inFlight = null;
      if (!this.stopped) this.schedule(this.wakeRequested ? 0 : this.reconcileMs);
      this.wakeRequested = false;
    });
    return this.inFlight;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drainNow().catch((error) => {
        console.error("[MeetingExtraction] queue reconciliation failed:", error);
      });
    }, delayMs);
  }

  private openAndClaim(): MeetingExtractionJob[] {
    const store = this.openStore();
    try {
      return store.claimExtractionJobs({
        owner: this.owner,
        now: this.now().toISOString(),
        leaseMs: this.leaseMs,
        limit: 10,
      });
    } finally {
      store.close();
    }
  }

  private verifyAndComplete(jobs: MeetingExtractionJob[], runId?: string): MeetingExtractionJob[] {
    const remaining: MeetingExtractionJob[] = [];
    const store = this.openStore();
    try {
      for (const job of jobs) {
        const result = this.verify(store, this.vaultPath, job.meeting_path);
        if (result.ok) {
          store.completeExtractionJob({
            meetingPath: job.meeting_path,
            owner: this.owner,
            completedAt: this.now().toISOString(),
            runId: runId ?? result.processed_at ?? undefined,
          });
        } else {
          remaining.push(job);
        }
      }
    } finally {
      store.close();
    }
    return remaining;
  }

  private retryIncomplete(jobs: MeetingExtractionJob[], batch: MeetingActionsBatchResult): void {
    const store = this.openStore();
    try {
      for (const job of jobs) {
        const verification = this.verify(store, this.vaultPath, job.meeting_path);
        if (verification.ok) {
          store.completeExtractionJob({
            meetingPath: job.meeting_path,
            owner: this.owner,
            completedAt: this.now().toISOString(),
            runId: verification.processed_at ?? undefined,
          });
          continue;
        }
        const current = store.getExtractionJob(job.meeting_path) ?? job;
        const delay = Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** Math.max(0, current.attempt_count - 1)));
        const now = this.now();
        const processFault = batch.timedOut
          ? "worker timed out"
          : batch.code !== 0
            ? `worker exited ${batch.code}`
            : "canonical completion verification failed";
        const tail = batch.tail.trim().split("\n").slice(-4).join(" | ");
        store.retryExtractionJob({
          meetingPath: job.meeting_path,
          owner: this.owner,
          failedAt: now.toISOString(),
          nextRetryAt: new Date(now.getTime() + delay).toISOString(),
          error: [processFault, ...verification.issues, tail].filter(Boolean).join("; "),
          maxAttempts: this.maxAttempts,
        });
      }
    } finally {
      store.close();
    }
  }

  private async drainOnce(): Promise<void> {
    const claimed = this.openAndClaim();
    if (!claimed.length) return;
    const pending = this.verifyAndComplete(claimed);
    if (!pending.length) {
      emitMeetingLedgerChanged(this.vaultPath, { extraction_queue: "reconciled", meetings: claimed.map((job) => job.meeting_path) });
      this.wakeRequested = true;
      return;
    }

    const paths = pending.map((job) => job.meeting_path);
    const heartbeat = setInterval(() => {
      try {
        const store = this.openStore();
        try {
          store.renewExtractionJobLeases({
            meetingPaths: paths,
            owner: this.owner,
            now: this.now().toISOString(),
            leaseMs: this.leaseMs,
          });
        } finally {
          store.close();
        }
      } catch (error) {
        console.error("[MeetingExtraction] lease renewal failed:", error);
      }
    }, this.leaseRenewMs);
    let result: MeetingActionsBatchResult;
    try {
      result = await this.runBatch(paths, { leaseOwner: this.owner, skipProcessed: true });
    } catch (error) {
      result = { code: null, timedOut: false, elapsedMs: 0, tail: error instanceof Error ? error.message : String(error) };
    } finally {
      clearInterval(heartbeat);
    }
    this.retryIncomplete(pending, result);
    emitMeetingLedgerChanged(this.vaultPath, {
      extraction_queue: "processed",
      meetings: paths,
      worker_exit: result.code,
      timed_out: result.timedOut,
    });
    this.wakeRequested = true;
  }
}

let coordinator: MeetingExtractionCoordinator | null = null;

export function startMeetingExtractionCoordinator(): void {
  if (!coordinator) coordinator = new MeetingExtractionCoordinator({ vaultPath: getGranolaVaultPath() });
  coordinator.start();
}

export function stopMeetingExtractionCoordinator(): void {
  coordinator?.stop();
  coordinator = null;
}

export function wakeMeetingExtractionCoordinator(): void {
  coordinator?.wake();
}

export function enqueueMeetingExtractionJobs(input: Array<{
  meetingPath: string;
  source: MeetingExtractionJobSource;
  queuedAt: string;
  granolaId?: string;
  settledAt?: string;
}>): number {
  if (!input.length) return 0;
  const vaultPath = getGranolaVaultPath();
  const store = openCanonicalMeetingLedgerStore(vaultPath);
  let enqueued = 0;
  try {
    for (const job of input) {
      const before = store.getExtractionJob(job.meetingPath);
      const after = store.enqueueExtractionJob(job);
      if (!before && after?.status === "queued") enqueued += 1;
    }
  } finally {
    store.close();
  }
  if (enqueued) {
    emitMeetingLedgerChanged(vaultPath, { extraction_queue: "enqueued", count: enqueued });
    wakeMeetingExtractionCoordinator();
  }
  return enqueued;
}
