import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { assertNotGeminiEndpoint } from "../ai/gemini-tripwire";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCE_ROOTS = ["src", "server", "scripts", "electron"];

function productionSourceFiles(): string[] {
  const files: string[] = [];
  const visit = (absolutePath: string) => {
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolutePath)) visit(path.join(absolutePath, name));
      return;
    }
    const relative = path.relative(REPO_ROOT, absolutePath);
    if (!/\.(?:[cm]?[jt]sx?|mjs|cjs)$/.test(relative)) return;
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative)) return;
    if (relative.includes(`${path.sep}__fixtures__${path.sep}`)) return;
    // One-time bake-off sources are being moved to the private archive during this cutover.
    if (/library-(?:recommendation-)?bakeoff/.test(path.basename(relative))) return;
    files.push(relative);
  };
  for (const root of SOURCE_ROOTS) visit(path.join(REPO_ROOT, root));
  return files.sort();
}

describe("production Gemini tripwire", () => {
  it("blocks public and Vertex Gemini endpoints while allowing unrelated Google APIs", () => {
    assert.throws(() => assertNotGeminiEndpoint("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash:generateContent"));
    assert.throws(() => assertNotGeminiEndpoint("https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/l/publishers/google/models/gemini-2:generateContent"));
    assert.doesNotThrow(() => assertNotGeminiEndpoint("https://youtube.googleapis.com/youtube/v3/videos?id=123"));
    for (const relative of ["src/instrumentation.ts", "server/ws-server.ts"]) {
      const source = fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");
      assert.match(source, /installGeminiNetworkTripwire\(\)/, `${relative} must install the runtime tripwire`);
    }
  });

  it("contains no Gemini client, credentials, model ids, or endpoints", () => {
    const forbidden = [
      /generativelanguage\.googleapis\.com/i,
      /GEMINI_API_KEY/,
      /@google\/generative-ai/i,
      /GoogleGenAI/,
      /["'`]google\/gemini-/i,
      /["'`]gemini-(?:embedding|flash|pro)/i,
      /(?:@\/|\.\.\/|\.\/)lib\/semantic\//,
    ];
    const violations: string[] = [];
    for (const relative of productionSourceFiles()) {
      if (relative === path.join("src", "lib", "ai", "gemini-tripwire.ts")) continue;
      const source = fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");
      for (const pattern of forbidden) {
        if (pattern.test(source)) violations.push(`${relative}: ${pattern}`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("puts every direct summarize CLI execution behind the runtime policy", () => {
    const violations: string[] = [];
    for (const relative of productionSourceFiles()) {
      const source = fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");
      const directSummarizeExecution = source.includes("SUMMARIZE_BIN")
        || /execFile(?:Async)?\(\s*["'`]summarize["'`]/.test(source);
      if (!directSummarizeExecution) continue;
      if (!source.includes("assertLibrarySummarizeInvocation(")) {
        violations.push(`${relative}: missing runtime summarize policy assertion`);
      }
      const modelBacked = source.includes('"--prompt"') || source.includes('"--force-summary"');
      if (modelBacked && !source.includes("withPinnedLibrarySummarizeModel(")) {
        violations.push(`${relative}: model-backed summarize call is not pinned`);
      }
    }
    assert.deepEqual(violations, []);
  });
});
