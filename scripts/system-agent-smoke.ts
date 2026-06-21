/* eslint-disable @typescript-eslint/no-explicit-any -- dev harness pokes at untyped JSON responses */
/**
 * Live smoke for a RUNNING System Agent (docs/plans/system-agent-mode.md).
 *
 * Curls every allowlisted route + a few disallowed ones against a base URL and
 * asserts the agent contract: machine identity reports role:agent, each route
 * answers with its enabled-or-disabled shape, disallowed paths 404 with no HTML,
 * and the Syncthing API key never leaks. Tolerant of disabled features so it works
 * against any host.
 *
 * Usage:
 *   npm run test:system-agent:smoke                       # http://127.0.0.1:3200
 *   npm run test:system-agent:smoke -- https://hestia.<tailnet>
 *   HILT_SYSTEM_AGENT_SMOKE_URL=https://hestia.<tailnet> npm run test:system-agent:smoke
 *
 * Exits 0 on success, 1 on any failure.
 */
export {}; // isolate module scope (avoids global-script identifier collisions under tsc)

const BASE = (process.argv[2] || process.env.HILT_SYSTEM_AGENT_SMOKE_URL || "http://127.0.0.1:3200").replace(/\/$/, "");
const TIMEOUT_MS = 8_000;
const failures: string[] = [];

function check(condition: unknown, message: string): void {
  if (condition) console.log(`  ok    ${message}`);
  else { console.error(`  FAIL  ${message}`); failures.push(message); }
}

async function req(p: string, init?: RequestInit): Promise<{ status: number; contentType: string; text: string; body: any }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${p}`, { ...init, cache: "no-store", signal: controller.signal });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* PNG or non-JSON */ }
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", text, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  console.log(`# system-agent smoke -> ${BASE}\n`);

  // Identity
  const machine = await req("/api/system/machine");
  check(machine.status === 200, `machine -> 200 (got ${machine.status})`);
  check(machine.body?.app === "hilt-system", "machine.app === hilt-system");
  check(machine.body?.enabled === true, "machine.enabled === true");
  check(machine.body?.role === "agent", `machine.role === agent (got ${machine.body?.role})`);
  check(machine.body?.app_server === null || machine.body?.app_server === undefined, "machine.app_server is null (no mode-switch surface)");

  // Sync (enabled or disabled shape) + key must never leak
  const sync = await req("/api/system/sync");
  check(sync.status === 200, `sync -> 200 (got ${sync.status})`);
  check(sync.body?.app === "hilt-system-sync", `sync.app === hilt-system-sync (got ${sync.body?.app})`);
  check(!/"apiKey"|api-key/i.test(sync.text), "sync response contains no apiKey/api-key");
  const conflicts = await req("/api/system/sync/conflicts");
  check(conflicts.status === 200, `sync/conflicts -> 200 (got ${conflicts.status})`);
  check(!/"apiKey"|api-key/i.test(conflicts.text), "sync/conflicts contains no apiKey/api-key");

  // Apps
  const apps = await req("/api/local-apps");
  check(apps.status === 200, `local-apps -> 200 (got ${apps.status})`);
  check(apps.body?.app === "hilt-local-apps", `local-apps.app === hilt-local-apps (got ${apps.body?.app})`);
  const badPreview = await req("/api/local-apps/previews/not-a-png.txt");
  check(badPreview.status === 400, `previews unsafe name -> 400 (got ${badPreview.status})`);

  // Stack
  const stack = await req("/api/system/stack");
  check(stack.status === 200, `stack -> 200 (got ${stack.status})`);
  check(stack.body?.app === "hilt-system-stack", `stack.app === hilt-system-stack (got ${stack.body?.app})`);

  // Map (200 when enabled, 403 disabled shape otherwise — both acceptable)
  for (const p of ["/api/map/local/work-graph", "/api/map/local/sessions"]) {
    const r = await req(p);
    check(r.status === 200 || (r.status === 403 && r.body?.disabled === true), `${p} -> 200 or 403-disabled (got ${r.status})`);
  }

  // Negative routes: JSON 404, never HTML
  for (const p of ["/", "/index.html", "/api/system/machines", "/api/system/graph", "/api/bridge/weekly", "/events"]) {
    const r = await req(p);
    check(r.status === 404, `${p} -> 404 (got ${r.status})`);
    check(/application\/json/.test(r.contentType), `${p} -> JSON content-type`);
    check(!/<html|<!doctype/i.test(r.text), `${p} -> no HTML`);
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`system-agent smoke FAILED (${failures.length}) against ${BASE}:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`system-agent smoke PASSED against ${BASE}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`system-agent smoke crashed against ${BASE}:`, error);
  process.exit(1);
});
