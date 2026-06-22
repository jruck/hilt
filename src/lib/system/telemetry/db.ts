import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { getMetricsRetentionDays, getTelemetryDbPath } from "./config";
import {
  COMPUTE_COLUMNS,
  TEXT_COMPUTE_COLUMNS,
  emptyCompute,
  type AmbientMetrics,
  type ComputeMetrics,
  type TelemetrySample,
} from "./types";

// Two-table per-machine time-series store (WAL, cached singleton, additive
// migration) modeled on src/lib/granola/db.ts. Compute is keyed (ts, machine_id);
// ambient is keyed by ts alone so closet/outdoor are stored once per tick.

let cachedDb: Database.Database | undefined;
let cachedPath: string | undefined;

export function getTelemetryDb(): Database.Database {
  const dbPath = getTelemetryDbPath();
  if (cachedDb && cachedPath === dbPath) return cachedDb;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  cachedDb = new Database(dbPath);
  cachedPath = dbPath;
  ensureTelemetrySchema(cachedDb);
  return cachedDb;
}

export function closeTelemetryDbForTests(): void {
  cachedDb?.close();
  cachedDb = undefined;
  cachedPath = undefined;
}

export function ensureTelemetrySchema(db = getTelemetryDb()): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS machine_samples (
      ts            INTEGER NOT NULL,
      machine_id    TEXT NOT NULL,
      cpu_temp_c    REAL,
      gpu_temp_c    REAL,
      cpu_power_w   REAL,
      gpu_power_w   REAL,
      fan_rpm       REAL,
      mem_used_pct  REAL,
      mem_used_gb   REAL,
      load_1m       REAL,
      cpu_pct       REAL,
      gpu_pct       REAL,
      thermal_pressure TEXT,
      PRIMARY KEY (ts, machine_id)
    );
    CREATE INDEX IF NOT EXISTS idx_machine_samples_ts ON machine_samples(ts);

    CREATE TABLE IF NOT EXISTS ambient_samples (
      ts              INTEGER PRIMARY KEY,
      closet_temp_f   REAL,
      closet_humidity REAL,
      closet_motion   TEXT,
      outdoor_temp_f  REAL
    );
  `);
  // Additive migration so future compute metrics appear on pre-existing DBs.
  const existing = new Set(
    (db.prepare("PRAGMA table_info(machine_samples)").all() as Array<{ name: string }>).map((r) => r.name),
  );
  for (const col of COMPUTE_COLUMNS) {
    if (!existing.has(col)) {
      const type = TEXT_COMPUTE_COLUMNS.has(col) ? "TEXT" : "REAL";
      db.exec(`ALTER TABLE machine_samples ADD COLUMN ${col} ${type}`);
    }
  }
}

export function upsertMachineSample(ts: number, machineId: string, m: Partial<ComputeMetrics>): void {
  const cols = ["ts", "machine_id", ...COMPUTE_COLUMNS];
  const placeholders = cols.map(() => "?").join(", ");
  const updates = COMPUTE_COLUMNS.map((c) => `${c} = excluded.${c}`).join(", ");
  const values = [ts, machineId, ...COMPUTE_COLUMNS.map((c) => m[c] ?? null)];
  getTelemetryDb()
    .prepare(
      `INSERT INTO machine_samples (${cols.join(", ")}) VALUES (${placeholders})
       ON CONFLICT(ts, machine_id) DO UPDATE SET ${updates}`,
    )
    .run(...values);
}

const AMBIENT_COLUMNS: (keyof AmbientMetrics)[] = ["closet_temp_f", "closet_humidity", "closet_motion", "outdoor_temp_f"];

export function upsertAmbientSample(ts: number, a: Partial<AmbientMetrics>): void {
  const cols = ["ts", ...AMBIENT_COLUMNS];
  const placeholders = cols.map(() => "?").join(", ");
  // COALESCE so a partial ambient write (e.g. outdoor only) never clobbers a good
  // closet reading already stored for this tick.
  const updates = AMBIENT_COLUMNS.map((c) => `${c} = COALESCE(excluded.${c}, ambient_samples.${c})`).join(", ");
  const values = [ts, ...AMBIENT_COLUMNS.map((c) => a[c] ?? null)];
  getTelemetryDb()
    .prepare(
      `INSERT INTO ambient_samples (${cols.join(", ")}) VALUES (${placeholders})
       ON CONFLICT(ts) DO UPDATE SET ${updates}`,
    )
    .run(...values);
}

// One aligned tick: N machine rows + one ambient row, in a single transaction.
export function writeTick(input: {
  ts: number;
  machines: Array<{ machineId: string; compute: Partial<ComputeMetrics> }>;
  ambient: Partial<AmbientMetrics>;
}): void {
  const db = getTelemetryDb();
  db.transaction(() => {
    for (const { machineId, compute } of input.machines) upsertMachineSample(input.ts, machineId, compute);
    upsertAmbientSample(input.ts, input.ambient);
  })();
}

interface MachineRow extends ComputeMetrics {
  ts: number;
  machine_id: string;
}
interface AmbientRow {
  ts: number;
  closet_temp_f: number | null;
  closet_humidity: number | null;
  closet_motion: string | null;
  outdoor_temp_f: number | null;
}

function pickCompute(row: MachineRow): ComputeMetrics {
  const out = emptyCompute();
  for (const c of COMPUTE_COLUMNS) (out[c] as unknown) = row[c] ?? null;
  return out;
}

export function queryTelemetry(sinceSeconds: number): { rows: TelemetrySample[]; machineIds: string[] } {
  const db = getTelemetryDb();
  const machineRows = db
    .prepare("SELECT * FROM machine_samples WHERE ts >= ? ORDER BY ts ASC")
    .all(sinceSeconds) as MachineRow[];
  const ambientRows = db
    .prepare("SELECT * FROM ambient_samples WHERE ts >= ?")
    .all(sinceSeconds) as AmbientRow[];

  const byTs = new Map<number, TelemetrySample>();
  const ensure = (ts: number): TelemetrySample => {
    let s = byTs.get(ts);
    if (!s) {
      s = { ts, closet_temp_f: null, closet_humidity: null, closet_motion: null, outdoor_temp_f: null, machines: {} };
      byTs.set(ts, s);
    }
    return s;
  };

  const ids = new Set<string>();
  for (const r of machineRows) {
    ids.add(r.machine_id);
    ensure(r.ts).machines[r.machine_id] = pickCompute(r);
  }
  for (const a of ambientRows) {
    const s = ensure(a.ts);
    s.closet_temp_f = a.closet_temp_f;
    s.closet_humidity = a.closet_humidity;
    s.closet_motion = a.closet_motion;
    s.outdoor_temp_f = a.outdoor_temp_f;
  }

  return { rows: [...byTs.values()].sort((a, b) => a.ts - b.ts), machineIds: [...ids].sort() };
}

export function latestTelemetry(): { sample: TelemetrySample | null; latestTs: number | null; machineIds: string[] } {
  const db = getTelemetryDb();
  const m = (db.prepare("SELECT MAX(ts) AS ts FROM machine_samples").get() as { ts: number | null }).ts ?? 0;
  const a = (db.prepare("SELECT MAX(ts) AS ts FROM ambient_samples").get() as { ts: number | null }).ts ?? 0;
  const latestTs = Math.max(m, a) || null;
  if (!latestTs) return { sample: null, latestTs: null, machineIds: [] };
  const { rows, machineIds } = queryTelemetry(latestTs);
  return { sample: rows[rows.length - 1] ?? null, latestTs, machineIds };
}

// Distinct machine ids seen since a lower bound — drives the series catalog.
export function listMachineIds(sinceSeconds = 0): string[] {
  const rows = getTelemetryDb()
    .prepare("SELECT DISTINCT machine_id FROM machine_samples WHERE ts >= ? ORDER BY machine_id ASC")
    .all(sinceSeconds) as Array<{ machine_id: string }>;
  return rows.map((r) => r.machine_id);
}

export function pruneTelemetry(retentionDays = getMetricsRetentionDays(), nowMs = Date.now()): number {
  const cutoff = Math.floor(nowMs / 1000) - retentionDays * 86400;
  const db = getTelemetryDb();
  const a = db.prepare("DELETE FROM machine_samples WHERE ts < ?").run(cutoff).changes;
  const b = db.prepare("DELETE FROM ambient_samples WHERE ts < ?").run(cutoff).changes;
  return a + b;
}
