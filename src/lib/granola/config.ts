import * as os from "os";
import * as path from "path";

export function getGranolaDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function getGranolaSyncDbPath(): string {
  return process.env.HILT_GRANOLA_SYNC_DB_PATH || path.join(getGranolaDataDir(), "granola-sync.sqlite");
}

export function getGranolaDaemonStatePath(): string {
  return process.env.HILT_GRANOLA_DAEMON_STATE_PATH || path.join(getGranolaDataDir(), "granola-sync-daemon.json");
}

export function getGranolaRemoteHost(): string {
  return process.env.HILT_GRANOLA_REMOTE_HOST || "mercury-v";
}

export function getGranolaRemoteRepoPath(): string {
  return process.env.HILT_GRANOLA_REMOTE_REPO_PATH || "/Users/jruck/work/engineering/me/hilt";
}

export function getGranolaRemoteNodePath(): string {
  return process.env.HILT_GRANOLA_REMOTE_NODE_PATH || "/Users/jruck/.nvm/versions/node/v22.22.0/bin/node";
}

export function getGranolaRemoteHelperPath(): string {
  return process.env.HILT_GRANOLA_REMOTE_HELPER_PATH || path.posix.join(getGranolaRemoteRepoPath(), "scripts", "granola-remote-helper.mjs");
}

export function getGranolaVaultPath(): string {
  return process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || path.join(os.homedir(), "work/bridge");
}

export function getGranolaCompareOutputDir(): string {
  return process.env.HILT_GRANOLA_COMPARE_OUTPUT_DIR || path.join(os.tmpdir(), "hilt-granola-compare");
}

export function granolaDaemonEnabled(): boolean {
  return process.env.HILT_GRANOLA_SYNC_DAEMON === "1";
}

export function getGranolaPollMs(): number {
  return boundedInt(process.env.HILT_GRANOLA_SYNC_POLL_MS, 60_000, 5_000, 3_600_000);
}

export function getGranolaFastPollMs(): number {
  return boundedInt(process.env.HILT_GRANOLA_SYNC_FAST_POLL_MS, 5_000, 5_000, 300_000);
}

export function getGranolaDefaultDaysBack(): number {
  return boundedInt(process.env.HILT_GRANOLA_SYNC_DAYS_BACK, 7, 1, 3650);
}

/**
 * Post-meeting extraction trigger gate (v3 unit B1): default ON whenever the granola daemon is
 * enabled; HILT_MEETING_TRIGGER=0 disables it quickly, =1 forces it on (only meaningful in the
 * process that runs the daemon — the daemon is what registers the post-sync observer).
 */
export function meetingTriggerEnabled(): boolean {
  const value = process.env.HILT_MEETING_TRIGGER;
  if (value === "0") return false;
  if (value === "1") return true;
  return granolaDaemonEnabled();
}

/** Settle rule: N consecutive no-growth transcript observations (default 3)… */
export function getMeetingTriggerSettlePolls(): number {
  return boundedInt(process.env.HILT_MEETING_TRIGGER_SETTLE_POLLS, 3, 2, 50);
}

/** …spanning at least this quiet window (default 2 min — quality over speed). */
export function getMeetingTriggerSettleMs(): number {
  return boundedInt(process.env.HILT_MEETING_TRIGGER_SETTLE_MS, 120_000, 10_000, 3_600_000);
}

/** Hard kill for a triggered loop run (default 15 min; one claude call per meeting inside). */
export function getMeetingTriggerRunTimeoutMs(): number {
  return boundedInt(process.env.HILT_MEETING_TRIGGER_RUN_TIMEOUT_MS, 900_000, 60_000, 3_600_000);
}

export function getMeetingExtractionLeaseMs(): number {
  return boundedInt(process.env.HILT_MEETING_EXTRACTION_LEASE_MS, 90_000, 30_000, 900_000);
}

export function getMeetingExtractionLeaseRenewMs(): number {
  const configured = boundedInt(process.env.HILT_MEETING_EXTRACTION_LEASE_RENEW_MS, 30_000, 5_000, 300_000);
  return Math.max(5_000, Math.min(configured, Math.floor(getMeetingExtractionLeaseMs() / 3)));
}

export function getMeetingExtractionRetryBaseMs(): number {
  return boundedInt(process.env.HILT_MEETING_EXTRACTION_RETRY_BASE_MS, 30_000, 5_000, 600_000);
}

export function getMeetingExtractionRetryMaxMs(): number {
  return boundedInt(process.env.HILT_MEETING_EXTRACTION_RETRY_MAX_MS, 300_000, 30_000, 3_600_000);
}

export function getMeetingExtractionMaxAttempts(): number {
  return boundedInt(process.env.HILT_MEETING_EXTRACTION_MAX_ATTEMPTS, 5, 1, 20);
}

export function getMeetingExtractionReconcileMs(): number {
  return boundedInt(process.env.HILT_MEETING_EXTRACTION_RECONCILE_MS, 15_000, 5_000, 300_000);
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
