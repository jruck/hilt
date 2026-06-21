import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import path from "node:path";
import type http from "node:http";
import { createSystemAgentServer, systemAgentHeartbeatPath } from "./system-agent";

/** Boot the agent on an ephemeral loopback port for the duration of `fn`. */
async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server: http.Server = createSystemAgentServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Temporarily set/unset env vars; returns a restore fn. */
function setEnv(vars: Record<string, string | undefined>): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function expectJson404(base: string, requestPath: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`${base}${requestPath}`, init);
  assert.equal(res.status, 404, `${requestPath} should be 404`);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/, `${requestPath} must be JSON`);
  const text = await res.text();
  assert.doesNotMatch(text, /<html|<!doctype/i, `${requestPath} must not serve HTML`);
  assert.match(text, /"error"/, `${requestPath} must carry a JSON error`);
}

describe("system agent: allowlist + 404/no-HTML contract", () => {
  const disallowed = [
    "/",
    "/index.html",
    "/api/system/machines", // the aggregate fan-out is NOT exposed by the agent
    "/api/system/graph",
    "/api/system/semantic/status",
    "/api/bridge/weekly",
    "/api/library/items",
    "/api/docs/tree",
    "/api/calendar/events",
    "/events",
    "/navigate",
    "/_next/static/chunk.js",
    "/random/nonsense",
  ];

  it("returns a JSON 404 (never HTML) for every disallowed path", async () => {
    await withServer(async (base) => {
      for (const p of disallowed) await expectJson404(base, p);
    });
  });

  it("returns 404 for the right path with the wrong method", async () => {
    await withServer(async (base) => {
      await expectJson404(base, "/api/system/machine", { method: "POST" });
      await expectJson404(base, "/api/local-apps/refresh", { method: "GET" });
      await expectJson404(base, "/api/map/local/refresh", { method: "GET" });
      await expectJson404(base, "/api/system/stack/file", { method: "PUT" });
    });
  });
});

describe("system agent: machine identity", () => {
  it("GET /api/system/machine reports role:agent and no app_server mode-switch surface", async () => {
    const restore = setEnv({
      HILT_SYSTEM_MACHINE_HOSTNAME: "agent-host",
      HILT_SYSTEM_MACHINE_DNS: "agent-host.tailnet.example",
      HILT_SYSTEM_MACHINE_IP4: "100.64.0.30",
    });
    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/system/machine`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type") ?? "", /application\/json/);
        const body = await res.json();
        assert.equal(body.app, "hilt-system");
        assert.equal(body.enabled, true);
        assert.equal(body.role, "agent");
        assert.equal(body.app_server, null);
        assert.equal(body.machine.hostname, "agent-host");
      });
    } finally {
      restore();
    }
  });
});

describe("system agent: map feature gates (no index access)", () => {
  it("all four map routes return the disabled shape when local map is off", async () => {
    const restore = setEnv({ HILT_MAP_LOCAL_ENABLED: "false" });
    try {
      await withServer(async (base) => {
        for (const p of ["/api/map/local/work-graph", "/api/map/local/sessions", "/api/map/local/session-detail"]) {
          const res = await fetch(`${base}${p}`);
          assert.equal(res.status, 403, p);
          const body = await res.json();
          assert.equal(body.disabled, true, p);
        }
        const refresh = await fetch(`${base}/api/map/local/refresh`, { method: "POST" });
        assert.equal(refresh.status, 403);
        assert.equal((await refresh.json()).disabled, true);
      });
    } finally {
      restore();
    }
  });

  it("session-detail returns the history-preview disabled shape when preview is off", async () => {
    const restore = setEnv({ HILT_MAP_LOCAL_ENABLED: undefined, HILT_MAP_HISTORY_PREVIEW: "false" });
    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/map/local/session-detail?id=whatever`);
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.disabled, true);
        assert.match(body.error, /history preview is disabled/i);
      });
    } finally {
      restore();
    }
  });
});

describe("system agent: input validation (no lib/filesystem access)", () => {
  it("rejects unsafe preview filenames with 400", async () => {
    await withServer(async (base) => {
      for (const name of ["not-a-png.txt", "..%2Fescape.png", "nested%2Ffile.png"]) {
        const res = await fetch(`${base}/api/local-apps/previews/${name}`);
        assert.equal(res.status, 400, name);
        assert.match((await res.json()).error, /invalid preview filename/i);
      }
    });
  });

  it("requires a path parameter for stack file reads", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/system/stack/file`);
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /path parameter required/i);
    });
  });
});

describe("system agent: heartbeat hygiene", () => {
  it("writes a heartbeat file distinct from the supervisor's app-supervisor.json", () => {
    const dataDir = "/tmp/hilt-agent-test-data";
    assert.equal(path.basename(systemAgentHeartbeatPath(dataDir)), "system-agent.json");
    assert.notEqual(path.basename(systemAgentHeartbeatPath(dataDir)), "app-supervisor.json");
  });
});

after(() => {
  // node:test keeps the process alive otherwise if a server lingered; all are closed in withServer.
});
