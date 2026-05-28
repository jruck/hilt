import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseFeed } from "./adapters/rss";
import { parseSuperhumanThreads } from "./adapters/email";
import { verifyLibraryAuth } from "./auth";
import { formatXurlFailureMessage, parseTwitterBookmarks } from "./adapters/twitter";
import { fetchRaindropArtifacts } from "./adapters/raindrop";
import { fetchYouTubeArtifacts } from "./adapters/youtube";
import { buildCandidateMarkdown, listCandidates } from "./candidate-cache";
import { digestArtifact } from "./digestion";
import { getLibraryOperationalHealth } from "./health";
import { archiveLibraryArtifact, listLibraryArtifactDetails } from "./library";
import { getRecommendations } from "./recommendations";
import { buildDurableReferenceMarkdown, listSavedReferences } from "./references";
import { runIngestion } from "./runner";
import { loadSources } from "./source-config";
import type { LibrarySourceConfig, ProcessedArtifact } from "./types";

function tempVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-library-"));
  fs.mkdirSync(path.join(vault, "meta", "sources"), { recursive: true });
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  return vault;
}

function writeSource(vault: string, name: string, yaml: string) {
  fs.writeFileSync(path.join(vault, "meta", "sources", name), yaml, "utf-8");
}

function processedYouTubeArtifact(): ProcessedArtifact {
  const source: LibrarySourceConfig = {
    id: "youtube-reference-playlist",
    name: "YouTube reference playlist",
    channel: "youtube",
    url: "youtube://playlist/PL123",
    enabled: true,
    cadence: "hourly",
    intent: "discovery",
    signal: "youtube_playlist",
    retention: { mode: "candidate", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" },
    tags: ["youtube"],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: { playlist_id: "PL123" },
    path: "",
  };
  return {
    raw: {
      url: "https://www.youtube.com/watch?v=abc123def45",
      title: "Useful watch-list video",
      author: "Useful Channel",
      date: "2026-05-27T00:00:00Z",
      thumbnail: "https://img.example/video.jpg",
      content: "Source description.",
      metadata: { video_id: "abc123def45", format: "video" },
    },
    source,
    format: "video",
    summary: "A useful video summary with enough detail to render in the Library.",
    key_points: ["First useful point.", "Second useful point."],
    assessment: { save_recommendation: "review", why: "Discovery source." },
    score: { relevance: 0.8, novelty: 0.7, confidence: 0.9, total: 0.82 },
    tags: ["youtube"],
    proposed_destination: "references/process",
    connected_projects: ["reference-library"],
    reasoning: "Fixture",
    extraction_notes: [],
    digestion: {
      status: "hot",
      extractor: "summarize-cli",
      digested_at: "2026-05-28T00:00:00.000Z",
      extracted_chars: 1200,
      cached_source_chars: 42,
      cached_source_extractor: "summarize-cli",
    },
    source_cache: {
      kind: "transcript",
      extractor: "summarize-cli",
      captured_at: "2026-05-28T00:00:00.000Z",
      content: "00:00 Intro\n00:30 A full transcript line.",
      chars: 42,
    },
  };
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

test("parses xurl bookmark responses into raw Twitter artifacts", () => {
  const source: LibrarySourceConfig = {
    id: "twitter-bookmarks",
    name: "X bookmarks",
    channel: "twitter",
    url: "x://bookmarks",
    enabled: true,
    cadence: "hourly",
    intent: "explicit_save",
    signal: "twitter_bookmark",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" },
    tags: [],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };
  const [artifact] = parseTwitterBookmarks(source, {
    data: [{
      id: "123",
      text: "A useful bookmarked post",
      created_at: "2026-05-27T00:00:00Z",
      author_id: "u1",
      entities: { urls: [{ expanded_url: "https://example.com" }] },
    }],
    includes: { users: [{ id: "u1", username: "justin", name: "Justin" }] },
  });
  assert.equal(artifact.url, "https://x.com/justin/status/123");
  assert.equal(artifact.author, "Justin");
  assert.equal(artifact.metadata.signal, "twitter_bookmark");
});

test("normalizes malformed Unicode from X bookmark text", () => {
  const source: LibrarySourceConfig = {
    id: "twitter-bookmarks",
    name: "X bookmarks",
    channel: "twitter",
    url: "x://bookmarks",
    enabled: true,
    cadence: "hourly",
    intent: "explicit_save",
    signal: "twitter_bookmark",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" },
    tags: [],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };
  const malformed = `Broken ${String.fromCharCode(0xd83e)} text`;
  const [artifact] = parseTwitterBookmarks(source, {
    data: [{ id: "123", text: malformed, created_at: "2026-05-27T00:00:00Z" }],
  });
  assert.equal(artifact.title, "Broken � text");
  assert.equal(artifact.content, "Broken � text");
});

test("formats xurl setup failures with local registration guidance", () => {
  const message = formatXurlFailureMessage("/Users/jruck/go/bin/xurl", new Error("No apps registered"));
  assert.match(message, /auth apps add bridge-library/);
  assert.match(message, /http:\/\/localhost:8080\/callback/);
  assert.match(message, /X Developer Portal/);
});

test("fetches Raindrop pages with checkpoint cursors", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.RAINDROP_TOKEN;
  process.env.RAINDROP_TOKEN = "test-token";
  const source: LibrarySourceConfig = {
    id: "raindrop-bookmarks",
    name: "Raindrop bookmarks",
    channel: "raindrop",
    url: "raindrop://collection/0",
    enabled: true,
    cadence: "hourly",
    intent: "explicit_save",
    signal: "raindrop_bookmark",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" },
    tags: [],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(url.searchParams.get("perpage"), "2");
    return new Response(JSON.stringify({
      items: [
        {
          _id: 1,
          link: "https://example.com/one",
          title: "One",
          created: "2026-05-27T00:00:00Z",
          cover: "https://img.example/cover.jpg",
          media: [{ link: "https://img.example/cover.jpg", type: "image" }],
          cache: { status: "ready", size: 1234, created: "2026-05-27T01:00:00Z" },
        },
        { _id: 2, link: "https://example.com/two", title: "Two", created: "2026-05-26T00:00:00Z" },
      ],
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const batch = await fetchRaindropArtifacts(source, { cursor: "2", limit: 2 });
    assert.equal(batch.artifacts.length, 2);
    assert.equal(batch.cursor, "2");
    assert.equal(batch.next_cursor, "3");
    assert.equal(batch.artifacts[0].thumbnail, "https://img.example/cover.jpg");
    assert.deepEqual(batch.artifacts[0].metadata.media, [{ link: "https://img.example/cover.jpg", type: "image" }]);
    assert.equal(batch.artifacts[0].metadata.cache_status, "ready");
    assert.equal(batch.artifacts[0].metadata.cache_size, 1234);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.RAINDROP_TOKEN;
    else process.env.RAINDROP_TOKEN = originalToken;
  }
});

test("uses Raindrop permanent copy as source-cache fallback", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.RAINDROP_TOKEN;
  const originalDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  process.env.RAINDROP_TOKEN = "test-token";
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const source: LibrarySourceConfig = {
    id: "raindrop-bookmarks",
    name: "Raindrop bookmarks",
    channel: "raindrop",
    url: "raindrop://collection/0",
    enabled: true,
    cadence: "hourly",
    intent: "explicit_save",
    signal: "raindrop_bookmark",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" },
    tags: [],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };
  const paragraph = "This cached article sentence has enough substance for extraction and library review. ";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.match(String(input), /\/raindrop\/123\/cache$/);
    return new Response(`<html><body><article><h1>Cached Article</h1><p>${paragraph.repeat(30)}</p></article><script>ignored()</script></body></html>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;

  try {
    const processed = await digestArtifact({
      url: "https://example.com/cached",
      title: "Cached Article",
      date: "2026-05-27T00:00:00Z",
      content: "Short metadata fallback.",
      metadata: { raindrop_id: 123, cache_status: "ready" },
    }, source);
    assert.equal(processed.source_cache?.extractor, "raindrop-cache");
    assert.equal(processed.digestion?.status, "hot");
    assert.match(processed.source_cache?.content || "", /Cached Article/);
    assert.doesNotMatch(processed.source_cache?.content || "", /ignored/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.RAINDROP_TOKEN;
    else process.env.RAINDROP_TOKEN = originalToken;
    if (originalDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED;
    else process.env.LIBRARY_SUMMARIZE_DISABLED = originalDisabled;
  }
});

test("keeps Raindrop-saved X links on source metadata instead of permanent-copy fallback", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.RAINDROP_TOKEN;
  const originalDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  process.env.RAINDROP_TOKEN = "test-token";
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const source: LibrarySourceConfig = {
    id: "raindrop-bookmarks",
    name: "Raindrop bookmarks",
    channel: "raindrop",
    url: "raindrop://collection/0",
    enabled: true,
    cadence: "hourly",
    intent: "explicit_save",
    signal: "raindrop_bookmark",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" },
    tags: [],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };
  globalThis.fetch = (async () => {
    throw new Error("cache fetch should not be called for X URLs");
  }) as typeof fetch;

  try {
    const processed = await digestArtifact({
      url: "https://x.com/example/status/123",
      title: "Saved X post",
      date: "2026-05-27T00:00:00Z",
      content: "A saved X post should use the source text rather than a rendered Raindrop permanent copy.",
      metadata: { raindrop_id: 123, cache_status: "ready" },
    }, source);
    assert.equal(processed.source_cache?.extractor, "source-metadata");
    assert.match(processed.extraction_notes.join("\n"), /Used X\/Twitter source text/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.RAINDROP_TOKEN;
    else process.env.RAINDROP_TOKEN = originalToken;
    if (originalDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED;
    else process.env.LIBRARY_SUMMARIZE_DISABLED = originalDisabled;
  }
});

test("fetches YouTube playlist videos as candidate artifacts", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
  process.env.YOUTUBE_OAUTH_ACCESS_TOKEN = "test-token";
  const source: LibrarySourceConfig = {
    id: "youtube-reference-playlist",
    name: "YouTube reference playlist",
    channel: "youtube",
    url: "youtube://playlist/PL123",
    enabled: true,
    cadence: "hourly",
    intent: "discovery",
    signal: "youtube_playlist",
    retention: { mode: "candidate", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" },
    tags: ["youtube"],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: { playlist_id: "PL123" },
    path: "",
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/youtube/v3/playlistItems");
    assert.equal(url.searchParams.get("playlistId"), "PL123");
    assert.equal(url.searchParams.get("maxResults"), "2");
    return new Response(JSON.stringify({
      nextPageToken: "next",
      items: [{
        snippet: {
          title: "Useful watch-list video",
          videoOwnerChannelTitle: "Useful Channel",
          description: "A video saved to a normal YouTube playlist.",
          thumbnails: { high: { url: "https://img.example/video.jpg" } },
          resourceId: { videoId: "abc123def45" },
        },
        contentDetails: {
          videoId: "abc123def45",
          videoPublishedAt: "2026-05-27T00:00:00Z",
        },
      }],
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const batch = await fetchYouTubeArtifacts(source, { limit: 2 });
    assert.equal(batch.artifacts.length, 1);
    assert.equal(batch.next_cursor, "next");
    assert.equal(batch.artifacts[0].url, "https://www.youtube.com/watch?v=abc123def45");
    assert.equal(batch.artifacts[0].metadata.signal, "youtube_playlist");
    assert.equal(batch.artifacts[0].metadata.playlist_id, "PL123");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
    else process.env.YOUTUBE_OAUTH_ACCESS_TOKEN = originalToken;
  }
});

test("candidate markdown preserves media, thumbnails, and cached source text", () => {
  const vault = tempVault();
  const cacheDir = path.join(vault, "references", ".cache", "library-candidates");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "candidate.md"), buildCandidateMarkdown(processedYouTubeArtifact()), "utf-8");

  const [candidate] = listCandidates(vault);
  assert.equal(candidate.thumbnail, "https://img.example/video.jpg");
  assert.match(candidate.content, /## Media/);
  assert.match(candidate.content, /youtube\.com\/embed\/abc123def45/);
  assert.match(candidate.cached_source || "", /00:30 A full transcript line/);

  const [artifact] = listLibraryArtifactDetails(vault, { includeCandidates: true }).artifacts;
  assert.equal(artifact.thumbnail, "https://img.example/video.jpg");
});

test("durable reference markdown includes media and cached source contract", () => {
  const markdown = buildDurableReferenceMarkdown(processedYouTubeArtifact(), "manual_save");
  assert.match(markdown, /## Media/);
  assert.match(markdown, /youtube\.com\/embed\/abc123def45/);
  assert.match(markdown, /cached_source_chars: 42/);
  assert.match(markdown, /## Raw Content/);
  assert.match(markdown, /00:30 A full transcript line/);
});

test("durable reference markdown includes bounded source images for articles", () => {
  const processed = processedYouTubeArtifact();
  processed.format = "article";
  processed.source.channel = "raindrop";
  processed.raw.url = "https://example.com/article";
  processed.raw.thumbnail = "https://img.example/hero.jpg";
  processed.raw.metadata = {
    media: [
      { link: "https://img.example/hero.jpg", type: "image" },
      { link: "https://img.example/detail.jpg", type: "image" },
      { link: "https://video.example/not-image.mp4", type: "video" },
    ],
  };
  const markdown = buildDurableReferenceMarkdown(processed);
  assert.match(markdown, /!\[Useful watch-list video\]\(https:\/\/img\.example\/hero\.jpg\)/);
  assert.match(markdown, /!\[Useful watch-list video source image 2\]\(https:\/\/img\.example\/detail\.jpg\)/);
  assert.doesNotMatch(markdown, /not-image\.mp4/);
});

test("parses Superhuman News threads into candidate-ready email artifacts", () => {
  const source: LibrarySourceConfig = {
    id: "superhuman-news",
    name: "Superhuman News",
    channel: "email",
    url: "superhuman://split/news",
    enabled: true,
    cadence: "daily",
    intent: "discovery",
    retention: { mode: "candidate", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" },
    tags: ["newsletter"],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: { split: "News" },
    path: "",
  };
  const [artifact] = parseSuperhumanThreads(source, {
    threads: [{
      thread_id: "thread-1",
      subject: "Useful market note",
      snippet: "Short thread summary.",
      participants: ["news@example.com"],
      labels: ["newsletter"],
      splits: ["News"],
      last_message_at: "2026-05-27T22:45:06Z",
      last_message_id: "message-1",
      message_count: 1,
      messages: [{
        message_id: "message-1",
        from: "News <news@example.com>",
        subject: "Useful market note",
        snippet: "Short thread summary.",
        body: "<html><body><p>The full newsletter body has enough text for fallback digestion &amp; candidate summaries.</p></body></html>",
        sent_at: "2026-05-27T22:45:06Z",
      }],
    }],
  });
  assert.equal(artifact.url, "superhuman://thread/thread-1");
  assert.equal(artifact.title, "Useful market note");
  assert.equal(artifact.author, "News <news@example.com>");
  assert.equal(artifact.metadata.source, "superhuman_news");
  assert.equal(artifact.metadata.format, "newsletter");
  assert.equal(artifact.metadata.split, "News");
  assert.match(artifact.content || "", /full newsletter body/);
  assert.match(artifact.content || "", /& candidate summaries/);
  assert.doesNotMatch(artifact.content || "", /<p>/);
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

test("archives saved references into a local archive folder", async () => {
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
fixtures:
  - url: https://example.com/archive-me
    title: Archive Me
    date: 2026-05-28
    content: This saved reference should be archivable from the Library UI.
    metadata: {}
`);
  await runIngestion(vault, { useSummarize: false });
  const [artifact] = listSavedReferences(vault);
  const result = archiveLibraryArtifact(vault, artifact.id);
  assert.match(result.archived_to, /references\/\.archive\/2026-05-28-archive-me\.md/);
  assert.equal(listSavedReferences(vault).some((item) => item.id === artifact.id), false);
  assert.equal(fs.existsSync(path.join(vault, result.archived_to)), true);
});

test("cursor ingestion bypasses timestamp state for historical backfill", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  writeSource(vault, "cursor.yaml", `
id: cursor-source
name: Cursor Source
channel: fixture
url: fixture://cursor
enabled: true
intent: explicit_save
signal: test_bookmark
backfill:
  enabled: true
  mode: checkpointed
fixtures:
  - url: https://example.com/historical
    title: Historical Artifact
    date: 2026-05-01
    content: This older artifact should be processed only by cursor-backed backfill.
    metadata: {}
`);
  fs.writeFileSync(path.join(vault, "meta", "sources", ".source-state.json"), JSON.stringify({
    "cursor-source": { last_checked_at: "2026-05-27T00:00:00.000Z" },
  }, null, 2), "utf-8");

  const normal = await runIngestion(vault, { useSummarize: false });
  assert.equal(normal.use_cursor, false);
  assert.equal(normal.saved, 0);

  const backfill = await runIngestion(vault, { useSummarize: false, useCursor: true });
  assert.equal(backfill.use_cursor, true);
  assert.equal(backfill.sources[0].cursor, null);
  assert.equal(backfill.saved, 1);
  assert.equal(listSavedReferences(vault).length, 1);
});

test("dry-run ingestion reports intended writes without mutating vault state", async () => {
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
fixtures:
  - url: https://example.com/saved-one
    title: Saved Artifact One
    date: 2026-05-26
    content: This would be saved in a live run.
    metadata: {}
  - url: https://example.com/saved-two
    title: Saved Artifact Two
    date: 2026-05-26
    content: This would also be saved in a live run.
    metadata: {}
`);
  const report = await runIngestion(vault, { useSummarize: false, dryRun: true, limit: 1 });
  assert.equal(report.dry_run, true);
  assert.equal(report.limit, 1);
  assert.equal(report.saved, 1);
  assert.equal(report.sources[0].fetched, 1);
  assert.equal(report.sources[0].artifacts[0].status, "saved");
  assert.equal(report.sources[0].artifacts[0].reason, "dry_run_explicit_save");
  assert.equal(listSavedReferences(vault).length, 0);
  assert.equal(listCandidates(vault).length, 0);
  assert.equal(fs.existsSync(path.join(vault, "meta", "sources", ".source-state.json")), false);
});

test("for-you recommendations are capped and explain active-context matches", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  fs.mkdirSync(path.join(vault, "projects", "agentic-product"), { recursive: true });
  fs.writeFileSync(path.join(vault, "projects", "agentic-product", "index.md"), "# Agentic Product\n\nActive work on agentic product discovery loops, library recommendations, and surfaced insights.\n", "utf-8");
  fs.mkdirSync(path.join(vault, "lists", "now"), { recursive: true });
  fs.writeFileSync(path.join(vault, "lists", "now", "2026-05-28.md"), "# Week\n\n- [ ] Tune reference library recommendations against active projects and tasks\n", "utf-8");

  const fixtures = [
    {
      url: "https://example.com/agentic-product-discovery",
      title: "Agentic Product Discovery Loops",
      content: "Agentic product discovery loops can improve library recommendations by tying surfaced insights to active projects and tasks. The workflow ranks candidates for review and saves durable references when they matter.",
    },
    ...Array.from({ length: 11 }, (_, index) => ({
      url: `https://example.com/off-topic-${index}`,
      title: `Off Topic Item ${index}`,
      content: "A general entertainment note about weekend hobbies with little relationship to active work.",
    })),
  ];
  writeSource(vault, "recommendations.yaml", `
id: recommendation-source
name: Recommendation Source
channel: fixture
url: fixture://recommendations
enabled: true
intent: discovery
tags: [agentic]
fixtures:
${fixtures.map((fixture) => `  - url: ${fixture.url}
    title: ${fixture.title}
    date: 2026-05-28
    content: >
      ${fixture.content}
    metadata: {}`).join("\n")}
`);

  await runIngestion(vault, { useSummarize: false });
  const recommendations = getRecommendations(vault, 50);
  assert.equal(recommendations.items.length, 8);
  assert.equal(recommendations.items[0].title, "Agentic Product Discovery Loops");
  assert.match(recommendations.items[0].why, /Matches/);
  assert.ok(recommendations.items[0].matched_terms.includes("agentic"));
});

test("library health summarizes scheduler, source, and dead-letter state", () => {
  const vault = tempVault();
  writeSource(vault, "health.yaml", `
id: health-source
name: Health Source
channel: fixture
url: fixture://health
enabled: true
intent: discovery
fixtures: []
`);
  fs.writeFileSync(path.join(vault, "meta", "sources", ".source-state.json"), JSON.stringify({
    "health-source": { last_checked_at: "2026-05-28T10:00:00.000Z", last_success_at: "2026-05-28T10:00:00.000Z" },
  }, null, 2), "utf-8");

  const health = getLibraryOperationalHealth(vault, { launchctl: () => "last exit code = 0" });
  assert.equal(health.scheduler.loaded, 5);
  assert.equal(health.sources[0].status, "ok");
  assert.equal(health.dead_letters.total, 0);
  assert.equal(health.ok, true);
});

test("auth verifier reports missing source credentials without exposing values", async () => {
  delete process.env.MISSING_LIBRARY_TEST_TOKEN;
  const vault = tempVault();
  writeSource(vault, "auth.yaml", `
id: auth-source
name: Auth Source
channel: fixture
url: fixture://auth
enabled: true
auth:
  required: true
  env: MISSING_LIBRARY_TEST_TOKEN
  stop_on_missing_credential: true
fixtures: []
`);
  const report = await verifyLibraryAuth(vault, { live: false });
  assert.equal(report.ok, false);
  assert.equal(report.sources[0].status, "missing");
  assert.deepEqual(report.sources[0].required_env, [{ name: "MISSING_LIBRARY_TEST_TOKEN", present: false }]);
  assert.match(report.sources[0].message, /MISSING_LIBRARY_TEST_TOKEN/);
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
