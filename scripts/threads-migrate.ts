/**
 * Migrate the two legacy comment stores into the thread store (v3 unit C2).
 *
 *   npx tsx scripts/threads-migrate.ts            # dry-run (default): report, write nothing
 *   DATA_DIR=~/.hilt/data npx tsx scripts/threads-migrate.ts --write
 *
 * Sources:
 *   - <vault>/meta/loops/<domain>/feedback/records.jsonl        (live loops)
 *   - <DATA_DIR>/loops-shadow/meta/loops/<domain>/feedback/...  (shadow loops)
 *   - <DATA_DIR>/library-feedback/<vaultKey>.json               (library comments)
 *
 * Original files are LEFT IN PLACE (history). Idempotent: records already lifted (matched by
 * source_ref / message id) are skipped, so re-runs are no-ops.
 */
import os from "os";
import path from "path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { defaultSandboxDir } from "../src/lib/loops/emit";
import {
  discoverFeedbackJsonl,
  discoverLibraryStores,
  existingSourceIds,
  migrateFeedbackJsonl,
  migrateLibraryFeedbackStore,
  type MigrationSourceReport,
} from "../src/lib/threads/migrate";
import { threadsDir } from "../src/lib/threads/store";

const args = process.argv.slice(2);
const write = args.includes("--write");

const vaultPath = process.env.BRIDGE_VAULT_PATH
  || process.env.HILT_WORKING_FOLDER
  || path.join(os.homedir(), "work/bridge");
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");

console.log(`threads-migrate ${write ? "WRITE" : "DRY-RUN (pass --write to apply)"}`);
console.log(`  vault:    ${vaultPath}`);
console.log(`  data dir: ${dataDir}`);
console.log(`  threads:  ${threadsDir()}`);

const existing = existingSourceIds();
const reports: MigrationSourceReport[] = [];

for (const file of discoverFeedbackJsonl([vaultPath, defaultSandboxDir()])) {
  reports.push(migrateFeedbackJsonl(file, existing, { write }));
}
for (const file of discoverLibraryStores(dataDir)) {
  reports.push(migrateLibraryFeedbackStore(file, existing, { write }));
}

if (reports.length === 0) {
  console.log("No feedback sources found.");
} else {
  let migrated = 0;
  let skipped = 0;
  for (const report of reports) {
    migrated += report.migrated;
    skipped += report.skipped;
    const malformed = report.malformed ? ` malformed=${report.malformed}` : "";
    console.log(`  ${report.source}`);
    console.log(`    records=${report.total} ${write ? "migrated" : "would migrate"}=${report.migrated} skipped(existing)=${report.skipped}${malformed}`);
  }
  console.log(`${write ? "Migrated" : "Would migrate"} ${migrated} record(s); ${skipped} already in the thread store.`);
}
