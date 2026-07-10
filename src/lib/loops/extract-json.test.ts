import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject } from "./extract-json";

test("extracts JSON after prose", () => {
  assert.deepEqual(
    extractJsonObject('I ran a real alignment pass — here is the result:\n{"a":1,"b":"ok"}'),
    { a: 1, b: "ok" },
  );
});

test("extracts fenced json with prose around it", () => {
  assert.deepEqual(
    extractJsonObject('Before\n```json\n{"summary":"done","items":[1,2]}\n```\nAfter'),
    { summary: "done", items: [1, 2] },
  );
});

test("preserves nested objects and braces inside strings", () => {
  const text = 'Result:\n{"outer":{"inner":{"value":"keep {these} braces","escaped":"quote \\" and }"}},"list":[{"x":1}]}';

  assert.deepEqual(extractJsonObject(text), {
    outer: {
      inner: {
        value: "keep {these} braces",
        escaped: 'quote " and }',
      },
    },
    list: [{ x: 1 }],
  });
});

test("returns null when no JSON is present", () => {
  assert.equal(extractJsonObject("I ran the analysis and found nothing parseable."), null);
});

test("ignores stray balanced braces before the object", () => {
  assert.deepEqual(extractJsonObject('in {short} — the answer: {"a":1}'), { a: 1 });
});

test("parses whole text JSON object", () => {
  assert.deepEqual(extractJsonObject('{"whole":true,"count":2}'), { whole: true, count: 2 });
});

test("rejects empty input and top-level arrays", () => {
  assert.equal(extractJsonObject(""), null);
  assert.equal(extractJsonObject('[{"a":1}]'), null);
});

test("rejects a fenced top-level array instead of plucking an inner object", () => {
  assert.equal(extractJsonObject('```json\n[{"a":1},{"b":2}]\n```'), null);
  assert.equal(extractJsonObject('Here:\n```json\n[{"a":1}]\n```\nDone.'), null);
});
