import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeContentTitle,
  contentMatchKeys,
  sourceRank,
  unionConnections,
  dedupeCitations,
  appendCitationToFile,
  findContentDuplicate,
  readCitations,
} from "./citations";
import { parseMarkdownFile } from "./markdown";

test("normalizeContentTitle collapses separators so the same episode matches across sources", () => {
  const a = normalizeContentTitle("OpenAI Codex lead on the new shape of product work | Andrew Ambrosino");
  const b = normalizeContentTitle("OpenAI Codex lead on the new shape of product work — Andrew Ambrosino");
  assert.equal(a, b);
});

test("contentMatchKeys pulls the YouTube id from the url AND from an embedded iframe", () => {
  assert.equal(contentMatchKeys({ url: "https://www.youtube.com/watch?v=P3KDebPTUrw" }).videoId, "P3KDebPTUrw");
  const body = `## Media\n\n<iframe width="560" src="https://www.youtube.com/embed/P3KDebPTUrw" title="x"></iframe>`;
  assert.equal(contentMatchKeys({ url: "superhuman://thread/abc", body }).videoId, "P3KDebPTUrw");
});

test("sourceRank: a YouTube feed outranks a newsletter announcement", () => {
  assert.ok(sourceRank("youtube-lennys-podcast", "youtube") > sourceRank("superhuman-news", "email"));
  assert.ok(sourceRank("raindrop-bookmarks", "raindrop") > sourceRank("superhuman-news", "email"));
});

test("unionConnections merges by target and de-dupes overlaps", () => {
  const a = [{ target: "projects/a", label: "A", relationship: "r1" }, { target: "projects/b", label: "B", relationship: "r2" }];
  const b = [{ target: "projects/b", label: "B", relationship: "dup" }, { target: "projects/c", label: "C", relationship: "r3" }];
  const out = unionConnections(a, b);
  assert.deepEqual(out.map((c) => c.target), ["projects/a", "projects/b", "projects/c"]);
});

test("dedupeCitations is idempotent on (source_id, url)", () => {
  const c = { source_id: "superhuman-news", source_name: "Newsletters", url: "superhuman://t/1" };
  assert.equal(dedupeCitations([c, { ...c }]).length, 1);
});

function writeEntry(dir: string, name: string, frontmatter: Record<string, unknown>, body: string): string {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}`)
    .join("\n");
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, `---\n${fm}\n---\n${body}\n`, "utf-8");
  return fp;
}

test("findContentDuplicate matches a YouTube entry from a different source, and appendCitationToFile folds it", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-cite-"));
  const candDir = path.join(vault, "references", ".cache", "library-candidates");
  fs.mkdirSync(candDir, { recursive: true });

  // Existing canonical: the YouTube video, with one connection.
  const canonical = writeEntry(candDir, "yt.md", {
    type: "reference-candidate",
    title: "OpenAI Codex lead on the new shape of product work | Andrew Ambrosino",
    url: "https://www.youtube.com/watch?v=P3KDebPTUrw",
    source_id: "youtube-lennys-podcast",
    source_name: "Lenny's Podcast",
    channel: "youtube",
    published: "2026-06-28",
    connection_suggestions: [{ target: "projects/product-factory", label: "Product Factory", relationship: "r" }],
  }, "# OpenAI Codex lead\n\n## Connections\n\n- [[projects/product-factory|Product Factory]] - r\n\n## Raw Content\n\n<details><summary>x</summary>\nbody\n</details>");

  // The newsletter announcing the same episode (no watch URL — title match).
  const dup = {
    url: "superhuman://thread/abc",
    title: "OpenAI Codex lead on the new shape of product work | Andrew Ambrosino",
    sourceId: "superhuman-news",
    date: "2026-06-28",
  };
  const match = findContentDuplicate(vault, dup, {});
  assert.ok(match, "expected to find the YouTube entry as a content duplicate");
  assert.equal(path.resolve(match!.path), path.resolve(canonical));

  // Fold the newsletter in as a citation, unioning a fresh connection.
  const changed = appendCitationToFile(canonical, {
    source_id: "superhuman-news", source_name: "Newsletters", url: dup.url, channel: "email", at: "2026-06-28",
  }, [{ target: "projects/seb", label: "Seb 1:1", relationship: "r2" }]);
  assert.equal(changed, true);

  const reparsed = fs.readFileSync(canonical, "utf-8");
  const data = parseMarkdownFile(canonical).data;
  assert.equal(readCitations(data).length, 1);
  assert.equal(readCitations(data)[0].source_id, "superhuman-news");
  // Connections unioned in the body (original + folded).
  assert.match(reparsed, /Product Factory/);
  assert.match(reparsed, /Seb 1:1/);

  // Same source ⇒ NOT a cross-source citation (that's the URL-dedup's job).
  assert.equal(findContentDuplicate(vault, { ...dup, sourceId: "youtube-lennys-podcast" }, {}), null);

  fs.rmSync(vault, { recursive: true, force: true });
});
