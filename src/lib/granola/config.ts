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
  return boundedInt(process.env.HILT_GRANOLA_SYNC_FAST_POLL_MS, 15_000, 5_000, 300_000);
}

export function getGranolaDefaultDaysBack(): number {
  return boundedInt(process.env.HILT_GRANOLA_SYNC_DAYS_BACK, 7, 1, 3650);
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
