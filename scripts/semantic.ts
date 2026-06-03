/**
 * `semantic` CLI — the headless query backbone (ships first; topic exploration is the
 * primary command). Reads only the query layer (src/lib/semantic/query.ts) over
 * DATA_DIR/semantic.sqlite. Human output by default; `--json` for machine use.
 *
 *   tsx scripts/semantic.ts status
 *   tsx scripts/semantic.ts topics [--recent] [--parent <id>]
 *   tsx scripts/semantic.ts topic <id>
 *   tsx scripts/semantic.ts related <itemId> [--k N]
 *   tsx scripts/semantic.ts entity <name…>
 *   tsx scripts/semantic.ts item <itemId>
 */

import { entityByName, getTopic, itemTopics, listTopics, recentTopics, relatedToItem, status } from "../src/lib/semantic/query";

interface Args {
  cmd: string;
  rest: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const [cmd = "status", ...tail] = argv;
  const rest: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < tail.length; i++) {
    const t = tail[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = tail[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(t);
    }
  }
  return { cmd, rest, flags };
}

function out(json: boolean, human: () => void, data: unknown): void {
  if (json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else human();
}

function requireBuilt(): boolean {
  if (status().built) return true;
  process.stderr.write("semantic layer not built yet — run the cold-start backfill first.\n");
  return false;
}

function main(): number {
  const { cmd, rest, flags } = parseArgs(process.argv.slice(2));
  const json = flags.json === true;

  switch (cmd) {
    case "status": {
      const s = status();
      out(json, () => {
        if (!s.built) return console.log("semantic: not built yet");
        console.log(`semantic: built · ${s.items} items · ${s.embeddedChunks}/${s.chunks} chunks embedded · ${s.entities} entities · ${s.topics} topics${s.builtAt ? ` · updated ${s.builtAt}` : ""}`);
      }, s);
      return 0;
    }
    case "topics": {
      if (!requireBuilt()) return json ? (process.stdout.write('{"error":"not_built"}\n'), 1) : 1;
      const topics = flags.recent ? recentTopics() : listTopics({ parentId: typeof flags.parent === "string" ? flags.parent : undefined });
      out(json, () => {
        if (topics.length === 0) console.log("(no topics)");
        for (const t of topics) console.log(`  ${t.label}  (${t.itemCount})  [${t.id}]`);
      }, topics);
      return 0;
    }
    case "topic": {
      if (!requireBuilt()) return 1;
      const id = rest[0];
      if (!id) { process.stderr.write("usage: semantic topic <id>\n"); return 2; }
      const d = getTopic(id);
      if (!d) { process.stderr.write(`no topic ${id}\n`); return 1; }
      out(json, () => {
        console.log(`# ${d.topic.label}  [${d.topic.id}]`);
        if (d.children.length) console.log("\nSub-topics:\n" + d.children.map((c) => `  ${c.label} (${c.itemCount}) [${c.id}]`).join("\n"));
        console.log("\nItems:\n" + d.items.map((i) => `  ${i.title ?? i.itemId} — ${i.itemId}`).join("\n"));
        if (d.lineage.length) console.log("\nLineage:\n" + d.lineage.map((l) => `  ${l.op}  ${l.oldTopicId ?? "∅"} → ${l.newTopicId ?? "∅"}`).join("\n"));
      }, d);
      return 0;
    }
    case "related": {
      if (!requireBuilt()) return 1;
      const id = rest[0];
      if (!id) { process.stderr.write("usage: semantic related <itemId>\n"); return 2; }
      const k = typeof flags.k === "string" ? Number(flags.k) : 10;
      const hits = relatedToItem(id, k);
      out(json, () => {
        if (hits.length === 0) console.log("(no related items — item missing or not embedded)");
        for (const h of hits) console.log(`  ${h.score.toFixed(3)}  ${h.title ?? h.itemId} (${h.kind})  ${h.itemId}`);
      }, hits);
      return 0;
    }
    case "entity": {
      if (!requireBuilt()) return 1;
      const name = rest.join(" ");
      if (!name) { process.stderr.write("usage: semantic entity <name>\n"); return 2; }
      const e = entityByName(name);
      if (!e) { process.stderr.write(`no entity matching "${name}"\n`); return 1; }
      out(json, () => {
        console.log(`# ${e.name}  (${e.type})${e.summary ? ` — ${e.summary}` : ""}`);
        console.log("\nItems:\n" + e.items.map((i) => `  ${i.title ?? i.itemId} — ${i.itemId}`).join("\n"));
      }, e);
      return 0;
    }
    case "item": {
      if (!requireBuilt()) return 1;
      const id = rest[0];
      if (!id) { process.stderr.write("usage: semantic item <itemId>\n"); return 2; }
      const topics = itemTopics(id);
      const related = relatedToItem(id, 5);
      out(json, () => {
        console.log(`# ${id}`);
        console.log("Topics: " + (topics.map((t) => t.label).join(", ") || "(none)"));
        console.log("Related:\n" + (related.map((h) => `  ${h.score.toFixed(3)} ${h.title ?? h.itemId}`).join("\n") || "  (none)"));
      }, { itemId: id, topics, related });
      return 0;
    }
    default:
      process.stderr.write(`unknown command "${cmd}". Try: status | topics | topic | related | entity | item\n`);
      return 2;
  }
}

process.exit(main());
