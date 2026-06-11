import * as fs from "fs";
import * as path from "path";
import {
  isHeartbeatFresh,
  readSupervisorHeartbeat,
  type SupervisorKind,
  type SupervisorState,
} from "../../../server/server-mode";

/**
 * How this Next.js server instance is running: dev (next dev via app-server,
 * hot reload, React development mode) or prod (a production build served from
 * its dist dir), plus whether a supervisor (Electron or the headless daemon)
 * currently manages it — which is what gates the mode-switch UI. Surfaced
 * through /api/system/app-server and the System machine identity payload so
 * source rows and machine views can show "dev" / "prod · built 2h ago".
 */
export interface AppServerInfo {
  mode: "dev" | "prod";
  dist_dir: string;
  build_id: string | null;
  /** ISO timestamp of build completion (rebuild stamp preferred over BUILD_ID). */
  built_at: string | null;
  /** True only with a FRESH supervisor heartbeat (≤90s, live pid). */
  supervised: boolean;
  supervisor: {
    kind: SupervisorKind;
    state: SupervisorState;
    detail?: string;
  } | null;
}

export function getAppServerInfo(): AppServerInfo {
  const mode = process.env.NODE_ENV === "production" ? "prod" : "dev";
  const distDir = process.env.HILT_DIST_DIR || ".next";

  let buildId: string | null = null;
  let builtAt: string | null = null;
  if (mode === "prod") {
    const distPath = path.join(process.cwd(), distDir);
    try {
      buildId = fs.readFileSync(path.join(distPath, "BUILD_ID"), "utf-8").trim();
    } catch {
      // Build metadata unavailable — leave null.
    }
    // The rebuild stamp is written after the build completes; BUILD_ID is
    // written mid-build. Prefer the stamp for an honest "built N ago".
    for (const marker of [".hilt-rebuild-stamp", "BUILD_ID"]) {
      try {
        builtAt = new Date(fs.statSync(path.join(distPath, marker)).mtimeMs).toISOString();
        break;
      } catch {
        // Try the next marker.
      }
    }
  }

  const heartbeat = readSupervisorHeartbeat();
  const supervised = isHeartbeatFresh(heartbeat);

  return {
    mode,
    dist_dir: distDir,
    build_id: buildId,
    built_at: builtAt,
    supervised,
    supervisor: supervised
      ? { kind: heartbeat.kind, state: heartbeat.state, ...(heartbeat.detail ? { detail: heartbeat.detail } : {}) }
      : null,
  };
}
