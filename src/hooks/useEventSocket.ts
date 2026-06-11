import { useEffect, useRef, useCallback, useState } from "react";

interface EventSocketState {
  connected: boolean;
  clientId: string | null;
}

type EventHandler = (data: unknown) => void;

interface ServerMessage {
  type?: "connected" | "subscribed" | "unsubscribed" | "pong" | "error";
  clientId?: string;
  channel?: string;
  event?: string;
  data?: unknown;
  message?: string;
}

/**
 * Hook for connecting to the EventServer WebSocket.
 * Provides subscription management and event handling.
 *
 * @example
 * ```tsx
 * const { connected, subscribe, on } = useEventSocket();
 *
 * useEffect(() => {
 *   if (!connected) return;
 *
 *   subscribe('bridge', { scope: '/path/to/scope' });
 *   const unsub = on('bridge', 'updated', (data) => {
 *     console.log('Bridge updated:', data);
 *   });
 *
 *   return () => {
 *     unsub();
 *     unsubscribe('bridge');
 *   };
 * }, [connected]);
 * ```
 */
export function useEventSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const [state, setState] = useState<EventSocketState>({
    connected: false,
    clientId: null,
  });
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttempts = useRef(0);
  const pendingSubscriptions = useRef<Array<{ channel: string; params: Record<string, unknown> }>>(
    []
  );
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (typeof window === "undefined") return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Same-origin + base path, no explicit port: the `${basePath}/events`
    // upgrade is hosted on the Next origin (server/app-server.ts) and proxied
    // to the internal ws-server, so the URL that loaded the page is the URL
    // that carries events. Correct in all three modes:
    //   unprefixed local dev      ws://localhost:3000/events
    //   raw-tailnet Electron      ws://xochipilli:3000/hilt/events
    //   Tailscale Serve gateway   wss://xochipilli.tailc0acaa.ts.net/hilt/events
    // The `|| "localhost:3000"` covers the file:// / empty-host case.
    const host = window.location.host || "localhost:3000";
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const url = `${protocol}//${host}${base}/events`;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      reconnectAttempts.current = 0;
      setState((s) => ({ ...s, connected: true }));

      // Re-send pending subscriptions
      pendingSubscriptions.current.forEach(({ channel, params }) => {
        ws.send(JSON.stringify({ type: "subscribe", channel, params }));
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);

        if (msg.type === "connected" && msg.clientId) {
          setState((s) => ({ ...s, clientId: msg.clientId! }));
        } else if (msg.channel && msg.event) {
          // This is an event message, route to handlers
          const key = `${msg.channel}:${msg.event}`;
          const handlers = handlersRef.current.get(key);
          handlers?.forEach((h) => h(msg.data));
        }
      } catch (err) {
        console.error("[useEventSocket] Error parsing message:", err);
      }
    };

    ws.onerror = () => {
      // WebSocket errors in browsers don't contain useful details
      // The actual error reason will be in the onclose event
      // Only log once to avoid spam
      if (reconnectAttempts.current === 0) {
        console.warn("[useEventSocket] Connection failed - event server may not be running");
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;

      setState({ connected: false, clientId: null });

      // Exponential backoff reconnect (silently after first attempt)
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
      reconnectAttempts.current++;
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  /**
   * Subscribe to a channel with optional params for filtering
   */
  const subscribe = useCallback((channel: string, params: Record<string, unknown> = {}) => {
    // Track subscription for reconnection
    const existing = pendingSubscriptions.current.find((s) => s.channel === channel);
    if (existing) {
      existing.params = params;
    } else {
      pendingSubscriptions.current.push({ channel, params });
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", channel, params }));
    }
  }, []);

  /**
   * Unsubscribe from a channel
   */
  const unsubscribe = useCallback((channel: string) => {
    // Remove from pending subscriptions
    pendingSubscriptions.current = pendingSubscriptions.current.filter(
      (s) => s.channel !== channel
    );

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "unsubscribe", channel }));
    }
  }, []);

  /**
   * Register a handler for a specific channel:event
   * Returns cleanup function
   */
  const on = useCallback((channel: string, event: string, handler: EventHandler) => {
    const key = `${channel}:${event}`;

    if (!handlersRef.current.has(key)) {
      handlersRef.current.set(key, new Set());
    }
    handlersRef.current.get(key)!.add(handler);

    // Return cleanup function
    return () => {
      handlersRef.current.get(key)?.delete(handler);
    };
  }, []);

  return {
    connected: state.connected,
    clientId: state.clientId,
    subscribe,
    unsubscribe,
    on,
  };
}
