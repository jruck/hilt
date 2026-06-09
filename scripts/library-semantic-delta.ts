/**
 * Measure the semantic-relevance lift on the L3 library eval (roadmap step 6 validation).
 *
 * Runs `evaluateLibrary` twice over the real vault — once token-only
 * (HILT_LIBRARY_SEMANTIC=false) and once with the embedding-cosine blend on — and reports
 * the per-artifact delta in relevance/worth, the lift distribution, the top movers, and any
 * to_archive lifecycle flips. Read-only: it opens semantic.sqlite read-only via the eval seam
 * and never writes, so it's safe to run while a backfill/extraction is still in flight.
 *
 *   DATA_DIR=$HOME/.hilt/data npm run library:semantic:delta
 */

import { resolveVaultRoot } from "../src/lib/graph/build";
import { evaluateLibrary } from "../src/lib/library/recommendations";
import { buildSemanticContext } from "../src/lib/library/semantic-relevance";
import { listLibraryArtifactDetails } from "../src/lib/library/library";
import type { RecommendedArtifact } from "../src/lib/library/types";

function index(items: RecommendedArtifact[]): Map<string, RecommendedArtifact> {
  return new Map(items.map((a) => [a.id, a]));
}

function pct(n: number, d: number): string {
  return d === 0 ? "0%" : `${((100 * n) / d).toFixed(1)}%`;
}

function main(): void {
  const vault = resolveVaultRoot();

  // Availability probe — fail loud if the semantic layer can't contribute.
  const arts = listLibraryArtifactDetails(vault, { limit: 3000, includeCandidates: true }).artifacts;
  process.env.HILT_SEMANTIC_ENABLED = "true";
  delete process.env.HILT_LIBRARY_SEMANTIC;
  const ctx = buildSemanticContext(vault, arts);
  process.stdout.write(`vault: ${vault}\n`);
  process.stdout.write(`semantic context: available=${ctx.available}, context centroids=${ctx.contexts.length}, embedded saved refs=${ctx.artifactBySourceFile.size}\n`);
  if (!ctx.available) {
    process.stdout.write("\nSemantic context unavailable — is HILT_SEMANTIC_ENABLED set and semantic.sqlite built? Nothing to compare.\n");
    return;
  }

  // Token-only baseline.
  process.env.HILT_LIBRARY_SEMANTIC = "false";
  const before = index(evaluateLibrary(vault, { limit: 3000 }));
  // Semantic blend on.
  delete process.env.HILT_LIBRARY_SEMANTIC;
  process.env.HILT_SEMANTIC_ENABLED = "true";
  const after = index(evaluateLibrary(vault, { limit: 3000 }));

  type Move = { id: string; title: string; saved: boolean; relBefore: number; relAfter: number; worthBefore: number; worthAfter: number; whyAfter: string; lcBefore: string; lcAfter: string };
  const moves: Move[] = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a) continue;
    moves.push({
      id,
      title: (a.title || id).slice(0, 64),
      saved: a.lifecycle_status === "saved",
      relBefore: b.relevance ?? 0,
      relAfter: a.relevance ?? 0,
      worthBefore: b.worth ?? 0,
      worthAfter: a.worth ?? 0,
      whyAfter: a.why ?? "",
      lcBefore: b.lifecycle ?? "active",
      lcAfter: a.lifecycle ?? "active",
    });
  }

  const saved = moves.filter((m) => m.saved);
  const changed = moves.filter((m) => Math.abs(m.relAfter - m.relBefore) > 0.0005);
  const lifted = moves.filter((m) => m.relAfter - m.relBefore > 0.0005);
  const dropped = moves.filter((m) => m.relAfter - m.relBefore < -0.0005);

  const archBefore = moves.filter((m) => m.lcBefore === "to_archive").length;
  const archAfter = moves.filter((m) => m.lcAfter === "to_archive").length;
  process.stdout.write(`\n=== Coverage ===\n`);
  process.stdout.write(`study items compared: ${moves.length} (saved refs: ${saved.length}, candidates+other: ${moves.length - saved.length})\n`);
  process.stdout.write(`to_archive flagged: token-only ${archBefore} (${pct(archBefore, moves.length)}) → semantic ${archAfter} (${pct(archAfter, moves.length)})\n`);
  process.stdout.write(`relevance changed: ${changed.length} (${pct(changed.length, moves.length)}) — lifted ${lifted.length}, lowered ${dropped.length}\n`);
  process.stdout.write(`(REPLACE semantics: embedded refs swap inflated token fit for the cosine gradient, so most move DOWN off the saturated ceiling — that's the differentiation, not a regression.)\n`);

  // Magnitude distribution over the changed set (absolute delta).
  const buckets = [0.01, 0.05, 0.1, 0.2, 0.3];
  process.stdout.write(`\n=== |relevance change| distribution (changed items) ===\n`);
  let lo = 0;
  for (const hi of buckets) {
    const n = changed.filter((m) => Math.abs(m.relAfter - m.relBefore) > lo && Math.abs(m.relAfter - m.relBefore) <= hi).length;
    process.stdout.write(`  ${lo.toFixed(2)}..${hi.toFixed(2)}: ${n}\n`);
    lo = hi;
  }
  const big = changed.filter((m) => Math.abs(m.relAfter - m.relBefore) > 0.3).length;
  process.stdout.write(`  >0.30: ${big}\n`);

  // Lifecycle flips (to_archive ⇄ active).
  const flips = moves.filter((m) => m.lcBefore !== m.lcAfter);
  process.stdout.write(`\n=== Lifecycle flips (to_archive ⇄ active) ===\n`);
  process.stdout.write(`  total flips: ${flips.length}\n`);
  const rescued = flips.filter((m) => m.lcBefore === "to_archive" && m.lcAfter === "active");
  process.stdout.write(`  rescued from to_archive (token-only flagged, semantic kept): ${rescued.length}\n`);
  for (const m of rescued.slice(0, 10)) process.stdout.write(`    · ${m.title}  rel ${m.relBefore.toFixed(2)}→${m.relAfter.toFixed(2)}\n`);
  const newlyFlagged = flips.filter((m) => m.lcBefore === "active" && m.lcAfter === "to_archive");
  process.stdout.write(`  newly flagged to_archive (lost their saturated relevance): ${newlyFlagged.length}\n`);
  for (const m of newlyFlagged.slice(0, 10)) process.stdout.write(`    · ${m.title}  rel ${m.relBefore.toFixed(2)}→${m.relAfter.toFixed(2)}  worth ${m.worthBefore.toFixed(2)}→${m.worthAfter.toFixed(2)}\n`);

  // Biggest movers by absolute change.
  const top = [...changed].sort((a, b) => Math.abs(b.relAfter - b.relBefore) - Math.abs(a.relAfter - a.relBefore)).slice(0, 20);
  process.stdout.write(`\n=== Top 20 relevance movers (by |Δ|) ===\n`);
  for (const m of top) {
    const d = m.relAfter - m.relBefore;
    process.stdout.write(`  ${(d >= 0 ? "+" : "")}${d.toFixed(3)}  rel ${m.relBefore.toFixed(2)}→${m.relAfter.toFixed(2)}  worth ${m.worthBefore.toFixed(2)}→${m.worthAfter.toFixed(2)}  ${m.title}\n`);
    process.stdout.write(`           why: ${m.whyAfter}\n`);
  }
}

main();
