import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HILT_LIBRARY_SUMMARIZE_MODEL,
  assertLibrarySummarizeInvocation,
  validateLibrarySummarizeModel,
  withPinnedLibrarySummarizeModel,
} from "./summarize-policy";

describe("Library summarize policy", () => {
  it("pins model-backed work to Claude Sonnet 4.6", () => {
    assert.equal(validateLibrarySummarizeModel(undefined), HILT_LIBRARY_SUMMARIZE_MODEL);
    assert.deepEqual(withPinnedLibrarySummarizeModel(["source", "--prompt", "digest"]), [
      "source",
      "--prompt",
      "digest",
      "--model",
      "cli/claude/claude-sonnet-4-6",
    ]);
    assert.doesNotThrow(() => assertLibrarySummarizeInvocation([
      "source",
      "--prompt",
      "digest",
      "--model",
      HILT_LIBRARY_SUMMARIZE_MODEL,
    ], undefined));
  });

  it("rejects empty, automatic, alternate, Google, and Gemini model selections", () => {
    for (const value of ["", "auto", "google/gemini-3-flash-preview", "gemini-flash-latest", "cli/claude/opus"]) {
      assert.throws(() => validateLibrarySummarizeModel(value));
    }
  });

  it("blocks model-backed calls without the exact pin", () => {
    assert.throws(() => assertLibrarySummarizeInvocation(["source", "--prompt", "digest"], undefined));
    assert.throws(() => assertLibrarySummarizeInvocation([
      "source",
      "--prompt",
      "digest",
      "--model",
      "google/gemini-3-flash-preview",
    ], undefined));
  });

  it("allows extraction-only calls without any model", () => {
    assert.doesNotThrow(() => assertLibrarySummarizeInvocation([
      "https://example.com/article",
      "--extract",
      "--format",
      "md",
    ], "google/gemini-3-flash-preview"));
  });
});
