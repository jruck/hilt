/** Phase 3 gate: induced-failure verification of the runtime loop's check logic. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { absenceItems, healthDigestItems, substrateItems, type SubstrateInputs } from "./runtime";
import { emitLoopArtifact } from "./emit";
import type { LoopsRegistry, RegistryLoop } from "./types";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hilt-runtime-"));
}

const LIB: RegistryLoop = { id: "library", domain: "references", cadence: "daily", enabled: true, phase: "shadow" };
const RT: RegistryLoop = { id: "runtime", domain: "system", cadence: "daily", enabled: true, phase: "shadow" };
const OFF: RegistryLoop = { id: "meeting-actions", domain: "meetings", cadence: "daily", enabled: false, phase: "shadow" };
const REG: LoopsRegistry = { loops: [LIB, RT, OFF] };

function writeArtifact(base: string, loop: RegistryLoop, date: string, ok = true, proposalIds: string[] = []): void {
  emitLoopArtifact({
    vaultPath: "/nonexistent-vault",
    sandboxDir: base,
    loop,
    date,
    runAt: `${date}T05:10:00.000Z`,
    items: [],
    health: { ok, notes: ok ? "fine" : "broke", proposal_ids: proposalIds.length ? proposalIds : undefined },
    contentBody: `# ${loop.id} — ${date}\n`,
  });
}

test("absence: enabled loop with NO artifact escalates; disabled loops are ignored", () => {
  const sandbox = tmp();
  const items = absenceItems(REG, { shadow: sandbox, live: tmp() }, "2026-07-06");
  const absent = items.find((i) => i.id.includes("absent-library"));
  assert.ok(absent, "library should be flagged absent");
  assert.ok(absent!.escalated, "absence escalates");
  assert.ok(!items.some((i) => i.id.includes("meeting-actions")), "disabled loop ignored");
  assert.ok(!items.some((i) => i.id.includes("-runtime")), "runtime does not watch itself");
});

test("absence: fresh artifact is quiet; stale (cadence+grace exceeded) escalates", () => {
  const sandbox = tmp();
  writeArtifact(sandbox, LIB, "2026-07-05"); // 1 day old on 07-06: within daily+grace
  assert.equal(absenceItems(REG, { shadow: sandbox, live: tmp() }, "2026-07-06").length, 0);
  const stale = tmp();
  writeArtifact(stale, LIB, "2026-07-02"); // 4 days old
  const items = absenceItems(REG, { shadow: stale, live: tmp() }, "2026-07-06");
  assert.equal(items.length, 1);
  assert.match(items[0].title, /STALE/);
  assert.ok(items[0].escalated);
});

test("health digest: FAILING loop escalates; pending proposals are a quiet insight", () => {
  const sandbox = tmp();
  writeArtifact(sandbox, LIB, "2026-07-06", false);
  let items = healthDigestItems(REG, { shadow: sandbox, live: tmp() }, "2026-07-06");
  assert.equal(items.length, 1);
  assert.match(items[0].title, /FAILING/);
  assert.ok(items[0].escalated);

  const sandbox2 = tmp();
  writeArtifact(sandbox2, LIB, "2026-07-06", true, ["lib-prop-2026-07-06-1"]);
  items = healthDigestItems(REG, { shadow: sandbox2, live: tmp() }, "2026-07-06");
  assert.equal(items.length, 1);
  assert.match(items[0].title, /1 tuning proposal/);
  assert.ok(!items[0].escalated, "pending proposals inform, not alarm");
});

test("health digest: malformed artifact escalates as a contract violation", () => {
  const sandbox = tmp();
  const dir = path.join(sandbox, "meta/loops/references/reports");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "2026-07-06.md"), "---\nloop: library\n---\nno items or health\n");
  const items = healthDigestItems(REG, { shadow: sandbox, live: tmp() }, "2026-07-06");
  assert.equal(items.length, 1);
  assert.match(items[0].title, /FAILS the contract/);
  assert.ok(items[0].escalated);
});

test("substrate: known-good inputs produce zero items", () => {
  const good: SubstrateInputs = {
    launchdExitCodes: { "com.hilt.briefing.daily": 0, "com.hilt.library.steering": 0 },
    criticalJobs: ["com.hilt.briefing.daily"],
    claudeVersion: "2.1.198 (Claude Code)",
    oauthTokenConfigured: true,
    diskFreeFraction: 0.42,
    supervisorHeartbeatAgeMin: 3,
    briefingPresent: true,
  };
  assert.equal(substrateItems(good, "2026-07-06").length, 0);
});

test("substrate: each induced failure produces the right item with the right escalation", () => {
  const bad: SubstrateInputs = {
    launchdExitCodes: { "com.hilt.briefing.daily": 1, "com.hilt.library.cleanup": 78 },
    criticalJobs: ["com.hilt.briefing.daily"],
    claudeVersion: "1.0.38 (Claude Code)",
    oauthTokenConfigured: false,
    diskFreeFraction: 0.05,
    supervisorHeartbeatAgeMin: 90,
    briefingPresent: false,
  };
  const items = substrateItems(bad, "2026-07-06");
  const byId = (frag: string) => items.find((i) => i.id.includes(frag));

  assert.ok(byId("launchd-com.hilt.briefing.daily")?.escalated, "critical job failure escalates");
  assert.ok(byId("launchd-com.hilt.library.cleanup"), "non-critical failure is an item");
  assert.ok(!byId("launchd-com.hilt.library.cleanup")?.escalated, "non-critical does not escalate");
  assert.ok(byId("claude-fossil")?.escalated, "v1.x CLI is the fossil incident class");
  assert.ok(byId("token-missing")?.escalated);
  assert.ok(byId("disk")?.escalated);
  assert.ok(byId("supervisor")?.escalated);
  assert.ok(byId("briefing-missing")?.escalated);
});
