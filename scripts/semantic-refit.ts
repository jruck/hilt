/**
 * Topic re-fit CLI (P2.2, spec §C.5) — the launchd-scheduled global pass that re-clusters
 * the corpus, labels topics with the stronger taxonomy model, and records lineage.
 *
 *   npm run semantic:refit            # signal-gated: no-ops unless enough drift
 *   npm run semantic:refit -- --force # run regardless of the gate
 *
 * Signal-gated (the "balanced" cadence, §C.5): the job no-ops unless at least
 * SEMANTIC_REFIT_MIN_NEW items are currently unassigned (new/outlier since the last re-fit)
 * — cheap to schedule often, expensive only when the corpus actually moved. Clustering runs
 * via the real `uv` sidecar (degrades to a no-op + warning if `uv` is missing); labeling via
 * the Gemini/Claude taxonomy model (SEMANTIC_TAXONOMY_MODEL). Key resolves from env or
 * ~/.summarize/config.json (see gemini.ts).
 */

import { loadEnvConfig } from "@next/env";
import { getSemanticDb } from "../src/lib/semantic/db";
import { isSemanticEnabled, semanticRefitMinNew } from "../src/lib/semantic/config";
import { createGeminiClient } from "../src/lib/semantic/gemini";
import { runTopicRefit } from "../src/lib/semantic/topics";

// Load .env.local so the launchd job sees the same flags as the dev server (see
// semantic-backfill.ts — without this every scheduled refit silently no-ops).
loadEnvConfig(process.cwd());

/** Items with at least one embedded chunk but NO topic membership = new/outlier drift signal. */
function unassignedItemCount(): number {
  const db = getSemanticDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM semantic_items si
       WHERE EXISTS (SELECT 1 FROM chunks c WHERE c.item_id = si.item_id AND c.embedding_blob IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM item_topics it WHERE it.item_id = si.item_id)`,
    )
    .get() as { c: number };
  return Number(row.c);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");

  // Flag short-circuit so a stray installed launchd plist is a no-op when the feature is off.
  if (!isSemanticEnabled() && !force) {
    process.stdout.write("refit skipped — HILT_SEMANTIC_ENABLED is off (use --force for a manual run).\n");
    return;
  }

  const minNew = semanticRefitMinNew();
  const drift = unassignedItemCount();
  if (!force && drift < minNew) {
    process.stdout.write(`refit skipped — ${drift} unassigned items < SEMANTIC_REFIT_MIN_NEW (${minNew}). Use --force to override.\n`);
    return;
  }

  const client = createGeminiClient();
  const t0 = Date.now();
  const r = await runTopicRefit({ client });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r.ran) {
    process.stdout.write(`refit did not run — clustering abstained (uv/sidecar unavailable or empty corpus); taxonomy unchanged.\n`);
    return;
  }
  process.stdout.write(
    `refit done in ${secs}s — ${r.topics} topics (${r.rootTopics} root / ${r.leafTopics} leaf), ` +
      `${r.itemsAssigned} items assigned, ${r.outliers} outliers · lineage ` +
      `carry=${r.lineage.carry} split=${r.lineage.split} merge=${r.lineage.merge} birth=${r.lineage.birth} death=${r.lineage.death}\n`,
  );
}

main().catch((e) => {
  console.error("refit failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
