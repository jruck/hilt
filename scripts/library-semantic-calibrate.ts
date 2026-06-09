/**
 * Calibration probe for semantic topical-fit (roadmap step 6): print the empirical cosine
 * distribution between embedded saved refs and the active-context centroids, so the
 * LIBRARY_SEMANTIC_FLOOR / SCALE knobs are set to data, not a guess. Read-only.
 *
 *   DATA_DIR=$HOME/.hilt/data HILT_SEMANTIC_ENABLED=true npx tsx scripts/library-semantic-calibrate.ts
 */

import { resolveVaultRoot } from "../src/lib/graph/build";
import { buildSemanticContext } from "../src/lib/library/semantic-relevance";
import { listLibraryArtifactDetails } from "../src/lib/library/library";
import { cosineSimilarity } from "../src/lib/semantic/vector";

function percentiles(xs: number[], ps: number[]): Record<string, number> {
  const s = [...xs].sort((a, b) => a - b);
  const out: Record<string, number> = {};
  for (const p of ps) {
    const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
    out[`p${p}`] = Number((s[idx] ?? 0).toFixed(3));
  }
  return out;
}

function main(): void {
  const vault = resolveVaultRoot();
  process.env.HILT_SEMANTIC_ENABLED = "true";
  delete process.env.HILT_LIBRARY_SEMANTIC;
  const arts = listLibraryArtifactDetails(vault, { limit: 3000, includeCandidates: true }).artifacts;
  const ctx = buildSemanticContext(vault, arts);
  process.stdout.write(`available=${ctx.available}, context centroids=${ctx.contexts.length}, embedded saved refs=${ctx.artifactBySourceFile.size}\n`);
  if (!ctx.available) return;

  // For each embedded saved ref: its max cosine to any context centroid, and its top-3 mean.
  const maxCos: number[] = [];
  const top3Mean: number[] = [];
  for (const vec of ctx.artifactBySourceFile.values()) {
    const sims = ctx.contexts.map((c) => cosineSimilarity(vec, c.vec)).sort((a, b) => b - a);
    if (sims.length === 0) continue;
    maxCos.push(sims[0]);
    top3Mean.push(sims.slice(0, 3).reduce((s, x) => s + x, 0) / Math.min(3, sims.length));
  }

  const ps = [10, 25, 50, 75, 90, 95, 99];
  process.stdout.write(`\n=== max cosine (saved ref → nearest context) ===\n`);
  process.stdout.write(JSON.stringify(percentiles(maxCos, ps)) + `  (n=${maxCos.length})\n`);
  process.stdout.write(`\n=== top-3 mean cosine ===\n`);
  process.stdout.write(JSON.stringify(percentiles(top3Mean, ps)) + `\n`);

  // How many refs clear candidate floors — pick where the signal starts being selective.
  process.stdout.write(`\n=== saved refs with max cosine ≥ floor ===\n`);
  for (const floor of [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]) {
    const n = maxCos.filter((c) => c >= floor).length;
    process.stdout.write(`  floor ${floor.toFixed(2)}: ${n}/${maxCos.length} (${((100 * n) / maxCos.length).toFixed(0)}%)\n`);
  }

  // Sanity: distribution of ALL pairwise cosines (sampled) to see the noise floor.
  const sample: number[] = [];
  const vecs = [...ctx.artifactBySourceFile.values()];
  for (let i = 0; i < vecs.length && sample.length < 5000; i += 7) {
    for (const c of ctx.contexts) sample.push(cosineSimilarity(vecs[i], c.vec));
  }
  process.stdout.write(`\n=== all saved-ref↔context pairwise cosines (sampled n=${sample.length}, = the "noise floor") ===\n`);
  process.stdout.write(JSON.stringify(percentiles(sample, ps)) + `\n`);
}

main();
