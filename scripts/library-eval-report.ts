/**
 * Library eval inspection report. A safe, read-only "workbench-lite": writes a markdown snapshot of what
 * the eval currently decides across the library — disposition, worth ranking, substance/worth
 * distributions, generation status, and the `to_archive` review pile — so it can be read in Hilt while
 * the interactive sidebar workbench is still pending. Re-run anytime; it never mutates library files.
 *
 *   npx tsx scripts/library-eval-report.ts            # writes to the vault Hilt project + repo docs
 */
import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { evaluateLibrary } from "../src/lib/library/recommendations";
import { listLibraryArtifactDetails } from "../src/lib/library/library";
import { connectionPassState, connectionSuggestionsFromFrontmatter } from "../src/lib/library/connection-state";

loadEnvConfig(process.cwd());
const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const stamp = process.argv.slice(2).find((a) => !a.startsWith("--")) || "report";

function bucket(n: number, edges: number[]): string {
  for (let i = 0; i < edges.length; i++) if (n < edges[i]) return `<${edges[i]}`;
  return `≥${edges[edges.length - 1]}`;
}
function histogram(values: number[], edges: number[]): string {
  const counts: Record<string, number> = {};
  for (const e of [...edges.map((x) => `<${x}`), `≥${edges[edges.length - 1]}`]) counts[e] = 0;
  for (const v of values) counts[bucket(v, edges)]++;
  return Object.entries(counts).map(([k, c]) => `${k}: ${c}`).join("  ·  ");
}

function main() {
  const scored = evaluateLibrary(vaultPath);
  // evaluateLibrary spreads the full detail, so raw_frontmatter is present at runtime though the
  // RecommendedArtifact type omits it (it extends the summary shape). Read it through a cast.
  const fm = (a: (typeof scored)[number]): Record<string, unknown> =>
    (a as unknown as { raw_frontmatter?: Record<string, unknown> }).raw_frontmatter || {};
  const all = listLibraryArtifactDetails(vaultPath, { limit: 5000, includeCandidates: true, mode: "all" } as Parameters<typeof listLibraryArtifactDetails>[1]).artifacts;
  const keep = all.filter((a) => a.library_mode === "keep");

  const conns = (a: (typeof scored)[number]) => connectionSuggestionsFromFrontmatter(fm(a));
  const graded = scored.filter((a) => typeof fm(a).substance === "number");
  const hasConns = scored.filter((a) => conns(a).length > 0);
  const judgedAbstain = scored.filter((a) => connectionPassState(fm(a)) === "abstained");
  const neverJudged = scored.filter((a) => connectionPassState(fm(a)) === "never");
  const toArchive = scored.filter((a) => a.lifecycle === "to_archive");

  const byVersion: Record<string, number> = {};
  for (const a of scored) { const v = String(fm(a).pipeline_version || "(none)"); byVersion[v] = (byVersion[v] || 0) + 1; }

  const bySource: Record<string, { n: number; sum: number }> = {};
  for (const a of scored) { const s = a.source_name || a.channel || "?"; (bySource[s] ||= { n: 0, sum: 0 }); bySource[s].n++; bySource[s].sum += a.worth; }
  const sourceRows = Object.entries(bySource).sort((x, y) => y[1].sum / y[1].n - x[1].sum / x[1].n)
    .map(([s, { n, sum }]) => `| ${s} | ${n} | ${(sum / n).toFixed(2)} |`).join("\n");

  const byWorth = [...scored].sort((a, b) => b.worth - a.worth);
  const top = byWorth.slice(0, 25);
  const archiveSample = [...toArchive].sort((a, b) => a.worth - b.worth).slice(0, 30);

  const md = [
    `# Library eval report — ${stamp}`,
    "",
    "Read-only snapshot. The eval is dynamic; this reflects the active context at generation time.",
    "",
    "## Disposition & lifecycle",
    `- study (scored): **${scored.length}**  ·  keep (stash, out of feed): **${keep.length}**`,
    `- lifecycle: active **${scored.length - toArchive.length}**  ·  to_archive (flagged for review, NOT moved) **${toArchive.length}**`,
    "",
    "## Generation status",
    `- substance graded (model): **${graded.length}** / ${scored.length}  ·  ungraded (structural proxy): ${scored.length - graded.length}`,
    `- connections: has **${hasConns.length}**  ·  judged & abstained **${judgedAbstain.length}**  ·  never judged **${neverJudged.length}**`,
    `- pipeline_version: ${Object.entries(byVersion).map(([v, c]) => `${v}:${c}`).join("  ")}`,
    "",
    "## Distributions",
    `- **worth**: ${histogram(scored.map((a) => a.worth), [0.05, 0.15, 0.3, 0.5])}`,
    `- **relevance**: ${histogram(scored.map((a) => a.relevance), [0.2, 0.4, 0.6, 0.8])}`,
    `- **substance**: ${histogram(scored.map((a) => a.substance), [0.2, 0.4, 0.6, 0.8])}`,
    "",
    "## Mean worth by source",
    "| source | n | mean worth |",
    "|---|---|---|",
    sourceRows,
    "",
    "## Top 25 by worth (For You preview)",
    ...top.map((a) => `- **${a.worth}** · ${a.title?.slice(0, 64)}  \n  ${a.why}`),
    "",
    `## to_archive review pile (${toArchive.length}) — bottom-worth study items flagged for your review`,
    "_Non-destructive: these stay in the main folder. Rescue any that matter (and why) to refine grading._",
    "",
    ...archiveSample.map((a) => `- ${a.worth} · ${a.title?.slice(0, 64)}  — ${a.why}`),
    toArchive.length > 30 ? `\n…and ${toArchive.length - 30} more.` : "",
  ].join("\n");

  const outVault = path.join(vaultPath, "projects", "hilt", "library-eval-report.md");
  const outRepo = path.join(process.cwd(), "docs", "plans", "library-eval-report.md");
  fs.mkdirSync(path.dirname(outVault), { recursive: true });
  fs.writeFileSync(outVault, md);
  fs.writeFileSync(outRepo, md);
  console.log(`wrote report → ${outVault}`);
  console.log(`study=${scored.length} keep=${keep.length} to_archive=${toArchive.length} substance_graded=${graded.length}`);
}

main();
