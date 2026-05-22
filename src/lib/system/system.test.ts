import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeSystemNodeId, decodeSystemSessionId, systemMachineNodeId, systemNodeId, systemSessionId } from "./map";
import { machineId, machineLabel } from "./peers";

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
