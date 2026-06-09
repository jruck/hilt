/**
 * Delete every library item (references, candidates, archive) whose sender is in the muted list
 * (`meta/library-muted-senders.json`). Dry-run by default; pass --write to delete.
 */
import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { walkMarkdown } from "../src/lib/library/utils";
import { parseMarkdownFile } from "../src/lib/library/markdown";
import { referencesDir } from "../src/lib/library/references";
import { candidateCacheDir } from "../src/lib/library/candidate-cache";
import { readMutedSenders, isMutedSender } from "../src/lib/library/library-mute";

loadEnvConfig(process.cwd());
const vault = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || "/Users/jruck/work/bridge";
const write = process.argv.includes("--write");
const muted = readMutedSenders(vault);
if (!muted.size) { console.log("No muted senders configured."); process.exit(0); }

const files = [
  ...walkMarkdown(referencesDir(vault)),                                 // includes .archive
  ...walkMarkdown(candidateCacheDir(vault), { includeHidden: true }),    // candidates under .cache
];

let count = 0;
const bySender: Record<string, number> = {};
for (const file of files) {
  let data: Record<string, unknown>;
  try { data = parseMarkdownFile(file).data; } catch { continue; }
  if (data.type !== "reference" && data.type !== "reference-candidate") continue;
  const sender = typeof data.author === "string" ? data.author : null;
  if (!isMutedSender(muted, sender)) continue;
  count += 1;
  const key = (sender || "?").toLowerCase();
  bySender[key] = (bySender[key] || 0) + 1;
  console.log(`${write ? "DELETE" : "would delete"}: ${String(data.title || "").slice(0, 48).padEnd(48)} [${sender}]`);
  if (write) fs.rmSync(file, { force: true });
}
console.log(`\n${write ? `deleted ${count} item(s)` : `DRY RUN — ${count} item(s) would be deleted`} across ${Object.keys(bySender).length} senders`);
for (const [s, c] of Object.entries(bySender).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(2)}  ${s}`);
