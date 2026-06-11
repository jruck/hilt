import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  HEARTBEAT_FRESH_MS,
  initialAppMode,
  isHeartbeatFresh,
  nextSpawnSpec,
  persistAppMode,
  readAppModeIntent,
  readPersistedAppMode,
  readSupervisorHeartbeat,
  resolveServerMode,
  writeAppModeIntent,
  writeSupervisorHeartbeat,
  type SupervisorHeartbeat,
} from "./server-mode";

function tmpDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hilt-server-mode-"));
}

function tmpProjectDir(withProdBuild: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-project-"));
  if (withProdBuild) {
    fs.mkdirSync(path.join(dir, ".next-prod"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".next-prod", "BUILD_ID"), "test-build");
  }
  return dir;
}

test("mode precedence: state file wins over env, env over default", () => {
  const dataDir = tmpDataDir();
  assert.equal(initialAppMode(dataDir, {}), "dev");
  assert.equal(initialAppMode(dataDir, { HILT_APP_MODE: "prod" }), "prod");
  persistAppMode("dev", dataDir);
  assert.equal(initialAppMode(dataDir, { HILT_APP_MODE: "prod" }), "dev");
  persistAppMode("prod", dataDir);
  assert.equal(initialAppMode(dataDir, {}), "prod");
  assert.equal(readPersistedAppMode(dataDir), "prod");
});

test("corrupt state file is ignored", () => {
  const dataDir = tmpDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "app-mode.json"), "{not json");
  assert.equal(readPersistedAppMode(dataDir), null);
  assert.equal(initialAppMode(dataDir, {}), "dev");
});

test("prod resolution requires BUILD_ID; falls back to dev otherwise", () => {
  const withBuild = tmpProjectDir(true);
  const withoutBuild = tmpProjectDir(false);
  assert.equal(resolveServerMode(withBuild, "prod"), "prod");
  assert.equal(resolveServerMode(withoutBuild, "prod"), "dev");
  assert.equal(resolveServerMode(withBuild, "dev"), "dev");
});

test("spawn spec carries mode-specific args and env", () => {
  const projectDir = tmpProjectDir(true);
  const prod = nextSpawnSpec(projectDir, 3456, "prod");
  assert.deepEqual(prod.args, ["run", "start", "--", "--port", "3456"]);
  assert.equal(prod.env.HILT_DIST_DIR, ".next-prod");
  assert.equal(prod.env.NODE_ENV, "production");
  assert.equal(prod.label, "production");

  const dev = nextSpawnSpec(projectDir, 3456, "dev");
  assert.deepEqual(dev.args, ["run", "dev", "--", "--port", "3456"]);
  assert.equal(dev.label, "dev");
});

test("intent round-trips with monotonically usable ts", () => {
  const dataDir = tmpDataDir();
  assert.equal(readAppModeIntent(dataDir), null);
  writeAppModeIntent("dev", "test", dataDir);
  const intent = readAppModeIntent(dataDir);
  assert.ok(intent);
  assert.equal(intent.mode, "dev");
  assert.equal(intent.requested_by, "test");
  assert.ok(typeof intent.ts === "number" && intent.ts > 0);
});

test("heartbeat: fresh + live pid ⇒ supervised; stale ⇒ not; dead pid ⇒ not", () => {
  const dataDir = tmpDataDir();
  assert.equal(isHeartbeatFresh(readSupervisorHeartbeat(dataDir)), false);

  writeSupervisorHeartbeat(
    { kind: "daemon", pid: process.pid, started_at: new Date().toISOString(), state: "idle" },
    dataDir
  );
  const fresh = readSupervisorHeartbeat(dataDir);
  assert.ok(isHeartbeatFresh(fresh));

  // Stale: backdate beyond the freshness window.
  const stale: SupervisorHeartbeat = {
    ...(fresh as SupervisorHeartbeat),
    beat_at: new Date(Date.now() - HEARTBEAT_FRESH_MS - 1000).toISOString(),
  };
  assert.equal(isHeartbeatFresh(stale), false);

  // Dead pid: fresh timestamp but no such process.
  const deadPid: SupervisorHeartbeat = {
    ...(fresh as SupervisorHeartbeat),
    beat_at: new Date().toISOString(),
    pid: 999999,
  };
  assert.equal(isHeartbeatFresh(deadPid), false);
});

test("heartbeat with unknown kind is rejected on read", () => {
  const dataDir = tmpDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "app-supervisor.json"),
    JSON.stringify({ kind: "mystery", pid: process.pid, beat_at: new Date().toISOString(), state: "idle" })
  );
  assert.equal(readSupervisorHeartbeat(dataDir), null);
});
