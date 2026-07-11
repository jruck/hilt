import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureFailed } from "./capture-health";
import { digestArtifact, looksLikeRawTranscriptDump } from "./digestion";
import {
  discoverEmbeddedVideoCandidatesFromHtml,
  recoverEmbeddedVideoTranscript,
  shouldAttemptEmbeddedVideoFallback,
} from "./embedded-video";
import { buildMediaMarkdown } from "./media";
import { buildDurableReferenceMarkdown } from "./references";
import type { LibrarySourceConfig, RawArtifact } from "./types";

const PAGE_URL = "https://example.com/product/native-video";
const VIMEO_URL = "https://player.vimeo.com/video/1208499437";

function source(): LibrarySourceConfig {
  return {
    id: "fixture-native-video",
    name: "Fixture native video",
    channel: "manual",
    url: "manual://fixture-native-video",
    enabled: true,
    cadence: "manual",
    intent: "explicit_save",
    signal: "manual_save",
    retention: { mode: "durable", candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: false, mode: "none" },
    tags: [],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };
}

function fixtureHtml(): string {
  return `<!doctype html>
<html><head><title>Native video page</title></head><body>
  <video muted loop src="/decorative-loop.mp4"></video>
  <script>self.__next_f.push([0,"host"],[0,"vimeo"],[0,"videoId"],[0,"1208499437"])</script>
</body></html>`;
}

function fakeYtDlp(): { bin: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-fake-ytdlp-"));
  const bin = path.join(dir, "yt-dlp");
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--dump-single-json")) {
  process.stdout.write(JSON.stringify({
    title: "How Teams Ship Faster",
    duration: 63,
    formats: [{ vcodec: "none", acodec: "aac", resolution: "audio only" }]
  }));
  process.exit(0);
}

if (args.includes("--write-subs")) {
  const template = args[args.indexOf("-o") + 1];
  const target = template.replace("%(id)s", "fixture").replace("%(ext)s", "en.vtt");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "WEBVTT\\n\\n1\\n00:00:00.000 --> 00:00:08.000\\nAgents capture customer feedback and organize it automatically.\\n\\n2\\n00:00:08.000 --> 00:00:16.000\\nThey draft product requirements and connect research with meeting notes.\\n\\n3\\n00:00:16.000 --> 00:00:24.000\\nTeams turn tasks and documents into specifications for coding agents.\\n\\n4\\n00:00:24.000 --> 00:00:32.000\\nReviewers iterate with agents, approve work, and request second opinions.\\n\\n5\\n00:00:32.000 --> 00:00:40.000\\nAgents prepare status reports, dashboards, and release notes for launch.\\n");
  process.exit(0);
}
process.exit(1);
`, "utf-8");
  fs.chmodSync(bin, 0o755);
  return { bin, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function fakeAudioTools(): { ytDlp: string; summarize: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-fake-video-audio-"));
  const ytDlp = path.join(dir, "yt-dlp");
  const summarize = path.join(dir, "summarize");
  fs.writeFileSync(ytDlp, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (!args.includes("--referer")) process.exit(2);
if (args.includes("--dump-single-json")) {
  process.stdout.write(JSON.stringify({ title: "Video Without Captions", duration: 90, formats: [{ vcodec: "none", acodec: "aac" }] }));
  process.exit(0);
}
if (args.includes("--write-subs")) process.exit(0);
if (args.includes("--extract-audio")) {
  const template = args[args.indexOf("-o") + 1];
  const target = template.replace("%(ext)s", "m4a");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "fixture audio");
  process.exit(0);
}
process.exit(1);
`, "utf-8");
  fs.writeFileSync(summarize, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (!args.includes("--extract") || !args.includes("--video-mode") || !args.includes("transcript")) process.exit(2);
process.stdout.write("[0:00] The speaker explains the product workflow from customer feedback through delivery.\\n[0:12] Agents organize research and draft planning artifacts for the team.\\n[0:24] Coding agents receive specifications while people review and approve the work.\\n");
`, "utf-8");
  fs.chmodSync(ytDlp, 0o755);
  fs.chmodSync(summarize, 0o755);
  return { ytDlp, summarize, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("embedded video discovery finds serialized Vimeo players and ignores decorative loops", () => {
  const candidates = discoverEmbeddedVideoCandidatesFromHtml(fixtureHtml(), PAGE_URL);
  assert.deepEqual(candidates, [{
    url: VIMEO_URL,
    page_url: PAGE_URL,
    provider: "vimeo",
    source: "serialized",
  }]);
});

test("embedded video fallback is restricted to thin explicit saves", () => {
  assert.equal(shouldAttemptEmbeddedVideoFallback({
    pageUrl: PAGE_URL,
    capturedText: "A short product tagline with almost no supporting detail.",
    explicitSave: true,
    studyMode: true,
    alreadyVideo: false,
  }), true);
  assert.equal(shouldAttemptEmbeddedVideoFallback({
    pageUrl: PAGE_URL,
    capturedText: "A short product tagline with almost no supporting detail.",
    explicitSave: false,
    studyMode: true,
    alreadyVideo: false,
  }), false);
  assert.equal(shouldAttemptEmbeddedVideoFallback({
    pageUrl: PAGE_URL,
    capturedText: Array.from({ length: 12 }, (_, index) => `Sentence ${index} carries enough substantive product detail to stand on its own.`).join(" "),
    explicitSave: true,
    studyMode: true,
    alreadyVideo: false,
  }), false);
  assert.equal(shouldAttemptEmbeddedVideoFallback({
    pageUrl: PAGE_URL,
    capturedText: "A short product tagline with almost no supporting detail.",
    explicitSave: true,
    studyMode: false,
    alreadyVideo: false,
  }), false);
});

test("short timestamped transcripts cannot masquerade as a digest", () => {
  assert.equal(looksLikeRawTranscriptDump([
    "[0:00] Agents capture customer feedback.",
    "[0:08] Agents draft product requirements.",
    "[0:16] Teams hand specifications to coding agents.",
  ].join("\n")), true);
});

test("embedded video recovery prefers subtitles and digestion uses them as canonical source", async () => {
  const fake = fakeYtDlp();
  const previous = process.env.YT_DLP_PATH;
  process.env.YT_DLP_PATH = fake.bin;
  const fetchImpl: typeof fetch = async () => new Response(fixtureHtml(), {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const recovered = await recoverEmbeddedVideoTranscript(PAGE_URL, { fetchImpl });
    assert.equal(recovered.status, "captured");
    assert.equal(recovered.method, "subtitles");
    assert.equal(recovered.candidate?.url, VIMEO_URL);
    assert.equal(recovered.duration_seconds, 63);
    assert.equal(recovered.cache?.extractor, "embedded-video-subtitles");
    assert.match(recovered.cache?.content || "", /\[0:00\] Agents capture customer feedback/);

    const raw: RawArtifact = {
      url: PAGE_URL,
      title: "Agent-native product development",
      date: "2026-07-10",
      thumbnail: "/fixture-cover.jpg",
      content: "The agents, docs, and databases you need to run product development workflows.",
      metadata: {},
    };
    const processed = await digestArtifact(raw, source(), { useSummarize: false });
    assert.equal(processed.format, "video");
    assert.equal(processed.source_cache?.extractor, "embedded-video-subtitles");
    assert.equal(processed.raw.metadata.embedded_video_transcript_status, "captured");
    assert.equal(processed.raw.metadata.embedded_video_provider, "vimeo");
    assert.equal(processed.raw.metadata.video_url, VIMEO_URL);
    assert.equal(processed.video_duration_seconds, 63);
    assert.doesNotMatch(processed.summary, /\[\d{1,2}:\d{2}/);
    assert.match(processed.summary, /Agents capture customer feedback/);
    assert.equal(processed.digest_markdown, undefined);
    assert.equal(processed.reweave_pending, true);
    assert.match(buildMediaMarkdown(processed.raw), /player\.vimeo\.com\/video\/1208499437/);
    const markdown = buildDurableReferenceMarkdown(processed);
    assert.match(markdown, /cached_source_extractor: embedded-video-subtitles/);
    assert.match(markdown, /embedded_video_transcript_status: captured/);
    assert.match(markdown, /\[0:00\] Agents capture customer feedback/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.YT_DLP_PATH;
    else process.env.YT_DLP_PATH = previous;
    fake.cleanup();
  }
});

test("embedded video recovery downloads and transcribes audio only when captions are absent", async () => {
  const fake = fakeAudioTools();
  const previousYtDlp = process.env.YT_DLP_PATH;
  const previousSummarize = process.env.SUMMARIZE_BIN;
  process.env.YT_DLP_PATH = fake.ytDlp;
  process.env.SUMMARIZE_BIN = fake.summarize;
  try {
    const recovered = await recoverEmbeddedVideoTranscript(PAGE_URL, {
      fetchImpl: async () => new Response(fixtureHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    });
    assert.equal(recovered.status, "captured");
    assert.equal(recovered.method, "audio");
    assert.equal(recovered.cache?.extractor, "embedded-video-audio");
    assert.match(recovered.cache?.content || "", /customer feedback through delivery/);
  } finally {
    if (previousYtDlp === undefined) delete process.env.YT_DLP_PATH;
    else process.env.YT_DLP_PATH = previousYtDlp;
    if (previousSummarize === undefined) delete process.env.SUMMARIZE_BIN;
    else process.env.SUMMARIZE_BIN = previousSummarize;
    fake.cleanup();
  }
});

test("a required embedded video without a transcript fails capture health", () => {
  const body = "## Raw Content\n\n<details><summary>Full source cache</summary>Thin page tagline.</details>";
  assert.equal(captureFailed({
    body,
    frontmatter: {
      embedded_video_required: true,
      embedded_video_transcript_status: "failed",
      cached_source_extractor: "summarize-cli",
    },
  }), true);
  assert.equal(captureFailed({
    body,
    frontmatter: {
      embedded_video_required: true,
      embedded_video_transcript_status: "captured",
      cached_source_extractor: "embedded-video-subtitles",
    },
  }), false);
});
