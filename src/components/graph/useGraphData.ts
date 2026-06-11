/**
 * useGraphData — fetch + decode the binary graph payload (scope-aware).
 *
 * Builds the GET /api/system/graph query (scope/node/hops/includeTags), fetches the
 * ArrayBuffer, decodes via decode.ts, and surfaces the typed arrays + sidecar. On a
 * GraphFormatError (magic/version mismatch) it reports the error so GraphView can
 * hard-refresh rather than render garbage. Re-fetches whenever the inputs (or the
 * meta payloadToken) change — flowing through the same renderer instance via setData.
 */

import { useEffect, useState } from "react";
import type { GraphScope } from "@/lib/graph/types";
import { decodeGraphBinary, GraphFormatError, type DecodedGraph } from "./decode";
import { withBasePath } from "@/lib/base-path";

export interface GraphDataParams {
  scope: GraphScope;
  /** Local-scope anchor node id (omit for global). */
  nodeId?: string | null;
  hops?: number;
  includeTags?: boolean;
  /** Global-scope minimum degree ("hide leaves" → 2). Ignored for local scope. */
  minDegree?: number;
}

export interface UseGraphDataResult {
  data: DecodedGraph | null;
  loading: boolean;
  error: string | null;
  /** True only for a magic/version mismatch (caller should hard-refresh). */
  formatError: boolean;
}

export function useGraphData(
  enabled: boolean,
  ready: boolean,
  params: GraphDataParams,
  payloadToken: number,
): UseGraphDataResult {
  const [data, setData] = useState<DecodedGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formatError, setFormatError] = useState(false);

  const { scope, nodeId, hops, includeTags, minDegree } = params;

  useEffect(() => {
    if (!enabled || !ready) return;
    let cancelled = false;
    const controller = new AbortController();

    const query = new URLSearchParams();
    query.set("scope", scope);
    if (scope === "local" && nodeId) query.set("node", nodeId);
    if (hops != null) query.set("hops", String(hops));
    if (includeTags) query.set("includeTags", "1");
    if (scope === "global" && minDegree != null && minDegree > 1) query.set("minDegree", String(minDegree));

    setLoading(true);
    setError(null);
    setFormatError(false);

    fetch(withBasePath(`/api/system/graph?${query.toString()}`), { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`payload failed: ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (cancelled) return;
        const decoded = decodeGraphBinary(buffer);
        setData(decoded);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof GraphFormatError) {
          setFormatError(true);
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load graph payload");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, ready, scope, nodeId, hops, includeTags, minDegree, payloadToken]);

  return { data, loading, error, formatError };
}
