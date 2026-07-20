import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { listLibraryArtifactDetails } from "./library";
import { contextTextHasStrongLibraryMatch } from "./recommendation-editor";
import {
  markRecommendationRefreshPending,
  recommendationAutomaticRunAllowed,
  readRecommendationRuntime,
  type RecommendationRuntimeState,
  writeRecommendationRuntime,
} from "./recommendation-store";

const RECOMMENDATION_CONTEXT_ROOTS = new Set(["meetings", "tasks", "projects", "areas"]);

export function isRecommendationContextPath(vaultPath: string, changedPath: string): boolean {
  const absolutePath = path.isAbsolute(changedPath) ? changedPath : path.join(vaultPath, changedPath);
  const relative = path.relative(vaultPath, absolutePath).split(path.sep).join("/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative) || !relative.endsWith(".md")) return false;
  const segments = relative.split("/");
  if (!RECOMMENDATION_CONTEXT_ROOTS.has(segments[0])) return false;
  return !(segments[0] === "meetings" && segments[1] === "transcripts");
}

/** Drop old watcher reasons that the context builder could never supply to the editor. This makes
 * the filtering rule self-healing across deploys instead of leaving a persisted transcript trigger
 * queued forever. */
export function reconcileRecommendationPendingReasons(vaultPath: string): RecommendationRuntimeState {
  const state = readRecommendationRuntime(vaultPath);
  const reasons = state.pending_reasons.filter((reason) => {
    if (!reason.startsWith("context-match:")) return true;
    return isRecommendationContextPath(vaultPath, reason.slice("context-match:".length));
  });
  if (reasons.length === state.pending_reasons.length) return state;
  const pending = reasons.length > 0;
  return writeRecommendationRuntime(vaultPath, {
    pending,
    pending_reasons: reasons,
    pending_since: pending ? state.pending_since : null,
    next_retry_at: pending ? state.next_retry_at : null,
  });
}

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
    if (!isRecommendationContextPath(this.vaultPath, path)) return;
    if (!this.contextMatcher(this.vaultPath, path)) return;
    markRecommendationRefreshPending(this.vaultPath, `context-match:${path}`);
    this.schedule();
  }

  resume(): void {
    reconcileRecommendationPendingReasons(this.vaultPath);
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
    const state = reconcileRecommendationPendingReasons(this.vaultPath);
    const now = Date.now();
    if (!recommendationAutomaticRunAllowed(state, "refresh", now)) return;
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
    const state = reconcileRecommendationPendingReasons(this.vaultPath);
    if (!state.pending) return;
    if (!recommendationAutomaticRunAllowed(state, "refresh", new Date())) return;
    this.running = (async () => {
      try {
        await this.runChild();
        const after = readRecommendationRuntime(this.vaultPath);
        if (!after.pending) {
          this.onChanged();
        }
      } catch (error) {
        const runtime = readRecommendationRuntime(this.vaultPath);
        const workerMessage = error instanceof Error && error.message.startsWith("Recommendation worker ")
          ? error.message.slice(0, 500)
          : "Recommendation worker failed";
        const message = runtime.last_attempt_status === "failed" && runtime.last_attempt_error
          ? runtime.last_attempt_error
          : workerMessage;
        const failedAt = new Date().toISOString();
        writeRecommendationRuntime(this.vaultPath, {
          pending: true,
          last_error: message,
          next_retry_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          last_attempt_at: runtime.last_attempt_status === "failed" ? runtime.last_attempt_at : failedAt,
          last_attempt_kind: runtime.last_attempt_status === "failed" ? runtime.last_attempt_kind : "refresh",
          last_attempt_status: "failed",
          last_attempt_error: message,
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
  if (!isRecommendationContextPath(vaultPath, changedPath)) return false;
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

export function recommendationRunTimeoutMs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const override = Number(env.LIBRARY_RECOMMENDATION_RUN_TIMEOUT_MS);
  if (env.LIBRARY_RECOMMENDATION_RUN_TIMEOUT_MS && Number.isFinite(override) && override > 0) return override;
  const configuredEditorTimeout = Number(env.LIBRARY_EDITOR_TIMEOUT_MS || 10 * 60_000);
  const editorTimeout = Number.isFinite(configuredEditorTimeout) && configuredEditorTimeout > 0
    ? configuredEditorTimeout
    : 10 * 60_000;
  // The editor may make one initial model call plus one bounded repair call. Keep the supervising
  // child alive for both call budgets and a minute of parsing/atomic-write/exit overhead.
  return editorTimeout * 2 + 60_000;
}

async function runRecommendationChild(vaultPath: string): Promise<void> {
  const timeoutMs = recommendationRunTimeoutMs();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/library-editor-pass.ts", "--kind", "refresh"], {
      cwd: process.cwd(),
      env: { ...process.env, BRIDGE_VAULT_PATH: vaultPath, HILT_WORKING_FOLDER: vaultPath },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let settled = false;
    // Drain output without retaining it. The editor writes a sanitized structured receipt; raw
    // subprocess output is not copied into runtime state or a parent-process error message.
    child.stdout?.resume();
    child.stderr?.resume();
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
    child.on("exit", (code) => code === 0 ? finish() : finish(new Error(`Recommendation worker exited ${code}`)));
  });
}
