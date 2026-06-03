import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cosineSimilarity } from "./vector";
import { createGeminiClient } from "./gemini";
import { createFakeSemanticClient } from "./test-helpers";

const original = process.env.SEMANTIC_FORCE_OFFLINE;
afterEach(() => {
  if (original === undefined) delete process.env.SEMANTIC_FORCE_OFFLINE;
  else process.env.SEMANTIC_FORCE_OFFLINE = original;
});

describe("no live calls + fake determinism", () => {
  test("the real Gemini client refuses to embed when offline-forced (CI guard)", async () => {
    process.env.SEMANTIC_FORCE_OFFLINE = "1";
    const client = createGeminiClient();
    await assert.rejects(() => client.embed(["hello"]), /blocked under test/);
  });

  test("the real labelTopics() abstains ([]) offline rather than firing a live call (P2.2 guard)", async () => {
    process.env.SEMANTIC_FORCE_OFFLINE = "1";
    const client = createGeminiClient();
    assert.deepEqual(await client.labelTopics([{ clusterId: "c1", sampleTexts: ["agent tool use"] }]), []);
  });

  test("fake embed is deterministic: same text → same unit vector", async () => {
    const fake = createFakeSemanticClient({ dim: 32 });
    const [a1] = await fake.embed(["agent architecture"]);
    const [a2] = await fake.embed(["agent architecture"]);
    const [b] = await fake.embed(["fundraising"]);
    assert.ok(Math.abs(cosineSimilarity(a1, a2) - 1) < 1e-6, "same text identical");
    assert.ok(cosineSimilarity(a1, b) < 0.9, "different text differs");
    assert.ok(Math.abs(Math.hypot(...Array.from(a1)) - 1) < 1e-5, "unit length");
    assert.equal(fake.calls.embed, 3);
    assert.equal(fake.calls.embedTexts, 3);
  });

  test("fake extract/label replay fixtures", async () => {
    const fake = createFakeSemanticClient({
      dim: 8,
      extractFixtures: { "note text": [{ type: "person", name: "Ada", aliases: ["Ada L."], salience: 0.9 }] },
      labelFixtures: { c1: { clusterId: "c1", label: "Agents", summary: "agent work" } },
    });
    assert.equal((await fake.extractEntities("note text"))[0]?.name, "Ada");
    assert.deepEqual(await fake.extractEntities("unknown"), []);
    assert.equal((await fake.labelTopics([{ clusterId: "c1", sampleTexts: [] }]))[0].label, "Agents");
  });
});
