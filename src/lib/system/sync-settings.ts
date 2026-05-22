import { homedir } from "os";
import path from "path";

export type SystemSyncProvider = "syncthing";

export interface SystemSyncSettings {
  enabled: boolean;
  provider: SystemSyncProvider;
  folderId: string;
  url: string;
  apiKeyFile: string;
  cacheMs: number;
}

export function isSystemSyncEnabled(): boolean {
  return process.env.HILT_SYNC_ENABLED === "true";
}

export function loadSystemSyncSettings(): SystemSyncSettings {
  const provider = process.env.HILT_SYNC_PROVIDER || "syncthing";
  if (provider !== "syncthing") {
    throw new Error(`Unsupported sync provider: ${provider}`);
  }

  return {
    enabled: isSystemSyncEnabled(),
    provider,
    folderId: process.env.HILT_SYNC_FOLDER_ID || "work-meta",
    url: process.env.HILT_SYNC_SYNCTHING_URL || "http://127.0.0.1:8384",
    apiKeyFile: process.env.HILT_SYNC_SYNCTHING_API_KEY_FILE || path.join(homedir(), ".hilt", "sync", "syncthing-api-key"),
    cacheMs: numberEnv("HILT_SYNC_CACHE_MS", 10_000),
  };
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
