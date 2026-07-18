import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { isRetiredGraphSystemUrl, isSystemMode, legacyConversationScopeFromSystemUrl, stackScopeFromSystemUrl, systemModeFromUrl, systemScopeForMode } from "./navigation";
import { decodeSystemNodeId, decodeSystemSessionId, systemMachineNodeId, systemNodeId, systemSessionId } from "./map";
import { machineIdentity } from "../local-apps/tailnet";
import { localSystemMachineResponse, machineId, machineLabel, systemMachineFromResponse } from "./peers";
import { __resetSystemSyncCacheForTests, collectConflictFiles, readLocalSystemSync, readSystemSyncForMachines } from "./sync";
import type { SystemMachine, SystemMachineResponse } from "./types";

describe("system machine ids", () => {
  it("prefers stable tailnet identity for machine ids and labels", () => {
    const machine = {
      hostname: "mercury.local",
      tailscale_dns: "mercury.tailc0acaa.ts.net",
      tailscale_ip4: "100.80.0.95",
      origin: "remote" as const,
    };

    assert.equal(machineId(machine), "mercury.tailc0acaa.ts.net");
    assert.equal(machineLabel(machine), "mercury");
  });

  it("falls back to hostname when tailnet identity is missing", () => {
    const machine = {
      hostname: "xochipilli",
      tailscale_dns: null,
      tailscale_ip4: null,
      origin: "local" as const,
    };

    assert.equal(machineId(machine), "xochipilli");
    assert.equal(machineLabel(machine), "xochipilli");
  });

  it("supports an explicit demo/screenshot machine identity override", () => {
    const previousHostname = process.env.HILT_SYSTEM_MACHINE_HOSTNAME;
    const previousDns = process.env.HILT_SYSTEM_MACHINE_DNS;
    const previousIp4 = process.env.HILT_SYSTEM_MACHINE_IP4;
    try {
      process.env.HILT_SYSTEM_MACHINE_HOSTNAME = "demo-workstation";
      process.env.HILT_SYSTEM_MACHINE_DNS = "demo-workstation.tailnet.example";
      process.env.HILT_SYSTEM_MACHINE_IP4 = "100.64.0.10";

      const machine = machineIdentity();
      assert.equal(machine.hostname, "demo-workstation");
      assert.equal(machine.tailscale_dns, "demo-workstation.tailnet.example");
      assert.equal(machine.tailscale_ip4, "100.64.0.10");
      assert.equal(machineLabel(machine), "demo-workstation");
    } finally {
      if (previousHostname === undefined) delete process.env.HILT_SYSTEM_MACHINE_HOSTNAME;
      else process.env.HILT_SYSTEM_MACHINE_HOSTNAME = previousHostname;
      if (previousDns === undefined) delete process.env.HILT_SYSTEM_MACHINE_DNS;
      else process.env.HILT_SYSTEM_MACHINE_DNS = previousDns;
      if (previousIp4 === undefined) delete process.env.HILT_SYSTEM_MACHINE_IP4;
      else process.env.HILT_SYSTEM_MACHINE_IP4 = previousIp4;
    }
  });
});

describe("system Map id namespacing", () => {
  it("round-trips session ids containing provider separators", () => {
    const id = systemSessionId("mercury.tailc0acaa.ts.net", "codex:019e41dd-39a2");

    assert.equal(id, "mercury.tailc0acaa.ts.net::codex:019e41dd-39a2");
    assert.deepEqual(decodeSystemSessionId(id), {
      machineId: "mercury.tailc0acaa.ts.net",
      sessionId: "codex:019e41dd-39a2",
    });
  });

  it("round-trips machine and nested node ids", () => {
    assert.deepEqual(decodeSystemNodeId(systemMachineNodeId("xochipilli")), {
      machineId: "xochipilli",
      nodeId: "root",
    });

    assert.deepEqual(decodeSystemNodeId(systemNodeId("xochipilli", "workspace:/work/hilt")), {
      machineId: "xochipilli",
      nodeId: "workspace:/work/hilt",
    });
  });

  it("rejects unscoped local node/session ids", () => {
    assert.equal(decodeSystemNodeId("root"), null);
    assert.equal(decodeSystemSessionId("codex:019e41dd"), null);
  });
});

describe("system navigation", () => {
  it("routes sync as a first-class System mode", () => {
    assert.equal(systemModeFromUrl("system", "/sync"), "sync");
    assert.equal(systemScopeForMode("sync"), "/sync");
    assert.equal(isSystemMode("sync"), true);
  });

  it("routes performance as a first-class System mode", () => {
    assert.equal(systemModeFromUrl("system", "/performance"), "performance");
    assert.equal(systemScopeForMode("performance"), "/performance");
    assert.equal(isSystemMode("performance"), true);
  });

  it("keeps Stack scope behavior separate from other System modes", () => {
    assert.equal(systemScopeForMode("stack", "/Users/jruck/work/engineering/hilt"), "/stack/Users/jruck/work/engineering/hilt");
    assert.equal(stackScopeFromSystemUrl("system", "/stack/Users/jruck/work/engineering/hilt"), "/Users/jruck/work/engineering/hilt");
    assert.equal(stackScopeFromSystemUrl("system", "/sync"), "");
  });

  it("no longer treats threads/chats as System modes — they redirect to the top-level Chats view", () => {
    assert.equal(isSystemMode("threads"), false);
    assert.equal(isSystemMode("chats"), false);
    assert.equal(systemModeFromUrl("system", "/threads"), "sessions");
    assert.equal(legacyConversationScopeFromSystemUrl("system", "/threads"), "");
    assert.equal(legacyConversationScopeFromSystemUrl("system", "/threads/th-123"), "/th-123");
    assert.equal(legacyConversationScopeFromSystemUrl("system", "/chats/abc-def"), "/abc-def");
    assert.equal(legacyConversationScopeFromSystemUrl("system", "/sync"), null);
    assert.equal(legacyConversationScopeFromSystemUrl("docs", "/threads/th-123"), null);
  });

  it("resolves retired knowledge-graph links to Sessions", () => {
    assert.equal(isSystemMode("graph"), false);
    assert.equal(systemModeFromUrl("system", "/graph"), "sessions");
    assert.equal(systemModeFromUrl("system", "/graph/focus/something"), "sessions");
    assert.equal(isRetiredGraphSystemUrl("system", "/graph"), true);
    assert.equal(isRetiredGraphSystemUrl("system", "/graph/focus/something"), true);
    assert.equal(isRetiredGraphSystemUrl("system", "/sessions"), false);
    assert.equal(isRetiredGraphSystemUrl("docs", "/graph"), false);
  });
});

describe("system sync snapshots", () => {
  it("finds conflict files without entering generated folders", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hilt-sync-conflicts-"));
    try {
      await writeFile(join(dir, "note.sync-conflict-20260522.txt"), "conflict");
      await writeFile(join(dir, ".stignore"), "#include .hilt-syncthing-ignore\n");
      await writeFile(join(dir, ".hilt-syncthing-ignore"), "**/node_modules\n");
      await writeFile(join(dir, "regular.txt"), "ok");
      await writeFile(join(dir, "node_modules"), "");
      const summary = await collectConflictFiles(dir);
      assert.equal(summary.count, 1);
      assert.equal(summary.files[0].path, "note.sync-conflict-20260522.txt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads Syncthing REST state and caches expensive status calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hilt-sync-rest-"));
    const apiKeyFile = join(dir, "api-key");
    await writeFile(apiKeyFile, "secret\n");
    await writeFile(join(dir, ".stignore"), "#include .hilt-syncthing-ignore\n");
    await writeFile(join(dir, ".hilt-syncthing-ignore"), "(?d).DS_Store\n**/node_modules\n");
    await writeFile(join(dir, "draft.sync-conflict-20260522.md"), "ours");

    let statusCalls = 0;
    const server = http.createServer((req, res) => {
      if (req.headers["x-api-key"] !== "secret") {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad key" }));
        return;
      }

      const url = new URL(req.url || "/", "http://127.0.0.1");
      const send = (data: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };

      if (url.pathname === "/rest/system/version") return send({ version: "v-test" });
      if (url.pathname === "/rest/system/status") return send({ myID: "SELF", startTime: "2026-05-22T12:00:00Z" });
      if (url.pathname === "/rest/system/connections") return send({
        connections: {
          PEER: { connected: true, address: "tcp://mercury-v.tailc0acaa.ts.net:22000", clientVersion: "v-test" },
        },
      });
      if (url.pathname === "/rest/config/folders/work-meta") return send({
        id: "work-meta",
        label: "Work Meta",
        path: dir,
        type: "sendreceive",
        devices: [{ deviceID: "SELF" }, { deviceID: "PEER" }],
        versioning: { type: "staggered", params: { maxAge: "7776000" } },
        maxConflicts: -1,
      });
      if (url.pathname === "/rest/db/status") {
        statusCalls += 1;
        return send({
          state: "idle",
          stateChanged: "2026-05-22T12:01:00Z",
          inSyncFiles: 3,
          inSyncBytes: 128,
          localBytes: 128,
          needFiles: 0,
          needBytes: 0,
          pullErrors: 0,
        });
      }
      if (url.pathname === "/rest/stats/folder") return send({
        "work-meta": {
          lastScan: "2026-05-22T12:02:00Z",
          lastFile: { at: "2026-05-22T12:01:30Z", filename: "probe.md", deleted: false },
        },
      });
      if (url.pathname === "/rest/folder/errors") return send({ errors: [] });
      if (url.pathname === "/rest/db/ignores") return send({
        ignore: ["#include .hilt-syncthing-ignore"],
        expanded: ["(?d).DS_Store", "**/node_modules"],
      });

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    const port = address && typeof address === "object" ? address.port : 0;

    const machine: SystemMachine = {
      id: "xochipilli.tailc0acaa.ts.net",
      self: true,
      reachable: true,
      source_url: null,
      machine: {
        hostname: "Xochipilli",
        tailscale_dns: "xochipilli.tailc0acaa.ts.net",
        tailscale_ip4: "100.104.52.2",
        origin: "local",
      },
      features: { map: true, apps: true, stack: true, sync: true },
      error: null,
    };

    try {
      __resetSystemSyncCacheForTests();
      const settings = {
        enabled: true,
        provider: "syncthing" as const,
        folderId: "work-meta",
        url: `http://127.0.0.1:${port}`,
        apiKeyFile,
        cacheMs: 60_000,
      };

      const first = await readLocalSystemSync({ machine, settings });
      const second = await readLocalSystemSync({ machine, settings });

      assert.equal(first.enabled, true);
      assert.equal(second.enabled, true);
      if (first.enabled && second.enabled) {
        assert.equal(first.machine.daemon.version, "v-test");
        assert.equal(first.machine.folder?.id, "work-meta");
        assert.equal(first.machine.folder?.lastScan, "2026-05-22T12:02:00Z");
        assert.equal(first.machine.folder?.versioning.maxAgeDays, 90);
        assert.equal(first.machine.folder?.maxConflicts, -1);
        assert.equal(first.machine.folder?.ignore.includePresent, true);
        assert.equal(first.machine.folder?.conflicts.count, 1);
        assert.equal(first.machine.folder?.disk.syncedBytes, 128);
        assert.equal(first.machine.peers[0].connected, true);
        assert.equal(second.machine.folder?.inSyncFiles, 3);
      }
      assert.equal(statusCalls, 1);
    } finally {
      __resetSystemSyncCacheForTests();
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("probes a peer sync endpoint even when the feature flag is stale", async () => {
    const remoteMachine: SystemMachine = {
      id: "xochipilli.tailc0acaa.ts.net",
      self: false,
      reachable: true,
      source_url: "https://xochipilli.tailc0acaa.ts.net",
      machine: {
        hostname: "Xochipilli",
        tailscale_dns: "xochipilli.tailc0acaa.ts.net",
        tailscale_ip4: "100.104.52.2",
        origin: "remote",
      },
      features: { map: true, apps: true, stack: true, sync: false },
      error: null,
    };

    let requestedPath = "";
    const response = await readSystemSyncForMachines([remoteMachine], {
      force: true,
      peerFetcher: async (_machine, path) => {
        requestedPath = path;
        return {
          app: "hilt-system-sync",
          enabled: true,
          machine: {
            machine: remoteMachine,
            provider: "syncthing",
            enabled: true,
            readOnly: true,
            daemon: {
              reachable: true,
              version: "v-test",
              deviceId: "REMOTE",
              startTime: "2026-06-09T12:00:00Z",
              error: null,
            },
            folder: {
              id: "work-meta",
              label: "Work Meta",
              path: "/Users/jruck/work/meta",
              type: "sendreceive",
              paused: false,
              state: "idle",
              stateChanged: "2026-06-09T12:01:00Z",
              lastScan: "2026-06-09T12:02:00Z",
              lastFile: null,
              globalBytes: 128,
              globalFiles: 1,
              inSyncBytes: 128,
              inSyncFiles: 1,
              localBytes: 128,
              localFiles: 1,
              needBytes: 0,
              needFiles: 0,
              needDeletes: 0,
              pullErrors: 0,
              versioning: { enabled: true, type: "staggered", maxAgeDays: 90, path: null },
              maxConflicts: -1,
              ignore: {
                localHash: "local",
                sharedHash: "shared",
                includePresent: true,
                patternCount: 1,
                expandedPatternCount: 1,
              },
              errors: [],
              conflicts: {
                count: 0,
                truncated: false,
                files: [],
                scannedAt: "2026-06-09T12:02:00Z",
              },
              disk: {
                totalBytes: 128,
                syncedBytes: 128,
                ignoredBytes: 0,
                otherBytes: 0,
                ignoredPathCount: 0,
                largestIgnoredPaths: [],
              },
            },
            peers: [],
            refreshedAt: "2026-06-09T12:03:00Z",
            error: null,
          },
        };
      },
    });

    assert.equal(requestedPath, "/api/system/sync?scope=local&force=true");
    assert.equal(response.summary.machine_count, 1);
    assert.equal(response.summary.healthy_count, 1);
    assert.equal(response.machines[0].enabled, true);
  });
});

describe("system agent role contract", () => {
  const reject = (data: unknown) =>
    systemMachineFromResponse(data as Partial<SystemMachineResponse>, "https://peer.example");

  it("accepts a peer response that omits role and defaults it to full (back-compat)", () => {
    const machine = {
      hostname: "xochipilli",
      tailscale_dns: "xochipilli.tailc0acaa.ts.net",
      tailscale_ip4: "100.104.52.2",
      origin: "local" as const,
    };
    const parsed = systemMachineFromResponse(
      { app: "hilt-system", enabled: true, machine, features: { map: true, apps: true, stack: true, sync: true } },
      "https://xochipilli.tailc0acaa.ts.net",
    );
    assert.ok(parsed);
    assert.equal(parsed?.role, "full");
    assert.equal(parsed?.machine.origin, "remote");
  });

  it("surfaces an explicit agent role from the peer response", () => {
    const machine = {
      hostname: "hestia",
      tailscale_dns: "hestia.tailc0acaa.ts.net",
      tailscale_ip4: null,
      origin: "local" as const,
    };
    const parsed = systemMachineFromResponse(
      { app: "hilt-system", enabled: true, role: "agent", machine, features: { map: true, apps: true, stack: true, sync: true } },
      "https://hestia.tailc0acaa.ts.net",
    );
    assert.equal(parsed?.role, "agent");
    assert.equal(parsed?.source_url, "https://hestia.tailc0acaa.ts.net");
  });

  it("rejects non-Hilt, disabled, or machine-less responders", () => {
    const machine = { hostname: "x", tailscale_dns: null, tailscale_ip4: null, origin: "local" as const };
    assert.equal(reject({ app: "something-else", enabled: true, machine }), null);
    assert.equal(reject({ app: "hilt-system", enabled: false, machine }), null);
    assert.equal(reject({ app: "hilt-system", enabled: true }), null);
  });

  it("emits role on the local machine response: full by default, agent + null app_server on request", async () => {
    const prev = {
      hostname: process.env.HILT_SYSTEM_MACHINE_HOSTNAME,
      dns: process.env.HILT_SYSTEM_MACHINE_DNS,
      ip4: process.env.HILT_SYSTEM_MACHINE_IP4,
    };
    try {
      process.env.HILT_SYSTEM_MACHINE_HOSTNAME = "agent-host";
      process.env.HILT_SYSTEM_MACHINE_DNS = "agent-host.tailnet.example";
      process.env.HILT_SYSTEM_MACHINE_IP4 = "100.64.0.20";

      const full = await localSystemMachineResponse();
      assert.equal(full.app, "hilt-system");
      assert.equal(full.enabled, true);
      assert.equal(full.role, "full");

      const agent = await localSystemMachineResponse({ role: "agent", includeAppServer: false });
      assert.equal(agent.role, "agent");
      assert.equal(agent.app_server, null);
      assert.equal(agent.machine.hostname, "agent-host");
    } finally {
      const restore = (key: string, value: string | undefined) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore("HILT_SYSTEM_MACHINE_HOSTNAME", prev.hostname);
      restore("HILT_SYSTEM_MACHINE_DNS", prev.dns);
      restore("HILT_SYSTEM_MACHINE_IP4", prev.ip4);
    }
  });
});
