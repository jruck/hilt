/* eslint-disable @typescript-eslint/no-explicit-any -- dev harness normalizes untyped JSON responses */
/**
 * Agent-vs-full parity check (docs/plans/system-agent-mode.md, M4) — the strongest
 * correctness proof for the System Agent.
 *
 * Boots the real `server/system-agent.ts` against a shared DATA_DIR, then for every
 * capability fetches the agent route AND calls the equivalent full-Hilt local lib
 * function IN THIS PROCESS against the same DATA_DIR. After normalizing volatile
 * fields (per-call timestamps, latency) both sides must be deepEqual — proving the
 * agent returns byte-identical output to full Hilt and never mangles/drops fields.
 *
 * The machine route is the one intentional difference (role + app_server), compared
 * with those two fields excluded. Run: npm run test:system-agent:parity
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

const HOST = "127.0.0.1";

// Load .env exactly like the child agent does, so the in-process reference runs under
// the SAME world (e.g. HILT_SYNC_ENABLED) as the spawned agent. Our explicit overrides
// below win because loadEnvConfig never clobbers an already-set process.env value.
loadEnvConfig(process.cwd());

// Shared DATA_DIR + feature flags. Set early; config reads are lazy but this keeps the
// reference and the child agent pointed at the same throwaway world.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-agent-parity-"));
process.env.DATA_DIR = dataDir;
process.env.HILT_LOCAL_APPS_ENABLED = "true";
process.env.HILT_MAP_LOCAL_ENABLED = "true";
process.env.HILT_MAP_HISTORY_PREVIEW = "true";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, HOST, () => {
      const address = srv.address();
      if (!address || typeof address === "string") return reject(new Error("no port"));
      const { port } = address;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitForServer(base: string, logs: () => string, child: ChildProcessWithoutNullStreams): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`agent exited early (${child.exitCode}).\n${logs()}`);
    try {
      const res = await fetch(`${base}/api/system/machine`, { cache: "no-store" });
      if (res.ok || res.status === 404) return;
    } catch { /* keep polling */ }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for agent.\n${logs()}`);
}

const VOLATILE = /(_at$|_ms$|At$|Ms$)|(latency|uptime|elapsed|duration|since|timestamp|start_time|startTime|stateChanged|lastScan|lastFile|refreshed|scanned|checked|generated|indexed|beat|built)/i;

/** Replace volatile-keyed values (per-call timestamps, latency) with a sentinel, recursively. */
function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = VOLATILE.test(k) ? "<volatile>" : stripVolatile(v);
    return out;
  }
  return value;
}

async function fetchJson(base: string, p: string): Promise<unknown> {
  const res = await fetch(`${base}${p}`, { cache: "no-store" });
  return res.json();
}

/** Return a human path to the first structural difference between two normalized values. */
function firstDiff(a: unknown, b: unknown, p = "$"): string | null {
  if (a === b) return null;
  const ta = Array.isArray(a) ? "array" : a === null ? "null" : typeof a;
  const tb = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;
  if (ta !== tb) return `${p}: type ${ta} != ${tb}`;
  if (ta === "array") {
    const aa = a as unknown[]; const bb = b as unknown[];
    if (aa.length !== bb.length) return `${p}.length: ${aa.length} != ${bb.length}`;
    for (let i = 0; i < aa.length; i++) { const d = firstDiff(aa[i], bb[i], `${p}[${i}]`); if (d) return d; }
    return null;
  }
  if (ta === "object") {
    const ao = a as Record<string, unknown>; const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) {
      if (!(k in ao)) return `${p}.${k}: missing in agent`;
      if (!(k in bo)) return `${p}.${k}: missing in full`;
      const d = firstDiff(ao[k], bo[k], `${p}.${k}`); if (d) return d;
    }
    return null;
  }
  return `${p}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

interface ParityCase {
  name: string;
  path: string;
  reference: () => Promise<unknown>;
  normalize?: (body: any) => unknown;
}

async function main(): Promise<void> {
  // Dynamic imports so the lib picks up the env set above.
  const { localSystemMachineResponse } = await import("@/lib/system/peers");
  const { readLocalSystemSync, readLocalSystemSyncConflicts } = await import("@/lib/system/sync");
  const { getLocalAppsResponse } = await import("@/lib/local-apps/scanner");
  const { normalizeForParity } = await import("@/lib/local-apps/parity");
  const { readLocalSystemStack } = await import("@/lib/system/stack");
  const { ensureMapIndexFresh, refreshMapIndex } = await import("@/lib/map/local-indexer");
  const { buildIndexedWorkGraph, queryIndexedSessionPage } = await import("@/lib/map/local-query");
  const { graphQuerySchema, graphResponseSchema, sessionsQuerySchema, sessionsResponseSchema } =
    await import("@/lib/map/local-contracts");

  // Pre-warm the shared Map index so the child agent reads the same committed rows.
  await refreshMapIndex();

  const graphQuery = graphQuerySchema.parse({});
  const sessionsQuery = sessionsQuerySchema.parse({});

  const cases: ParityCase[] = [
    {
      name: "machine (role/app_server excluded)",
      path: "/api/system/machine",
      reference: () => localSystemMachineResponse(),
      normalize: (body) => {
        const { role, app_server, ...rest } = body ?? {};
        return stripVolatile(rest);
      },
    },
    {
      name: "sync",
      path: "/api/system/sync",
      reference: () => readLocalSystemSync({ force: false }),
      normalize: stripVolatile,
    },
    {
      name: "sync/conflicts",
      path: "/api/system/sync/conflicts?folder=work-meta",
      reference: () => readLocalSystemSyncConflicts("work-meta", { force: false }),
      normalize: stripVolatile,
    },
    {
      name: "local-apps (normalizeForParity on groups)",
      path: "/api/local-apps",
      reference: () => getLocalAppsResponse({ includePeers: false }),
      normalize: (body) => (body?.groups ? normalizeForParity({ groups: body.groups }, { includePreviews: true }) : body),
    },
    {
      name: "stack (embedded app_server excluded)",
      path: "/api/system/stack",
      reference: () => readLocalSystemStack(null),
      normalize: (body) => {
        const clone = structuredClone(body ?? {});
        if (clone?.machine) delete clone.machine.app_server;
        return stripVolatile(clone);
      },
    },
    {
      name: "map/work-graph",
      path: "/api/map/local/work-graph",
      reference: async () => {
        await ensureMapIndexFresh(15_000);
        return graphResponseSchema.parse(buildIndexedWorkGraph(graphQuery));
      },
      normalize: stripVolatile,
    },
    {
      name: "map/sessions",
      path: "/api/map/local/sessions",
      reference: async () => {
        await ensureMapIndexFresh(15_000);
        return sessionsResponseSchema.parse(queryIndexedSessionPage(sessionsQuery));
      },
      normalize: stripVolatile,
    },
  ];

  const port = await findFreePort();
  const base = `http://${HOST}:${port}`;
  let logs = "";
  let child: ChildProcessWithoutNullStreams | null = null;
  const failures: string[] = [];

  try {
    child = spawn("./node_modules/.bin/tsx", ["server/system-agent.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, HILT_SYSTEM_AGENT_PORT: String(port) },
    });
    child.stdout.on("data", (c: Buffer) => { logs += c.toString(); });
    child.stderr.on("data", (c: Buffer) => { logs += c.toString(); });
    await waitForServer(base, () => logs, child);

    for (const c of cases) {
      const normalize = c.normalize ?? stripVolatile;
      let agentBody: unknown;
      let refBody: unknown;
      try {
        // Sequential (agent first): lets the agent's request settle before the
        // in-process reference reads the same committed Map index / daemon state.
        agentBody = await fetchJson(base, c.path);
        // Round-trip the reference through JSON so it reflects what full Hilt actually
        // SERVES (NextResponse.json drops `undefined` keys, stringifies Dates, etc.) —
        // matching the agent's own sendJson serialization. This is wire-vs-wire parity.
        refBody = JSON.parse(JSON.stringify(await c.reference()));
      } catch (error) {
        failures.push(`${c.name}: error producing outputs — ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const agentNorm = normalize(agentBody as any);
      const refNorm = normalize(refBody as any);
      try {
        assert.deepEqual(agentNorm, refNorm);
        console.log(`  ok    parity: ${c.name}`);
      } catch {
        failures.push(c.name);
        console.error(`  FAIL  parity: ${c.name}`);
        console.error(`        first diff -> ${firstDiff(agentNorm, refNorm)}`);
      }
    }
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGINT");
      await sleep(300);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\nsystem-agent parity FAILED (${failures.length}): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nsystem-agent parity PASSED (agent output == full-Hilt local output)");
  process.exit(0);
}

main().catch((error) => {
  console.error("system-agent parity crashed:", error);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(1);
});
