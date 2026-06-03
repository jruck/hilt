/**
 * Semantic backfill dispatcher (P2.4) — the single CLI entrypoint the launchd jobs share.
 *
 *   npm run semantic:backfill                 # cold-start (default), full corpus
 *   npm run semantic:backfill -- --limit 30   # cheap slice (real smoke)
 *   npm run semantic:backfill:cold            # alias for `cold-start` (launchd cold-start job)
 *   npm run semantic:gc                       # drop rows whose version != active_version
 *   npm run semantic:backfill -- sample --review-batch <label>   # decimal sample lane
 *
 * Modes:
 *   cold-start (default) — embed/extract/cluster the whole corpus; blesses active_version on a
 *                          true cold-start (no prior baseline). Idempotent + resumable.
 *   sample               — a coexistence/decimal pass: writes new-version rows WITHOUT blessing
 *                          (the prior baseline stays live), and registers the sample items into
 *                          the SEMANTIC review queue with the version's review note.
 *   gc                   — sweep rows whose semantic_version != active_version (post-bless).
 *
 * Flag-gated: a no-op when HILT_SEMANTIC_ENABLED is off (so a stray installed plist does
 * nothing) unless `--force` is passed for a manual dev run. Key resolves from env or
 * ~/.summarize/config.json (see gemini.ts).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { runColdStart } from "../src/lib/semantic/backfill";
import { isSemanticEnabled } from "../src/lib/semantic/config";
import { gcStaleVersions, getActiveVersion, listItemRows } from "../src/lib/semantic/db";
import { createGeminiClient } from "../src/lib/semantic/gemini";
import { SEMANTIC_VERSION } from "../src/lib/semantic/pipeline";
import { resolveVaultRoot } from "../src/lib/graph/build";
import { addToReviewQueue } from "../src/lib/library/review-queue";

type Mode = "cold-start" | "sample" | "gc";

function parseMode(args: string[]): Mode {
  const positional = args.find((a) => !a.startsWith("--"));
  if (positional === "gc") return "gc";
  if (positional === "sample") return "sample";
  if (positional === "cold-start" || positional === "cold") return "cold-start";
  return "cold-start";
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Read docs/semantic-review-notes/<version>.md as the batch note (title = H1, body = rest). */
function loadReviewNote(version: string): { version: string; title: string; markdown: string } | undefined {
  const notePath = join(process.cwd(), "docs", "semantic-review-notes", `${version}.md`);
  if (!existsSync(notePath)) return undefined;
  const raw = readFileSync(notePath, "utf-8");
  const lines = raw.split("\n");
  const h1 = lines.find((l) => l.startsWith("# "));
  const title = h1 ? h1.replace(/^#\s+/, "").trim() : version;
  return { version, title, markdown: raw };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = parseMode(args);
  const force = args.includes("--force");

  if (!isSemanticEnabled() && !force) {
    process.stdout.write("semantic backfill skipped — HILT_SEMANTIC_ENABLED is off (use --force for a manual run).\n");
    return;
  }

  if (mode === "gc") {
    const r = gcStaleVersions();
    process.stdout.write(`gc done — active_version=${r.activeVersion}, removed ${r.rowsRemoved} rows at superseded versions.\n`);
    return;
  }

  const limitRaw = argValue(args, "--limit");
  const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
  const client = createGeminiClient();
  const t0 = Date.now();

  // sample = coexistence pass: write new-version rows but DON'T bless the active baseline.
  const blessActive = mode === "sample" ? false : undefined;
  const r = await runColdStart({
    client,
    limit,
    blessActive,
    onProgress: (done, total, id) => {
      if (done === 1 || done === total || done % 10 === 0) process.stderr.write(`  ${done}/${total}  ${id}\n`);
    },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(
    `${mode} done in ${secs}s — ${r.itemsEmbedded} embedded, ${r.itemsSkipped} skipped, ${r.chunksEmbedded} chunks, ` +
      `${r.embedCalls} embed calls, ${r.entitiesResolved} entities, ${r.topicsTotal} topics (${r.topicsItemsAssigned} items assigned) · ` +
      `active_version=${getActiveVersion()}\n`,
  );

  // A sample pass carries its review note + the sample items into the SEMANTIC review queue
  // (sibling store, no collision with the Library queue) so the decimal lane is reviewable.
  if (mode === "sample") {
    const reviewBatch = argValue(args, "--review-batch") ?? SEMANTIC_VERSION;
    const note = loadReviewNote(SEMANTIC_VERSION);
    const root = resolveVaultRoot();
    const entries = listItemRows()
      .filter((it) => it.semantic_version === SEMANTIC_VERSION)
      .map((it) => ({ id: it.item_id, path: it.source_file, pipeline_version: it.semantic_version }));
    const { added } = addToReviewQueue(root, entries, { batch: reviewBatch, note, kind: "semantic" });
    process.stdout.write(`sample registered ${added} items into the semantic review queue (batch=${reviewBatch}).\n`);
  }
}

main().catch((e) => {
  console.error("semantic backfill failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
