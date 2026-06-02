/**
 * useGraphMeta — drives the first-run state machine (plan "First-run / cold-start").
 *
 * Calls GET /api/system/graph/meta (cheap). Subscribes to the `graph` WS channel and
 * refetches on `changed`. Falls back to polling /meta on a 10s interval when the
 * socket is down (Tailscale failover, like SystemStackView). Refetches the binary
 * payload (caller's responsibility) when layoutVersion or builtAt changes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useEventSocket } from "@/hooks/useEventSocket";
import type { GraphMeta } from "@/lib/graph/types";

interface GraphChangedPayload {
  kind?: "incremental" | "full";
  changed?: string[];
  ts?: number;
}

export interface UseGraphMetaResult {
  meta: GraphMeta | null;
  loading: boolean;
  error: string | null;
  /** Monotonic token bumped whenever the payload should be re-fetched. */
  payloadToken: number;
  /** Node ids that moved in the last incremental relax (null on a full refetch). */
  changedIds: string[] | null;
  /**
   * Whether the live WS event socket is connected. When false the view is on the
   * 10s /meta polling fallback (Tailscale failover) and surfaces an offline chip.
   */
  socketConnected: boolean;
  refresh: () => void;
}

export function useGraphMeta(enabled: boolean): UseGraphMetaResult {
  const [meta, setMeta] = useState<GraphMeta | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [payloadToken, setPayloadToken] = useState(0);
  const [changedIds, setChangedIds] = useState<string[] | null>(null);

  const { connected, subscribe, unsubscribe, on } = useEventSocket();
  const lastSignatureRef = useRef<string>("");

  const fetchMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/system/graph/meta", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          setError(null);
          setMeta((prev) => (prev ? prev : null));
          setLoading(false);
          return;
        }
        throw new Error(`meta failed: ${res.status}`);
      }
      const data = (await res.json()) as GraphMeta;
      setMeta(data);
      setError(null);
      // Bump the payload token when the layout identity changes (built_at / version).
      const signature = `${data.builtAt ?? ""}:${data.layoutVersion}`;
      if (signature !== lastSignatureRef.current) {
        lastSignatureRef.current = signature;
        setChangedIds(null);
        setPayloadToken((t) => t + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph meta");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void fetchMeta();
  }, [fetchMeta]);

  // Initial fetch.
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void fetchMeta();
  }, [enabled, fetchMeta]);

  // WS subscription: refetch on `changed`. Targeted-patch ids carried through.
  useEffect(() => {
    if (!enabled || !connected) return;
    subscribe("graph");
    const unsub = on("graph", "changed", (data) => {
      const payload = (data ?? {}) as GraphChangedPayload;
      if (payload.kind === "incremental" && Array.isArray(payload.changed)) {
        setChangedIds(payload.changed);
        setPayloadToken((t) => t + 1);
      } else {
        setChangedIds(null);
      }
      void fetchMeta();
    });
    return () => {
      unsub();
      unsubscribe("graph");
    };
  }, [enabled, connected, subscribe, unsubscribe, on, fetchMeta]);

  // Polling fallback when the socket is down (10s, like SystemStackView).
  useEffect(() => {
    if (!enabled || connected) return;
    const interval = window.setInterval(() => void fetchMeta(), 10_000);
    return () => window.clearInterval(interval);
  }, [enabled, connected, fetchMeta]);

  return { meta, loading, error, payloadToken, changedIds, socketConnected: connected, refresh };
}
