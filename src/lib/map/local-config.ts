import { join } from "path";

export function getMapDataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), "data");
}

export function getMapDbPath(): string {
  return process.env.HILT_MAP_DB_PATH || join(getMapDataDir(), "map.sqlite");
}

export function isLocalMapEnabled(): boolean {
  return process.env.HILT_MAP_LOCAL_ENABLED !== "false";
}

export function isMapHistoryPreviewEnabled(): boolean {
  if (process.env.HILT_MAP_HISTORY_PREVIEW === "true") return true;
  if (process.env.HILT_MAP_HISTORY_PREVIEW === "false") return false;
  return process.env.NODE_ENV !== "production";
}
