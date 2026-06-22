import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Point the store at a throwaway file before any db call (read lazily in getTelemetryDb).
const TMP = path.join(os.tmpdir(), `hilt-metrics-test-${process.pid}.sqlite`);
process.env.HILT_METRICS_DB_PATH = TMP;

import { buildMachineCatalog, labelFromMachineId } from "./catalog";
import {
  closeTelemetryDbForTests,
  latestTelemetry,
  listMachineIds,
  pruneTelemetry,
  queryTelemetry,
  writeTick,
} from "./db";

function cleanup(): void {
  closeTelemetryDbForTests();
  for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

test("writeTick stores per-machine compute and one ambient row per tick", () => {
  cleanup();
  writeTick({
    ts: 1000,
    machines: [
      { machineId: "mercury-v.tailc0acaa.ts.net", compute: { cpu_temp_c: 50, gpu_temp_c: 40 } },
      { machineId: "hestia.tailc0acaa.ts.net", compute: { cpu_temp_c: 38 } },
    ],
    ambient: { closet_temp_f: 85, outdoor_temp_f: 77, closet_humidity: 42, closet_motion: "inactive" },
  });

  const { rows, machineIds } = queryTelemetry(0);
  assert.equal(rows.length, 1, "one aligned tick");
  assert.deepEqual(machineIds.sort(), ["hestia.tailc0acaa.ts.net", "mercury-v.tailc0acaa.ts.net"]);
  const s = rows[0];
  assert.equal(s.closet_temp_f, 85);
  assert.equal(s.outdoor_temp_f, 77);
  assert.equal(s.machines["mercury-v.tailc0acaa.ts.net"].cpu_temp_c, 50);
  assert.equal(s.machines["mercury-v.tailc0acaa.ts.net"].gpu_temp_c, 40);
  assert.equal(s.machines["hestia.tailc0acaa.ts.net"].cpu_temp_c, 38);
  assert.equal(s.machines["hestia.tailc0acaa.ts.net"].gpu_temp_c, null, "missing metrics are null");
  cleanup();
});

test("ambient is keyed by ts; partial re-write does not clobber a good closet value", () => {
  cleanup();
  writeTick({ ts: 2000, machines: [], ambient: { closet_temp_f: 86, outdoor_temp_f: 70 } });
  // A later partial write for the SAME tick (outdoor only) must keep closet via COALESCE.
  writeTick({ ts: 2000, machines: [], ambient: { outdoor_temp_f: 72, closet_temp_f: null } });
  const { rows } = queryTelemetry(0);
  assert.equal(rows.length, 1, "still one ambient row for the tick");
  assert.equal(rows[0].closet_temp_f, 86, "closet preserved");
  assert.equal(rows[0].outdoor_temp_f, 72, "outdoor updated");
  cleanup();
});

test("latestTelemetry returns the newest tick; prune drops old rows", () => {
  cleanup();
  const nowSec = 1_000_000_000;
  writeTick({ ts: nowSec - 400 * 86400, machines: [{ machineId: "m", compute: { cpu_temp_c: 10 } }], ambient: {} });
  writeTick({ ts: nowSec, machines: [{ machineId: "m", compute: { cpu_temp_c: 60 } }], ambient: { closet_temp_f: 88 } });

  const latest = latestTelemetry();
  assert.equal(latest.latestTs, nowSec);
  assert.equal(latest.sample?.machines["m"].cpu_temp_c, 60);

  const removed = pruneTelemetry(365, nowSec * 1000);
  assert.ok(removed >= 1, "old row pruned");
  assert.equal(listMachineIds(0).length, 1);
  cleanup();
});

test("catalog: deterministic colors, collector sorts first, title-cased label", () => {
  const ids = ["hestia.tailc0acaa.ts.net", "mercury-v.tailc0acaa.ts.net"];
  const cat = buildMachineCatalog(ids, "mercury-v.tailc0acaa.ts.net");
  assert.equal(cat[0].id, "mercury-v.tailc0acaa.ts.net", "collector first");
  assert.equal(cat[0].color, "#a855f7", "Mercury = violet");
  assert.equal(cat[0].label, "Mercury");
  assert.equal(cat[1].color, "#ec4899", "Hestia = magenta");
  assert.equal(cat[1].label, "Hestia");
  // Stable regardless of input order / which peers are present.
  const cat2 = buildMachineCatalog([...ids].reverse(), "mercury-v.tailc0acaa.ts.net");
  assert.deepEqual(
    cat2.map((m) => `${m.id}:${m.color}`),
    cat.map((m) => `${m.id}:${m.color}`),
  );
  assert.equal(labelFromMachineId("apollo.tailc0acaa.ts.net"), "Apollo");
});
