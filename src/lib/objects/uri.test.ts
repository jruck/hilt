import assert from "node:assert/strict";
import test from "node:test";
import { buildHiltUri, parseHiltUri } from "./uri";

// --- parse: all five kinds -------------------------------------------------------------------

test("parses a task uri", () => {
  assert.deepEqual(parseHiltUri("hilt:task/t-20260705-003"), { kind: "task", id: "t-20260705-003" });
});

test("parses a person uri", () => {
  assert.deepEqual(parseHiltUri("hilt:person/art-vandelay"), { kind: "person", id: "art-vandelay" });
});

test("parses a library uri", () => {
  assert.deepEqual(parseHiltUri("hilt:library/9f3a0b1c2d3e4f50"), { kind: "library", id: "9f3a0b1c2d3e4f50" });
});

test("parses a meeting uri, splitting on the FIRST slash so the path id keeps its slashes", () => {
  assert.deepEqual(
    parseHiltUri("hilt:meeting/meetings/2026-07-05/Floyds-2026-07-05.md"),
    { kind: "meeting", id: "meetings/2026-07-05/Floyds-2026-07-05.md" },
  );
});

test("parses a project uri with a path id", () => {
  assert.deepEqual(
    parseHiltUri("hilt:project/projects/everpro-migration"),
    { kind: "project", id: "projects/everpro-migration" },
  );
});

// --- parse: encoding, spaces, unicode --------------------------------------------------------

test("decodes percent-encoded segments (spaces, unicode) while keeping slash separators", () => {
  assert.deepEqual(
    parseHiltUri("hilt:meeting/meetings/2026-07-05/Floyds%20Standup%20%40%2014-00-00.md"),
    { kind: "meeting", id: "meetings/2026-07-05/Floyds Standup @ 14-00-00.md" },
  );
  assert.deepEqual(
    parseHiltUri("hilt:meeting/meetings/2026-07-05/Caf%C3%A9%20Sync.md"),
    { kind: "meeting", id: "meetings/2026-07-05/Café Sync.md" },
  );
});

test("accepts hand-written uris with literal spaces and unicode (decode is a no-op)", () => {
  assert.deepEqual(
    parseHiltUri("hilt:meeting/meetings/2026-07-05/Floyds Standup @ 14-00-00.md"),
    { kind: "meeting", id: "meetings/2026-07-05/Floyds Standup @ 14-00-00.md" },
  );
  assert.deepEqual(
    parseHiltUri("hilt:meeting/meetings/2026-07-05/Café Sync.md"),
    { kind: "meeting", id: "meetings/2026-07-05/Café Sync.md" },
  );
});

test("malformed % sequences degrade to the literal id instead of throwing", () => {
  assert.deepEqual(parseHiltUri("hilt:person/50%-off"), { kind: "person", id: "50%-off" });
});

// --- parse: rejection ------------------------------------------------------------------------

test("rejects non-hilt hrefs", () => {
  assert.equal(parseHiltUri("https://example.com/post"), null);
  assert.equal(parseHiltUri("mailto:justin@example.com"), null);
  assert.equal(parseHiltUri("/api/reports/morning"), null);
  assert.equal(parseHiltUri(""), null);
});

// BriefingLink seam (B5 adoption): parseHiltUri is the ONLY branch point in the briefing's
// link renderer, so every briefing-native href form MUST fall through to null — a non-null
// here would silently turn a pre-B5 briefing's link into a pill.
test("every briefing-native href form falls through the pill seam", () => {
  for (const href of [
    "#fn-1", // [^N] citation superscript anchor
    "/api/reports/morning", // required Library section link
    "/api/reports/memo", // editor's memo link
    "https://example.com/article", // external link
    "meetings/2026-07-05/Floyds sync-2026-07-05.md", // bare vault citation path
    "hilttask/t-20260707-001", // scheme requires the colon
  ]) {
    assert.equal(parseHiltUri(href), null, `expected fall-through for ${href}`);
  }
});

test("rejects unknown kinds", () => {
  assert.equal(parseHiltUri("hilt:widget/abc"), null);
  assert.equal(parseHiltUri("hilt:Meeting/abc"), null); // case-sensitive
});

test("rejects malformed hilt uris", () => {
  assert.equal(parseHiltUri("hilt:"), null);
  assert.equal(parseHiltUri("hilt:task"), null); // no slash
  assert.equal(parseHiltUri("hilt:task/"), null); // empty id
  assert.equal(parseHiltUri("hilt:/task/abc"), null); // empty kind
  assert.equal(parseHiltUri("hilt://task/abc"), null); // scheme-relative form is not the grammar
});

// --- build + round-trip ----------------------------------------------------------------------

test("builds simple uris unchanged for all five kinds", () => {
  assert.equal(buildHiltUri({ kind: "task", id: "t-20260705-003" }), "hilt:task/t-20260705-003");
  assert.equal(buildHiltUri({ kind: "person", id: "art-vandelay" }), "hilt:person/art-vandelay");
  assert.equal(buildHiltUri({ kind: "library", id: "9f3a0b1c2d3e4f50" }), "hilt:library/9f3a0b1c2d3e4f50");
  assert.equal(buildHiltUri({ kind: "project", id: "projects/everpro-migration" }), "hilt:project/projects/everpro-migration");
  assert.equal(
    buildHiltUri({ kind: "meeting", id: "meetings/2026-07-05/plain.md" }),
    "hilt:meeting/meetings/2026-07-05/plain.md",
  );
});

test("build percent-encodes spaces/unicode per segment (markdown-safe) and parse round-trips", () => {
  const id = "meetings/2026-07-05/Floyds Standup-2026-07-05 @ 14-00-00.md";
  const uri = buildHiltUri({ kind: "meeting", id });
  assert.ok(!uri.includes(" "), `expected no raw spaces in ${uri}`);
  assert.deepEqual(parseHiltUri(uri), { kind: "meeting", id });

  const unicodeId = "meetings/2026-07-05/Café Sync — Q3.md";
  assert.deepEqual(parseHiltUri(buildHiltUri({ kind: "meeting", id: unicodeId })), {
    kind: "meeting",
    id: unicodeId,
  });
});

test("round-trips ids containing uri-hostile characters", () => {
  for (const id of ["a?b=c&d", "100% done", "(parens) [brackets]", "semi;colon"]) {
    assert.deepEqual(parseHiltUri(buildHiltUri({ kind: "person", id })), { kind: "person", id });
  }
});
