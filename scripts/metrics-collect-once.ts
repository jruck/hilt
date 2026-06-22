/**
 * Run a single collector tick on demand (self + peers + NWS → one stored tick).
 * Useful for verification / a launchd-timer fallback. Honors DATA_DIR.
 *
 *   DATA_DIR=~/.hilt/data npm run metrics:collect-once
 */

import { collectOnce } from "../src/lib/system/telemetry/daemon";

async function main(): Promise<void> {
  const result = await collectOnce();
  console.log(`[metrics] wrote tick @${result.ts} for machines: ${result.machineIds.join(", ") || "(none responded)"}`);
}

void main();
