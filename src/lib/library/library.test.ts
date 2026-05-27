import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseFeed } from "./adapters/rss";
import { listCandidates } from "./candidate-cache";
import { listLibraryArtifactDetails } from "./library";
import { listSavedReferences } from "./references";
import { runIngestion } from "./runner";
import { loadSources } from "./source-config";

function tempVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-library-"));
  fs.mkdirSync(path.join(vault, "meta", "sources"), { recursive: true });
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  return vault;
}

function writeSource(vault: string, name: string, yaml: string) {
  fs.writeFileSync(path.join(vault, "meta", "sources", name), yaml, "utf-8");
}

test("loads library source configs with defaults", () => {
  const vault = tempVault();
  writeSource(vault, "fixture.yaml", `
id: fixture-source
name: Fixture Source
channel: fixture
url: fixture://source
enabled: true
fixtures: []
`);
  const sources = loadSources(vault);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].intent, "discovery");
  assert.equal(sources[0].retention.mode, "candidate");
  assert.equal(sources[0].retention.candidate_ttl_days, 30);
  assert.equal(sources[0].backfill.mode, "none");
  assert.equal(sources[0].backfill.enabled, false);
});

test("loads explicit source policy, auth gate, and backfill contract", () => {
  const vault = tempVault();
  writeSource(vault, "explicit.yaml", `
id: explicit-source
name: Explicit Source
channel: fixture
url: fixture://source
enabled: true
intent: explicit_save
signal: fixture_save
retention:
  mode: durable
  ttl_days: 60
  auto_promote_threshold: 0.9
auth:
  required: true
  env: [ONE_TOKEN, TWO_TOKEN]
  scopes: [read]
  stop_on_missing_credential: true
backfill:
  enabled: true
  mode: checkpointed
  cursor: abc
  limit: 20
fixtures: []
`);
  const [source] = loadSources(vault);
  assert.equal(source.retention.mode, "durable");
  assert.equal(source.retention.candidate_ttl_days, 60);
  assert.deepEqual(source.auth?.env, ["ONE_TOKEN", "TWO_TOKEN"]);
  assert.equal(source.auth?.stop_on_missing_credential, true);
  assert.equal(source.backfill.mode, "checkpointed");
  assert.equal(source.backfill.cursor, "abc");
});

test("rejects malformed source configs and explicit-save sources without signals", () => {
  const malformedVault = tempVault();
  writeSource(malformedVault, "bad.yaml", `
id:
name: Bad Source
channel: nope
url: fixture://bad
`);
  assert.throws(() => loadSources(malformedVault));

  const missingSignalVault = tempVault();
  writeSource(missingSignalVault, "missing-signal.yaml", `
id: missing-signal
name: Missing Signal
channel: fixture
url: fixture://missing
intent: explicit_save
fixtures: []
`);
  assert.throws(() => loadSources(missingSignalVault), /explicit_save/);
});

test("parses RSS and Atom-like feed items", () => {
  const items = parseFeed(`
    <feed>
      <entry>
        <title>One useful post</title>
        <link href="https://example.com/one" />
        <published>2026-05-26T00:00:00Z</published>
        <summary>Useful post summary.</summary>
      </entry>
    </feed>
  `);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.com/one");
  assert.equal(items[0].title, "One useful post");
});

test("discovery ingestion writes candidate and is idempotent", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  writeSource(vault, "discovery.yaml", `
id: discovery-source
name: Discovery Source
channel: fixture
url: fixture://discovery
enabled: true
intent: discovery
retention:
  candidate_ttl_days: 30
  auto_promote_threshold: 0.99
tags: [ai]
fixtures:
  - url: https://example.com/discovery
    title: Discovery Artifact
    date: 2026-05-26
    content: This is a useful discovery artifact about AI product work. It should be reviewed before filing.
    metadata: {}
`);
  const first = await runIngestion(vault, { useSummarize: false });
  assert.equal(first.candidates, 1);
  assert.equal(listCandidates(vault).length, 1);

  const second = await runIngestion(vault, { useSummarize: false });
  assert.equal(second.candidates, 0);
  assert.equal(listCandidates(vault).length, 1);
});

test("explicit-save ingestion writes durable reference", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  writeSource(vault, "explicit.yaml", `
id: explicit-source
name: Explicit Source
channel: fixture
url: fixture://explicit
enabled: true
intent: explicit_save
signal: test_bookmark
tags: [bookmark]
fixtures:
  - url: https://example.com/saved
    title: Saved Artifact
    date: 2026-05-26
    content: This is explicitly saved and should become a durable reference.
    metadata: {}
`);
  const report = await runIngestion(vault, { useSummarize: false });
  assert.equal(report.saved, 1);
  const listed = listLibraryArtifactDetails(vault, { includeCandidates: true });
  assert.equal(listed.artifacts.length, 1);
  assert.equal(listed.artifacts[0].lifecycle_status, "saved");
});

test("malformed legacy reference frontmatter is skipped instead of breaking library lists", () => {
  const vault = tempVault();
  fs.writeFileSync(path.join(vault, "references", "bad.md"), `---
type: reference
description: Bad: unquoted colon value
---
# Bad
`, "utf-8");
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(listSavedReferences(vault), []);
  } finally {
    console.warn = originalWarn;
  }
});

test("low-score discovery writes a skipped candidate with matching file state", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  writeSource(vault, "skip.yaml", `
id: skip-source
name: Skip Source
channel: fixture
url: fixture://skip
enabled: true
intent: discovery
filters:
  include_topics: []
  exclude_topics: [bananas, pears, apples]
fixtures:
  - url: https://example.com/skip
    title: Skip Artifact
    date: 2026-05-26
    content: bananas pears apples
    metadata: {}
`);
  const report = await runIngestion(vault, { useSummarize: false });
  assert.equal(report.skipped, 1);
  const [candidate] = listCandidates(vault);
  assert.equal(candidate.status, "skipped");
  assert.equal(candidate.save_recommendation, "skip");
});
