/* eslint-disable @typescript-eslint/no-explicit-any -- dev harness pokes at untyped JSON responses */
/**
 * Single-host end-to-end check for the System Agent (docs/plans/system-agent-mode.md, M3).
 *
 * Boots the real `server/system-agent.ts` on an ephemeral loopback port against a
 * throwaway DATA_DIR, then:
 *   - exercises all 12 allowlisted routes and asserts each returns the expected shape,
 *   - asserts every disallowed path returns a JSON 404 with no HTML,
 *   - asserts stack files come back read-only (isEditable:false),
 *   - asserts the Syncthing API key never appears in sync output,
 *   - diffs DATA_DIR before/after to prove no daemon/runner artifacts were written.
 *
 * Exits 0 on success, 1 on any failure. Run: npm run test:system-agent:e2e
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOST = "127.0.0.1";
const failures: string[] = [];

function check(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ok  ${message}`);
  } else {
    console.error(`  FAIL ${message}`);
    failures.push(message);
  }
}

function section(title: string): void {
  console.log(`\n# ${title}`);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, HOST, () => {
      const address = srv.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a port."));
        return;
      }
      const { port } = address;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(base: string, logs: () => string, child: ChildProcessWithoutNullStreams): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`system-agent exited early (code ${child.exitCode}).\n${logs()}`);
    try {
      const res = await fetch(`${base}/api/system/machine`, { cache: "no-store" });
      if (res.ok || res.status === 404) return;
    } catch {
      // keep polling
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for system-agent to listen.\n${logs()}`);
}

async function getJson(base: string, p: string, init?: RequestInit): Promise<{ status: number; body: any; contentType: string; text: string }> {
  const res = await fetch(`${base}${p}`, init);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* non-JSON (e.g. PNG) */ }
  return { status: res.status, body, contentType: res.headers.get("content-type") ?? "", text };
}

async function expect404(base: string, p: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`${base}${p}`, init);
  const text = await res.text();
  const label = `${init?.method ?? "GET"} ${p}`;
  check(res.status === 404, `${label} -> 404 (got ${res.status})`);
  check(/application\/json/.test(res.headers.get("content-type") ?? ""), `${label} -> JSON content-type`);
  check(!/<html|<!doctype/i.test(text), `${label} -> no HTML body`);
}

function listFiles(dir: string): Set<string> {
  try {
    return new Set(fs.readdirSync(dir));
  } catch {
    return new Set();
  }
}

async function main(): Promise<void> {
  const port = await findFreePort();
  const base = `http://${HOST}:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-agent-e2e-"));

  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    HILT_SYSTEM_AGENT_PORT: String(port),
    HILT_LOCAL_APPS_ENABLED: "true",
    HILT_MAP_LOCAL_ENABLED: "true",
    HILT_MAP_HISTORY_PREVIEW: "true",
    // sync intentionally left unconfigured -> disabled shape, no daemon needed
  };

  const before = listFiles(dataDir);
  let logs = "";
  let child: ChildProcessWithoutNullStreams | null = null;

  try {
    child = spawn("./node_modules/.bin/tsx", ["server/system-agent.ts"], { cwd: process.cwd(), env });
    child.stdout.on("data", (c: Buffer) => { logs += c.toString(); });
    child.stderr.on("data", (c: Buffer) => { logs += c.toString(); });
    await waitForServer(base, () => logs, child);

    section("machine identity");
    const machine = await getJson(base, "/api/system/machine");
    check(machine.status === 200, `machine -> 200 (got ${machine.status})`);
    check(machine.body?.app === "hilt-system", "machine.app === hilt-system");
    check(machine.body?.enabled === true, "machine.enabled === true");
    check(machine.body?.role === "agent", `machine.role === agent (got ${machine.body?.role})`);
    check(machine.body?.app_server === null, "machine.app_server === null (no mode-switch surface)");
    check(!!machine.body?.machine?.hostname, "machine.machine.hostname present");

    section("sync (disabled shape, key never leaked)");
    const sync = await getJson(base, "/api/system/sync");
    check(sync.status === 200, `sync -> 200 (got ${sync.status})`);
    check(typeof sync.body?.enabled === "boolean" || Array.isArray(sync.body?.machines), "sync returns a sync response shape");
    check(!/"apiKey"|api-key/i.test(sync.text), "sync response contains no apiKey/api-key");
    const conflicts = await getJson(base, "/api/system/sync/conflicts");
    check(conflicts.status === 200, `sync/conflicts -> 200 (got ${conflicts.status})`);
    check(!/"apiKey"|api-key/i.test(conflicts.text), "sync/conflicts contains no apiKey/api-key");

    section("apps + refresh + previews");
    const apps = await getJson(base, "/api/local-apps");
    check(apps.status === 200, `local-apps -> 200 (got ${apps.status})`);
    check(apps.body?.app === "hilt-local-apps", "local-apps.app === hilt-local-apps");
    const appsRefresh = await getJson(base, "/api/local-apps/refresh?previews=false", { method: "POST" });
    check(appsRefresh.status === 200, `local-apps/refresh POST -> 200 (got ${appsRefresh.status})`);
    check(appsRefresh.body?.app === "hilt-local-apps", "local-apps/refresh.app === hilt-local-apps");
    const badPreview = await getJson(base, "/api/local-apps/previews/not-a-png.txt");
    check(badPreview.status === 400, `previews unsafe name -> 400 (got ${badPreview.status})`);
    const missingPreview = await fetch(`${base}/api/local-apps/previews/does-not-exist.png`);
    check(missingPreview.status === 404 || missingPreview.status === 403, `previews safe+missing -> 403|404 (got ${missingPreview.status})`);

    section("stack + read-only file");
    const stack = await getJson(base, "/api/system/stack");
    check(stack.status === 200, `stack -> 200 (got ${stack.status})`);
    check(stack.body?.app === "hilt-system-stack", "stack.app === hilt-system-stack");
    const layers = stack.body?.stack?.layers ?? {};
    const firstFile: string | undefined = [
      ...(layers.system ?? []), ...(layers.user ?? []), ...(layers.project ?? []), ...(layers.local ?? []),
    ].map((f: any) => f?.path).find(Boolean);
    const noPath = await getJson(base, "/api/system/stack/file");
    check(noPath.status === 400, `stack/file without path -> 400 (got ${noPath.status})`);
    if (firstFile) {
      const file = await getJson(base, `/api/system/stack/file?path=${encodeURIComponent(firstFile)}`);
      check(file.status === 200, `stack/file(${path.basename(firstFile)}) -> 200 (got ${file.status})`);
      check(file.body?.file?.isEditable === false, "stack/file isEditable === false (read-only)");
    } else {
      console.log("  --  no stack files discovered to read (skipping read-only assertion)");
    }

    section("map: work-graph / sessions / session-detail / refresh");
    const workGraph = await getJson(base, "/api/map/local/work-graph");
    check(workGraph.status === 200, `work-graph -> 200 (got ${workGraph.status})`);
    check(!!workGraph.body?.root && typeof workGraph.body?.summary?.totalSessions === "number", "work-graph has root tree + summary");
    const sessions = await getJson(base, "/api/map/local/sessions");
    check(sessions.status === 200, `sessions -> 200 (got ${sessions.status})`);
    const sessionList: any[] = sessions.body?.items ?? [];
    check(Array.isArray(sessionList), "sessions returns a list");
    const sessionId: string | undefined = sessionList[0]?.id;
    if (sessionId) {
      const detail = await getJson(base, `/api/map/local/session-detail?id=${encodeURIComponent(sessionId)}`);
      check(detail.status === 200, `session-detail -> 200 (got ${detail.status})`);
    } else {
      const detail = await getJson(base, "/api/map/local/session-detail?id=nonexistent::session");
      check(detail.status === 404, `session-detail(missing) -> 404 (got ${detail.status})`);
    }
    const mapRefresh = await getJson(base, "/api/map/local/refresh", { method: "POST" });
    check(mapRefresh.status === 200, `map/refresh POST -> 200 (got ${mapRefresh.status})`);
    check(mapRefresh.body?.diagnostics !== undefined, "map/refresh returns diagnostics");

    section("negative routes (404, never HTML)");
    for (const p of ["/", "/index.html", "/api/system/machines", "/api/system/graph", "/api/bridge/weekly", "/api/library/items", "/events", "/navigate", "/_next/static/x.js"]) {
      await expect404(base, p);
    }
    await expect404(base, "/api/system/machine", { method: "POST" });
    await expect404(base, "/api/local-apps/refresh", { method: "GET" });

    section("no daemon/runner artifacts written to DATA_DIR");
    const after = listFiles(dataDir);
    const created = [...after].filter((f) => !before.has(f));
    console.log(`  created in DATA_DIR: ${created.join(", ") || "(none)"}`);
    check(after.has("system-agent.json"), "system-agent.json heartbeat written");
    const forbidden = ["app-supervisor.json", "granola-sync-daemon.json", "calendar-sync-event.json", "semantic.sqlite", "graph.sqlite"];
    for (const f of forbidden) check(!after.has(f), `no ${f} (daemon/runner did not start)`);
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGINT");
      await sleep(300);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\nsystem-agent e2e FAILED (${failures.length} check(s)):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nsystem-agent e2e PASSED");
  process.exit(0);
}

main().catch((error) => {
  console.error("system-agent e2e crashed:", error);
  process.exit(1);
});
