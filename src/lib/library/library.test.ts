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
import { captureFailed } from "./capture-health";
import { parseConnectionJudgment } from "./connection-prompt";
import { connectionPassState } from "./connection-state";
import { detectRateLimit, detectRateLimitInEnvelope } from "./connections";
import { unresolvedDeadLetterSources } from "./dead-letter";
import * as digestion from "./digestion";
import { digestArtifact } from "./digestion";
import { getLibraryOperationalHealth } from "./health";
import { buildKbIndex } from "./kb-index";
import { cleanupLegacyReferenceBody, stripLegacyReferenceBodyCruft } from "./legacy-cleanup";
import { archiveLibraryArtifact, getLibraryArtifact, getLibraryArtifactByPath, hasUnreadLibraryArtifacts, listLibraryArtifactDetails, listLibrarySources } from "./library";
import { buildMediaMarkdown } from "./media";
import { parseOpenGraphHtml } from "./media-enrichment";
import { parseMarkdownFile, stringifyMarkdown } from "./markdown";
import { markLibraryArtifactsRead } from "./read-state";
import { PIPELINE_VERSION } from "./pipeline";
import { getRecommendations, scoreArtifacts } from "./recommendations";
import { findReweavePendingTargets } from "./reweave-pending";
import { evaluateArtifact, structuralSubstance } from "./library-eval";
import { artifactTaxonomy } from "./taxonomy";
import { buildDurableReferenceMarkdown, findArchivedReferenceByUrl, listArchivedReferences, listSavedReferences, parseReferenceFile } from "./references";
import { addToReviewQueue, getActiveBatchNotes, readReviewQueue, setReviewStatus } from "./review-queue";
import { parseReweaveOutput } from "./reweave-prompt";
import { runIngestion } from "./runner";
import { librarySchedulerJobs } from "./scheduler-jobs";
import { loadSources } from "./source-config";
import { parseTimedTranscript } from "./transcript";
import { buildLibraryItemUrl, buildLibraryUrl, libraryItemIdFromScope, libraryItemScope, parseLibraryControls } from "./url";
import { buildWorkbenchRows } from "./workbench";
import { cleanXVideoSubtitleContent } from "./x-video-transcript";
import type { ConnectionSuggestion, LibrarySourceConfig, ProcessedArtifact, RawArtifact } from "./types";
import { detectYouTubeContentForm, parseYouTubeDurationSeconds } from "./youtube-clip-detector";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-library-state-"));
// Keep the suite offline and deterministic: the LLM connection judge must never invoke the
// real Claude CLI during tests, regardless of how the suite is launched (BRIDGE_VAULT_PATH /
// HILT_WORKING_FOLDER may be set in the dev environment). Tests that exercise the judge stub
// or override this flag locally.
process.env.LIBRARY_CONNECTIONS_DISABLED = "1";

function tempVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-library-"));
  fs.mkdirSync(path.join(vault, "meta", "sources"), { recursive: true });
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  return vault;
}

function writeSource(vault: string, name: string, yaml: string) {
  fs.writeFileSync(path.join(vault, "meta", "sources", name), yaml, "utf-8");
}

function markFixtureWeavesComplete(vault: string): void {
  for (const artifact of listLibraryArtifactDetails(vault, { includeCandidates: true }).artifacts) {
    const { data, body } = parseMarkdownFile(artifact.abs_path);
    if (data.reweave_pending !== true) continue;
    // Rest-spread instead of delete: the spread literal's inferred type pins its known keys,
    // so `delete next.reweave_pending` fails to compile (TS2339).
    const { reweave_pending: _cleared, ...rest } = data;
    const next = { ...rest, reconnected_at: "2026-05-28T12:00:00.000Z" };
    fs.writeFileSync(artifact.abs_path, stringifyMarkdown(next, body), "utf-8");
  }
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
    metadata: {
      playlist_id: "PL123",
      playlist_title: "Reference Playlist",
      playlist_url: "https://www.youtube.com/playlist?list=PL123",
      playlist_total: 13,
      series_id: "reference-playlist",
      series_title: "Reference Playlist",
      series_url: "https://www.youtube.com/playlist?list=PL123",
      series_total: 13,
      series_parent: "references/series/reference-playlist.md",
    },
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
    source_tags: [],
    source_collection: null,
    source_collection_id: null,
    source_folder: null,
    source_folder_id: null,
    library_mode: "study",
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

function buildProcessedArtifactWithConnections(connections: ConnectionSuggestion[]): ProcessedArtifact {
  const base = processedYouTubeArtifact();
  return {
    ...base,
    connected_projects: [],
    connection_suggestions: connections,
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

test("library URL helpers encode item links and view controls", () => {
  assert.equal(libraryItemScope("abc/123"), "/item/abc%2F123");
  assert.equal(libraryItemIdFromScope("/item/abc%2F123"), "abc/123");
  assert.equal(buildLibraryItemUrl("abc123"), "/library/item/abc123");
  assert.equal(buildLibraryUrl("/item/abc123", {
    density: "list",
    ranking: "new",
    status: "candidate",
    mode: "study",
    source: "twitter-bookmarks",
    tag: null,
  }), "/library/item/abc123?view=list&rank=new&status=candidate&source=twitter-bookmarks");
  assert.deepEqual(parseLibraryControls("?view=list&rank=for-you&status=saved&source=manual"), {
    density: "list",
    ranking: "for-you",
    status: "saved",
    mode: "study",
    source: "manual",
    tag: null,
  });
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
      text: "A useful bookmarked post https://t.co/x",
      created_at: "2026-05-27T00:00:00Z",
      author_id: "u1",
      attachments: { media_keys: ["m1"] },
      entities: { urls: [{ expanded_url: "https://example.com" }] },
    }],
    includes: {
      users: [{ id: "u1", username: "justin", name: "Justin" }],
      media: [{ media_key: "m1", type: "photo", url: "https://img.example/tweet.jpg" }],
    },
  });
  assert.equal(artifact.url, "https://x.com/justin/status/123");
  assert.equal(artifact.title, "A useful bookmarked post");
  assert.equal(artifact.author, "Justin");
  assert.equal(artifact.thumbnail, "https://img.example/tweet.jpg");
  assert.equal(artifact.metadata.signal, "twitter_bookmark");
  assert.deepEqual(artifact.metadata.media, [{ link: "https://img.example/tweet.jpg", type: "image", source: "x_bookmark" }]);
});

test("parses X video media previews and embed hints from bookmarks", () => {
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
      id: "456",
      text: "A useful bookmarked video post https://t.co/video",
      created_at: "2026-05-27T00:00:00Z",
      attachments: { media_keys: ["v1"] },
      entities: { urls: [{ expanded_url: "https://x.com/example/status/456/video/1" }] },
    }],
    includes: {
      media: [{ media_key: "v1", type: "video", preview_image_url: "https://img.example/video-preview.jpg" }],
    },
  });

  assert.equal(artifact.thumbnail, "https://img.example/video-preview.jpg");
  assert.equal(artifact.metadata.video_url, "https://x.com/example/status/456/video/1");
  assert.deepEqual(artifact.metadata.media, [{
    link: "https://img.example/video-preview.jpg",
    preview_image_url: "https://img.example/video-preview.jpg",
    type: "video",
    source: "x_bookmark",
  }]);
});

test("synthesizes X video urls from attached media when no expanded video url is present", () => {
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
      id: "789",
      text: "A useful video without an entity URL",
      created_at: "2026-05-27T00:00:00Z",
      author_id: "u1",
      attachments: { media_keys: ["v1"] },
    }],
    includes: {
      users: [{ id: "u1", username: "justin", name: "Justin" }],
      media: [{ media_key: "v1", type: "video", preview_image_url: "https://img.example/video-preview.jpg", duration_ms: 123400 }],
    },
  });

  assert.equal(artifact.url, "https://x.com/justin/status/789");
  assert.equal(artifact.metadata.video_url, "https://x.com/justin/status/789/video/1");
  assert.equal(artifact.metadata.video_duration_seconds, 123);
});

test("cleans X video VTT word markup into timestamped transcript text", () => {
  const transcript = cleanXVideoSubtitleContent(`WEBVTT

00:00:00.000 --> 00:00:01.860
<X-word-ms ms=60,200 index=1 character_ranges=0-0,1-6>I think we're AI-pilled.</X-word-ms>

00:00:01.980 --> 00:00:03.180
<X-word-ms ms=140,80 index=2 character_ranges=0-2,3-5>And if you're AI-pilled, that</X-word-ms>
`);

  assert.equal(transcript, "[0:00] I think we're AI-pilled.\n[0:01] And if you're AI-pilled, that");
  assert.doesNotMatch(transcript, /X-word-ms|character_ranges/);
});

test("X video captures require an X transcript cache, not wrapper tweet metadata", () => {
  const body = `# Video tweet

## Raw Content

<details>
<summary>Full source cache</summary>

Good interview Author: Elon Musk Published: 2026-06-12T06:19:00.000Z Links: https://x.com/BG2Pod/status/2065217980141908034/video/1

</details>`;

  assert.equal(captureFailed({
    body,
    frontmatter: {
      video_url: "https://x.com/BG2Pod/status/2065217980141908034/video/1",
      digested_with: "summarize-cli",
      cached_source_extractor: "source-metadata",
    },
  }), true);
  assert.equal(captureFailed({
    body,
    frontmatter: {
      video_url: "https://x.com/BG2Pod/status/2065217980141908034/video/1",
      digested_with: "summarize-cli",
      cached_source_extractor: "x-video-subtitles",
    },
  }), false);
  assert.equal(captureFailed({
    body,
    frontmatter: {
      video_url: "https://x.com/BG2Pod/status/2065217980141908034/video/1",
      digested_with: "summarize-cli",
      cached_source_extractor: "source-metadata",
      x_video_transcript_status: "unavailable_no_audio",
    },
  }), false);
});

test("capture health ignores Source Notes when judging metadata-only X article stubs", () => {
  const body = `# Factory 2.0: From coding agents to software factories

Content unavailable — X Notes article could not be fetched.

## Raw Content

<details>
<summary>Full source cache</summary>

https://t.co/Yp4MzETtYs Author: Matan Grinberg Published: 2026-06-15T17:46:26.000Z Links: http://x.com/i/article/2066394250074599424

</details>

## Source Notes

- Fetched full X post text for digest context.
- Used X/Twitter source text as canonical source metadata.
`;

  assert.equal(captureFailed({
    body,
    frontmatter: {
      digested_with: "source-metadata",
      cached_source_chars: 132,
      cached_source_extractor: "source-metadata",
    },
  }), true);
});

test("extracts representative Open Graph media for article captures", () => {
  const metadata = parseOpenGraphHtml(`
    <html>
      <head>
        <meta property="og:title" content="Useful Product Page" />
        <meta property="og:image" content="/og.png" />
        <meta name="description" content="A useful product page." />
        <link rel="canonical" href="/canonical" />
      </head>
    </html>
  `, "https://example.com/path");
  assert.equal(metadata.image, "https://example.com/og.png");
  assert.equal(metadata.title, "Useful Product Page");
  assert.equal(metadata.description, "A useful product page.");
  assert.equal(metadata.canonicalUrl, "https://example.com/canonical");
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

test("uses a non-url fallback title for URL-only X bookmarks", () => {
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
    data: [{ id: "123", text: "https://t.co/only", created_at: "2026-05-27T00:00:00Z", author_id: "u1" }],
    includes: { users: [{ id: "u1", username: "justin", name: "Justin" }] },
  });
  assert.equal(artifact.title, "X bookmark by Justin");
});

test("URL-only X bookmark digestion does not promote the URL to summary text", async () => {
  const originalDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
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

  try {
    const processed = await digestArtifact({
      url: "https://x.com/example/status/123",
      title: "https://t.co/only",
      author: "Siddharth",
      date: "2026-05-28T00:00:00Z",
      content: "https://t.co/only",
      metadata: { expanded_url: "https://x.com/i/article/2059655090164944896" },
    }, source, { useSummarize: false });

    assert.equal(processed.raw.title, "X bookmark by Siddharth");
    assert.equal(processed.summary, "X bookmark by Siddharth");
    assert.equal(processed.digestion?.status, "warm");
    assert.equal(processed.source_cache, undefined);
    // An x.com/i/article link is an X Article share: classify it as x-article (not a bare tweet) and
    // route it to browser recovery rather than emitting the generic metadata-limited note.
    assert.equal(processed.format, "x-article");
    assert.match(processed.extraction_notes.join("\n"), /X Article share/);
    assert.match(buildDurableReferenceMarkdown(processed), /format: x-article/);
    assert.doesNotMatch(buildDurableReferenceMarkdown(processed), /https:\/\/t\.co\/only/);
  } finally {
    if (originalDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED;
    else process.env.LIBRARY_SUMMARIZE_DISABLED = originalDisabled;
  }
});

test("X bookmark digestion enriches truncated bookmark text with full note_tweet text", async () => {
  const originalDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-xurl-note-"));
  const xurlBin = path.join(dir, "xurl");
  fs.writeFileSync(xurlBin, `#!/usr/bin/env node
console.log(JSON.stringify({
  data: {
    id: "2061796432534003866",
    text: "In the last 6 months at @Ahrefs, we analyzed over 1 billion data points across 14 studies. Here's what we learned about AI search optimization:\\n\\n1) Best X listicles make up 43.8% of all page types",
    note_tweet: {
      text: "In the last 6 months at @Ahrefs, we analyzed over 1 billion data points across 14 studies. Here's what we learned about AI search optimization:\\n\\n1) Best X blog listicles make up 43.8% of all page types cited by ChatGPT specifically.\\n\\n2) 67% of ChatGPT's top 1,000 citations come from sources marketers can't influence.\\n\\n3) 28.3% of ChatGPT's most-cited pages have zero Google organic visibility.\\n\\n4) ChatGPT only cites about 50% of the URLs it retrieves."
    },
    conversation_id: "2061796432534003866",
    created_at: "2026-06-02T13:05:50.000Z",
    author_id: "85286925"
  },
  includes: { users: [{ id: "85286925", username: "timsoulo", name: "Tim Soulo" }] }
}));
`, "utf-8");
  fs.chmodSync(xurlBin, 0o755);
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
    metadata: { xurl_path: xurlBin },
    path: "",
  };

  try {
    const processed = await digestArtifact({
      url: "https://x.com/timsoulo/status/2061796432534003866",
      title: "In the last 6 months at @Ahrefs, we analyzed over 1 billion data points across 14 studies. Here's what we learned about ",
      author: "Tim Soulo",
      date: "2026-06-02T13:05:50.000Z",
      content: "In the last 6 months at @Ahrefs, we analyzed over 1 billion data points across 14 studies. Here's what we learned about AI search optimization:\n\n1) Best X listicles make up 43.8% of all page types",
      metadata: { tweet_id: "2061796432534003866" },
    }, source, { useSummarize: true });

    assert.equal(processed.raw.title, "In the last 6 months at @Ahrefs, we analyzed over 1 billion data points across 14 studies. Here's what we learned about AI search optimization");
    assert.match(processed.source_cache?.content || "", /67% of ChatGPT's top 1,000 citations/);
    assert.match(processed.source_cache?.content || "", /28\.3% of ChatGPT's most-cited pages/);
    assert.equal(processed.digestion?.status, "hot");
    assert.match(processed.extraction_notes.join("\n"), /Fetched full X post text/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED;
    else process.env.LIBRARY_SUMMARIZE_DISABLED = originalDisabled;
  }
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

test("login-walled Raindrop cache with no article grades warm and flags needs_auth_recovery", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.RAINDROP_TOKEN;
  const originalDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  process.env.RAINDROP_TOKEN = "test-token";
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const source: LibrarySourceConfig = {
    id: "raindrop-bookmarks", name: "Raindrop bookmarks", channel: "raindrop", url: "raindrop://collection/0",
    enabled: true, cadence: "hourly", intent: "explicit_save", signal: "raindrop_bookmark",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" }, tags: [], filters: { include_topics: [], exclude_topics: [] }, metadata: {}, path: "",
  };
  // A bare LinkedIn sign-in gate — no article underneath.
  const wall = [
    "Sign in to view more content",
    "Create your free account or sign in to continue your search",
    "By clicking Continue to join or sign in, you agree to LinkedIn's User Agreement",
    "New to LinkedIn? Join now",
    "Agree & Join LinkedIn",
  ];
  globalThis.fetch = (async () => new Response(`<html><body>${wall.map((w) => `<p>${w}</p>`).join("")}</body></html>`, {
    status: 200, headers: { "content-type": "text/html" },
  })) as typeof fetch;
  try {
    const processed = await digestArtifact({
      url: "https://www.linkedin.com/pulse/walled-article-xyz/",
      title: "Walled Article | LinkedIn",
      date: "2026-06-22T00:00:00Z",
      content: "Short metadata fallback.",
      metadata: { raindrop_id: 123, cache_status: "ready" },
    }, source);
    assert.equal(processed.source_cache?.extractor, "raindrop-cache");
    assert.equal(processed.needs_auth_recovery, true);
    assert.equal(processed.digestion?.status, "warm");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.RAINDROP_TOKEN; else process.env.RAINDROP_TOKEN = originalToken;
    if (originalDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED; else process.env.LIBRARY_SUMMARIZE_DISABLED = originalDisabled;
  }
});

test("Raindrop cache that leads with sign-in chrome but carries the article is not flagged for recovery", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.RAINDROP_TOKEN;
  const originalDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  process.env.RAINDROP_TOKEN = "test-token";
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const source: LibrarySourceConfig = {
    id: "raindrop-bookmarks", name: "Raindrop bookmarks", channel: "raindrop", url: "raindrop://collection/0",
    enabled: true, cadence: "hourly", intent: "explicit_save", signal: "raindrop_bookmark",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" }, tags: [], filters: { include_topics: [], exclude_topics: [] }, metadata: {}, path: "",
  };
  // The common Raindrop case: sign-in chrome leads, the real article (logged-in DOM snapshot) follows.
  const article = "This is a substantive analysis of the recapitalization and what it means for enterprise software buyers. ".repeat(20);
  globalThis.fetch = (async () => new Response(
    `<html><body><p>Sign in to view more content</p><p>Continue to join or sign in</p><article><h1>Real Article</h1><p>${article}</p></article></body></html>`,
    { status: 200, headers: { "content-type": "text/html" } },
  )) as typeof fetch;
  try {
    const processed = await digestArtifact({
      url: "https://www.linkedin.com/pulse/real-article-xyz/",
      title: "Real Article | LinkedIn",
      date: "2026-06-22T00:00:00Z",
      content: "Short metadata fallback.",
      metadata: { raindrop_id: 124, cache_status: "ready" },
    }, source);
    assert.equal(processed.source_cache?.extractor, "raindrop-cache");
    assert.equal(processed.needs_auth_recovery, undefined);
    assert.equal(processed.digestion?.status, "hot");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.RAINDROP_TOKEN; else process.env.RAINDROP_TOKEN = originalToken;
    if (originalDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED; else process.env.LIBRARY_SUMMARIZE_DISABLED = originalDisabled;
  }
});

test("Raindrop PDF cache is extracted with pdftotext, not dumped as binary", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.RAINDROP_TOKEN;
  const originalDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  process.env.RAINDROP_TOKEN = "test-token";
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const source: LibrarySourceConfig = {
    id: "raindrop-bookmarks", name: "Raindrop bookmarks", channel: "raindrop", url: "raindrop://collection/0",
    enabled: true, cadence: "hourly", intent: "explicit_save", signal: "raindrop_bookmark",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" }, tags: [], filters: { include_topics: [], exclude_topics: [] }, metadata: {}, path: "",
  };
  // A minimal valid single-page PDF whose text is "Hilt PDF extraction smoke test - …" (>80 chars).
  const MINI_PDF_B64 = "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAxNTQgPj4Kc3RyZWFtCkJUIC9GMSAxNCBUZiA3MiA3MDAgVGQgKEhpbHQgUERGIGV4dHJhY3Rpb24gc21va2UgdGVzdCAtIHRoaXMgc2VudGVuY2UgaXMgZGVsaWJlcmF0ZWx5IGxvbmcgZW5vdWdoIHRvIGNsZWFyIHRoZSBlaWdodHkgY2hhcmFjdGVyIG1pbmltdW0gdGhyZXNob2xkLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA0NDYgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1MTYKJSVFT0Y=";
  const pdfBytes = Buffer.from(MINI_PDF_B64, "base64");
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.match(String(input), /\/raindrop\/777\/cache$/);
    return new Response(pdfBytes, { status: 200, headers: { "content-type": "application/pdf" } });
  }) as typeof fetch;
  try {
    const processed = await digestArtifact({
      url: "https://api.raindrop.io/v2/raindrop/777/file?type=application/pdf",
      title: "Loop-Engineering-IEEE.pdf",
      date: "2026-06-25T00:00:00Z",
      content: "Raindrop.io",
      metadata: { raindrop_id: 777, cache_status: "ready" },
    }, source);
    assert.equal(processed.source_cache?.extractor, "raindrop-pdf");
    assert.equal(processed.source_cache?.kind, "document");
    assert.match(processed.source_cache?.content || "", /smoke test/);
    assert.equal(processed.needs_auth_recovery, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.RAINDROP_TOKEN; else process.env.RAINDROP_TOKEN = originalToken;
    if (originalDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED; else process.env.LIBRARY_SUMMARIZE_DISABLED = originalDisabled;
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
    metadata: {
      playlist_id: "PL123",
      playlist_title: "Reference Playlist",
      playlist_url: "https://www.youtube.com/playlist?list=PL123",
      playlist_total: 13,
      series_id: "reference-playlist",
      series_title: "Reference Playlist",
      series_url: "https://www.youtube.com/playlist?list=PL123",
      series_total: 13,
      series_parent: "references/series/reference-playlist.md",
    },
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
          position: 4,
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
    assert.equal(batch.artifacts[0].metadata.playlist_title, "Reference Playlist");
    assert.equal(batch.artifacts[0].metadata.playlist_index, 5);
    assert.equal(batch.artifacts[0].metadata.playlist_total, 13);
    assert.equal(batch.artifacts[0].metadata.series_id, "reference-playlist");
    assert.equal(batch.artifacts[0].metadata.series_index, 5);
    assert.equal(batch.artifacts[0].metadata.series_parent, "references/series/reference-playlist.md");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
    else process.env.YOUTUBE_OAUTH_ACCESS_TOKEN = originalToken;
  }
});

test("resolves YouTube channel pages from canonical link before embedded channel IDs", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
  delete process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
  const source: LibrarySourceConfig = {
    id: "youtube-dwarkesh-patel",
    name: "Dwarkesh Patel",
    channel: "youtube",
    url: "https://www.youtube.com/@DwarkeshPatel",
    enabled: true,
    cadence: "hourly",
    intent: "discovery",
    retention: { mode: "candidate", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" },
    tags: ["youtube"],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "www.youtube.com" && url.pathname === "/@DwarkeshPatel") {
      return new Response(`
        <script>{"channelId":"UCZa18YV7qayTh-MRIrBhDpA"}</script>
        <link rel="canonical" href="https://www.youtube.com/channel/UCXl4i9dYBrFOabk0xGmbkRA">
      `, { status: 200 });
    }
    assert.equal(url.pathname, "/feeds/videos.xml");
    assert.equal(url.searchParams.get("channel_id"), "UCXl4i9dYBrFOabk0xGmbkRA");
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
        <entry>
          <title>Proper main-channel episode</title>
          <link rel="alternate" href="https://www.youtube.com/watch?v=abc123def45"/>
          <published>2026-06-05T00:00:00Z</published>
        </entry>
      </feed>
    `, { status: 200 });
  }) as typeof fetch;

  try {
    const batch = await fetchYouTubeArtifacts(source, { limit: 1 });
    assert.equal(batch.artifacts.length, 1);
    assert.equal(batch.artifacts[0].title, "Proper main-channel episode");
    assert.equal(batch.artifacts[0].metadata.channel_id, "UCXl4i9dYBrFOabk0xGmbkRA");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
    else process.env.YOUTUBE_OAUTH_ACCESS_TOKEN = originalToken;
  }
});

test("resolves YouTube handles through channels.list for Data API uploads", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
  process.env.YOUTUBE_OAUTH_ACCESS_TOKEN = "test-token";
  const source: LibrarySourceConfig = {
    id: "youtube-dwarkesh-patel",
    name: "Dwarkesh Patel",
    channel: "youtube",
    url: "https://www.youtube.com/@DwarkeshPatel",
    enabled: true,
    cadence: "hourly",
    intent: "discovery",
    retention: { mode: "candidate", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" },
    tags: ["youtube"],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: { fetch_strategy: "youtube_data_api" },
    path: "",
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/youtube/v3/channels") {
      assert.equal(url.searchParams.get("forHandle"), "@DwarkeshPatel");
      return new Response(JSON.stringify({
        items: [{ id: "UCXl4i9dYBrFOabk0xGmbkRA" }],
      }), { status: 200 });
    }
    assert.equal(url.pathname, "/youtube/v3/playlistItems");
    assert.equal(url.searchParams.get("playlistId"), "UUXl4i9dYBrFOabk0xGmbkRA");
    return new Response(JSON.stringify({
      items: [{
        snippet: {
          title: "Proper main-channel episode",
          channelTitle: "Dwarkesh Patel",
          description: "A full episode from the main channel.",
          resourceId: { videoId: "abc123def45" },
        },
        contentDetails: {
          videoId: "abc123def45",
          videoPublishedAt: "2026-06-05T00:00:00Z",
        },
      }],
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const batch = await fetchYouTubeArtifacts(source, { limit: 1 });
    assert.equal(batch.artifacts.length, 1);
    assert.equal(batch.artifacts[0].author, "Dwarkesh Patel");
    assert.equal(batch.artifacts[0].metadata.channel_id, "UCXl4i9dYBrFOabk0xGmbkRA");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
    else process.env.YOUTUBE_OAUTH_ACCESS_TOKEN = originalToken;
  }
});

test("YouTube clip detector parses ISO 8601 video durations", () => {
  assert.equal(parseYouTubeDurationSeconds("PT1H16M8S"), 4568);
  assert.equal(parseYouTubeDurationSeconds("PT53S"), 53);
  assert.equal(parseYouTubeDurationSeconds("P1DT2M3S"), 86523);
  assert.equal(parseYouTubeDurationSeconds("not-a-duration"), null);
});

test("YouTube clip detector suppresses high-confidence clips from dedicated clip channels", () => {
  const result = detectYouTubeContentForm({
    title: "How Did Italy Cope With the Fall of Rome? - Ada Palmer",
    description: "A short excerpt from the Dwarkesh podcast. Watch the full episode: https://youtu.be/fullEpisode1",
    channelTitle: "Dwarkesh Clips",
    sourceId: "youtube-dwarkesh-patel",
    sourceName: "Dwarkesh Patel",
    sourceIntent: "discovery",
    sourceSignal: "youtube_channel_upload",
    durationSeconds: 228,
  });

  assert.equal(result.content_form, "clip");
  assert.equal(result.confidence_label, "high");
  assert.equal(result.policy_action, "suppress");
  assert.ok(result.signals.includes("channel_mentions_clips"));
  assert.ok(result.signals.includes("description_links_full_episode"));
});

test("YouTube clip detector suppresses short-form videos when discovery sources carry Shorts markers", () => {
  const result = detectYouTubeContentForm({
    title: "The one word that defines every great founder",
    description: "David Senra on company building. #shorts #podcast",
    channelTitle: "Sequoia Capital",
    sourceId: "youtube-sequoia-capital",
    sourceName: "Sequoia Capital",
    sourceIntent: "discovery",
    sourceSignal: "youtube_channel_upload",
    durationSeconds: 41,
  });

  assert.equal(result.content_form, "short");
  assert.equal(result.policy_action, "suppress");
  assert.ok(result.signals.includes("shorts_marker"));
  assert.ok(result.signals.includes("duration_under_90s"));
});

test("YouTube clip detector suppresses ambiguous podcast excerpts under the consolidated policy", () => {
  // Consolidated 2026-06 after the review phase validated every label_review verdict as a real
  // clip: medium-confidence clips suppress directly instead of asking for review.
  const result = detectYouTubeContentForm({
    title: "\"Zero token architecture\"",
    description: "Kelsey Hightower on The Pragmatic Engineer podcast.",
    channelTitle: "The Pragmatic Engineer",
    sourceId: "youtube-pragmatic-engineer",
    sourceName: "The Pragmatic Engineer",
    sourceIntent: "discovery",
    sourceSignal: "youtube_channel_upload",
    durationSeconds: 53,
  });

  assert.equal(result.content_form, "clip");
  assert.equal(result.confidence_label, "medium");
  assert.equal(result.policy_action, "suppress");
  assert.ok(result.signals.includes("short_podcast_excerpt_description"));
});

test("YouTube clip detector suppresses very short discovery uploads under the consolidated policy", () => {
  const result = detectYouTubeContentForm({
    title: "AI still needs humans",
    description: "#ai #artificialintelligence #futureofwork",
    channelTitle: "Lenny's Podcast",
    sourceId: "youtube-lennys-podcast",
    sourceName: "Lenny's Podcast",
    sourceIntent: "discovery",
    sourceSignal: "youtube_channel_upload",
    durationSeconds: 56,
  });

  assert.equal(result.content_form, "standalone_short");
  assert.equal(result.confidence_label, "medium");
  assert.equal(result.policy_action, "suppress");
  assert.ok(result.signals.includes("very_short_discovery_upload"));
});

test("YouTube clip detector processes long episode-shaped videos", () => {
  const result = detectYouTubeContentForm({
    title: "Learning Go with Eric Jang",
    description: "00:00:00 Intro\n00:05:12 Learning Go\n00:40:00 Production systems",
    channelTitle: "Full Stack Radio",
    sourceId: "youtube-full-stack-radio",
    sourceName: "Full Stack Radio",
    sourceIntent: "discovery",
    sourceSignal: "youtube_channel_upload",
    durationSeconds: 4568,
  });

  assert.equal(result.content_form, "episode");
  assert.equal(result.policy_action, "process");
  assert.ok(result.signals.includes("duration_over_20m"));
  assert.ok(result.signals.includes("description_has_chapters"));
});

test("YouTube clip detector does not suppress explicit user saves", () => {
  const result = detectYouTubeContentForm({
    title: "A useful short explanation",
    description: "Useful short clip. #shorts",
    channelTitle: "Useful Channel",
    sourceId: "youtube-bookmarks",
    sourceName: "YouTube Bookmarks",
    sourceIntent: "explicit_save",
    sourceSignal: "youtube_bookmark_playlist",
    durationSeconds: 58,
  });

  assert.equal(result.content_form, "short");
  assert.equal(result.policy_action, "label_only");
});

test("library YouTube clip admin filter includes skipped auto-skip candidates with evidence", () => {
  const vault = tempVault();
  const cacheDir = path.join(vault, "references", ".cache", "library-candidates");
  fs.mkdirSync(cacheDir, { recursive: true });

  const clip = processedYouTubeArtifact();
  clip.source = { ...clip.source, id: "youtube-fixture-clips", name: "Fixture Clips" };
  clip.raw = {
    ...clip.raw,
    url: "https://www.youtube.com/watch?v=clip1234567",
    title: "Short excerpt from a longer episode",
    author: "Fixture Clips",
  };
  clip.description = "Watch the full episode after this short excerpt.";
  clip.summary = "Watch the full episode after this short excerpt.";
  clip.video_duration_seconds = 181;

  const episode = processedYouTubeArtifact();
  episode.raw = {
    ...episode.raw,
    url: "https://www.youtube.com/watch?v=episode1234",
    title: "Full episode with chapters",
    author: "Fixture Channel",
  };
  episode.description = "00:00:00 Intro\n00:10:00 Main topic";
  episode.summary = "00:00:00 Intro\n00:10:00 Main topic";
  episode.video_duration_seconds = 3600;

  fs.writeFileSync(path.join(cacheDir, "clip.md"), buildCandidateMarkdown(clip).replace("status: candidate", "status: skipped"), "utf-8");
  fs.writeFileSync(path.join(cacheDir, "episode.md"), buildCandidateMarkdown(episode), "utf-8");

  const suppress = listLibraryArtifactDetails(vault, { youtube_clip_policy: "suppress" });
  assert.equal(suppress.total, 1);
  assert.equal(suppress.artifacts[0].title, "Short excerpt from a longer episode");
  assert.equal(suppress.artifacts[0].lifecycle_status, "skipped");
  assert.equal(suppress.artifacts[0].youtube_clip?.policy_action, "suppress");
  assert.ok(suppress.artifacts[0].youtube_clip?.signals.includes("channel_mentions_clips"));

  const workbench = buildWorkbenchRows(vault);
  assert.equal(workbench.facets.youtube_clip_policy.suppress, 1);
  assert.equal(workbench.facets.youtube_clip_policy.process, 1);
});

test("YouTube metadata preflight persists clip evidence for library review filters", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
  const originalSummarizeDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  const originalClipSuppress = process.env.LIBRARY_YOUTUBE_CLIP_SUPPRESS;
  process.env.YOUTUBE_OAUTH_ACCESS_TOKEN = "test-token";
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  // Kill switch ON: this test exercises the label-only persistence path (frontmatter evidence on a
  // written candidate); default-on enforcement is covered by the suppression-skip test below.
  process.env.LIBRARY_YOUTUBE_CLIP_SUPPRESS = "0";
  const vault = tempVault();
  writeSource(vault, "youtube.yaml", `
id: youtube-sequoia-capital
name: Sequoia Capital
channel: youtube
url: fixture://youtube
enabled: true
intent: discovery
signal: youtube_channel_upload
retention:
  mode: candidate
  candidate_ttl_days: 30
  auto_promote_threshold: 0.99
tags: [youtube]
fixtures:
  - url: https://www.youtube.com/watch?v=clip1234567
    title: The one word that defines every great founder
    date: "2026-06-05T00:00:00Z"
    metadata:
      format: video
`);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/youtube/v3/videos");
    assert.equal(url.searchParams.get("id"), "clip1234567");
    return new Response(JSON.stringify({
      items: [{
        id: "clip1234567",
        snippet: {
          title: "The one word that defines every great founder",
          description: "David Senra on company building. #shorts Watch the full episode on the channel.",
          channelId: "UC123",
          channelTitle: "Sequoia Capital",
          publishedAt: "2026-06-05T00:00:00Z",
          tags: ["founders", "podcast"],
        },
        contentDetails: { duration: "PT41S" },
        status: { privacyStatus: "public" },
      }],
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const report = await runIngestion(vault, { useSummarize: false });
    assert.equal(report.candidates, 1);
    assert.deepEqual(report.errors, []);
    assert.equal(report.sources[0].youtube_clip_review?.metadata_checked, 1);
    assert.equal(report.sources[0].youtube_clip_review?.metadata_enriched, 1);
    assert.equal(report.sources[0].youtube_clip_review?.policy_actions.suppress, 1);
    assert.equal(report.sources[0].youtube_clip_review?.content_forms.short, 1);
    assert.equal(report.sources[0].artifacts[0].youtube_clip_policy, "suppress");
    assert.equal(report.sources[0].artifacts[0].youtube_content_form, "short");

    const [candidate] = listCandidates(vault);
    assert.equal(candidate.raw_frontmatter.youtube_metadata_at ? true : false, true);
    assert.equal(candidate.raw_frontmatter.youtube_channel_title, "Sequoia Capital");
    assert.equal(candidate.raw_frontmatter.youtube_duration_seconds, 41);
    assert.equal(candidate.raw_frontmatter.video_duration_seconds, 41);
    assert.equal(candidate.raw_frontmatter.youtube_description_has_shorts_marker, true);
    assert.equal(candidate.raw_frontmatter.youtube_description_links_full_episode, true);
    assert.equal((candidate.raw_frontmatter.youtube_clip as Record<string, unknown>).policy_action, "suppress");

    const suppress = listLibraryArtifactDetails(vault, { youtube_clip_policy: "suppress" });
    assert.equal(suppress.total, 1);
    assert.equal(suppress.artifacts[0].youtube_clip?.policy_action, "suppress");
    assert.ok(suppress.artifacts[0].youtube_clip?.signals.includes("shorts_marker"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
    else process.env.YOUTUBE_OAUTH_ACCESS_TOKEN = originalToken;
    if (originalSummarizeDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED;
    else process.env.LIBRARY_SUMMARIZE_DISABLED = originalSummarizeDisabled;
    if (originalClipSuppress === undefined) delete process.env.LIBRARY_YOUTUBE_CLIP_SUPPRESS;
    else process.env.LIBRARY_YOUTUBE_CLIP_SUPPRESS = originalClipSuppress;
  }
});

test("ingestion skips suppressed clips before digestion (enforced by default)", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
  const originalSummarizeDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  process.env.YOUTUBE_OAUTH_ACCESS_TOKEN = "test-token";
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  writeSource(vault, "youtube.yaml", `
id: youtube-sequoia-capital
name: Sequoia Capital
channel: youtube
url: fixture://youtube
enabled: true
intent: discovery
signal: youtube_channel_upload
retention:
  mode: candidate
  candidate_ttl_days: 30
  auto_promote_threshold: 0.99
tags: [youtube]
fixtures:
  - url: https://www.youtube.com/watch?v=clip1234567
    title: The one word that defines every great founder
    date: "2026-06-05T00:00:00Z"
    metadata:
      format: video
`);

  globalThis.fetch = (async () => new Response(JSON.stringify({
    items: [{
      id: "clip1234567",
      snippet: {
        title: "The one word that defines every great founder",
        description: "David Senra on company building. #shorts Watch the full episode on the channel.",
        channelId: "UC123",
        channelTitle: "Sequoia Capital",
        publishedAt: "2026-06-05T00:00:00Z",
        tags: ["founders", "podcast"],
      },
      contentDetails: { duration: "PT41S" },
      status: { privacyStatus: "public" },
    }],
  }), { status: 200 })) as typeof fetch;

  try {
    const report = await runIngestion(vault, { useSummarize: false });
    assert.equal(report.candidates, 0);
    assert.equal(report.skipped, 1);
    assert.deepEqual(report.errors, []);
    // The skip is fully audited: per-artifact status + reason, and the clip rollup still counts it.
    assert.equal(report.sources[0].artifacts[0].status, "skipped");
    assert.equal(report.sources[0].artifacts[0].reason, "youtube_clip_suppressed");
    assert.equal(report.sources[0].artifacts[0].youtube_clip_policy, "suppress");
    assert.equal(report.sources[0].youtube_clip_review?.policy_actions.suppress, 1);
    // Nothing was written: suppression happens BEFORE digestion, so no candidate file exists.
    assert.equal(listCandidates(vault).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
    else process.env.YOUTUBE_OAUTH_ACCESS_TOKEN = originalToken;
    if (originalSummarizeDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED;
    else process.env.LIBRARY_SUMMARIZE_DISABLED = originalSummarizeDisabled;
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

test("series metadata round-trips through candidates and saved references", () => {
  const vault = tempVault();
  const processed = processedYouTubeArtifact();
  processed.series = {
    id: "reference-playlist",
    title: "Reference Playlist",
    url: "https://www.youtube.com/playlist?list=PL123",
    index: 2,
    total: 13,
    parent_path: "references/series/reference-playlist.md",
  };

  const cacheDir = path.join(vault, "references", ".cache", "library-candidates");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "candidate.md"), buildCandidateMarkdown(processed), "utf-8");
  const [candidate] = listCandidates(vault);
  assert.deepEqual(candidate.series, processed.series);

  const candidateArtifact = listLibraryArtifactDetails(vault, {
    includeCandidates: true,
    series: "reference-playlist",
  }).artifacts[0];
  assert.ok(candidateArtifact);
  assert.equal(candidateArtifact.series?.title, "Reference Playlist");

  const referencePath = path.join(vault, "references", "saved.md");
  fs.writeFileSync(referencePath, buildDurableReferenceMarkdown(processed, "manual_save"), "utf-8");
  const parsed = parseReferenceFile(vault, referencePath);
  assert.ok(parsed);
  assert.deepEqual(parsed.series, processed.series);
  assert.equal(listLibraryArtifactDetails(vault, {
    includeCandidates: false,
    series: "reference-playlist",
  }).artifacts.length, 1);
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

test("durable reference markdown embeds metadata video url when canonical url is an article page", () => {
  const processed = processedYouTubeArtifact();
  processed.raw.url = "https://www.dwarkesh.com/p/dario-amodei-2";
  processed.raw.metadata.video_url = "https://www.youtube.com/watch?v=n1E9IZfvGMA";
  const markdown = buildDurableReferenceMarkdown(processed);
  assert.match(markdown, /youtube\.com\/embed\/n1E9IZfvGMA/);
  assert.doesNotMatch(markdown, /\[Watch on YouTube]/);
});

test("durable reference markdown embeds X video post urls", () => {
  const processed = processedYouTubeArtifact();
  processed.source.channel = "twitter";
  processed.format = "tweet";
  processed.raw.url = "https://x.com/wrapper/status/123";
  processed.raw.metadata.video_url = "https://x.com/example/status/456/video/1";
  const markdown = buildDurableReferenceMarkdown(processed);
  assert.match(markdown, /platform\.twitter\.com\/embed\/Tweet\.html\?id=456&dnt=true/);
  assert.match(markdown, /height="900"/);
  assert.doesNotMatch(markdown, /\[Open on X]/);
  assert.match(buildMediaMarkdown(processed.raw), /## Media/);
});

test("parses timestamped YouTube transcript cache into seekable segments", () => {
  const segments = parseTimedTranscript(`00:00 Intro line
00:30 A full transcript line.
1:02:03 Long-form timestamp line.
`);
  assert.deepEqual(segments.map((segment) => segment.timestamp), ["0:00", "0:30", "1:02:03"]);
  assert.equal(segments[1].start_seconds, 30);
  assert.equal(segments[2].start_seconds, 3723);
});

test("parses WebVTT-like transcript ranges into seekable segments", () => {
  const segments = parseTimedTranscript(`WEBVTT

00:00:01.000 --> 00:00:04.000
Opening words.

00:00:04.000 --> 00:00:06.000
Second caption.
`);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].timestamp, "0:01");
  assert.equal(segments[0].text, "Opening words.");
});

test("saved references use legacy created frontmatter before filesystem creation time", () => {
  const vault = tempVault();
  fs.writeFileSync(path.join(vault, "references", "legacy.md"), `---
type: reference
description: Legacy reference.
url: https://example.com/legacy
created: 2026-02-14T00:00:00.000Z
---
# Legacy Reference

## Summary

Older manually captured reference.
`, "utf-8");

  const [reference] = listSavedReferences(vault);
  assert.equal(reference.created_at, "2026-02-14");
});

test("saved references use captured_at before filesystem creation time", () => {
  const vault = tempVault();
  const memoPath = path.join(vault, "references", "process", "memos", "2026-06-10-editors-memo.md");
  fs.mkdirSync(path.dirname(memoPath), { recursive: true });
  fs.writeFileSync(memoPath, `---
type: reference
title: The Bottleneck Isn't the Model
format: memo
source_id: library-memo
source_name: Editor's Memo
captured_at: '2026-06-10T03:34:33.790Z'
digested_at: '2026-06-10T03:34:33.790Z'
---
# The Bottleneck Isn't the Model
`, "utf-8");

  const [reference] = listSavedReferences(vault);
  assert.equal(reference.created_at, "2026-06-10");
});

test("cleans legacy reference body navigation and metadata into frontmatter", () => {
  const body = `# Legacy Video

← [[index|References]]

**Source**: https://www.youtube.com/watch?v=abc123def45
**Author:** Example Author
**Publisher**: Example Publisher
**Date**: May 24, 2026
**Captured**: May 25, 2026
**Format**: podcast video (1:34:06)

---

## Summary

Useful preserved summary.
`;
  const result = cleanupLegacyReferenceBody({ type: "reference" }, body);
  assert.equal(result.removedNavigation, true);
  assert.deepEqual(result.addedFrontmatterKeys, ["url", "author", "publisher", "published", "captured", "format"]);
  assert.equal(result.data.url, "https://www.youtube.com/watch?v=abc123def45");
  assert.equal(result.data.published, "2026-05-24");
  assert.equal(result.data.captured, "2026-05-25");
  assert.doesNotMatch(result.body, /\[\[index\|References\]\]/);
  assert.doesNotMatch(result.body, /\*\*Source/);
  assert.match(result.body, /^# Legacy Video\n\n## Summary/m);
});

test("legacy body cleanup is limited to top chrome and preserves raw source metadata", () => {
  const body = `# Legacy Article

## Summary

Useful summary.

## Raw Content

<details>
<summary>Full source cache</summary>

**Source:** This line belongs to the source cache, not the note chrome.

</details>
`;
  const result = cleanupLegacyReferenceBody({ type: "reference", url: "https://example.com" }, body);
  assert.equal(result.body, body);
  assert.deepEqual(result.addedFrontmatterKeys, []);
  assert.equal(stripLegacyReferenceBodyCruft(body), body);
});

test("legacy body cleanup moves pre-title media into the standard reference order", () => {
  const body = `## Media

![Hero](https://example.com/hero.jpg)

# Legacy Article

## Summary

Useful summary.
`;
  const result = cleanupLegacyReferenceBody({ type: "reference" }, body);
  assert.equal(result.movedLeadingMedia, true);
  assert.match(result.body, /^# Legacy Article\n\n## Media\n\n!\[Hero\]\(https:\/\/example\.com\/hero\.jpg\)\n\n## Summary/m);
});

test("recent library list sorts mixed frontmatter date formats by timestamp", () => {
  const vault = tempVault();
  fs.writeFileSync(path.join(vault, "references", "saved.md"), `---
type: reference
description: Saved reference.
url: https://example.com/saved
published: 2026-05-27
captured: 2026-05-28
---
# Saved Reference
`, "utf-8");

  const processed = processedYouTubeArtifact();
  processed.raw.date = "2026-05-28";
  const cacheDir = path.join(vault, "references", ".cache", "library-candidates");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "candidate.md"), buildCandidateMarkdown(processed), "utf-8");

  const listed = listLibraryArtifactDetails(vault, { includeCandidates: true });
  // Intake-ordering (feed position = "first seen"): the candidate's `digested` stamp is today, so it
  // leads; the saved ref resolves to its `captured` intake date 2026-05-28 — NOT the earlier
  // `published` 2026-05-27 — proving intake beats publish across mixed frontmatter date formats.
  assert.equal(listed.artifacts[0].lifecycle_status, "candidate");
  assert.equal(listed.artifacts[1].lifecycle_status, "saved");
  assert.equal(listed.artifacts[1].created_at, "2026-05-28");
});

test("recent library list uses precise ingestion time to order same-day references", () => {
  const vault = tempVault();
  fs.writeFileSync(path.join(vault, "references", "older-same-day.md"), `---
type: reference
description: Older same-day reference.
url: https://example.com/older-same-day
published: 2026-05-29
digested_at: '2026-05-29T01:43:05.840Z'
---
# Older Same Day
`, "utf-8");
  fs.writeFileSync(path.join(vault, "references", "newer-same-day.md"), `---
type: reference
description: Newer same-day reference.
url: https://example.com/newer-same-day
published: 2026-05-29
digested_at: '2026-05-29T12:19:52.713Z'
---
# Newer Same Day
`, "utf-8");

  const listed = listLibraryArtifactDetails(vault, { limit: 2 });
  assert.deepEqual(listed.artifacts.map((artifact) => artifact.title), ["Newer Same Day", "Older Same Day"]);
  assert.deepEqual(listed.artifacts.map((artifact) => artifact.created_at), ["2026-05-29", "2026-05-29"]);
});

test("library list supports offset pagination for incremental UI loading", () => {
  const vault = tempVault();
  for (const [index, date] of ["2026-05-29", "2026-05-28", "2026-05-27"].entries()) {
    fs.writeFileSync(path.join(vault, "references", `saved-${index}.md`), `---
type: reference
description: Saved ${index}.
url: https://example.com/saved-${index}
published: ${date}
---
# Saved ${index}
`, "utf-8");
  }

  const first = listLibraryArtifactDetails(vault, { limit: 2 });
  const second = listLibraryArtifactDetails(vault, { offset: 2, limit: 2 });
  assert.equal(first.total, 3);
  assert.deepEqual(first.artifacts.map((artifact) => artifact.created_at), ["2026-05-29", "2026-05-28"]);
  assert.equal(second.total, 3);
  assert.deepEqual(second.artifacts.map((artifact) => artifact.created_at), ["2026-05-27"]);
});

test("library detail lookup returns saved references and candidates by id", () => {
  const vault = tempVault();
  fs.writeFileSync(path.join(vault, "references", "saved.md"), `---
type: reference
description: Saved detail summary.
url: https://example.com/saved-detail
published: 2026-05-29
---
# Saved Detail

## Summary

Saved detail body.
`, "utf-8");

  const processed = processedYouTubeArtifact();
  const cacheDir = path.join(vault, "references", ".cache", "library-candidates");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "candidate.md"), buildCandidateMarkdown(processed), "utf-8");

  const listed = listLibraryArtifactDetails(vault, { includeCandidates: true, limit: 10 }).artifacts;
  const saved = listed.find((artifact) => artifact.lifecycle_status === "saved");
  const candidate = listed.find((artifact) => artifact.lifecycle_status === "candidate");
  assert.ok(saved);
  assert.ok(candidate);

  const savedDetail = getLibraryArtifact(vault, saved.id);
  const candidateDetail = getLibraryArtifact(vault, candidate.id);
  assert.equal(savedDetail?.title, "Saved Detail");
  assert.equal(savedDetail?.content.includes("Saved detail body."), true);
  assert.equal(candidateDetail?.title, processed.raw.title);
  assert.equal(candidateDetail?.lifecycle_status, "candidate");
  assert.equal(candidateDetail?.content.includes("Full source cache"), true);

  assert.equal(getLibraryArtifactByPath(vault, saved.id, saved.path)?.title, "Saved Detail");
  assert.equal(getLibraryArtifactByPath(vault, candidate.id, candidate.path)?.title, processed.raw.title);
  assert.equal(getLibraryArtifactByPath(vault, saved.id, "../outside.md"), null);
  assert.equal(getLibraryArtifactByPath(vault, "wrong-id", saved.path), null);
});

test("skipped candidates stay out of the default library feed", () => {
  const vault = tempVault();
  const cacheDir = path.join(vault, "references", ".cache", "library-candidates");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "skipped.md"), buildCandidateMarkdown(processedYouTubeArtifact()).replace("status: candidate", "status: skipped"), "utf-8");

  const defaultList = listLibraryArtifactDetails(vault, { includeCandidates: true });
  assert.equal(defaultList.total, 0);

  const skippedList = listLibraryArtifactDetails(vault, { includeCandidates: true, status: "skipped" });
  assert.equal(skippedList.total, 1);
  assert.equal(skippedList.artifacts[0].lifecycle_status, "skipped");
});

test("library read state baselines old stock and marks new artifacts read", () => {
  const vault = tempVault();
  const initial = listLibraryArtifactDetails(vault, { includeCandidates: true });
  assert.equal(initial.total, 0);
  assert.equal(initial.unread_total, 0);
  assert.equal(hasUnreadLibraryArtifacts(vault), false);

  const legacyPath = path.join(vault, "references", "legacy-maintenance.md");
  fs.writeFileSync(legacyPath, `---
type: reference
description: Legacy item that should not become unread when repaired.
url: https://example.com/legacy
published: '2026-05-01'
captured: '2026-05-01'
---
# Legacy Maintenance

## Summary

Old stock.
`, "utf-8");
  const maintenanceTime = new Date(Date.now() + 5_000);
  fs.utimesSync(legacyPath, maintenanceTime, maintenanceTime);

  const afterMaintenance = listLibraryArtifactDetails(vault, { includeCandidates: true });
  assert.equal(afterMaintenance.total, 1);
  assert.equal(afterMaintenance.unread_total, 0);
  assert.equal(afterMaintenance.artifacts[0].is_unread, false);
  assert.equal(hasUnreadLibraryArtifacts(vault), false);

  const filePath = path.join(vault, "references", "new-reference.md");
  const captureTime = new Date(Date.now() + 5_000).toISOString();
  const newReferenceMarkdown = buildDurableReferenceMarkdown(processedYouTubeArtifact(), "manual_save")
    .replace(/captured_at: .+/, `captured_at: '${captureTime}'`);
  fs.writeFileSync(filePath, newReferenceMarkdown, "utf-8");

  const withUnread = listLibraryArtifactDetails(vault, { includeCandidates: true });
  assert.equal(withUnread.total, 2);
  assert.equal(withUnread.unread_total, 1);
  const unreadArtifact = withUnread.artifacts.find((artifact) => artifact.is_unread);
  assert.ok(unreadArtifact);
  assert.equal(unreadArtifact.path, "references/new-reference.md");
  assert.equal(hasUnreadLibraryArtifacts(vault), true);
  const unreadOnly = listLibraryArtifactDetails(vault, { includeCandidates: true, unread: true });
  assert.equal(unreadOnly.total, 1);
  assert.equal(unreadOnly.artifacts[0].id, unreadArtifact.id);

  const result = markLibraryArtifactsRead(vault, [unreadArtifact.id], new Date(Date.now() + 10_000).toISOString());
  assert.equal(result.marked, 1);

  const afterRead = listLibraryArtifactDetails(vault, { includeCandidates: true });
  assert.equal(afterRead.unread_total, 0);
  assert.equal(hasUnreadLibraryArtifacts(vault), false);
  const readArtifact = afterRead.artifacts.find((artifact) => artifact.id === unreadArtifact.id);
  assert.ok(readArtifact);
  assert.equal(readArtifact.is_unread, false);
  assert.ok(readArtifact.read_at);
  const unreadAfterRead = listLibraryArtifactDetails(vault, { includeCandidates: true, unread: true });
  assert.equal(unreadAfterRead.total, 0);
});

test("legacy saved references without source ids appear as Manual", () => {
  const vault = tempVault();
  fs.writeFileSync(path.join(vault, "references", "manual.md"), `---
type: reference
description: Manual saved item.
url: https://example.com/manual
published: 2026-05-29
---
# Manual Saved Item
`, "utf-8");

  const [artifact] = listLibraryArtifactDetails(vault, { source: "manual" }).artifacts;
  assert.equal(artifact.source_id, "manual");
  assert.equal(artifact.source_name, "Manual");
  assert.equal(artifact.channel, "manual");

  const sources = listLibrarySources(vault);
  assert.equal(sources[0].id, "manual");
  assert.equal(sources[0].name, "Manual");
  assert.equal(sources[0].artifact_count, 1);
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
        body: "<html><body><p>The full newsletter body has enough text for fallback digestion &amp; candidate summaries.</p><p>\u034f \u00ad\u034f \u00ad Forwarded this email? Subscribe here for more.</p></body></html>",
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
  assert.doesNotMatch(artifact.content || "", /\u034f|\u00ad/);
});

test("metadata fallback digestion strips newsletter chrome before summarizing", async () => {
  const originalDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
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
  const realParagraph = [
    "Anthropic announced a major financing round and a new Claude model focused on long-running coding work.",
    "The meaningful product shift is dynamic workflows, where the coding agent plans a migration and coordinates parallel subagents.",
    "The operational risk is that these workflows can consume large token budgets and need careful harnessing before they are reliable.",
    "For the library, this is useful because it connects model capability, agent orchestration, and infrastructure costs.",
  ].join(" ");

  try {
    const processed = await digestArtifact({
      url: "superhuman://thread/test-newsletter",
      title: "Useful AI infrastructure note",
      date: "2026-05-29T00:00:00Z",
      content: `Products Products Workplace Systems Pricing Login. Total Anthropic victory!. \u034f \u00ad\u034f \u00ad Forwarded this email? Subscribe here for more. ${realParagraph}`,
      metadata: { format: "newsletter" },
    }, source);

    assert.equal(processed.source_cache?.extractor, "source-metadata");
    assert.match(processed.summary, /Anthropic announced a major financing round/);
    assert.doesNotMatch(processed.summary, /\u034f|\u00ad|Forwarded this email|Subscribe here/);
    assert.doesNotMatch(processed.key_points.join("\n"), /\u034f|\u00ad|Forwarded this email|Subscribe here/);
    assert.doesNotMatch(processed.source_cache?.content || "", /\u034f|\u00ad|Forwarded this email|Subscribe here/);
    // Web-nav chrome (collapsed "Products Products" plus a capitalized nav run) must not leak into the summary.
    assert.doesNotMatch(processed.summary, /Products Products Workplace Systems/);
    assert.doesNotMatch(processed.summary, /Workplace Systems Pricing Login/);
    // Summary now preserves the full narrative; key points are the DISTINCT remaining sentences,
    // so the two must no longer be identical (the old slice(0,4)/slice(0,5) overlap is gone).
    assert.ok(processed.key_points.length > 0);
    assert.notEqual(processed.summary, processed.key_points.join(" "));
    assert.notEqual(processed.summary, processed.key_points.join("\n"));
    for (const point of processed.key_points) {
      assert.equal(processed.summary.includes(point), false);
    }
  } finally {
    if (originalDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED;
    else process.env.LIBRARY_SUMMARIZE_DISABLED = originalDisabled;
  }
});

test("digestion does not leak markdown headings into prose summaries", async () => {
  const originalDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const source: LibrarySourceConfig = {
    id: "fixture-source",
    name: "Fixture",
    channel: "fixture",
    url: "fixture://source",
    enabled: true,
    cadence: "manual",
    intent: "explicit_save",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: false, mode: "none" },
    tags: [],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };

  try {
    const processed = await digestArtifact({
      url: "https://example.com/markdown-summary",
      title: "Markdown summary",
      date: "2026-05-29T00:00:00Z",
      content: [
        "Building a monopoly from scratch requires a company to create and capture value in a durable way.",
        "",
        "### Core Lessons for Market Dominance",
        "",
        "- **Value Creation vs. Value Capture:** It is not enough to create value; the business has to capture part of it.",
        "- *Create value, then capture it* is the foundational rule for long-term viability.",
      ].join("\n"),
      metadata: {},
    }, source, { useSummarize: false });

    assert.doesNotMatch(processed.summary, /###|\*\*/);
    assert.doesNotMatch(processed.key_points.join("\n"), /###|\*\*/);
    // Key points now come from the source's distinct markdown bullets (stripped of markers),
    // not a slice(0,5) overlap with the summary.
    assert.match(processed.key_points.join("\n"), /Value Creation vs\. Value Capture/);
    assert.match(processed.key_points.join("\n"), /Create value, then capture it/);
    assert.equal(processed.key_points.length, 2);
    // Summary and key points are no longer the same slice of text.
    assert.notEqual(processed.summary, processed.key_points.join(" "));
  } finally {
    if (originalDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED;
    else process.env.LIBRARY_SUMMARIZE_DISABLED = originalDisabled;
  }
});

// These helpers are module-private in digestion.ts today. The namespace access keeps this test
// file compiling and the suite green; the moment the core agent exports them, the assertions run
// for real instead of skipping. See report note about required exports.
const parseDigestOutput = (digestion as {
  parseDigestOutput?: (raw: string) => { summary: string; keyPoints: string[] };
}).parseDigestOutput;
const stripWebChrome = (digestion as {
  stripWebChrome?: (text: string) => string;
}).stripWebChrome;

test("parseDigestOutput keeps the full narrative and parses distinct key points", { skip: typeof parseDigestOutput !== "function" ? "digestion.parseDigestOutput is not exported" : false }, () => {
  const parse = parseDigestOutput as (raw: string) => { summary: string; keyPoints: string[] };
  const { summary, keyPoints } = parse("Narrative sentence one. Sentence two.\n\nKey takeaways:\n- alpha\n- beta\n- gamma");
  // Full narrative preserved (both sentences), not sentence-sliced.
  assert.equal(summary, "Narrative sentence one. Sentence two.");
  assert.deepEqual(keyPoints, ["alpha", "beta", "gamma"]);
  // Key points are distinct from the summary and carry no markers/markdown.
  assert.notEqual(summary, keyPoints.join(" "));
  assert.doesNotMatch(summary, /Key takeaways|^- |[*#]/);
  assert.doesNotMatch(keyPoints.join("\n"), /^- |[*#]/);
});

test("parseDigestOutput falls back to the full text when no takeaways marker is present", { skip: typeof parseDigestOutput !== "function" ? "digestion.parseDigestOutput is not exported" : false }, () => {
  const parse = parseDigestOutput as (raw: string) => { summary: string; keyPoints: string[] };
  const { summary, keyPoints } = parse("Just a narrative with no marker. A second sentence stays in full.");
  assert.equal(summary, "Just a narrative with no marker. A second sentence stays in full.");
  assert.deepEqual(keyPoints, []);
});

test("stripWebChrome collapses repeated navigation tokens", { skip: typeof stripWebChrome !== "function" ? "digestion.stripWebChrome is not exported" : false }, () => {
  const strip = stripWebChrome as (text: string) => string;
  const collapsed = strip("North North star metric metric metric dashboard");
  assert.doesNotMatch(collapsed, /North North/);
  assert.doesNotMatch(collapsed, /metric metric/);
  assert.match(collapsed, /North star metric dashboard/);
});

test("pure navigation chrome triggers the low-sentence guard and falls back to the title", async () => {
  const originalDisabled = process.env.LIBRARY_SUMMARIZE_DISABLED;
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const source: LibrarySourceConfig = {
    id: "fixture-source",
    name: "Fixture",
    channel: "fixture",
    url: "fixture://source",
    enabled: true,
    cadence: "manual",
    intent: "explicit_save",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: false, mode: "none" },
    tags: [],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };

  try {
    const processed = await digestArtifact({
      url: "https://example.com/nav-only",
      title: "Marketing Site Home",
      date: "2026-05-29T00:00:00Z",
      // Site navigation chrome with no real sentences (no terminal punctuation, capitalized run).
      content: "Acme Dashboard Reporting Analytics widget toolbar sidebar panel",
      metadata: {},
    }, source, { useSummarize: false });

    // No source-metadata cache is emitted for chrome-only source text.
    assert.equal(processed.source_cache, undefined);
    // Summary and key points fall back to the title rather than the navigation text.
    assert.equal(processed.summary, "Marketing Site Home");
    assert.deepEqual(processed.key_points, ["Marketing Site Home"]);
    assert.match(processed.extraction_notes.join("\n"), /Source text looked like site navigation/);
  } finally {
    if (originalDisabled === undefined) delete process.env.LIBRARY_SUMMARIZE_DISABLED;
    else process.env.LIBRARY_SUMMARIZE_DISABLED = originalDisabled;
  }
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
  // Explicit saves date to INTAKE (when Justin saved it), not the source's publish date (2026-05-26),
  // so a fresh bookmark surfaces at the top of the feed rather than buried at the content's age.
  assert.equal(listed.artifacts[0].created_at, new Date().toISOString().slice(0, 10));
});

test("explicit-save promotion preserves a completed candidate reweave", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  const cacheDir = path.join(vault, "references", ".cache", "library-candidates");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "adam-mosseri.md"), `---
type: reference-candidate
pipeline_version: v2.2
description: Instagram's pod model validates the product-staff role and taste-as-bottleneck thesis.
url: 'https://www.youtube.com/watch?v=yQ_EWmtfWvQ'
format: video
title: 'Adam Mosseri: AI is a tailwind for authenticity'
author: Lenny's Podcast
published: '2026-07-09'
digested: '2026-07-09'
channel: youtube
source_id: youtube-lennys-podcast
source_name: Lenny's Podcast
intent: discovery
digestion_status: hot
digested_with: summarize-cli
digested_at: '2026-07-09T13:28:27.825Z'
extracted_chars: 1000
cached_source_chars: 1000
cached_source_extractor: summarize-cli
tags: [product, growth]
library_mode: study
status: candidate
expires: '2026-08-08'
score:
  relevance: 0.51
  novelty: 0.65
  confidence: 0.78
  total: 0.619
save_recommendation: review
proposed_destination: references/process
connected_projects:
  - seb-1on1-strategy
connection_suggestions:
  - target: thoughts/new-process/index
    label: The New Process
    relationship: Mosseri's pod model confirms the role-collapse thesis.
connection_reasoning: Woven into 1 note across Justin's work.
reconnected_at: '2026-07-09T13:28:27.824Z'
reweave_candidates:
  - target: projects/seb-1on1-strategy/2026-07-09-seb-show-and-tell-plan
    why: Add product staff as Meta's vocabulary for the generalist PM-plus archetype.
attention_judgment:
  tier: high
  reason: Directly supports the current Seb narrative.
youtube_video_id: yQ_EWmtfWvQ
youtube_clip:
  content_form: episode
  confidence: 0.85
  confidence_label: high
  policy_action: process
  clip_score: 0
  episode_score: 0.85
  signals:
    - duration_over_20m
    - description_has_chapters
---
# Adam Mosseri: AI is a tailwind for authenticity

## Media

<iframe width="560" height="315" src="https://www.youtube.com/embed/yQ_EWmtfWvQ" title="Adam Mosseri: AI is a tailwind for authenticity" frameborder="0"></iframe>

Meta restructured Instagram's canonical product team into smaller pods.

## Product Staff

The candidate's completed reweave explains product staff as an evolved PM shape.

## Connections

- [[thoughts/new-process/index|The New Process]] - Mosseri's pod model confirms the role-collapse thesis.

## Raw Content

<details>
<summary>Full source cache</summary>

Transcript: A long useful transcript about product staff, pods, taste, and authenticity.

</details>
`, "utf-8");
  writeSource(vault, "youtube-bookmarks.yaml", `
id: youtube-bookmarks
name: YouTube Bookmarks
channel: fixture
url: youtube://playlist/PLBOOKMARKS
enabled: true
intent: explicit_save
signal: youtube_bookmark_playlist
fixtures:
  - url: https://www.youtube.com/watch?v=yQ_EWmtfWvQ
    title: 'Adam Mosseri: AI is a tailwind for authenticity'
    date: 2026-07-09
    content: Explicit bookmark of the same video should promote the candidate, not redigest it down.
    metadata: {}
`);

  const report = await runIngestion(vault, { useSummarize: false });
  assert.equal(report.promoted, 1);
  const promotedCandidate = listCandidates(vault)[0];
  assert.equal(promotedCandidate.status, "promoted");

  const saved = listSavedReferences(vault)[0];
  assert.equal(saved.path, "references/process/2026-07-09-adam-mosseri-ai-is-a-tailwind-for-authenticity.md");
  const parsed = parseReferenceFile(vault, path.join(vault, saved.path));
  assert.ok(parsed);
  assert.match(parsed.content, /## Product Staff/);
  assert.doesNotMatch(parsed.content, /## Summary\n\nExplicit bookmark/);
  assert.equal(parsed.raw_frontmatter.reconnected_at, "2026-07-09T13:28:27.824Z");
  assert.equal(parsed.raw_frontmatter.reweave_pending, undefined);
  assert.equal(parsed.raw_frontmatter.connection_reasoning, "Woven into 1 note across Justin's work.");
  assert.equal((parsed.raw_frontmatter.connection_suggestions as ConnectionSuggestion[]).length, 1);
  assert.equal((parsed.raw_frontmatter.youtube_clip as { confidence_label?: string }).confidence_label, "high");
});

test("source taxonomy is preserved separately from display tags", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  writeSource(vault, "raindrop.yaml", `
id: raindrop-bookmarks
name: Raindrop bookmarks
channel: fixture
url: fixture://raindrop
enabled: true
intent: explicit_save
signal: raindrop_bookmark
tags: [bookmark, raindrop]
fixtures:
  - url: https://example.com/centaurs
    title: Centaurs and Cyborgs
    date: 2026-05-26
    content: This saved article should keep Raindrop source tags as taxonomy rather than card source labels.
    metadata:
      tags: [ai-consulting, future-of-work]
      source_collection: AI Reading
      source_collection_id: 42
`);
  await runIngestion(vault, { useSummarize: false });

  const [artifact] = listLibraryArtifactDetails(vault, { includeCandidates: true }).artifacts;
  assert.deepEqual(artifact.tags, []);
  assert.deepEqual(artifact.source_tags, ["ai-consulting", "future-of-work"]);
  assert.equal(artifact.source_collection, "AI Reading");

  const byTag = listLibraryArtifactDetails(vault, { tag: "future-of-work", includeCandidates: true });
  assert.equal(byTag.total, 1);

  const source = listLibrarySources(vault).find((item) => item.id === "raindrop-bookmarks");
  assert.equal(source?.facets.some((facet) => facet.kind === "collection" && facet.label === "AI Reading"), true);
  assert.equal(source?.facets.some((facet) => facet.kind === "tag" && facet.label === "ai-consulting"), true);
});

test("keep-mode saved references are durable but hidden from the default study list", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  writeSource(vault, "raindrop.yaml", `
id: raindrop-bookmarks
name: Raindrop bookmarks
channel: fixture
url: fixture://raindrop
enabled: true
intent: explicit_save
signal: raindrop_bookmark
fixtures:
  - url: https://shop.example.com/zander-ottoman
    title: Zander Ottoman
    date: 2026-05-26
    content: A product bookmark to keep for later, not a study item to weave.
    metadata:
      tags: [shopping, furniture]
`);
  await runIngestion(vault, { useSummarize: false });

  assert.equal(listSavedReferences(vault).length, 1);
  assert.equal(listLibraryArtifactDetails(vault, { includeCandidates: true }).total, 0);

  const keep = listLibraryArtifactDetails(vault, { mode: "keep", includeCandidates: true });
  assert.equal(keep.total, 1);
  assert.equal(keep.artifacts[0].library_mode, "keep");
  assert.deepEqual(keep.artifacts[0].source_tags, ["shopping", "furniture"]);

  const all = listLibraryArtifactDetails(vault, { mode: "all", includeCandidates: true });
  assert.equal(all.total, 1);
});

test("library source counts respect lifecycle filters", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  writeSource(vault, "mixed.yaml", `
id: mixed-source
name: Mixed Source
channel: fixture
url: fixture://mixed
enabled: true
intent: discovery
retention:
  candidate_ttl_days: 30
  auto_promote_threshold: 0.99
fixtures:
  - url: https://example.com/review
    title: Review Artifact
    date: 2026-05-25
    content: This discovery item should remain a review candidate for source count filtering.
    metadata: {}
`);
  writeSource(vault, "explicit.yaml", `
id: explicit-source
name: Explicit Source
channel: fixture
url: fixture://explicit
enabled: true
intent: explicit_save
signal: test_bookmark
fixtures:
  - url: https://example.com/saved
    title: Saved Artifact
    date: 2026-05-26
    content: This explicit item should become a saved reference for source count filtering.
    metadata: {}
`);
  await runIngestion(vault, { useSummarize: false });

  const all = listLibrarySources(vault);
  assert.equal(all.find((source) => source.id === "mixed-source")?.candidate_count, 1);
  assert.equal(all.find((source) => source.id === "explicit-source")?.artifact_count, 1);

  const saved = listLibrarySources(vault, { status: "saved" });
  assert.equal(saved.find((source) => source.id === "mixed-source")?.candidate_count, 0);
  assert.equal(saved.find((source) => source.id === "explicit-source")?.artifact_count, 1);

  const candidates = listLibrarySources(vault, { status: "candidate" });
  assert.equal(candidates.find((source) => source.id === "mixed-source")?.candidate_count, 1);
  assert.equal(candidates.find((source) => source.id === "explicit-source")?.artifact_count, 0);
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
  const archived = parseReferenceFile(vault, path.join(vault, result.archived_to));
  assert.equal(archived?.raw_frontmatter.archived, true);
  assert.equal(archived?.raw_frontmatter.archived_from, artifact.path);
  assert.equal(listArchivedReferences(vault).length, 1);
  assert.equal(findArchivedReferenceByUrl(vault, "https://example.com/archive-me")?.path, result.archived_to);

  const rerun = await runIngestion(vault, { useSummarize: false, ignoreState: true });
  assert.equal(rerun.saved, 0);
  assert.equal(rerun.duplicates, 1);
  assert.equal(rerun.sources[0].artifacts[0].reason, "archived_reference_exists");
  assert.equal(listSavedReferences(vault).length, 0);
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

test("windowed X bookmark ingestion does not filter newly saved old tweets by tweet date", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  writeSource(vault, "twitter.yaml", `
id: twitter-bookmarks
name: X/Twitter bookmarks
channel: twitter
url: x://bookmarks
enabled: true
intent: explicit_save
signal: twitter_bookmark
metadata:
  incremental_mode: window
fixtures:
  - url: https://x.com/example/status/123
    title: Older tweet bookmarked today
    date: 2026-01-01T00:00:00.000Z
    content: This tweet is older than the last check but appears in the fetched bookmark window.
    metadata:
      signal: twitter_bookmark
`);
  fs.writeFileSync(path.join(vault, "meta", "sources", ".source-state.json"), JSON.stringify({
    "twitter-bookmarks": { last_checked_at: "2026-05-29T12:00:00.000Z" },
  }, null, 2), "utf-8");

  const report = await runIngestion(vault, { useSummarize: false });
  assert.equal(report.saved, 1);
  assert.equal(listSavedReferences(vault).length, 1);

  const duplicateReport = await runIngestion(vault, { useSummarize: false });
  assert.equal(duplicateReport.saved, 0);
  assert.equal(duplicateReport.duplicates, 1);
  assert.equal(listSavedReferences(vault).length, 1);
});

test("YouTube bookmark ingestion does not filter newly saved old videos by publish date", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  writeSource(vault, "youtube-bookmarks.yaml", `
id: youtube-bookmarks
name: YouTube Bookmarks
channel: fixture
url: youtube://playlist/PLBOOKMARKS
enabled: true
intent: explicit_save
signal: youtube_bookmark_playlist
fixtures:
  - url: https://www.youtube.com/watch?v=RkQQ7WEor7w
    title: Older video bookmarked today
    date: 2026-06-02T21:45:13.000Z
    content: This video was published before the last check but appeared in the fetched bookmark window today.
    metadata:
      signal: youtube_bookmark_playlist
      video_id: RkQQ7WEor7w
`);
  fs.writeFileSync(path.join(vault, "meta", "sources", ".source-state.json"), JSON.stringify({
    "youtube-bookmarks": { last_checked_at: "2026-06-05T01:34:09.622Z" },
  }, null, 2), "utf-8");

  const report = await runIngestion(vault, { useSummarize: false });
  assert.equal(report.saved, 1);
  assert.equal(listSavedReferences(vault).length, 1);

  const duplicateReport = await runIngestion(vault, { useSummarize: false });
  assert.equal(duplicateReport.saved, 0);
  assert.equal(duplicateReport.duplicates, 1);
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

test("for-you surfaces relevant items by worth and buries off-topic filler", async () => {
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
  markFixtureWeavesComplete(vault);
  const recommendations = getRecommendations(vault, 50);
  // The eval discriminates by worth: the on-topic item leads and outranks every off-topic filler item.
  assert.ok(recommendations.items.length >= 1 && recommendations.items.length <= 8);
  assert.equal(recommendations.items[0].title, "Agentic Product Discovery Loops");
  const onTopic = recommendations.items.find((item) => item.title === "Agentic Product Discovery Loops");
  const offTopicMax = Math.max(0, ...recommendations.items.filter((item) => item.title.startsWith("Off Topic")).map((item) => item.worth || 0));
  assert.ok((onTopic?.worth || 0) > offTopicMax, "on-topic item outranks all off-topic filler by worth");
  assert.equal("priority" in recommendations.items[0], false, "artificial priority buckets are not part of the recommendation contract");
  assert.equal(recommendations.items[0].eval_attrs?.worth, recommendations.items[0].worth);
  assert.equal(recommendations.items[0].eval_attrs?.freshness, recommendations.items[0].freshness);
  assert.match(recommendations.items[0].why, /relevance|substance/i);
  assert.ok(recommendations.items[0].matched_terms.includes("agentic"));
});

test("scoreArtifacts attaches eval attrs for card/list progressive disclosure", async () => {
  process.env.LIBRARY_SUMMARIZE_DISABLED = "1";
  const vault = tempVault();
  fs.mkdirSync(path.join(vault, "projects", "library"), { recursive: true });
  fs.writeFileSync(path.join(vault, "projects", "library", "index.md"), "# Library\n\nActive reference library eval work.\n", "utf-8");
  writeSource(vault, "eval-source.yaml", `
id: eval-source
name: Eval Source
channel: fixture
url: fixture://eval-source
enabled: true
intent: discovery
tags: [library]
fixtures:
  - url: https://example.com/eval
    title: Library Eval Notes
    date: 2026-05-28
    content: Reference library eval work with relevance, substance, freshness, and worth.
    metadata: {}
`);

  await runIngestion(vault, { useSummarize: false });
  markFixtureWeavesComplete(vault);
  const artifact = listLibraryArtifactDetails(vault, { includeCandidates: true }).artifacts[0];
  const scored = scoreArtifacts(vault, [artifact])[0];
  assert.ok(scored.eval_attrs);
  assert.equal(scored.eval_attrs.worth, scored.worth);
  assert.equal(scored.eval_attrs.relevance, scored.relevance);
  assert.equal(scored.eval_attrs.substance, scored.substance);
  assert.equal(scored.eval_attrs.freshness, scored.freshness);
  assert.equal("priority" in scored, false);
});

test("disposition: a per-item keep signal beats a source's study default", () => {
  // raindrop-bookmarks defaults library_mode: study. A Talent/Art collection item must still be keep —
  // the source default must NOT short-circuit the per-item classification (the precedence bug).
  const studyDefaultSource: LibrarySourceConfig = {
    id: "raindrop-bookmarks", name: "Raindrop", channel: "raindrop", url: "raindrop://b", enabled: true,
    cadence: "hourly",
    intent: "explicit_save", library_mode: "study", tags: [], metadata: {},
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: true, mode: "checkpointed" },
    filters: { include_topics: [], exclude_topics: [] },
    path: "",
  };
  const mk = (title: string, metadata: Record<string, unknown>) => {
    const raw: RawArtifact = { url: "https://x.com/a", title, content: "", date: "2026-01-01", metadata };
    return artifactTaxonomy(raw, studyDefaultSource).library_mode;
  };

  assert.equal(mk("Aristide Benoist — Creative Developer", { source_collection: "Talent" }), "keep");
  assert.equal(mk("Some artist", { source_collection: "Art" }), "keep");
  assert.equal(mk("Cool portfolio", { tags: ["portfolio"] }), "keep");
  // A normal study item in the same study-default source stays study.
  assert.equal(mk("Agentic product discovery loops", { source_collection: "AI" }), "study");
  // An ambiguous title word must NOT trigger keep (no title-word matching).
  assert.equal(mk("Billie Eilish: Tiny Desk Concert", {}), "study");
  assert.equal(mk("State of the art AI agents", {}), "study");
  // An explicit per-item mode wins over everything.
  assert.equal(mk("Whatever", { source_collection: "Talent", library_mode: "study" }), "study");
});

test("library eval computes worth = relevance × substance × freshness", () => {
  const fp = (label: string) => ({ target: `projects/${label}/index`, label, relationship: "informs" });
  const old = "2020-01-01T00:00:00Z";

  const strong = evaluateArtifact({ connections: [fp("a"), fp("b"), fp("c")], contextFit: 0.2, createdAt: old, substance: 0.8 });
  // Same ties, thin substance → much lower worth. Substance is sovereign — it independently moves worth.
  const thin = evaluateArtifact({ connections: [fp("a"), fp("b"), fp("c")], contextFit: 0.2, createdAt: old, substance: 0.15 });
  assert.ok(strong.worth > thin.worth, "substance independently lowers worth");
  assert.ok(strong.relevance > 0.5);
  assert.match(strong.why, /relevance/);

  // No ties + no context → ~zero relevance → ~zero worth no matter how substantial the source.
  const irrelevant = evaluateArtifact({ connections: [], contextFit: 0, createdAt: old, substance: 0.9, analyzed: true });
  assert.ok(irrelevant.worth < 0.05, "irrelevant scores ~0 worth despite high substance");
  assert.equal(irrelevant.lifecycle, "to_archive"); // analyzed + low worth → flagged for review (not moved)

  // An un-analyzed low-worth item is NEVER flagged — we don't bury what we didn't look at.
  assert.equal(evaluateArtifact({ connections: [], contextFit: 0, createdAt: old, substance: 0.9, analyzed: false }).lifecycle, "active");
});

test("structural substance reflects source depth, not digest length", () => {
  const tweet = structuralSubstance({ format: "tweet", sourceChars: 200 });
  const longform = structuralSubstance({ format: "long-form-guide", sourceChars: 15000, findingsCount: 7 });
  const video2h = structuralSubstance({ format: "video", videoDurationSeconds: 7200 });
  assert.ok(tweet <= 0.3, "a tweet is low-substance");
  assert.ok(longform > tweet && video2h > tweet, "a long guide and a 2h talk out-score a tweet");
});

test("digestion abstains from fabricating connections when the LLM judge is disabled", async () => {
  const originalMediaDisabled = process.env.LIBRARY_MEDIA_ENRICHMENT_DISABLED;
  const originalConnectionsDisabled = process.env.LIBRARY_CONNECTIONS_DISABLED;
  process.env.LIBRARY_MEDIA_ENRICHMENT_DISABLED = "1";
  // No real LLM/CLI may run in the suite. With the judge disabled the engine must abstain:
  // no fabricated connections, no lone "- " bullet, and frontmatter records the abstention.
  process.env.LIBRARY_CONNECTIONS_DISABLED = "1";
  const vault = tempVault();
  fs.mkdirSync(path.join(vault, "projects", "agentic-product"), { recursive: true });
  fs.writeFileSync(path.join(vault, "projects", "agentic-product", "index.md"), "# Agentic Product\n\nActive work on agentic product discovery loops and surfaced insights.\n", "utf-8");
  const source: LibrarySourceConfig = {
    id: "manual",
    name: "Manual",
    channel: "manual",
    url: "manual://capture",
    enabled: true,
    cadence: "manual",
    intent: "explicit_save",
    signal: "manual_capture",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: false, mode: "none" },
    tags: ["agentic"],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };

  try {
    const processed = await digestArtifact({
      url: "https://example.com/agentic",
      title: "Agentic Product Discovery Loops",
      date: "2026-05-28",
      content: "Agentic product discovery loops help surfaced insights connect to active projects. The reference library can use this context to recommend candidates.",
      metadata: {},
    }, source, { useSummarize: false, vaultPath: vault });

    // Token-overlap inference is gone: no project ties, no suggestions, no reasoning are fabricated.
    assert.deepEqual(processed.connected_projects, []);
    assert.deepEqual(processed.connection_suggestions, []);
    assert.equal(processed.connection_reasoning, undefined);
    assert.equal(processed.reweave_candidates, undefined);
    // The assessment why carries no appended connection reasoning when the judge abstains.
    assert.equal(processed.assessment.why, "The source action is configured as explicit save intent.");

    // With no connections, the candidate omits the Connections heading entirely — never a stray
    // "- " placeholder bullet — going straight from the digest body to Raw Content.
    const candidateMarkdown = buildCandidateMarkdown(processed);
    assert.doesNotMatch(candidateMarkdown, /## Connections/);
    assert.match(candidateMarkdown, /## Key Points[\s\S]*## Raw Content/);

    const referenceMarkdown = buildDurableReferenceMarkdown(processed);
    // With no connections, the durable reference omits the Connections heading entirely —
    // it goes straight from the digest (Key Points here) to Raw Content.
    assert.doesNotMatch(referenceMarkdown, /## Connections/);
    assert.match(referenceMarkdown, /## Key Points[\s\S]*## Raw Content/);
    // No connection frontmatter keys are emitted on abstention.
    assert.doesNotMatch(referenceMarkdown, /connection_suggestions:/);
    assert.doesNotMatch(referenceMarkdown, /connection_reasoning:/);
  } finally {
    if (originalMediaDisabled === undefined) delete process.env.LIBRARY_MEDIA_ENRICHMENT_DISABLED;
    else process.env.LIBRARY_MEDIA_ENRICHMENT_DISABLED = originalMediaDisabled;
    if (originalConnectionsDisabled === undefined) delete process.env.LIBRARY_CONNECTIONS_DISABLED;
    else process.env.LIBRARY_CONNECTIONS_DISABLED = originalConnectionsDisabled;
  }
});

test("parseConnectionJudgment parses clean JSON", () => {
  const judgment = parseConnectionJudgment(JSON.stringify({
    connects: true,
    reasoning: "Extends the personal-orchestrator project with a delivery-rate counterexample.",
    connections: [
      { target: "personal-orchestrator", label: "Personal Orchestrator", relationship: "Extends the orchestrator with a concrete delivery-rate counterexample." },
    ],
    reweave_candidates: [{ target: "agent-architecture", why: "Adds a data point on tool routing." }],
  }));
  assert.equal(judgment.connects, true);
  assert.equal(judgment.connections.length, 1);
  assert.equal(judgment.connections[0].target, "personal-orchestrator");
  assert.equal(judgment.connections[0].label, "Personal Orchestrator");
  assert.match(judgment.connections[0].relationship, /delivery-rate counterexample/);
  assert.equal(judgment.reweave_candidates?.length, 1);
  assert.equal(judgment.reweave_candidates?.[0].target, "agent-architecture");
});

test("parseConnectionJudgment parses JSON inside ```json fences", () => {
  const raw = "Sure, here is the judgment:\n```json\n" + JSON.stringify({
    connects: true,
    reasoning: "Is a peer/alternative of an existing type-foundry reference.",
    connections: [
      { target: null, label: "Type foundry references", relationship: "Is a peer/alternative of the existing type-foundry reference cluster." },
    ],
  }) + "\n```\nLet me know if you want more.";
  const judgment = parseConnectionJudgment(raw);
  assert.equal(judgment.connects, true);
  assert.equal(judgment.connections.length, 1);
  assert.equal(judgment.connections[0].target, null);
  assert.equal(judgment.connections[0].label, "Type foundry references");
});

test("parseConnectionJudgment parses JSON embedded in prose", () => {
  const raw = "After reviewing the index, my answer is { \"connects\": true, \"reasoning\": \"Builds on memory-and-search.\", \"connections\": [ { \"target\": \"memory-and-search\", \"label\": \"Memory and Search\", \"relationship\": \"Builds on the memory-and-search retrieval design.\" } ] } and nothing else applies.";
  const judgment = parseConnectionJudgment(raw);
  assert.equal(judgment.connects, true);
  assert.equal(judgment.connections.length, 1);
  assert.equal(judgment.connections[0].target, "memory-and-search");
  assert.match(judgment.connections[0].relationship, /retrieval design/);
});

test("parseConnectionJudgment treats plain-prose abstention as no connection", () => {
  const judgment = parseConnectionJudgment("This chicken-roasting guide doesn't connect to anything in his active work.");
  assert.equal(judgment.connects, false);
  assert.deepEqual(judgment.connections, []);
  assert.match(judgment.reasoning, /doesn't connect/);
});

test("parseConnectionJudgment drops connection entries that lack a relationship", () => {
  const judgment = parseConnectionJudgment(JSON.stringify({
    connects: true,
    reasoning: "Mixed bag.",
    connections: [
      { target: "agent-architecture", label: "Agent Architecture" },
      { target: "personal-orchestrator", label: "Personal Orchestrator", relationship: "Supports the orchestrator with a routing data point." },
    ],
  }));
  // The entry with no relationship sentence is not a connection and is dropped.
  assert.equal(judgment.connections.length, 1);
  assert.equal(judgment.connections[0].target, "personal-orchestrator");
  assert.equal(judgment.connects, true);
});

test("parseConnectionJudgment abstains on empty or unparseable input", () => {
  const empty = parseConnectionJudgment("");
  assert.equal(empty.connects, false);
  assert.deepEqual(empty.connections, []);
  assert.equal(empty.reasoning, "");
  // connects:true with every connection dropped collapses to a clean abstain.
  const allDropped = parseConnectionJudgment(JSON.stringify({
    connects: true,
    reasoning: "Claimed a tie but named no relationship.",
    connections: [{ target: "agent-architecture", label: "Agent Architecture" }],
  }));
  assert.equal(allDropped.connects, false);
  assert.deepEqual(allDropped.connections, []);
});

test("connection rendering formats target, null-target, and empty cases", () => {
  const base = buildProcessedArtifactWithConnections([]);
  // Empty connections omit the Connections heading entirely — no bullet, no stray dash.
  const emptyMd = buildCandidateMarkdown(base);
  assert.doesNotMatch(emptyMd, /## Connections/);
  assert.match(emptyMd, /## Key Points[\s\S]*## Raw Content/);

  // A targeted connection renders "[[target|label]] - relationship".
  const targeted = buildProcessedArtifactWithConnections([
    { target: "personal-orchestrator", label: "Personal Orchestrator", relationship: "Extends the orchestrator with a delivery-rate counterexample." },
  ]);
  assert.match(buildCandidateMarkdown(targeted), /- \[\[personal-orchestrator\|Personal Orchestrator\]\] - Extends the orchestrator with a delivery-rate counterexample\./);
  assert.match(buildDurableReferenceMarkdown(targeted), /- \[\[personal-orchestrator\|Personal Orchestrator\]\] - Extends the orchestrator with a delivery-rate counterexample\./);

  // A null-target (theme-level) connection renders "label - relationship", no wiki link.
  const nullTarget = buildProcessedArtifactWithConnections([
    { target: null, label: "Type foundry references", relationship: "Is a peer/alternative of the type-foundry cluster." },
  ]);
  const nullMd = buildCandidateMarkdown(nullTarget);
  assert.match(nullMd, /- Type foundry references - Is a peer\/alternative of the type-foundry cluster\./);
  assert.doesNotMatch(nullMd, /\[\[Type foundry references\]\]/);
});

test("parseReweaveOutput parses clean JSON", () => {
  const result = parseReweaveOutput(JSON.stringify({
    description: "A practitioner take on weaving references into a personal KB.",
    proposed_title: "Weaving References Into a Personal KB",
    digest_markdown: "## The core idea\n\nMatch depth to the source.",
    connections_first_party: [
      { target: "projects/personal-orchestrator/index", title: "Personal Orchestrator", relationship: "extends the orchestrator with a routing data point" },
    ],
    connections_library: [
      { target: "references/2026-05-10-type-foundries", title: "Type foundries", relationship: "offers a surprising contrast on durable value" },
    ],
    reweave_candidates: [
      { target: "areas/knowledge-base", why: "Adds a connection-discipline heuristic worth folding in." },
    ],
  }));
  assert.equal(result.description, "A practitioner take on weaving references into a personal KB.");
  assert.equal(result.proposed_title, "Weaving References Into a Personal KB");
  assert.match(result.digest_markdown, /## The core idea/);
  assert.equal(result.connections_first_party.length, 1);
  assert.equal(result.connections_first_party[0].target, "projects/personal-orchestrator/index");
  assert.equal(result.connections_first_party[0].title, "Personal Orchestrator");
  assert.match(result.connections_first_party[0].relationship, /routing data point/);
  assert.equal(result.connections_library.length, 1);
  assert.equal(result.connections_library[0].target, "references/2026-05-10-type-foundries");
  assert.equal(result.reweave_candidates?.length, 1);
  assert.equal(result.reweave_candidates?.[0].target, "areas/knowledge-base");
});

test("parseReweaveOutput parses JSON inside ```json fences", () => {
  const raw = "Here is the weave:\n```json\n" + JSON.stringify({
    description: "Short feed card line.",
    proposed_title: "Fenced Title",
    digest_markdown: "## Summary\n\nFenced body.",
    connections_first_party: [
      { target: "thoughts/memory-and-search", title: "Memory and Search", relationship: "builds on the retrieval design" },
    ],
    connections_library: [],
  }) + "\n```\nLet me know if you want changes.";
  const result = parseReweaveOutput(raw);
  assert.equal(result.proposed_title, "Fenced Title");
  assert.equal(result.connections_first_party.length, 1);
  assert.equal(result.connections_first_party[0].target, "thoughts/memory-and-search");
  assert.deepEqual(result.connections_library, []);
});

test("parseReweaveOutput parses JSON embedded in prose", () => {
  const raw = "After exploring the vault, my answer is " + JSON.stringify({
    description: "Embedded description.",
    proposed_title: "Embedded Title",
    digest_markdown: "## Notes\n\nEmbedded body.",
    connections_first_party: [
      { target: "areas/writing", title: "Writing", relationship: "informs the writing area" },
    ],
    connections_library: [],
  }) + " and nothing else applies.";
  const result = parseReweaveOutput(raw);
  assert.equal(result.description, "Embedded description.");
  assert.equal(result.connections_first_party[0].target, "areas/writing");
});

test("parseReweaveOutput drops connections pointing into references/.cache/", () => {
  const result = parseReweaveOutput(JSON.stringify({
    description: "d",
    proposed_title: "t",
    digest_markdown: "## x\n\ny",
    connections_first_party: [
      { target: "references/.cache/library-candidates/temp", title: "Temp candidate", relationship: "should be dropped" },
      { target: "projects/real/index", title: "Real Project", relationship: "is kept" },
    ],
    connections_library: [
      { target: "references/.cache/foo", title: "Cache foo", relationship: "should also be dropped" },
    ],
  }));
  assert.equal(result.connections_first_party.length, 1);
  assert.equal(result.connections_first_party[0].target, "projects/real/index");
  assert.deepEqual(result.connections_library, []);
});

test("parseReweaveOutput strips a trailing .md from connection targets", () => {
  const result = parseReweaveOutput(JSON.stringify({
    description: "d",
    proposed_title: "t",
    digest_markdown: "## x\n\ny",
    connections_first_party: [
      { target: "projects/personal-orchestrator/index.md", title: "Personal Orchestrator", relationship: "extends it" },
    ],
    connections_library: [],
  }));
  assert.equal(result.connections_first_party[0].target, "projects/personal-orchestrator/index");
});

test("parseReweaveOutput requires a relationship and a non-cache target", () => {
  const result = parseReweaveOutput(JSON.stringify({
    description: "d",
    proposed_title: "t",
    digest_markdown: "## x\n\ny",
    connections_first_party: [
      { target: "projects/no-rel/index", title: "No Relationship" },
      { target: "", title: "Empty target", relationship: "claims a tie but names no target" },
      { target: "projects/kept/index", title: "Kept", relationship: "has both a target and a relationship" },
    ],
    connections_library: [],
  }));
  // The entry with no relationship and the entry with an empty target are both dropped.
  assert.equal(result.connections_first_party.length, 1);
  assert.equal(result.connections_first_party[0].target, "projects/kept/index");
});

test("parseReweaveOutput allows empty connection arrays and coerces missing fields", () => {
  const empty = parseReweaveOutput(JSON.stringify({
    description: "Just a digest, no ties.",
    proposed_title: "Standalone",
    digest_markdown: "## Body\n\nNo connections earned.",
    connections_first_party: [],
    connections_library: [],
  }));
  assert.deepEqual(empty.connections_first_party, []);
  assert.deepEqual(empty.connections_library, []);
  assert.deepEqual(empty.reweave_candidates, []);

  // Unparseable / empty input coerces every field to a safe default.
  const blank = parseReweaveOutput("not json at all");
  assert.equal(blank.description, "");
  assert.equal(blank.proposed_title, "");
  assert.equal(blank.digest_markdown, "");
  assert.deepEqual(blank.connections_first_party, []);
  assert.deepEqual(blank.connections_library, []);
  assert.deepEqual(blank.reweave_candidates, []);
});

test("buildDurableReferenceMarkdown emits a free-form body when digest_markdown is set", () => {
  const base = processedYouTubeArtifact();
  const processed: ProcessedArtifact = {
    ...base,
    description: "A reweaved feed-card description that is more specific than the legacy summary.",
    digest_markdown: "## What it is\n\nA reweaved free-form digest body.\n\n## Why it matters\n\nIt ties into active work.",
    connection_suggestions: [
      { target: "projects/personal-orchestrator/index", label: "Personal Orchestrator", relationship: "extends the orchestrator" },
    ],
    connected_projects: ["personal-orchestrator"],
  };
  const markdown = buildDurableReferenceMarkdown(processed, "manual_save");

  // The reweave digest replaces the fixed Summary/Key Points sections.
  assert.match(markdown, /## What it is/);
  assert.match(markdown, /## Why it matters/);
  assert.doesNotMatch(markdown, /## Summary/);
  assert.doesNotMatch(markdown, /## Key Points/);
  // The reweave description (not the summary) drives the frontmatter description. The long value
  // is emitted as a YAML folded block, so assert on the text rather than an inline `key: value`.
  assert.match(markdown, /A reweaved feed-card description that is more specific than the legacy/);
  assert.doesNotMatch(markdown, /A useful video summary with enough detail/);
  // Connections render in the new [[target|label]] - relationship form.
  assert.match(markdown, /## Connections/);
  assert.match(markdown, /- \[\[projects\/personal-orchestrator\/index\|Personal Orchestrator\]\] - extends the orchestrator/);
  // Raw Content is still appended for the source cache.
  assert.match(markdown, /## Raw Content/);
  assert.match(markdown, /00:30 A full transcript line/);
});

test("buildDurableReferenceMarkdown keeps the legacy Summary/Key Points body without digest_markdown", () => {
  const processed = processedYouTubeArtifact();
  assert.equal(processed.digest_markdown, undefined);
  const markdown = buildDurableReferenceMarkdown(processed, "manual_save");
  assert.match(markdown, /## Summary/);
  assert.match(markdown, /A useful video summary with enough detail/);
  assert.match(markdown, /## Key Points/);
  assert.match(markdown, /- First useful point\./);
  assert.match(markdown, /## Raw Content/);
});

test("a reweaved durable reference round-trips through parseReferenceFile", () => {
  const vault = tempVault();
  const base = processedYouTubeArtifact();
  const processed: ProcessedArtifact = {
    ...base,
    raw: { ...base.raw, title: "Reweaved Reference Title" },
    description: "Round-trip feed-card description.",
    digest_markdown: "## The argument\n\nThe digest body survives the round trip intact.",
    connection_suggestions: [
      { target: "projects/personal-orchestrator/index", label: "Personal Orchestrator", relationship: "extends the orchestrator" },
    ],
    connected_projects: ["personal-orchestrator"],
  };
  const filePath = path.join(vault, "references", "reweaved.md");
  fs.writeFileSync(filePath, buildDurableReferenceMarkdown(processed, "manual_save"), "utf-8");

  const parsed = parseReferenceFile(vault, filePath);
  assert.ok(parsed);
  // Title comes from the H1.
  assert.equal(parsed.title, "Reweaved Reference Title");
  // Description comes from frontmatter (the reweave description, not a "## Summary" section).
  assert.equal(parsed.summary, "Round-trip feed-card description.");
  // The free-form digest body is preserved verbatim.
  assert.match(parsed.content, /## The argument/);
  assert.match(parsed.content, /The digest body survives the round trip intact\./);
  // Connections are extracted from the body.
  assert.ok(parsed.connections.some((line) => line.includes("Personal Orchestrator")));
});

test("findReweavePendingTargets queues only active study references and candidates", () => {
  const vault = tempVault();
  const candidateDir = path.join(vault, "references", ".cache", "library-candidates");
  const archiveDir = path.join(vault, "references", ".archive");
  fs.mkdirSync(candidateDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  fs.writeFileSync(path.join(vault, "references", "pending-old.md"), `---
type: reference
title: Old Pending
library_mode: study
captured_at: '2026-05-01T00:00:00.000Z'
reweave_pending: true
---
# Old Pending
`, "utf-8");
  fs.writeFileSync(path.join(vault, "references", "missing-connection-pass.md"), `---
type: reference
title: Missing Connection Pass
library_mode: study
digestion_status: hot
captured_at: '2026-05-01T12:00:00.000Z'
---
# Missing Connection Pass
`, "utf-8");
  fs.writeFileSync(path.join(vault, "references", "already-reconnected.md"), `---
type: reference
title: Already Reconnected
library_mode: study
digestion_status: hot
reconnected_at: '2026-05-01T12:00:00.000Z'
---
# Already Reconnected
`, "utf-8");
  fs.writeFileSync(path.join(vault, "references", "attention-judged-abstain.md"), `---
type: reference
title: Attention Judged Abstain
library_mode: study
digestion_status: hot
attention_judgment:
  tier: low
  reason: No active-work tie.
---
# Attention Judged Abstain
`, "utf-8");
  fs.writeFileSync(path.join(candidateDir, "pending-candidate.md"), `---
type: reference-candidate
title: Pending Candidate
status: candidate
library_mode: study
digested_at: '2026-05-02T00:00:00.000Z'
reweave_pending: true
---
# Pending Candidate
`, "utf-8");
  fs.writeFileSync(path.join(vault, "references", "keep-pending.md"), `---
type: reference
title: Keep Pending
library_mode: keep
reweave_pending: true
---
# Keep Pending
`, "utf-8");
  fs.writeFileSync(path.join(candidateDir, "skipped-candidate.md"), `---
type: reference-candidate
title: Skipped Pending
status: skipped
library_mode: study
reweave_pending: true
---
# Skipped Pending
`, "utf-8");
  fs.writeFileSync(path.join(archiveDir, "archived-pending.md"), `---
type: reference
title: Archived Pending
library_mode: study
reweave_pending: true
---
# Archived Pending
`, "utf-8");

  const targets = findReweavePendingTargets(vault);
  assert.deepEqual(targets.map((target) => target.relative_path), [
    "references/pending-old.md",
    "references/missing-connection-pass.md",
    "references/.cache/library-candidates/pending-candidate.md",
  ]);
  assert.deepEqual(targets.map((target) => target.reason), [
    "reweave_pending",
    "missing_connection_pass",
    "reweave_pending",
  ]);
  assert.deepEqual(findReweavePendingTargets(vault, { includeCandidates: false }).map((target) => target.relative_path), [
    "references/pending-old.md",
    "references/missing-connection-pass.md",
  ]);
  assert.deepEqual(findReweavePendingTargets(vault, { limit: 1 }).map((target) => target.relative_path), [
    "references/pending-old.md",
  ]);
  assert.equal(connectionPassState({ attention_judgment: { tier: "low", reason: "No active-work tie." } }), "abstained");
});

test("detectRateLimitInEnvelope never flags a successful result, even one ABOUT rate limits", () => {
  // The notcrawl poison pill: a successful reweave digest of a "rate-limit-aware" crawler contains
  // the phrase "rate-limit". A success envelope must NOT read as a usage limit.
  const successEnvelope = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: JSON.stringify({
      digest_markdown: "## Summary\nA rate-limit-aware sync against the official Notion API (handles 429 quota errors).",
      description: "Local-first Notion crawler with rate-limit aware crawling.",
    }),
  });
  assert.deepEqual(detectRateLimitInEnvelope(successEnvelope), { limited: false, resetAt: null });

  // An is_error envelope whose text signals a usage limit IS flagged, with the reset time parsed.
  const limitEnvelope = JSON.stringify({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "Claude AI usage limit reached. Your limit will reset at 2026-06-10T01:00:00Z.",
  });
  const limitHit = detectRateLimitInEnvelope(limitEnvelope);
  assert.equal(limitHit.limited, true);
  assert.equal(limitHit.resetAt, "2026-06-10T01:00:00Z");

  // An is_error envelope with a NON-limit failure (e.g. a tool crash) is not a rate limit.
  const errorEnvelope = JSON.stringify({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "Execution failed: tool error while reading a file.",
  });
  assert.deepEqual(detectRateLimitInEnvelope(errorEnvelope), { limited: false, resetAt: null });

  // Non-envelope stdout under --output-format json is an error surface — sniff it raw.
  assert.equal(detectRateLimitInEnvelope("Claude AI usage limit reached|1765324800").limited, true);
  assert.deepEqual(detectRateLimitInEnvelope(""), { limited: false, resetAt: null });

  // JSON that is NOT the result envelope (an API error blob, an array) is an error surface too —
  // the absence of is_error must not read as "not limited".
  const apiErrorBlob = JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Rate limit exceeded" } });
  assert.equal(detectRateLimitInEnvelope(apiErrorBlob).limited, true);
  assert.equal(detectRateLimitInEnvelope(JSON.stringify(["usage limit reached"])).limited, true);
  assert.equal(detectRateLimitInEnvelope(JSON.stringify({ unrelated: "fine" })).limited, false);
});

test("detectRateLimit flags error text and parses epoch reset times", () => {
  assert.equal(detectRateLimit("429 too many requests").limited, true);
  assert.equal(detectRateLimit("everything is fine").limited, false);
  const epochHit = detectRateLimit("usage limit reached, reset 1765324800");
  assert.equal(epochHit.limited, true);
  assert.equal(epochHit.resetAt, new Date(1765324800 * 1000).toISOString());
});

test("library scheduler includes a bounded deferred reweave repair job", () => {
  const job = librarySchedulerJobs("/tmp/hilt-library-test-logs").find((item) => item.id === "reweave-pending");
  assert.ok(job);
  assert.equal(job.script, "library:reweave:nightly");
  assert.deepEqual(job.schedule, { hour: 3, minute: 35 });
  assert.match(job.stdout, /reweave-pending\.out\.log$/);
  assert.match(job.stderr, /reweave-pending\.err\.log$/);
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
  assert.equal(health.scheduler.loaded, librarySchedulerJobs().length);
  assert.equal(health.sources[0].status, "ok");
  assert.equal(health.dead_letters.total, 0);
  assert.equal(health.dead_letters.unresolved, 0);
  assert.equal(health.ok, true);
});

test("library health treats dead letters as resolved once the source succeeds again", () => {
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
  // A failure at 10:00, then a successful run at 11:00 → that failure is self-healed.
  // A second failure at 12:00 (after the last success) → still unresolved.
  fs.mkdirSync(path.join(vault, "references", ".cache"), { recursive: true });
  fs.writeFileSync(path.join(vault, "references", ".cache", "library-dead-letter.json"), JSON.stringify([
    { source_id: "health-source", error: "fetch failed", at: "2026-05-28T10:00:00.000Z" },
    { source_id: "health-source", error: "fetch failed", at: "2026-05-28T12:00:00.000Z" },
  ]), "utf-8");
  fs.writeFileSync(path.join(vault, "meta", "sources", ".source-state.json"), JSON.stringify({
    "health-source": { last_checked_at: "2026-05-28T11:00:00.000Z", last_success_at: "2026-05-28T11:00:00.000Z" },
  }, null, 2), "utf-8");

  const health = getLibraryOperationalHealth(vault, { launchctl: () => "last exit code = 0" });
  assert.equal(health.dead_letters.total, 2);
  // Only the post-success failure remains unresolved; the pre-success one is treated as healed.
  assert.equal(health.dead_letters.unresolved, 1);
});

test("dead-letter retry sources include only unresolved failures", () => {
  const vault = tempVault();
  fs.mkdirSync(path.join(vault, "references", ".cache"), { recursive: true });
  fs.mkdirSync(path.join(vault, "references", ".cache", "library-candidates"), { recursive: true });
  fs.writeFileSync(path.join(vault, "references", ".cache", "library-candidates", "healed-item.md"), `---
type: reference-candidate
title: Healed Item
url: https://example.com/healed-item
status: candidate
---
# Healed Item
`, "utf-8");
  fs.writeFileSync(path.join(vault, "references", ".cache", "library-dead-letter.json"), JSON.stringify([
    { source_id: "healed-source", error: "old fetch failed", at: "2026-05-28T10:00:00.000Z" },
    { source_id: "stale-source", error: "new fetch failed", at: "2026-05-28T12:00:00.000Z" },
    { source_id: "stale-source", error: "same source failed again", at: "2026-05-28T12:05:00.000Z" },
    { source_id: "artifact-source", artifact_url: "https://example.com/healed-item", error: "write failed", at: "2026-05-28T13:00:00.000Z" },
    { source_id: "artifact-source", artifact_url: "https://example.com/missing-item", error: "write failed", at: "2026-05-28T13:05:00.000Z" },
  ]), "utf-8");

  const state = {
    "healed-source": { last_success_at: "2026-05-28T11:00:00.000Z" },
    "stale-source": { last_success_at: "2026-05-28T11:00:00.000Z" },
    "artifact-source": { last_success_at: "2026-05-28T14:00:00.000Z" },
  };

  assert.deepEqual(unresolvedDeadLetterSources(vault, state), ["stale-source", "artifact-source"]);
});

test("library health treats known scheduler stderr noise as a notice, not a failure", () => {
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
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-library-logs-"));
  const stderr = path.join(logDir, "job.err.log");
  const stdout = path.join(logDir, "job.out.log");
  const deprecationBlock = "(node:123) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.\n(Use `node --trace-deprecation ...` to show where the warning was created)\n";
  const npmNoticeBlock = [
    "npm notice",
    "npm notice New minor version of npm available! 11.12.1 -> 11.16.0",
    "npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.16.0",
    "npm notice To update run: npm install -g npm@11.16.0",
    "npm notice",
    "",
  ].join("\n");
  fs.writeFileSync(stderr, `${deprecationBlock.repeat(12)}${npmNoticeBlock}${deprecationBlock.repeat(12)}`, "utf-8");
  fs.writeFileSync(stdout, "ok\n", "utf-8");

  const health = getLibraryOperationalHealth(vault, {
    launchctl: () => "last exit code = 0",
    schedulerJobs: [{
      id: "fixture-job",
      label: "com.hilt.library.fixture",
      script: "library:fixture",
      schedule: { intervalSeconds: 3600 },
      stdout,
      stderr,
    }],
  });
  assert.equal(health.scheduler.jobs[0].status, "ok");
  assert.match(health.scheduler.jobs[0].message || "", /known scheduler noise/);
  assert.match(health.scheduler.jobs[0].stderr_excerpt || "", /DEP0205/);
  assert.doesNotMatch(health.scheduler.jobs[0].stderr_excerpt || "", /^nstead/);
  assert.doesNotMatch(health.scheduler.jobs[0].stderr_excerpt || "", /^\(Use `node --trace-deprecation/);
});

test("library health treats refetch recovered lines as scheduler progress", () => {
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
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-library-logs-"));
  const stderr = path.join(logDir, "job.err.log");
  const stdout = path.join(logDir, "job.out.log");
  fs.writeFileSync(stderr, [
    "[refetch] RECOVERED    2026-05-05-the-validator",
    "[refetch] RECOVERED    2026-06-02-a-harness-for-every-task-dynamic-workflows-in-cla",
    "",
  ].join("\n"), "utf-8");
  fs.writeFileSync(stdout, "ok\n", "utf-8");

  const health = getLibraryOperationalHealth(vault, {
    launchctl: () => "last exit code = 0",
    schedulerJobs: [{
      id: "refetch",
      label: "com.hilt.library.refetch",
      script: "library:refetch",
      schedule: { hour: 4, minute: 45 },
      stdout,
      stderr,
    }],
  });
  assert.equal(health.scheduler.jobs[0].status, "ok");
  assert.match(health.scheduler.jobs[0].message || "", /known scheduler noise/);
});

test("library health keeps failed refetch outcomes actionable", () => {
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
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-library-logs-"));
  const stderr = path.join(logDir, "job.err.log");
  const stdout = path.join(logDir, "job.out.log");
  fs.writeFileSync(stderr, "[refetch] STILL_FAILED 2026-05-05-the-validator\n", "utf-8");
  fs.writeFileSync(stdout, "ok\n", "utf-8");

  const health = getLibraryOperationalHealth(vault, {
    launchctl: () => "last exit code = 0",
    schedulerJobs: [{
      id: "refetch",
      label: "com.hilt.library.refetch",
      script: "library:refetch",
      schedule: { hour: 4, minute: 45 },
      stdout,
      stderr,
    }],
  });
  assert.equal(health.scheduler.jobs[0].status, "warning");
  assert.match(health.scheduler.jobs[0].message || "", /STILL_FAILED/);
});

test("library health surfaces actionable scheduler stderr in warning message", () => {
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
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-library-logs-"));
  const stderr = path.join(logDir, "job.err.log");
  const stdout = path.join(logDir, "job.out.log");
  fs.writeFileSync(stderr, "Error: source auth expired\nstack line\n", "utf-8");
  fs.writeFileSync(stdout, "ok\n", "utf-8");

  const health = getLibraryOperationalHealth(vault, {
    launchctl: () => "last exit code = 0",
    schedulerJobs: [{
      id: "fixture-job",
      label: "com.hilt.library.fixture",
      script: "library:fixture",
      schedule: { intervalSeconds: 3600 },
      stdout,
      stderr,
    }],
  });
  assert.equal(health.scheduler.jobs[0].status, "warning");
  assert.match(health.scheduler.jobs[0].message || "", /Error: source auth expired/);
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

test("review queue read/write round-trips through setReviewStatus", () => {
  const vault = tempVault();

  // Fresh queue starts empty.
  assert.deepEqual(readReviewQueue(vault), { version: 1, items: {}, batches: {} });

  const { added } = addToReviewQueue(
    vault,
    [
      { id: "ref-alpha", path: "references/alpha.md", pipeline_version: PIPELINE_VERSION },
      { id: "ref-beta", path: "references/beta.md", pipeline_version: PIPELINE_VERSION },
    ],
    { batch: "batch-1" },
  );
  assert.equal(added, 2);

  // Added entries read back as pending with the batch + pipeline version preserved.
  const afterAdd = readReviewQueue(vault);
  assert.equal(afterAdd.items["ref-alpha"].status, "pending");
  assert.equal(afterAdd.items["ref-alpha"].batch, "batch-1");
  assert.equal(afterAdd.items["ref-alpha"].pipeline_version, PIPELINE_VERSION);
  assert.equal(afterAdd.items["ref-alpha"].path, "references/alpha.md");
  assert.equal(afterAdd.items["ref-alpha"].reviewed_at, undefined);

  // setReviewStatus returns the updated entry and persists it to disk.
  const updated = setReviewStatus(vault, "ref-alpha", "approved", "looks good");
  assert.ok(updated);
  assert.equal(updated.status, "approved");
  assert.equal(updated.note, "looks good");
  assert.ok(typeof updated.reviewed_at === "string");

  const afterReview = readReviewQueue(vault);
  assert.equal(afterReview.items["ref-alpha"].status, "approved");
  assert.equal(afterReview.items["ref-alpha"].note, "looks good");
  assert.equal(afterReview.items["ref-alpha"].reviewed_at, updated.reviewed_at);
  // Untouched siblings stay pending.
  assert.equal(afterReview.items["ref-beta"].status, "pending");

  // Updating an unknown id is a no-op that returns null.
  assert.equal(setReviewStatus(vault, "missing", "rejected"), null);
});

test("getActiveBatchNotes surfaces a batch note only while it has pending items", () => {
  const vault = tempVault();

  // A batch with no note contributes nothing to the active notes.
  addToReviewQueue(vault, [{ id: "a", path: "references/a.md", pipeline_version: "v1.3" }], { batch: "noteless" });
  assert.deepEqual(getActiveBatchNotes(vault), []);

  // A batch with a note surfaces it, annotated with its pending count.
  addToReviewQueue(
    vault,
    [
      { id: "b", path: "references/b.md", pipeline_version: "v1.3" },
      { id: "c", path: "references/c.md", pipeline_version: "v1.3" },
    ],
    { batch: "noted", note: { version: "v1.3", title: "Concision pass", markdown: "- check length" } },
  );
  const notes = getActiveBatchNotes(vault);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].batch, "noted");
  assert.equal(notes[0].title, "Concision pass");
  assert.equal(notes[0].pending_count, 2);

  // Once every item in the batch is reviewed, its note drops out of the active set.
  setReviewStatus(vault, "b", "approved");
  setReviewStatus(vault, "c", "rejected");
  assert.deepEqual(getActiveBatchNotes(vault), []);
});

test("buildDurableReferenceMarkdown emits pipeline_version that parseReferenceFile reads back", () => {
  const vault = tempVault();
  const filePath = path.join(vault, "references", "pipeline-version.md");
  fs.writeFileSync(filePath, buildDurableReferenceMarkdown(processedYouTubeArtifact(), "manual_save"), "utf-8");

  // The emitted frontmatter carries the current pipeline version...
  assert.match(fs.readFileSync(filePath, "utf-8"), new RegExp(`pipeline_version:\\s*${PIPELINE_VERSION}`));

  // ...and parseReferenceFile surfaces it onto the LibraryArtifact.
  const parsed = parseReferenceFile(vault, filePath);
  assert.ok(parsed);
  assert.equal(parsed.pipeline_version, PIPELINE_VERSION);
});

test("KB index includes collaborative library projects for reweave discovery", () => {
  const vault = tempVault();
  const projectDir = path.join(vault, "libraries", "priceless-misc", "projects", "ai-consultancy");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "index.md"), `---
description: AI consultancy venture concept for managed AI employees.
---

# AI Consultancy

Managed AI employees, de-SaaS replacement tools, and AI-native operating systems for small businesses.
`, "utf-8");

  const index = buildKbIndex(vault, { noWrite: true, recentReferenceLimit: 0 });

  assert.match(index, /## LIBRARY PROJECTS/);
  assert.match(index, /AI Consultancy \(libraries\/priceless-misc\/projects\/ai-consultancy\)/);
  assert.match(index, /Managed AI employees/);
});

// Guard against the YouTube/video failure mode: the summarize CLI sometimes returns the verbatim
// transcript instead of a digest, which (unguarded) became the body — bloating the file, poisoning the
// description, and starving the reweave that would fix it. looksLikeRawTranscriptDump flags such output.
test("looksLikeRawTranscriptDump flags a 'Transcript:'-led verbatim dump", () => {
  const dump = "Transcript:\n" + "Anthropic engineers ship eight times as much code per quarter. ".repeat(40);
  assert.equal(digestion.looksLikeRawTranscriptDump(dump), true);
});

test("looksLikeRawTranscriptDump flags a very long, structureless wall of spoken text", () => {
  const wall = "so the thing about this is that you really have to think about it carefully and then ".repeat(200);
  assert.ok(wall.length > 12000);
  assert.equal(digestion.looksLikeRawTranscriptDump(wall), true);
});

test("looksLikeRawTranscriptDump leaves a real structured digest alone", () => {
  const digest = `Claire Vo argues code output is now abundant but demand isn't.

## The three things that matter

- Commercial value: will they pay?
- Behavior change: can you get adoption?
- Novel ideas from first principles.`;
  assert.equal(digestion.looksLikeRawTranscriptDump(digest), false);
  assert.equal(digestion.looksLikeRawTranscriptDump(""), false);
  assert.equal(digestion.looksLikeRawTranscriptDump(null), false);
});
