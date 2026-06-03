import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EXTRACTION_PROMPT, parseExtractionOutput } from "./extraction-prompt";

describe("parseExtractionOutput", () => {
  test("the prompt names the four buckets and the abstain answer", () => {
    assert.match(EXTRACTION_PROMPT, /"person"/);
    assert.match(EXTRACTION_PROMPT, /"project"/);
    assert.match(EXTRACTION_PROMPT, /"concept"/);
    assert.match(EXTRACTION_PROMPT, /"source"/);
    assert.match(EXTRACTION_PROMPT, /\{ "entities": \[\] \}/);
  });

  test("parses clean JSON and maps concept→idea + salience→number", () => {
    const out = parseExtractionOutput(
      JSON.stringify({
        entities: [
          { type: "person", name: "Ada Lovelace", aliases: ["Ada"], salience: "primary", evidence: "Ada writes the notes" },
          { type: "concept", name: "retrieval-augmented generation", aliases: ["RAG"], salience: "secondary", evidence: "RAG is discussed" },
        ],
      }),
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].type, "person");
    assert.equal(out[0].salience, 1);
    assert.equal(out[1].type, "idea", "concept folds to the idea bucket");
    assert.ok(Math.abs(out[1].salience - 0.6) < 1e-9);
    assert.deepEqual(out[1].aliases, ["RAG"]);
  });

  test("strips ```json code fences", () => {
    const out = parseExtractionOutput(
      "```json\n" +
        JSON.stringify({ entities: [{ type: "source", name: "Anthropic", aliases: [], salience: "mention", evidence: "Anthropic ships it" }] }) +
        "\n```",
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "source");
    assert.ok(Math.abs(out[0].salience - 0.3) < 1e-9);
  });

  test("extracts JSON embedded in surrounding prose", () => {
    const out = parseExtractionOutput(
      'Here is what I found: {"entities":[{"type":"project","name":"Hilt","aliases":[],"salience":"primary","evidence":"Hilt is the app"}]} — done.',
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "Hilt");
  });

  test("drops malformed entities, never throws", () => {
    const out = parseExtractionOutput(
      JSON.stringify({
        entities: [
          { type: "weather", name: "Sunny", salience: "primary", evidence: "x" }, // unknown type ⇒ drop
          { type: "person", name: "", salience: "primary", evidence: "x" }, // blank name ⇒ drop
          { type: "person", name: "No Evidence", salience: "primary" }, // missing evidence ⇒ drop
          { type: "person", name: "Kept", aliases: ["k"], salience: "primary", evidence: "grounded" }, // valid
        ],
      }),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "Kept");
  });

  test("garbage / partial JSON / empty → [] (abstain)", () => {
    assert.deepEqual(parseExtractionOutput(""), []);
    assert.deepEqual(parseExtractionOutput("not json at all"), []);
    assert.deepEqual(parseExtractionOutput('{"entities": [trailing'), []);
    assert.deepEqual(parseExtractionOutput("```\n{bad}\n```"), []);
  });

  test("a numeric salience is clamped to 0..1; an alias equal to the name is dropped", () => {
    const out = parseExtractionOutput(
      JSON.stringify({ entities: [{ type: "person", name: "Bob", aliases: ["Bob", "Bobby"], salience: 2.5, evidence: "e" }] }),
    );
    assert.equal(out[0].salience, 1);
    assert.deepEqual(out[0].aliases, ["Bobby"]);
  });
});
