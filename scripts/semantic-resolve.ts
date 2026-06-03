/**
 * Global entity-resolution CLI (P2.1) — run the cold-start / periodic resolution pass
 * over every mention already in semantic.sqlite (populated by the extraction backfill).
 * Blocks same-type candidates, asks the real Gemini Flash merge-judge on the ambiguous
 * ones, binds person/project entities to existing graph nodes, and writes the canonical
 * entities + aliases + item_entities. Fail-soft throughout (no merge on any LLM failure).
 *
 *   npm run semantic:resolve
 *
 * Key resolves from env or ~/.summarize/config.json (see gemini.ts). The extraction
 * step lives in the backfill; this script is the standalone re-resolve entry point
 * (e.g. after a SEMANTIC_VERSION bump re-extracts everything).
 */

import { createGeminiClient } from "../src/lib/semantic/gemini";
import { createReconcileBinder } from "../src/lib/semantic/reconcile";
import { resolveAll } from "../src/lib/semantic/resolve";
import { createGeminiMergeJudge } from "../src/lib/semantic/resolve-prompt";

async function main(): Promise<void> {
  const client = createGeminiClient();
  const judge = createGeminiMergeJudge();
  const { binder, close } = createReconcileBinder();
  const t0 = Date.now();
  try {
    const r = await resolveAll({ client, judge, reconcile: binder });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const byType = Object.entries(r.byType)
      .map(([t, n]) => `${t}:${n}`)
      .join(" ");
    process.stdout.write(
      `resolve done in ${secs}s — ${r.entitiesTotal} entities (${byType || "none"}), ${r.merges} merges, ${r.judgeCalls} judge calls\n`,
    );
  } finally {
    close();
  }
}

main().catch((e) => {
  console.error("resolve failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
