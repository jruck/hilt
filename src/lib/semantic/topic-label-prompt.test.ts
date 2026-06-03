import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TOPIC_LABEL_PROMPT, parseTopicLabels, parseTopicMerges } from "./topic-label-prompt";

describe("parseTopicLabels — tolerant label parse", () => {
  test("clean JSON yields one TopicLabel per well-formed entry", () => {
    const labels = parseTopicLabels(
      JSON.stringify({
        topics: [
          { cluster_id: "L1-0", label: "Agent tool-use design", summary: "How agents call tools.", aliases: ["tools"] },
          { cluster_id: "L1-1", label: "Hiring", summary: "Recruiting notes." },
        ],
      }),
    );
    assert.equal(labels.length, 2);
    assert.deepEqual(labels.map((l) => l.clusterId), ["L1-0", "L1-1"]);
    assert.equal(labels[0].label, "Agent tool-use design");
    assert.equal(labels[0].summary, "How agents call tools.");
  });

  test("fenced ```json``` body is unwrapped", () => {
    const labels = parseTopicLabels('```json\n{ "topics": [ { "cluster_id": "X", "label": "Memory" } ] }\n```');
    assert.equal(labels.length, 1);
    assert.equal(labels[0].clusterId, "X");
    assert.equal(labels[0].summary, "", "missing summary defaults to empty string");
  });

  test("JSON embedded in prose is recovered", () => {
    const labels = parseTopicLabels('Sure! Here is the result:\n{ "topics": [ { "cluster_id": "Y", "label": "Strategy" } ] }\nHope that helps.');
    assert.equal(labels.length, 1);
    assert.equal(labels[0].label, "Strategy");
  });

  test("entries missing cluster_id or label are dropped; the rest survive", () => {
    const labels = parseTopicLabels(
      JSON.stringify({ topics: [{ cluster_id: "A", label: "Good" }, { cluster_id: "B" }, { label: "no id" }, {}] }),
    );
    assert.deepEqual(labels.map((l) => l.clusterId), ["A"]);
  });

  test("wholly unparseable body ⇒ [] (abstain, no throw)", () => {
    assert.deepEqual(parseTopicLabels(""), []);
    assert.deepEqual(parseTopicLabels("the model refused"), []);
    assert.deepEqual(parseTopicLabels("[1,2,3]"), []);
  });
});

describe("parseTopicMerges — unjustified merges dropped", () => {
  test("a justified ≥2-member merge survives", () => {
    const merges = parseTopicMerges(
      JSON.stringify({
        merges: [{ merge: ["L1-0", "L1-3"], into_label: "Agents", why: "Both name the same agent-architecture thread." }],
      }),
    );
    assert.equal(merges.length, 1);
    assert.deepEqual(merges[0].merge, ["L1-0", "L1-3"]);
    assert.equal(merges[0].intoLabel, "Agents");
  });

  test("a merge with no `why` justification is dropped (mirrors normalizeConnections)", () => {
    const merges = parseTopicMerges(JSON.stringify({ merges: [{ merge: ["L1-0", "L1-1"], into_label: "X" }] }));
    assert.deepEqual(merges, []);
  });

  test("a single-member merge is invalid and dropped", () => {
    const merges = parseTopicMerges(JSON.stringify({ merges: [{ merge: ["L1-0"], why: "alone" }] }));
    assert.deepEqual(merges, []);
  });

  test("into_label defaults to the first member when omitted", () => {
    const merges = parseTopicMerges(JSON.stringify({ merges: [{ merge: ["L1-2", "L1-9"], why: "same" }] }));
    assert.equal(merges.length, 1);
    assert.equal(merges[0].intoLabel, "L1-2");
  });

  test("empty merges / unparseable ⇒ [] (no merges is a complete answer)", () => {
    assert.deepEqual(parseTopicMerges(JSON.stringify({ merges: [] })), []);
    assert.deepEqual(parseTopicMerges("nope"), []);
  });
});

describe("TOPIC_LABEL_PROMPT", () => {
  test("is a non-empty practitioner-voice prompt that asks for the topics envelope", () => {
    assert.ok(TOPIC_LABEL_PROMPT.length > 200);
    assert.match(TOPIC_LABEL_PROMPT, /cluster_id/);
    assert.match(TOPIC_LABEL_PROMPT, /"label"/);
  });
});
