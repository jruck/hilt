import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { walkMarkdown } from "../src/lib/library/utils";
import { parseMarkdownFile } from "../src/lib/library/markdown";
import {
  appendCitationToFile,
  citationFrom,
  connectionSuggestionsOf,
  contentMatchKeys,
  sourceRank,
} from "../src/lib/library/citations";

/**
 * Cross-source content de-duplication. A library entry is the CONTENT; the sources are where it was
 * cited from. The same important article/video/episode often arrives from more than one source — most
 * commonly a podcast episode that comes in via its YouTube channel feed AND the newsletter that
 * announces it. This merges each such group into ONE canonical entry that records the others as
 * `cited_from` citations (unioning their connections), then removes the now-folded duplicate.
 *
 * Canonical preference: primary CONTENT (YouTube video / direct article) over an ANNOUNCEMENT
 * (newsletter); ties broken by saved-over-candidate, reweaved, more connections, longer body.
 *
 *   npx tsx scripts/library-dedupe.ts                 # dry run (default) — prints the merge plan
 *   npx tsx scripts/library-dedupe.ts --write         # apply: fold citations + connections, remove dupes
 *   npx tsx scripts/library-dedupe.ts --day-window=7  # widen the title-match date window (default 4)
 *
 * SAFETY: never deletes a SAVED reference (only candidate-cache files); if a non-canonical duplicate is
 * a saved reference, the citation is still folded into the canonical but the file is left in place and
 * flagged for manual handling.
 */
loadEnvConfig(process.cwd());
const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const args = process.argv.slice(2);
const write = args.includes("--write");
const dayWindow = Number((args.find((a) => a.startsWith("--day-window="))?.split("=")[1]) || 4);

interface Item {
  fp: string;
  rel: string;
  saved: boolean;
  data: Record<string, unknown>;
  body: string;
  vid: string | null;
  titleKey: string | null;
}

function load(): Item[] {
  const out: Item[] = [];
  for (const root of ["references", "references/.cache/library-candidates"]) {
    let files: string[];
    try { files = walkMarkdown(path.join(vaultPath, root), { includeHidden: root.includes(".cache") }); } catch { continue; }
    for (const fp of files) {
      let parsed: ReturnType<typeof parseMarkdownFile>;
      try { parsed = parseMarkdownFile(fp); } catch { continue; }
      const keys = contentMatchKeys({ url: String(parsed.data.url || ""), body: parsed.body, title: String(parsed.data.title || "") });
      if (!keys.videoId && !keys.titleKey) continue;
      out.push({
        fp,
        rel: path.relative(vaultPath, fp),
        saved: !fp.includes(`${path.sep}.cache${path.sep}`),
        data: parsed.data,
        body: parsed.body,
        vid: keys.videoId,
        titleKey: keys.titleKey,
      });
    }
  }
  return out;
}

const dateOf = (d: Record<string, unknown>): number =>
  Date.parse(String(d.published || d.captured || d.digested || d.digested_at || "")) || NaN;

/** Group items that are the same content (by video id, else title + close date). Cross-source only. */
function groupByContent(items: Item[]): Item[][] {
  const used = new Set<Item>();
  const groups: Item[][] = [];
  for (const a of items) {
    if (used.has(a)) continue;
    const g = [a];
    used.add(a);
    for (const b of items) {
      if (used.has(b)) continue;
      let match = false;
      if (a.vid && b.vid && a.vid === b.vid) match = true;
      else if (a.titleKey && b.titleKey && a.titleKey === b.titleKey) {
        const da = dateOf(a.data);
        const db = dateOf(b.data);
        match = !Number.isFinite(da) || !Number.isFinite(db) ? true : Math.abs(da - db) <= dayWindow * 86_400_000;
      }
      if (match) { g.push(b); used.add(b); }
    }
    if (g.length > 1) groups.push(g);
  }
  // Require ≥2 distinct REAL sources — a "source it was cited from" is an external feed, not Justin's
  // own manual note (no/`manual` source_id). This drops e.g. a hand-written note that merely embeds the
  // same video as a raindrop bookmark, while keeping true cross-source pairs (youtube feed + newsletter).
  const realSource = (i: Item) => {
    const s = String(i.data.source_id || "");
    return s && s !== "manual" && s !== "unknown" ? s : null;
  };
  return groups.filter((g) => new Set(g.map(realSource).filter(Boolean)).size > 1);
}

/** Canonical-preference ordering — higher is better, compared field by field. */
function rankKey(i: Item): number[] {
  return [
    sourceRank(String(i.data.source_id || ""), String(i.data.channel || "")),
    i.saved ? 1 : 0,
    i.data.reconnected_at ? 1 : 0,
    connectionSuggestionsOf(i.data).length,
    i.body.length,
  ];
}
function cmp(a: Item, b: Item): number {
  const ra = rankKey(a);
  const rb = rankKey(b);
  for (let i = 0; i < ra.length; i++) if (rb[i] !== ra[i]) return rb[i] - ra[i];
  return 0;
}

function main() {
  const groups = groupByContent(load());
  const results = groups.map((g) => {
    const [canonical, ...dupes] = [...g].sort(cmp);
    const folded: Array<{ rel: string; source: string; connections: number; removed: boolean; note?: string }> = [];
    for (const d of dupes) {
      const citation = citationFrom({
        source_id: String(d.data.source_id || ""),
        source_name: String(d.data.source_name || ""),
        url: String(d.data.url || ""),
        channel: String(d.data.channel || ""),
        at: String(d.data.captured || d.data.digested || d.data.published || ""),
        title: String(d.data.title || ""),
      });
      const conns = connectionSuggestionsOf(d.data);
      const keepFile = d.saved; // never delete a saved reference
      if (write) {
        appendCitationToFile(canonical.fp, citation, conns);
        if (!keepFile) fs.rmSync(d.fp);
      }
      folded.push({
        rel: d.rel,
        source: citation.source_id,
        connections: conns.length,
        removed: write && !keepFile,
        note: keepFile ? "saved reference — folded citation but left file in place (handle manually)" : undefined,
      });
    }
    return {
      canonical: canonical.rel,
      canonical_source: String(canonical.data.source_id || ""),
      title: String(canonical.data.title || "").slice(0, 70),
      folded,
    };
  });
  console.log(JSON.stringify({ write, vault: vaultPath, day_window: dayWindow, groups: results.length, results }, null, 2));
}

main();
