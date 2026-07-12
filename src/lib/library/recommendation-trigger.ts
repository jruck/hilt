import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { listLibraryArtifactDetails } from "./library";
import { contextTextHasStrongLibraryMatch } from "./recommendation-editor";
import {
  markRecommendationRefreshPending,
  readRecommendationRuntime,
  writeRecommendationRuntime,
} from "./recommendation-store";

export class LibraryRecommendationRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly vaultPath: string,
    private readonly onChanged: () => void = () => {},
    private readonly runChild: () => Promise<void> = () => runRecommendationChild(vaultPath),
    private readonly contextMatcher: (vaultPath: string, changedPath: string) => boolean = contextChangeHasStrongMatch,
  ) {}

  noteArtifact(path: string, ready: boolean): void {
    if (!ready) return;
    markRecommendationRefreshPending(this.vaultPath, `artifact:${path}`);
    if (this.hasMeaningfulPendingSignal()) this.schedule();
  }

  noteContext(path: string): void {
    if (!this.contextMatcher(this.vaultPath, path)) return;
    markRecommendationRefreshPending(this.vaultPath, `context-match:${path}`);
    this.schedule();
  }

  resume(): void {
    if (this.hasMeaningfulPendingSignal()) this.schedule();
  }

  private hasMeaningfulPendingSignal(): boolean {
    const reasons = readRecommendationRuntime(this.vaultPath).pending_reasons;
    const candidates = new Set(reasons.filter((reason) => reason.includes("/.cache/library-candidates/")));
    const saved = new Set(reasons.filter((reason) => reason.startsWith("artifact:") && !reason.includes("/.cache/library-candidates/")));
    return saved.size >= 1
      || candidates.size >= 3
      || reasons.some((reason) => reason.startsWith("context-match:") || reason.startsWith("editor-retry:"));
  }

  private schedule(): void {
    if (this.timer || this.running) return;
    const state = readRecommendationRuntime(this.vaultPath);
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if ((state.automatic_runs_by_day[today] || 0) >= 3) return;
    const debounceMs = Number(process.env.LIBRARY_RECOMMENDATION_DEBOUNCE_MS || 20 * 60_000);
    const cooldownMs = Number(process.env.LIBRARY_RECOMMENDATION_COOLDOWN_MS || 2 * 60 * 60_000);
    const pendingAge = state.pending_since ? now - Date.parse(state.pending_since) : 0;
    const debounceDelay = Number.isFinite(pendingAge) ? Math.max(0, debounceMs - pendingAge) : debounceMs;
    const sinceSuccess = state.last_success_at ? now - Date.parse(state.last_success_at) : Number.POSITIVE_INFINITY;
    const retryDelay = state.next_retry_at ? Math.max(0, Date.parse(state.next_retry_at) - now) : 0;
    const delay = Math.max(0, debounceDelay, retryDelay, Number.isFinite(sinceSuccess) ? cooldownMs - sinceSuccess : 0);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.kick();
    }, delay);
  }

  async kick(): Promise<void> {
    if (this.running) return this.running;
    const state = readRecommendationRuntime(this.vaultPath);
    if (!state.pending) return;
    const today = new Date().toISOString().slice(0, 10);
    if ((state.automatic_runs_by_day[today] || 0) >= 3) return;
    this.running = (async () => {
      try {
        await this.runChild();
        const after = readRecommendationRuntime(this.vaultPath);
        if (!after.pending) {
          this.onChanged();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeRecommendationRuntime(this.vaultPath, {
          pending: true,
          last_error: message.slice(0, 500),
          next_retry_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        });
      } finally {
        this.running = null;
        if (readRecommendationRuntime(this.vaultPath).pending) this.schedule();
      }
    })();
    return this.running;
  }

  isActive(): boolean {
    return this.running !== null;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export function contextChangeHasStrongMatch(vaultPath: string, changedPath: string): boolean {
  let text = "";
  try {
    const absolutePath = path.isAbsolute(changedPath) ? changedPath : path.join(vaultPath, changedPath);
    text = fs.readFileSync(absolutePath, "utf-8").slice(0, 12_000);
  } catch {
    return false;
  }
  if (!text.trim()) return false;
  const artifacts = listLibraryArtifactDetails(vaultPath, {
    includeCandidates: true,
    mode: "study",
    limit: 3_000,
  }).artifacts
    .filter((artifact) => !artifact.processing || artifact.processing.state === "ready");
  return contextTextHasStrongLibraryMatch(text, artifacts);
}

async function runRecommendationChild(vaultPath: string): Promise<void> {
  const timeoutMs = Number(process.env.LIBRARY_RECOMMENDATION_RUN_TIMEOUT_MS || 5 * 60_000);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/library-editor-pass.ts", "--kind", "refresh"], {
      cwd: process.cwd(),
      env: { ...process.env, BRIDGE_VAULT_PATH: vaultPath, HILT_WORKING_FOLDER: vaultPath },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let tail = "";
    let settled = false;
    const capture = (chunk: Buffer) => { tail = `${tail}${chunk.toString("utf-8")}`.slice(-8_000); };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      finish(new Error(`Recommendation worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => code === 0 ? finish() : finish(new Error(`Recommendation worker exited ${code}: ${tail.slice(-2_000)}`)));
  });
}
