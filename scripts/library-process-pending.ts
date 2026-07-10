#!/usr/bin/env tsx
import { loadEnvConfig } from "@next/env";
import { drainLibraryProcessingQueue } from "../src/lib/library/processing-worker";

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
  const results = await drainLibraryProcessingQueue(vaultPath);
  process.stdout.write(`${JSON.stringify({ processed: results.length, results }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
