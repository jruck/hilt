/**
 * effectiveHiddenTypes (src/components/graph/graph-labels.ts) — the legend mixer's
 * audio-console hide/solo resolution. Node-safe (graph-labels has no DOM imports);
 * placed here like deeplink.test.ts / decode-filter.test.ts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { effectiveHiddenTypes } from "@/components/graph/graph-labels";
import type { GraphNodeType } from "@/lib/graph/types";

const set = (...t: GraphNodeType[]): Set<GraphNodeType> => new Set(t);

describe("effectiveHiddenTypes — hide/solo mixer semantics", () => {
  test("no solo ⇒ hides apply as marked", () => {
    const out = effectiveHiddenTypes(set("entity", "note"), set());
    assert.deepEqual([...out].sort(), ["entity", "note"]);
  });

  test("solo wins: only the soloed type stays visible, hides are suspended", () => {
    const out = effectiveHiddenTypes(set("entity"), set("topic"));
    assert.ok(!out.has("topic"), "soloed type visible");
    assert.ok(out.has("note") && out.has("reference") && out.has("person"), "everything else hidden");
    assert.ok(out.has("entity"), "previously-hidden type also hidden (solo set is exact)");
  });

  test("defensive: a multi-solo set unions (UI enforces single-select, the function tolerates any set)", () => {
    const out = effectiveHiddenTypes(set(), set("topic", "project"));
    assert.ok(!out.has("topic") && !out.has("project"), "both soloed types visible");
    assert.ok(out.has("entity") && out.has("note"), "the rest hidden");
  });

  test("clearing solo restores the standing hide set", () => {
    const hidden = set("candidate");
    assert.deepEqual([...effectiveHiddenTypes(hidden, set())], ["candidate"]);
  });
});
