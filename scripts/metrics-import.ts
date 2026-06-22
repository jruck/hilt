/**
 * One-shot history import: fan out the old mercury-observability wide rows into
 * Hilt's per-machine telemetry store so the Performance chart keeps its trend
 * history across the cutover. Idempotent (PK upserts) — safe to re-run.
 *
 *   DATA_DIR=~/.hilt/data npm run metrics:import          # write into the live store
 *   DATA_DIR=~/.hilt/data npm run metrics:import -- --dry-run
 *
 * Source DB defaults to the standalone collector's SQLite; override with
 * HILT_METRICS_IMPORT_SRC. Canonical machine ids default to live discovery
 * (Mercury) + hestia.<tailnet>; override with HILT_METRICS_IMPORT_{MERCURY,HESTIA}_ID.
 */

import Database from "better-sqlite3";
import * as os from "os";
import * as path from "path";
import { machineIdentityAsync } from "../src/lib/local-apps/tailnet";
import { machineId } from "../src/lib/system/peers";
import { ensureTelemetrySchema, writeTick } from "../src/lib/system/telemetry/db";
import type { ComputeMetrics } from "../src/lib/system/telemetry/types";

const OLD_DB =
  process.env.HILT_METRICS_IMPORT_SRC ||
  path.join(os.homedir(), "Library", "Application Support", "mercury-observability", "metrics.sqlite");

interface OldRow {
  ts: number;
  closet_temp_f: number | null;
  closet_humidity: number | null;
  closet_motion: string | null;
  outdoor_temp_f: number | null;
  cpu_temp_c: number | null;
  gpu_temp_c: number | null;
  hestia_cpu_temp_c: number | null;
  hestia_gpu_temp_c: number | null;
  cpu_power_w: number | null;
  gpu_power_w: number | null;
  fan_rpm: number | null;
  mem_used_pct: number | null;
  mem_used_gb: number | null;
  load_1m: number | null;
  cpu_pct: number | null;
  gpu_pct: number | null;
  thermal_pressure: string | null;
}

const empty = (): ComputeMetrics => ({
  cpu_temp_c: null,
  gpu_temp_c: null,
  cpu_power_w: null,
  gpu_power_w: null,
  fan_rpm: null,
  mem_used_pct: null,
  mem_used_gb: null,
  load_1m: null,
  cpu_pct: null,
  gpu_pct: null,
  thermal_pressure: null,
});

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const mercuryId = process.env.HILT_METRICS_IMPORT_MERCURY_ID || machineId(await machineIdentityAsync());
  const hestiaId = process.env.HILT_METRICS_IMPORT_HESTIA_ID || "hestia.tailc0acaa.ts.net";

  const src = new Database(OLD_DB, { readonly: true, fileMustExist: true });
  const rows = src.prepare("SELECT * FROM samples ORDER BY ts ASC").all() as OldRow[];

  if (!dryRun) ensureTelemetrySchema();
  let imported = 0;
  let hestiaRows = 0;
  for (const r of rows) {
    const machines = [
      {
        machineId: mercuryId,
        compute: {
          ...empty(),
          cpu_temp_c: r.cpu_temp_c,
          gpu_temp_c: r.gpu_temp_c,
          cpu_power_w: r.cpu_power_w,
          gpu_power_w: r.gpu_power_w,
          fan_rpm: r.fan_rpm,
          mem_used_pct: r.mem_used_pct,
          mem_used_gb: r.mem_used_gb,
          load_1m: r.load_1m,
          cpu_pct: r.cpu_pct,
          gpu_pct: r.gpu_pct,
          thermal_pressure: r.thermal_pressure,
        } as ComputeMetrics,
      },
    ];
    if (r.hestia_cpu_temp_c != null || r.hestia_gpu_temp_c != null) {
      machines.push({
        machineId: hestiaId,
        compute: { ...empty(), cpu_temp_c: r.hestia_cpu_temp_c, gpu_temp_c: r.hestia_gpu_temp_c },
      });
      hestiaRows++;
    }
    if (!dryRun) {
      writeTick({
        ts: r.ts,
        machines,
        ambient: {
          closet_temp_f: r.closet_temp_f,
          closet_humidity: r.closet_humidity,
          closet_motion: r.closet_motion,
          outdoor_temp_f: r.outdoor_temp_f,
        },
      });
    }
    imported++;
  }
  src.close();

  console.log(`${dryRun ? "[dry-run] would import" : "imported"} ${imported} ticks from ${OLD_DB}`);
  console.log(`  mercury_id=${mercuryId}  (${imported} rows)`);
  console.log(`  hestia_id=${hestiaId}  (${hestiaRows} rows with hestia temps)`);
}

void main();
