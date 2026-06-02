/**
 * Deep-link round-trip regression (plan §grammar lines 185/857).
 *
 * Asserts the ONE path-segment grammar survives the full URL round-trip:
 *   buildGraphScope({ focus }) -> buildViewUrl -> parseViewUrl
 *     -> systemModeFromUrl -> isSystemMode === "graph", focus id recovered.
 *
 * graph-deeplink.ts lives in src/components/graph/ but only `import type`s
 * @/lib/graph/types, so tsx strips that import and this colocated test (under
 * the test:graph glob) reaches it with a relative import and no alias loader.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildGraphScope, parseGraphScope } from "../../components/graph/graph-deeplink";
import { isSystemMode, systemModeFromUrl } from "../system/navigation";
import { buildViewUrl, parseViewUrl } from "../url-utils";

/** Split a "/a/b/c" URL into the segment array parseViewUrl expects. */
function urlToSegments(url: string): string[] {
  return url.split("/").filter(Boolean);
}

describe("graph deep-link round-trip", () => {
  test("focus deep-link survives buildGraphScope -> buildViewUrl -> parseViewUrl -> systemModeFromUrl", () => {
    const focusId = "person:art-vandelay";

    // 1. "Show in graph" emits navigateTo("system", buildGraphScope({ focus })).
    const scope = buildGraphScope({ focus: focusId });
    assert.equal(scope, `/graph/focus/${encodeURIComponent(focusId)}`);

    // 2. navigateTo builds the URL as buildViewUrl("system", scope).
    const url = buildViewUrl("system", scope);
    assert.equal(url, `/system/graph/focus/${encodeURIComponent(focusId)}`);

    // 3. On history pop, parseViewUrl splits on "/".
    const parsed = parseViewUrl(urlToSegments(url));
    assert.equal(parsed.viewMode, "system");
    assert.equal(parsed.scope, `/graph/focus/${encodeURIComponent(focusId)}`);

    // 4. systemModeFromUrl resolves the sub-mode and isSystemMode accepts it.
    const mode = systemModeFromUrl(parsed.viewMode, parsed.scope);
    assert.equal(mode, "graph");
    assert.equal(isSystemMode(mode), true);

    // 5. Board strips the leading "graph"; GraphView parses the remainder.
    const graphScopePath = parsed.scope.split("/").filter(Boolean).slice(1).join("/");
    const recovered = parseGraphScope(graphScopePath);
    assert.equal(recovered.focusId, focusId);
    assert.equal(recovered.scope, null); // no explicit scope => device default
  });

  test("focus + explicit scope (local/global) round-trips", () => {
    for (const explicit of ["local", "global"] as const) {
      const focusId = "ref:abc123";
      const scope = buildGraphScope({ focus: focusId, scope: explicit });
      const url = buildViewUrl("system", scope);
      const parsed = parseViewUrl(urlToSegments(url));
      assert.equal(systemModeFromUrl(parsed.viewMode, parsed.scope), "graph");
      const graphScopePath = parsed.scope.split("/").filter(Boolean).slice(1).join("/");
      const recovered = parseGraphScope(graphScopePath);
      assert.equal(recovered.focusId, focusId, `${explicit}: focus id should survive`);
      assert.equal(recovered.scope, explicit, `${explicit}: explicit scope should survive`);
    }
  });

  test("scope-only deep-links (no focus) round-trip and resolve to graph", () => {
    for (const explicit of ["local", "global"] as const) {
      const scope = buildGraphScope({ scope: explicit });
      assert.equal(scope, `/graph/${explicit}`);
      const url = buildViewUrl("system", scope);
      const parsed = parseViewUrl(urlToSegments(url));
      assert.equal(systemModeFromUrl(parsed.viewMode, parsed.scope), "graph");
      const graphScopePath = parsed.scope.split("/").filter(Boolean).slice(1).join("/");
      const recovered = parseGraphScope(graphScopePath);
      assert.equal(recovered.focusId, null);
      assert.equal(recovered.scope, explicit);
    }
  });

  test("bare /system/graph resolves to graph with device-default scope", () => {
    const scope = buildGraphScope({});
    assert.equal(scope, "/graph");
    const url = buildViewUrl("system", scope);
    assert.equal(url, "/system/graph");
    const parsed = parseViewUrl(urlToSegments(url));
    assert.equal(systemModeFromUrl(parsed.viewMode, parsed.scope), "graph");
    const graphScopePath = parsed.scope.split("/").filter(Boolean).slice(1).join("/");
    const recovered = parseGraphScope(graphScopePath);
    assert.equal(recovered.focusId, null);
    assert.equal(recovered.scope, null);
  });

  test("ids needing percent-encoding (absolute paths, colons) survive the round-trip", () => {
    const focusId = "note:/Users/me/work/bridge/projects/atlas/index.md";
    const scope = buildGraphScope({ focus: focusId });
    // The encoded segment must not introduce a stray "/" that breaks parsing.
    const url = buildViewUrl("system", scope);
    const parsed = parseViewUrl(urlToSegments(url));
    assert.equal(systemModeFromUrl(parsed.viewMode, parsed.scope), "graph");
    const graphScopePath = parsed.scope.split("/").filter(Boolean).slice(1).join("/");
    const recovered = parseGraphScope(graphScopePath);
    assert.equal(recovered.focusId, focusId, "percent-encoded path id should decode back exactly");
  });
});
