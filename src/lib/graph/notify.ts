import * as fs from "fs";
import * as path from "path";
import { getGraphMarkerPath } from "./config";

/**
 * Write the graph build-event marker. Mirrors `calendar/notify.ts
 * touchCalendarChanged` exactly: the worker/orchestrator (main thread) writes a
 * marker file under DATA_DIR; `ws-server` watches it with `fs.watchFile` and
 * broadcasts a `graph` `changed` WS event when its mtime advances. This keeps the
 * WS layer fully decoupled from the layout loop.
 *
 * `kind` distinguishes a full rebuild from an incremental relax; `changed` is the
 * optional list of node ids the relax touched (lets the client apply a targeted
 * patch instead of a full refetch). The marker only ever lives under DATA_DIR — it
 * never writes the vault, so it can never trigger a watcher feedback loop.
 */
export interface GraphChangeDetail {
  kind?: "full" | "incremental";
  changed?: string[];
}

export function touchGraphChanged(detail: GraphChangeDetail = {}): void {
  const marker = getGraphMarkerPath();
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ ...detail, ts: Date.now() }), "utf-8");
}
