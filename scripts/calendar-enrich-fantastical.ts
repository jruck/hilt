#!/usr/bin/env tsx

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { enrichEverCommerceEventsFromFantastical, refreshFantasticalSnapshot } from "../src/lib/calendar/fantastical";
import { touchCalendarChanged } from "../src/lib/calendar/notify";

const SNAPSHOT_REFRESH_TIMEOUT_MS = 45_000;

if (process.argv.includes("--snapshot-worker")) {
  try {
    process.stdout.write(`${JSON.stringify(refreshFantasticalSnapshot())}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
} else {
  try {
    const snapshot = process.argv.includes("--refresh-snapshot")
      ? refreshSnapshotInWorker()
      : null;
    const report = enrichEverCommerceEventsFromFantastical();
    if (report.status === "ok" && report.enrichedEvents > 0) {
      touchCalendarChanged({ kind: "sync" });
    }
    process.stdout.write(`${JSON.stringify({ snapshot, enrichment: report }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

function refreshSnapshotInWorker(): ReturnType<typeof refreshFantasticalSnapshot> {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", fileURLToPath(import.meta.url), "--snapshot-worker"],
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: process.env,
      timeout: SNAPSHOT_REFRESH_TIMEOUT_MS,
    },
  );
  if (result.error && "code" in result.error && result.error.code === "ETIMEDOUT") {
    throw new Error("Fantastical snapshot refresh timed out while macOS was opening the protected cache; the existing Hilt snapshot was left unchanged.");
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Fantastical snapshot refresh failed; the existing Hilt snapshot was left unchanged.");
  }
  return JSON.parse(result.stdout) as ReturnType<typeof refreshFantasticalSnapshot>;
}
