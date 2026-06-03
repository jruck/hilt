import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { diffLineage, membershipFromRows, type LineageEvent, type Membership } from "./lineage";

function m(entries: Record<string, string[]>): Membership {
  return new Map(Object.entries(entries).map(([t, items]) => [t, new Set(items)]));
}

function opsFor(events: LineageEvent[], op: LineageEvent["op"]): LineageEvent[] {
  return events.filter((e) => e.op === op);
}

describe("diffLineage — split/merge/stable/birth/death (pure set math, §C.5)", () => {
  test("STABLE 1:1 (a topic that barely moved) ⇒ one carry, no split/merge", () => {
    const prior = m({ "t-old": ["a", "b", "c", "d"] });
    const next = m({ "t-new": ["a", "b", "c", "e"] }); // 3/4 overlap, still the same theme
    const events = diffLineage(prior, next, { overlapFloor: 0.5 });
    const carry = opsFor(events, "carry");
    assert.equal(carry.length, 1);
    assert.equal(carry[0].oldTopicId, "t-old");
    assert.equal(carry[0].newTopicId, "t-new");
    assert.equal(opsFor(events, "split").length, 0);
    assert.equal(opsFor(events, "merge").length, 0);
  });

  test("a perfectly stable topic (same id, same members) writes a single carry row", () => {
    const prior = m({ topicX: ["a", "b"] });
    const next = m({ topicX: ["a", "b"] });
    const events = diffLineage(prior, next);
    assert.equal(events.length, 1);
    assert.equal(events[0].op, "carry");
  });

  test("SPLIT — a prior topic's members land in ≥2 new clusters", () => {
    const prior = m({ big: ["a", "b", "c", "d"] });
    const next = m({ c1: ["a", "b"], c2: ["c", "d"] }); // each new gets half (overlap 1.0 of the smaller)
    const events = diffLineage(prior, next, { overlapFloor: 0.5 });
    const split = opsFor(events, "split");
    assert.equal(split.length, 2, "one split row per child cluster");
    assert.deepEqual(split.map((s) => s.newTopicId).sort(), ["c1", "c2"]);
    assert.ok(split.every((s) => s.oldTopicId === "big"));
    assert.equal(opsFor(events, "carry").length, 0);
  });

  test("MERGE — ≥2 prior topics collapse into one new cluster", () => {
    const prior = m({ p1: ["a", "b"], p2: ["c", "d"] });
    const next = m({ merged: ["a", "b", "c", "d"] }); // each prior fully inside the new
    const events = diffLineage(prior, next, { overlapFloor: 0.5 });
    const merge = opsFor(events, "merge");
    assert.equal(merge.length, 2, "one merge row per parent");
    assert.ok(merge.every((mm) => mm.newTopicId === "merged"));
    assert.deepEqual(merge.map((mm) => mm.oldTopicId).sort(), ["p1", "p2"]);
    assert.equal(opsFor(events, "carry").length, 0, "merged parents are not also carried");
  });

  test("BIRTH — a wholly-new cluster (former outliers) with no prior match", () => {
    const prior = m({ p1: ["a", "b"] });
    const next = m({ p1n: ["a", "b"], fresh: ["x", "y", "z"] });
    const events = diffLineage(prior, next, { overlapFloor: 0.5 });
    const birth = opsFor(events, "birth");
    assert.equal(birth.length, 1);
    assert.equal(birth[0].newTopicId, "fresh");
    assert.equal(birth[0].oldTopicId, null);
  });

  test("DEATH — a prior topic with no surviving matched cluster", () => {
    const prior = m({ gone: ["a", "b"], kept: ["c", "d"] });
    const next = m({ keptn: ["c", "d"] });
    const events = diffLineage(prior, next, { overlapFloor: 0.5 });
    const death = opsFor(events, "death");
    assert.equal(death.length, 1);
    assert.equal(death[0].oldTopicId, "gone");
    assert.equal(death[0].newTopicId, null);
  });

  test("first-ever fit (no prior) ⇒ every new cluster is a birth", () => {
    const events = diffLineage(new Map(), m({ a: ["1", "2"], b: ["3", "4"] }), { overlapFloor: 0.5 });
    assert.equal(opsFor(events, "birth").length, 2);
    assert.equal(events.length, 2);
  });

  test("deterministic ordering (sorted prior ids, then merge, then birth passes)", () => {
    const prior = m({ zzz: ["a"], aaa: ["b"] });
    const next = m({ n: ["a", "b"], extra: ["q"] });
    const e1 = diffLineage(prior, next, { overlapFloor: 0.5 });
    const e2 = diffLineage(prior, next, { overlapFloor: 0.5 });
    assert.deepEqual(e1, e2, "same inputs → byte-identical event sequence");
  });
});

describe("membershipFromRows", () => {
  test("groups flat (item_id, topic_id) rows into topic→item-set", () => {
    const mem = membershipFromRows([
      { item_id: "a", topic_id: "t1" },
      { item_id: "b", topic_id: "t1" },
      { item_id: "c", topic_id: "t2" },
    ]);
    assert.deepEqual([...mem.get("t1")!].sort(), ["a", "b"]);
    assert.deepEqual([...mem.get("t2")!], ["c"]);
  });
});
