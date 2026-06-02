/**
 * Graph scope deep-link grammar — the ONE place that defines or parses graph scope.
 *
 * Both the "Show in graph" buttons (Docs/Library/People) and GraphView import this;
 * the API route validates `scope` against the shared `GraphScope` type from
 * `@/lib/graph/types` (no re-typed string literals anywhere).
 *
 * Grammar is path-segment only — there are NO query strings. `navigateTo(mode, scope)`
 * builds the URL as `/${mode}${scope}` and cannot carry a query string (ScopeContext.tsx,
 * url-utils.ts). The value GraphView receives as `scopePath` is the segment(s) AFTER
 * "graph" (Board strips the leading "graph" out of the "/system/graph/..." URL).
 *
 * Canonical URL forms (the only ones):
 *   /system/graph                              -> default scope (device default)
 *   /system/graph/focus/<encodedNodeId>        -> focus node; scope = device default
 *   /system/graph/focus/<encodedNodeId>/local  -> local N-hop around the node
 *   /system/graph/focus/<encodedNodeId>/global -> global graph centered on the node
 *   /system/graph/local | /system/graph/global -> force scope without a focus
 */

import type { GraphScope } from "@/lib/graph/types"; // "global" | "local"

export interface GraphScopeParse {
  focusId: string | null;
  /** null => apply device default (desktop global, mobile local). */
  scope: GraphScope | null;
}

/** Parse the path tail after "graph" (what SystemView passes as `scopePath`). */
export function parseGraphScope(scopePath: string): GraphScopeParse {
  const parts = scopePath.split("/").filter(Boolean); // e.g. ["focus", "<enc>", "local"]
  if (parts[0] === "focus" && parts[1]) {
    const focusId = safeDecode(parts[1]);
    const scope = parts[2] === "local" || parts[2] === "global" ? parts[2] : null;
    return { focusId, scope };
  }
  if (parts[0] === "local") return { focusId: null, scope: "local" };
  if (parts[0] === "global") return { focusId: null, scope: "global" };
  return { focusId: null, scope: null };
}

/** Build a scope string for `navigateTo("system", ...)`: "/graph", "/graph/focus/<enc>", etc. */
export function buildGraphScope(o: { focus?: string; scope?: GraphScope }): string {
  const f = o.focus ? `/focus/${encodeURIComponent(o.focus)}` : "";
  const s = o.scope ? `/${o.scope}` : "";
  return `/graph${f}${s}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
