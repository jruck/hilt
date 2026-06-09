/**
 * Head-to-head: token-overlap contextFit vs semantic-cosine contextFit, per embedded saved
 * ref — the real diagnostic for whether the semantic blend adds signal or token-overlap
 * already saturates it. Read-only.
 *
 *   DATA_DIR=$HOME/.hilt/data HILT_SEMANTIC_ENABLED=true npx tsx scripts/library-semantic-headtohead.ts
 */

import { resolveVaultRoot } from "../src/lib/graph/build";
import { listLibraryArtifactDetails } from "../src/lib/library/library";
import { __debugActiveContextSignals, __debugTokenContextFit } from "../src/lib/library/recommendations";
import { buildSemanticContext, scoreArtifactSemantic } from "../src/lib/library/semantic-relevance";
import type { ConnectionSuggestion, LibraryArtifactDetail } from "../src/lib/library/types";

function firstPartyCount(a: LibraryArtifactDetail): number {
  const cs = Array.isArray(a.raw_frontmatter.connection_suggestions) ? (a.raw_frontmatter.connection_suggestions as ConnectionSuggestion[]) : [];
  return cs.filter((c) => c && typeof c === "object" && /^(projects|areas|thoughts|people|writing)\//.test(c.target ?? "")).length;
}

function hist(xs: number[], edges: number[]): string {
  const counts = edges.map(() => 0);
  for (const x of xs) {
    let i = edges.length - 1;
    while (i > 0 && x < edges[i]) i--;
    counts[i]++;
  }
  return edges.map((e, i) => `${e.toFixed(2)}:${counts[i]}`).join("  ");
}

function main(): void {
  const vault = resolveVaultRoot();
  process.env.HILT_SEMANTIC_ENABLED = "true";
  delete process.env.HILT_LIBRARY_SEMANTIC;

  const arts = listLibraryArtifactDetails(vault, { limit: 3000, includeCandidates: true }).artifacts;
  const signals = __debugActiveContextSignals(vault, arts);
  const ctx = buildSemanticContext(vault, arts);
  if (!ctx.available) {
    process.stdout.write("semantic unavailable\n");
    return;
  }

  const saved = arts.filter((a) => a.lifecycle_status === "saved" && a.library_mode !== "keep");
  let embedded = 0;
  let semWins = 0;
  let tokenZeroSemPos = 0; // token found nothing, semantic found something (the rescue case)
  let bothZero = 0;
  const tokFits: number[] = [];
  const semFits: number[] = [];
  const unconnectedSemWins: string[] = [];

  for (const a of saved) {
    const sem = scoreArtifactSemantic(vault, a, ctx);
    if (!sem) continue; // not embedded
    embedded++;
    const tok = __debugTokenContextFit(a, signals);
    tokFits.push(tok);
    semFits.push(sem.score);
    if (sem.score > tok + 0.0005) semWins++;
    if (tok < 0.02 && sem.score > 0.05) tokenZeroSemPos++;
    if (tok < 0.02 && sem.score < 0.02) bothZero++;
    if (firstPartyCount(a) === 0 && sem.score > tok + 0.05) {
      unconnectedSemWins.push(`  ${tok.toFixed(2)}→${sem.score.toFixed(2)}  ${sem.label ?? "?"}  ::  ${(a.title || a.id).slice(0, 60)}`);
    }
  }

  const edges = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.45];
  process.stdout.write(`embedded saved refs: ${embedded}\n`);
  process.stdout.write(`\ntoken contextFit histogram:    ${hist(tokFits, edges)}\n`);
  process.stdout.write(`semantic contextFit histogram: ${hist(semFits, edges)}\n`);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  process.stdout.write(`\nmean token fit:    ${mean(tokFits).toFixed(3)}\n`);
  process.stdout.write(`mean semantic fit: ${mean(semFits).toFixed(3)}\n`);
  process.stdout.write(`\nsemantic > token (MAX picks semantic): ${semWins}/${embedded} (${((100 * semWins) / embedded).toFixed(0)}%)\n`);
  process.stdout.write(`token≈0 but semantic>0.05 (rescue case): ${tokenZeroSemPos}\n`);
  process.stdout.write(`both≈0 (no signal either way):           ${bothZero}\n`);

  process.stdout.write(`\n=== unconnected refs where semantic beats token by >0.05 (top 25) ===\n`);
  for (const line of unconnectedSemWins.slice(0, 25)) process.stdout.write(line + "\n");
  process.stdout.write(`(total: ${unconnectedSemWins.length})\n`);
}

main();
