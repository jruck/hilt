import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildBookCaptureImportPlan, writeBookCaptureImport } from "./book-capture";
import { parseReferenceFile } from "./references";

function tempVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-book-capture-vault-"));
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  return vault;
}

function tempCaptureDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-book-capture-input-"));
  fs.writeFileSync(path.join(dir, "Interesting Book.md"), `---
author: Ada Reader
URL: https://example.com/books/interesting
Category: Systems
---

# Interesting Book

A concise account of how durable systems thinking works in practice.

## Topics

- [[01 Feedback Loops]] - How loops shape outcomes
- [[02 Operating Tempo]] - How cadence compounds
`, "utf-8");
  fs.writeFileSync(path.join(dir, "01_Feedback_Loops.md"), `# Feedback Loops

Feedback loops turn local decisions into system behavior.
`, "utf-8");
  return dir;
}

test("builds a normalized book capture reference plan", () => {
  const vault = tempVault();
  const input = tempCaptureDir();
  const plan = buildBookCaptureImportPlan({
    vaultPath: vault,
    inputPath: input,
    thumbnail: "/api/docs/raw?path=/tmp/cover.jpg",
    now: "2026-06-01T12:00:00.000Z",
  });

  assert.equal(plan.title, "Interesting Book");
  assert.equal(plan.author, "Ada Reader");
  assert.equal(plan.url, "https://example.com/books/interesting");
  assert.equal(path.relative(vault, plan.referencePath), "references/books/interesting-book/index.md");
  assert.match(plan.markdown, /source_id: book-capture/);
  assert.match(plan.markdown, /format: book/);
  assert.ok(plan.markdown.includes("/api/docs/raw?path=/tmp/cover.jpg"));
  assert.match(plan.markdown, /## Media\n\n!\[Interesting Book cover]/);
  assert.match(plan.markdown, /book_capture_cache: references\/.cache\/book-captures\/interesting-book\/capture.md/);
  assert.match(plan.markdown, /## Captured Notes/);
  assert.match(plan.markdown, /## Raw Content/);
});

test("preserves structured book digests without duplicate captured notes", () => {
  const vault = tempVault();
  const input = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-book-capture-digest-"));
  fs.writeFileSync(path.join(input, "Digest.md"), `# Practical AI

This is a polished digest with enough detail to become the body summary without being clipped awkwardly in the visible note.

## Key Points

- Implementation quality matters.

## Connections

- [[agentic-workflows]] - Useful adjacent context.
`, "utf-8");

  const plan = buildBookCaptureImportPlan({
    vaultPath: vault,
    inputPath: input,
    title: "Practical AI",
    now: "2026-06-01T12:00:00.000Z",
  });

  assert.match(plan.markdown, /## Summary\n\nThis is a polished digest/);
  assert.match(plan.markdown, /## Key Points/);
  assert.doesNotMatch(plan.markdown, /## Captured Notes/);
  assert.doesNotMatch(plan.markdown, /documen$/);
});

test("can append OCR raw text JSON to the cached capture", () => {
  const vault = tempVault();
  const input = tempCaptureDir();
  const rawText = path.join(input, "raw_text.json");
  fs.writeFileSync(rawText, JSON.stringify({
    stats: { total: 1, averageConfidence: 0.98 },
    pages: [{ page: 1, text: "OCR page text", confidence: 0.98, method: "vision" }],
  }), "utf-8");

  const plan = buildBookCaptureImportPlan({
    vaultPath: vault,
    inputPath: input,
    rawTextJsonPath: rawText,
    now: "2026-06-01T12:00:00.000Z",
  });

  assert.match(plan.cacheMarkdown, /# OCR Capture/);
  assert.match(plan.cacheMarkdown, /## OCR Stats/);
  assert.match(plan.cacheMarkdown, /## Page 1\n\nOCR page text/);
});

test("writes book capture reference, topic files, and cache", () => {
  const vault = tempVault();
  const input = tempCaptureDir();
  const plan = buildBookCaptureImportPlan({
    vaultPath: vault,
    inputPath: input,
    title: "Interesting Book",
    now: "2026-06-01T12:00:00.000Z",
  });

  writeBookCaptureImport(plan);

  assert.equal(fs.existsSync(plan.referencePath), true);
  assert.equal(fs.existsSync(path.join(plan.topicsDir, "01_Feedback_Loops.md")), true);
  assert.equal(fs.existsSync(plan.cachePath), true);

  const parsed = parseReferenceFile(vault, plan.referencePath);
  assert.equal(parsed?.title, "Interesting Book");
  assert.equal(parsed?.source_id, "book-capture");
  assert.equal(parsed?.source_name, "Books");
  assert.equal(parsed?.url, "https://example.com/books/interesting");
  assert.equal(parsed?.raw_frontmatter.format, "book");
});
