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
 *   subscribe('sessions', { scope: '/path/to/scope' });
 *   const unsub = on('sessions', 'updated', (data) => {
 *     console.log('Session updated:', data);
 *   });
 *
 *   return () => {
 *     unsub();
 *     unsubscribe('sessions');
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
  const wsPortRef = useRef<number | null>(null);

  // Fetch WebSocket port from API
  const fetchPort = useCallback(async (): Promise<number | null> => {
    if (wsPortRef.current) return wsPortRef.current;
    if (typeof window === "undefined") return null;

    try {
      const res = await fetch("/api/ws-port");
      if (res.ok) {
        const data = await res.json();
        wsPortRef.current = data.port;
        return data.port;
      }
    } catch (err) {
      console.error("[useEventSocket] Failed to fetch WS port:", err);
    }
    return null;
  }, []);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const port = await fetchPort();
    if (!port || !mountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//localhost:${port}/events`;

    console.log("[useEventSocket] Connecting to:", url);
    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      console.log("[useEventSocket] Connected");
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

    ws.onerror = (err) => {
      console.error("[useEventSocket] WebSocket error:", err);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;

      console.log("[useEventSocket] Disconnected");
      setState({ connected: false, clientId: null });

      // Exponential backoff reconnect
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
      reconnectAttempts.current++;
      console.log(`[useEventSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    wsRef.current = ws;
  }, [fetchPort]);

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
